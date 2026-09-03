#include "sysapi.h"

// common.h מביא את windows.h, שעליו כותרות המערכת שמתחת נשענות. ראו
// ההערה בראש common.h — סדר ההכללה כאן אינו סתמי.
#include "common.h"
#include "paths.h"

#include <shellapi.h>
#include <shobjidl.h>
#include <tlhelp32.h>

namespace otz::sysapi {
namespace {

// אורך מרבי של שם מפתח ברג'יסטרי (255 תווים), ועוד תו סיום.
constexpr DWORD kMaxKeyNameChars = 256;

// חוצץ לקריאת ערך מהרג'יסטרי. נתיב התקנה לא מתקרב לזה; מפתח חריג
// שכן — מדולג.
constexpr DWORD kMaxValueBytes = 8192;

// גודל החוצץ ל-`QueryFullProcessImageNameW`. `MAX_PATH` אינו מספיק —
// נתיב ארוך אפשרי, ואז הקריאה הייתה נכשלת דווקא במקרה הלא-שגרתי
// שבגללו כל המנגנון הזה קיים.
constexpr DWORD kMaxProcessPathChars = 32768;

// שמות התהליך של אוצריא. חייב להישאר תואם ל-`processNamesFor`
// בגרסת ה-Flutter.
const wchar_t* const kOtzariaProcessNames[] = {L"otzaria.exe"};

std::wstring ToLower(std::wstring text) {
  CharLowerBuffW(text.data(), static_cast<DWORD>(text.size()));
  return text;
}

// האם הטקסט מזכיר את אוצריא — כך נבדק גם ה-`DisplayName` מהרג'יסטרי.
// פורט של `OtzariaAppLocator.mentionsOtzaria`.
bool MentionsOtzaria(const std::wstring& text) {
  const std::wstring lower = ToLower(text);
  return lower.find(L"otzaria") != std::wstring::npos ||
         lower.find(L"אוצריא") != std::wstring::npos;
}

// ── רג'יסטרי ────────────────────────────────────────────────────────────────

class ScopedKey {
 public:
  ~ScopedKey() {
    if (key_ != nullptr) RegCloseKey(key_);
  }
  HKEY* put() { return &key_; }
  HKEY get() const { return key_; }

