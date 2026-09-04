#include "paths.h"

#include <shlobj.h>

#include <vector>

#include "common.h"

namespace otz {
namespace {

// יוצר את התיקייה ובודק כתיבה **בפועל** (קובץ בדיקה), ולא רק שהיצירה לא
// נכשלה: בווינדוס תיקייה יכולה להיווצר ואז לחסום כתיבה בגלל ACL. מחזיר
// את קוד השגיאה, או 0 בהצלחה — הקורא מחליט אם יש מסלול חלופי.
DWORD ProbeWritable(const std::wstring& dir) {
  if (!CreateDirectories(dir)) {
    const DWORD error = GetLastError();
    return error == 0 ? ERROR_ACCESS_DENIED : error;
  }

  const std::wstring probe = JoinPath(dir, L".write-test");
  HANDLE file = CreateFileW(probe.c_str(), GENERIC_WRITE, 0, nullptr,
                            CREATE_ALWAYS,
                            FILE_ATTRIBUTE_TEMPORARY | FILE_FLAG_DELETE_ON_CLOSE,
                            nullptr);
  if (file == INVALID_HANDLE_VALUE) {
    const DWORD error = GetLastError();
    return error == 0 ? ERROR_ACCESS_DENIED : error;
  }
  // FILE_FLAG_DELETE_ON_CLOSE מנקה את קובץ הבדיקה גם אם התוכנה תיפול כאן.
  CloseHandle(file);
  return 0;
}

// `true` אם הקטלוג נושא תוכן. תיקייה ריקה על כונן נעול אינה "מצב קריאה"
// אלא סתם מקום שאין ממנו מה להתקין.
bool HasCatalog(const std::wstring& data_dir) {
  const std::wstring catalog = JoinPath(data_dir, L"catalog.json");
  const DWORD attributes = GetFileAttributesW(catalog.c_str());
  return attributes != INVALID_FILE_ATTRIBUTES &&
         (attributes & FILE_ATTRIBUTE_DIRECTORY) == 0;
}

// תיקיית הכתיבה שבמחשב הזה, או ריק כשאין ממה לגזור אותה.
std::wstring MachineStateDir() {
  PWSTR base = nullptr;
  if (FAILED(SHGetKnownFolderPath(FOLDERID_LocalAppData, 0, nullptr, &base)) ||
      base == nullptr) {
    return {};
  }
  std::wstring result = JoinPath(base, kMachineDirName);
  CoTaskMemFree(base);
  return result;
}

}  // namespace

std::wstring JoinPath(std::wstring_view left, std::wstring_view right) {
  if (left.empty()) return std::wstring(right);
  if (right.empty()) return std::wstring(left);

  std::wstring result(left);
  if (result.back() != L'\\' && result.back() != L'/') result += L'\\';
  size_t start = 0;
  while (start < right.size() && (right[start] == L'\\' || right[start] == L'/')) {
    ++start;
  }
  result += right.substr(start);
  return result;
}

std::wstring ExecutablePath() {
  // חוצץ גדול ולא MAX_PATH: נתיב ארוך אפשרי, וכשל דווקא במקרה הלא-שגרתי
  // הוא בדיוק מה שלא מתגלה בבדיקות.
  std::wstring buffer(32768, L'\0');
  const DWORD length =
      GetModuleFileNameW(nullptr, buffer.data(), static_cast<DWORD>(buffer.size()));
  buffer.resize(length);
  return buffer;
}

std::wstring ExecutableDir() {
  std::wstring path = ExecutablePath();
  const size_t slash = path.find_last_of(L"\\/");
  return slash == std::wstring::npos ? path : path.substr(0, slash);
}

bool CreateDirectories(const std::wstring& path) {
  if (path.empty()) return false;

  const DWORD attributes = GetFileAttributesW(path.c_str());
  if (attributes != INVALID_FILE_ATTRIBUTES) {
    return (attributes & FILE_ATTRIBUTE_DIRECTORY) != 0;
  }

  // ההורים קודם. `CreateDirectoryW` אינו יוצר שרשרת, ו-`SHCreateDirectoryEx`
  // אינו מקבל נתיבים יחסיים — כאן הנתיבים תמיד מוחלטים, אבל הלולאה
  // הזאת עולה כמה שורות וחוסכת את התלות ב-shell.
  //
  // ⚠️ לולאה ולא רקורסיה, אף שהרקורסיה הייתה קצרה יותר: חלק מהנתיבים
  // כאן נבנים מהאינדקס של החבילה (ראו `SafeRelativePath` ב-overlay.cpp),
  // ושם מספר המקטעים אינו מוגבל בשום דבר. נתיב עם עשרות אלפי מקטעים
  // היה מפוצץ את המחסנית — קריסה בלי הודעה — במקום להיכשל על נתיב ארוך
  // מדי.
  //
  // הכיוון הוא מהעמוק לרדוד ואז חזרה: עוצרים על ההורה הקיים הראשון
  // ויוצרים ממנו ולמטה, בדיוק כמו שהרקורסיה עשתה. כך נתיב UNC
  // (`\\server\share\...`) אינו גורר ניסיון ליצור את `\\server` עצמו.
  std::vector<size_t> missing;
  for (size_t slash = path.find_last_of(L"\\/");
       slash != std::wstring::npos && slash > 0;
       slash = path.find_last_of(L"\\/", slash - 1)) {
    const std::wstring parent = path.substr(0, slash);
    // `C:` לבדו אינו תיקייה שניתן ליצור — עוצרים על שורש הכונן.
    if (parent.size() == 2 && parent[1] == L':') break;

    const DWORD parent_attributes = GetFileAttributesW(parent.c_str());
    if (parent_attributes != INVALID_FILE_ATTRIBUTES) {
      // קובץ במקום שבו צריכה לשבת תיקייה — אין דרך להמשיך מכאן.
      if ((parent_attributes & FILE_ATTRIBUTE_DIRECTORY) == 0) return false;
      break;  // ההורה הקיים הראשון — מכאן ולמטה יוצרים
    }
    missing.push_back(slash);
  }

  for (auto it = missing.rbegin(); it != missing.rend(); ++it) {
    const std::wstring parent = path.substr(0, *it);
    if (!CreateDirectoryW(parent.c_str(), nullptr) &&
        GetLastError() != ERROR_ALREADY_EXISTS) {
      return false;
    }
  }

  if (CreateDirectoryW(path.c_str(), nullptr)) return true;
  // מקבילות: תהליך אחר יצר אותה בינתיים.
  return GetLastError() == ERROR_ALREADY_EXISTS;
}

std::wstring AppPaths::PluginsDir() const {
  return JoinPath(data_dir, L"plugins");
}

std::wstring AppPaths::CatalogPath() const {
  return JoinPath(data_dir, L"catalog.json");
}

std::wstring AppPaths::WebViewCacheDir() const {
  // ראו ההסבר על [cache_dir] ב-paths.h: תמיד במחשב, מחוץ ל-`Data\`.
  // הנפילה ל-`state_dir` היא למקרה שאין `%LOCALAPPDATA%` בכלל — ה-WebView2
  // חייב מקום כותב, אחרת הוא אינו עולה.
  const std::wstring base = cache_dir.empty() ? state_dir : cache_dir;
  return JoinPath(base, L"webview2");
}

std::wstring AppPaths::StateFilePath() const {
  return JoinPath(state_dir, L"state.json");
}

std::wstring AppPaths::LogFilePath() const {
  SYSTEMTIME now;
  GetLocalTime(&now);
  wchar_t name[32];
  wsprintfW(name, L"store-%04d-%02d-%02d.log", now.wYear, now.wMonth, now.wDay);
  return JoinPath(JoinPath(state_dir, L"logs"), name);
}

AppPaths ResolveAppPaths() {
  AppPaths paths;
  paths.data_dir = JoinPath(ExecutableDir(), kDataDirName);
  // המאגר של ה-WebView2 אינו נתוני משתמש ואינו נוסע עם הכונן — ראו
  // [AppPaths::cache_dir]. הוא נקבע כאן ואינו תלוי בשאלה אם `Data\`
  // כותבת.
  paths.cache_dir = MachineStateDir();

  const DWORD failure = ProbeWritable(paths.data_dir);
  if (failure == 0) {
    paths.state_dir = paths.data_dir;
    return paths;
  }

  // הבדיקה הזו רצה **רק** אחרי כשל כתיבה, כדי שההרצה הרגילה תישאר
  // סבב I/O אחד.
  if (HasCatalog(paths.data_dir)) {
    const std::wstring machine = MachineStateDir();
    if (!machine.empty() && ProbeWritable(machine) == 0) {
      paths.state_dir = machine;
      paths.read_only = true;
      return paths;
    }
  }

  // אין נפילה חזרה לתיקיית המשתמש עבור המראה עצמה: מיקום שאי אפשר
  // להוריד אליו פירושו שהתוכנה הותקנה במקום הלא נכון, וזה מה שצריך
  // להיאמר.
  //
  // אבל תיקיית ה**כתיבה** כן נופלת למחשב, גם במסלול הכשל הזה: ה-WebView2
  // מחייב תיקיית נתונים שניתן לכתוב בה, ובלעדיה הוא אינו עולה בכלל — ואז
  // אין לנו איפה להציג את ההסבר עצמו. מסך השגיאה הוא כל מה שנשאר לתוכנה
  // לעשות כאן, והוא לא יכול להיות התלוי היחיד בדבר שכרגע נכשל.
  const std::wstring machine_fallback = MachineStateDir();
  paths.state_dir = (!machine_fallback.empty() &&
                     ProbeWritable(machine_fallback) == 0)
                        ? machine_fallback
                        : paths.data_dir;
  paths.error = L"לא ניתן לכתוב לתיקיית הנתונים שליד התוכנה:\n" +
                paths.data_dir + L"\n\n" + MessageForError(failure) +
                L"\n\nיש להעביר את התוכנה לתיקייה שניתן לכתוב בה — "
                L"למשל לתיקיית ההורדות או לכונן נייד — ולהריץ אותה משם.";
  return paths;
}

}  // namespace otz