 private:
  HKEY key_ = nullptr;
};

// מרחיב `%ProgramFiles%\Otzaria` לנתיב אמיתי: `REG_EXPAND_SZ` מוחזר
// כפי שנכתב, ובלי ההרחבה הוא נתיב עם אחוזים שלא קיים על הדיסק.
std::wstring ExpandVariables(const std::wstring& value) {
  const DWORD needed = ExpandEnvironmentStringsW(value.c_str(), nullptr, 0);
  if (needed == 0) return value;
  std::wstring expanded(needed, L'\0');
  const DWORD written =
      ExpandEnvironmentStringsW(value.c_str(), expanded.data(), needed);
  if (written == 0) return value;
  expanded.resize(written == 0 ? 0 : written - 1);
  return expanded;
}

std::wstring ReadRegistryString(HKEY key, const wchar_t* value_name) {
  std::vector<BYTE> data(kMaxValueBytes);
  DWORD size = kMaxValueBytes;
  DWORD type = 0;
  if (RegQueryValueExW(key, value_name, nullptr, &type, data.data(), &size) !=
      ERROR_SUCCESS) {
    return {};
  }
  if (type != REG_SZ && type != REG_EXPAND_SZ) return {};

  // הערך אינו חייב להסתיים ב-NUL, ולכן החיתוך ידני לפי הגודל שהוחזר.
  std::wstring text(reinterpret_cast<const wchar_t*>(data.data()),
                    size / sizeof(wchar_t));
  const size_t end = text.find(L'\0');
  if (end != std::wstring::npos) text.resize(end);

  // trim
  const size_t first = text.find_first_not_of(L" \t");
  if (first == std::wstring::npos) return {};
  const size_t last = text.find_last_not_of(L" \t");
  text = text.substr(first, last - first + 1);

  return type == REG_EXPAND_SZ ? ExpandVariables(text) : text;
}

// שולף את קובץ ההרצה מתוך פקודת הסרה: מסיר מירכאות ומוריד ארגומנטים
// שבאים אחריו (`…\unins000.exe /SILENT`). פורט של
// `WindowsInstallRegistry.executableOf`.
std::wstring ExecutableOfUninstallString(const std::wstring& value) {
  if (value.empty()) return {};
  if (value.front() == L'"') {
    const size_t close = value.find(L'"', 1);
    return close == std::wstring::npos ? std::wstring{}
                                       : value.substr(1, close - 1);
  }
  const std::wstring lower = ToLower(value);
  const size_t exe = lower.find(L".exe");
  if (exe == std::wstring::npos) return value;
  return value.substr(0, exe + 4);
}

bool DirectoryExists(const std::wstring& path) {
  const DWORD attributes = GetFileAttributesW(path.c_str());
  return attributes != INVALID_FILE_ATTRIBUTES &&
         (attributes & FILE_ATTRIBUTE_DIRECTORY) != 0;
}

// תיקיית ההתקנה של רישום פתוח, או ריק כשאין תיקייה מוחלטת שקיימת.
//
// ה-`DisplayName` הוא הסימן היחיד שנבדק לזהות — `InstallLocation`
// שמזכיר "otzaria" יכול להיות של תוכנה אחרת לגמרי.
std::wstring InstallDirOf(HKEY key) {
  std::wstring dir = ReadRegistryString(key, L"InstallLocation");
  if (dir.empty()) {
    // גיבוי: המתקין רשם רק את פקודת ההסרה — ה-uninstaller יושב
    // בתיקיית ההתקנה עצמה, כך שהתיקייה שלו היא התשובה.
    const std::wstring uninstall =
        ExecutableOfUninstallString(ReadRegistryString(key, L"UninstallString"));
    if (uninstall.empty()) return {};
    const size_t slash = uninstall.find_last_of(L"\\/");
    if (slash == std::wstring::npos) return {};
    dir = uninstall.substr(0, slash);
  }
  if (dir.empty()) return {};

  // רק תיקייה מוחלטת שקיימת בפועל: `UninstallString` של MSI הוא
  // `MsiExec.exe /X{GUID}`, ומשם יוצא נתיב חסר משמעות.
  if (dir.size() < 3 || dir[1] != L':') return {};
  if (!DirectoryExists(dir)) return {};
  return dir;
}

void CollectInstallDirs(HKEY hive, REGSAM access,
                        std::vector<std::wstring>& dirs,
                        std::vector<std::wstring>& seen_lower) {
  ScopedKey uninstall;
  if (RegOpenKeyExW(hive,
                    L"SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\Uninstall",
                    0, access, uninstall.put()) != ERROR_SUCCESS) {
    return;
  }

  std::wstring name(kMaxKeyNameChars, L'\0');
  for (DWORD index = 0;; ++index) {
    DWORD length = kMaxKeyNameChars;
    const LSTATUS status = RegEnumKeyExW(uninstall.get(), index, name.data(),
                                         &length, nullptr, nullptr, nullptr,
                                         nullptr);
    // שם ארוך מהחוצץ פוסל את המפתח הבודד ולא את ההמשך: עצירה כאן הייתה
    // מוותרת בשקט על כל הרישומים שאחריו, ואוצריא עלולה להיות ביניהם.
    if (status == ERROR_MORE_DATA) continue;
    if (status != ERROR_SUCCESS) break;

    const std::wstring sub_key(name.data(), length);
    ScopedKey entry;
    if (RegOpenKeyExW(uninstall.get(), sub_key.c_str(), 0, access, entry.put()) !=
        ERROR_SUCCESS) {
      continue;
    }

    const std::wstring display_name = ReadRegistryString(entry.get(), L"DisplayName");
    if (display_name.empty() || !MentionsOtzaria(display_name)) continue;

    const std::wstring dir = InstallDirOf(entry.get());
    if (dir.empty()) continue;

    const std::wstring lower = ToLower(dir);
    bool already = false;
    for (const auto& existing : seen_lower) {
      if (existing == lower) {
        already = true;
        break;
      }
    }
    if (already) continue;
    seen_lower.push_back(lower);
    dirs.push_back(dir);
  }
}

// ── תהליכים ─────────────────────────────────────────────────────────────────

std::wstring ImagePathOfPid(DWORD process_id) {
  HANDLE process =
      OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, FALSE, process_id);
  if (process == nullptr) return {};

  std::wstring buffer(kMaxProcessPathChars, L'\0');
  DWORD size = kMaxProcessPathChars;
  const BOOL ok = QueryFullProcessImageNameW(process, 0, buffer.data(), &size);
  CloseHandle(process);
  if (!ok) return {};
  buffer.resize(size);
  return buffer;
}

}  // namespace

bool Init() {
  // APARTMENTTHREADED: דיאלוג הקבצים ו-ShellExecute הם COM/STA.
  const HRESULT result =
      CoInitializeEx(nullptr, COINIT_APARTMENTTHREADED | COINIT_DISABLE_OLE1DDE);
  return SUCCEEDED(result) || result == RPC_E_CHANGED_MODE;
}

Result OpenExternalUrl(const std::wstring& url) {
  // ShellExecute מחזיר "handle" שקטן מ-32 פירושו שגיאה. זה ה-API
  // שמוסר כתובת למטפל הפרוטוקול, וזה בדיוק מה שנדרש כאן.
  const HINSTANCE result =
      ShellExecuteW(nullptr, L"open", url.c_str(), nullptr, nullptr, SW_SHOWNORMAL);
  const auto code = reinterpret_cast<INT_PTR>(result);
  if (code > 32) return Result::Ok("true");

  const std::wstring reason = MessageForError(static_cast<DWORD>(code));
  return Result::Fail(L"פתיחת הכתובת נכשלה. ודא שאוצריא מותקנת במחשב.\n(" +
                      reason + L")");
}

Result LaunchDetached(const std::wstring& exe_path, const std::wstring& argument) {
  const DWORD attributes = GetFileAttributesW(exe_path.c_str());
  if (attributes == INVALID_FILE_ATTRIBUTES) {
    return Result::Fail(L"קובץ ההרצה של אוצריא לא נמצא:\n" + exe_path);
  }

  // שורת הפקודה: ה-exe במירכאות ואחריו הארגומנט במירכאות.
  // `CreateProcessW` כותב לתוך המאגר הזה, ולכן הוא אינו const.
  std::wstring command = L"\"" + exe_path + L"\" \"" + argument + L"\"";

  STARTUPINFOW startup{};
  startup.cb = sizeof(startup);
  PROCESS_INFORMATION process{};

  // ה-cwd הוא תיקיית ההתקנה של אוצריא — שם היא מצפה למצוא את ה-DLL
  // וה-data שלה, בדיוק כמו כל אפליקציית Flutter.
  std::wstring working_dir = exe_path;
  const size_t slash = working_dir.find_last_of(L"\\/");
  if (slash != std::wstring::npos) working_dir.resize(slash);

  const BOOL ok = CreateProcessW(exe_path.c_str(), command.data(), nullptr,
                                 nullptr, FALSE, DETACHED_PROCESS, nullptr,
                                 working_dir.c_str(), &startup, &process);
  if (!ok) {
    return Result::Fail(L"הרצת אוצריא נכשלה: " + MessageForError(GetLastError()));
  }
  // מנותק: לא ממתינים לה. סגירת ה-handles אינה הורגת את התהליך.
  CloseHandle(process.hThread);
  CloseHandle(process.hProcess);
  return Result::Ok("true");
}

Result SaveFileDialog(HWND owner, const std::wstring& suggested_name) {
  IFileSaveDialog* dialog = nullptr;
  HRESULT hr = CoCreateInstance(CLSID_FileSaveDialog, nullptr, CLSCTX_INPROC_SERVER,
                                IID_PPV_ARGS(&dialog));
  if (FAILED(hr) || dialog == nullptr) {
    return Result::Fail(L"פתיחת חלון השמירה נכשלה");
  }

  const COMDLG_FILTERSPEC filters[] = {
      {L"קובץ תוסף של אוצריא", L"*.otzplugin"},
      {L"כל הקבצים", L"*.*"},
  };
  dialog->SetFileTypes(ARRAYSIZE(filters), filters);
  dialog->SetDefaultExtension(L"otzplugin");
  if (!suggested_name.empty()) dialog->SetFileName(suggested_name.c_str());

  hr = dialog->Show(owner);
  if (hr == HRESULT_FROM_WIN32(ERROR_CANCELLED)) {
    dialog->Release();
    // ביטול אינו שגיאה — הצד ה-JS מקבל null ופשוט לא עושה כלום.
    return Result::Ok("null");
  }
  if (FAILED(hr)) {
    dialog->Release();
    return Result::Fail(L"חלון השמירה נכשל");
  }

  IShellItem* item = nullptr;
  std::wstring chosen;
  if (SUCCEEDED(dialog->GetResult(&item)) && item != nullptr) {
    PWSTR path = nullptr;
    if (SUCCEEDED(item->GetDisplayName(SIGDN_FILESYSPATH, &path)) &&
        path != nullptr) {
      chosen = path;
      CoTaskMemFree(path);
    }
    item->Release();
  }
  dialog->Release();

  if (chosen.empty()) return Result::Fail(L"לא נבחר מקום לשמירה");
  return Result::Ok(JsonString(chosen));
}

Result ReadExeProductVersion(const std::wstring& exe_path) {
  DWORD handle = 0;
  const DWORD size = GetFileVersionInfoSizeW(exe_path.c_str(), &handle);
  if (size == 0) return Result::Ok("null");

  std::vector<BYTE> data(size);
  if (!GetFileVersionInfoW(exe_path.c_str(), 0, size, data.data())) {
    return Result::Ok("null");
  }

  // שלב 1: זוג (language, codepage) שקיים בקובץ, כדי לדעת איזה
  // תת-בלוק StringFileInfo לקרוא. כמעט תמיד יש בלוק אחד יחיד.
  void* block = nullptr;
  UINT length = 0;
  if (!VerQueryValueW(data.data(), L"\\VarFileInfo\\Translation", &block,
                      &length) ||
      length < 4 || block == nullptr) {
    return Result::Ok("null");
  }
  const auto* translation = static_cast<const WORD*>(block);

  wchar_t sub_block[64];
  wsprintfW(sub_block, L"\\StringFileInfo\\%04x%04x\\ProductVersion",
            translation[0], translation[1]);

  // שלב 2: ProductVersion מתוך תת-הבלוק הזה.
  if (!VerQueryValueW(data.data(), sub_block, &block, &length) ||
      block == nullptr || length == 0) {
    return Result::Ok("null");
  }

  std::wstring version(static_cast<const wchar_t*>(block), length);
  while (!version.empty() && version.back() == L'\0') version.pop_back();
  if (version.empty()) return Result::Ok("null");
  return Result::Ok(JsonString(version));
}

Result OtzariaRegistryInstallDirs() {
  std::vector<std::wstring> dirs;
  std::vector<std::wstring> seen_lower;

  // שלושת המקומות שבהם ווינדוס מחזיק רישומי הסרה, לפי סדר עדיפות:
  // התקנה למשתמש הנוכחי (ברירת המחדל של המתקין של אוצריא) לפני התקנה
  // לכלל המחשב, ושם 64 סיביות לפני 32 — שתי התצוגות נפרדות ברג'יסטרי.
  CollectInstallDirs(HKEY_CURRENT_USER, KEY_READ, dirs, seen_lower);
  CollectInstallDirs(HKEY_LOCAL_MACHINE, KEY_READ | KEY_WOW64_64KEY, dirs,
                     seen_lower);
  CollectInstallDirs(HKEY_LOCAL_MACHINE, KEY_READ | KEY_WOW64_32KEY, dirs,
                     seen_lower);

  std::vector<std::string> items;
  items.reserve(dirs.size());
  for (const auto& dir : dirs) items.push_back(JsonString(dir));
  return Result::Ok(JsonArray(items));
}

Result FindRunningOtzaria() {
  HANDLE snapshot = CreateToolhelp32Snapshot(TH32CS_SNAPPROCESS, 0);
  if (snapshot == INVALID_HANDLE_VALUE) {
    // כשל בבדיקה עצמה מדווח כ"רצה", כמו ב-`RunningOtzariaLocator.probe`:
    // עדיף לחשוב שאוצריא פתוחה מלהניח שאינה.
    return Result::Ok(JsonObject({
        {"running", JsonBool(true)},
        {"launchPath", "null"},
    }));
  }

  PROCESSENTRY32W entry{};
  entry.dwSize = sizeof(entry);
  bool running = false;
  std::wstring launch_path;
  const std::wstring self = ToLower(ExecutablePath());

  if (Process32FirstW(snapshot, &entry)) {
    do {
      const std::wstring name = ToLower(entry.szExeFile);
      bool matches = false;
      for (const wchar_t* candidate : kOtzariaProcessNames) {
        if (name == candidate) {
          matches = true;
          break;
        }
      }
      if (!matches) continue;

      running = true;
      if (!launch_path.empty()) continue;

      const std::wstring path = ImagePathOfPid(entry.th32ProcessID);
      // ביטוח זול: החנות עצמה לעולם לא תיקרא otzaria.exe.
      if (path.empty() || ToLower(path) == self) continue;
      launch_path = path;
    } while (Process32NextW(snapshot, &entry));
  }
  CloseHandle(snapshot);

  return Result::Ok(JsonObject({
      {"running", JsonBool(running)},
      {"launchPath", launch_path.empty() ? "null" : JsonString(launch_path)},
  }));
}

bool IsSystemDarkMode() {
  ScopedKey key;
  if (RegOpenKeyExW(HKEY_CURRENT_USER,
                    L"SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\Themes\\"
                    L"Personalize",
                    0, KEY_READ, key.put()) != ERROR_SUCCESS) {
    return false;
  }
  DWORD value = 1;
  DWORD size = sizeof(value);
  DWORD type = 0;
  if (RegQueryValueExW(key.get(), L"AppsUseLightTheme", nullptr, &type,
                       reinterpret_cast<BYTE*>(&value), &size) != ERROR_SUCCESS ||
      type != REG_DWORD) {
    return false;
  }
  // הערך הוא "השתמש בערכה בהירה", ולכן 0 = כהה.
  return value == 0;
}

}  // namespace otz::sysapi
