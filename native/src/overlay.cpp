#include "overlay.h"

#include <commctrl.h>

#include <cstdio>
#include <cstring>
#include <cwchar>
#include <vector>

#include "paths.h"
#include "resource.h"

namespace otz {
namespace {

// גודל הגוש שבו זורם המטען. ‎1MB הוא המקום שבו סיבובי ה-I/O כבר זניחים
// מול הזמן שהכונן עצמו לוקח, וגדול ממנו רק תופס זיכרון.
//
// ⚠️ **זה כל מה שמוקצה**, בלי קשר לגודל המטען: ‎96MB לא נטענים לזיכרון
// בשום שלב, וזו הסיבה שהפורמט אינו דחוס (ראו overlay.h).
constexpr size_t kCopyChunk = 1u << 20;

// תקרה שפויה לאינדקס. הוא מטא-דאטה בלבד — נתיב וגודל לכל קובץ — ומראה
// של אלפי קבצים מייצרת פחות מ-‎1MB. ערך גדול מכאן פירושו footer פגום,
// ואסור שהוא יגרור הקצאה של גיגה-בייט.
constexpr uint64_t kMaxIndexBytes = 64ull * 1024 * 1024;

// ── עזרי קבצים ───────────────────────────────────────────────────────────────

// סוגר את ה-handle בכל יציאה מהפונקציה.
//
// יש בקובץ הזה עשרות מסלולי כשל שכל אחד מהם מחזיר הודעה אחרת, ובקוד עם
// `CloseHandle` ידני בכל אחד מהם דליפה היא רק שאלה של זמן.
class ScopedHandle {
 public:
  explicit ScopedHandle(HANDLE handle) : handle_(handle) {}
  ~ScopedHandle() {
    if (valid()) CloseHandle(handle_);
  }
  ScopedHandle(const ScopedHandle&) = delete;
  ScopedHandle& operator=(const ScopedHandle&) = delete;

  HANDLE get() const { return handle_; }
  bool valid() const {
    return handle_ != nullptr && handle_ != INVALID_HANDLE_VALUE;
  }

 private:
  HANDLE handle_;
};

// קריאה מלאה מ-offset מוחלט. `ReadFile` רשאי להחזיר פחות ממה שביקשנו
// גם בלי שגיאה, ולכן הלולאה — קריאה חלקית שנחשבת מלאה היא בדיוק סוג
// הבאג שמתגלה רק על כונן איטי.
bool ReadAt(HANDLE file, uint64_t offset, void* buffer, size_t size) {
  LARGE_INTEGER at{};
  at.QuadPart = static_cast<LONGLONG>(offset);
  if (!SetFilePointerEx(file, at, nullptr, FILE_BEGIN)) return false;

  auto* out = static_cast<uint8_t*>(buffer);
  size_t done = 0;
  while (done < size) {
    const size_t left = size - done;
    const DWORD want = static_cast<DWORD>(left < kCopyChunk ? left : kCopyChunk);
    DWORD read = 0;
    if (!ReadFile(file, out + done, want, &read, nullptr) || read == 0) {
      return false;
    }
    done += read;
  }
  return true;
}

// כתיבה מלאה. אותו שיקול כמו ב-[ReadAt] — כתיבה חלקית אפשרית.
bool WriteAll(HANDLE file, const void* buffer, size_t size) {
  const auto* bytes = static_cast<const uint8_t*>(buffer);
  size_t done = 0;
  while (done < size) {
    DWORD written = 0;
    if (!WriteFile(file, bytes + done, static_cast<DWORD>(size - done), &written,
                   nullptr) ||
        written == 0) {
      return false;
    }
    done += written;
  }
  return true;
}

// שדות ה-footer וה-אינדקס הם little-endian, וזה גם הסדר של המעבד כאן.
// הקריאה עוברת ב-`memcpy` ולא ב-cast כדי לא להסתמך על יישור.
uint32_t LoadU32(const uint8_t* at) {
  uint32_t value = 0;
  memcpy(&value, at, sizeof(value));
  return value;
}

uint64_t LoadU64(const uint8_t* at) {
  uint64_t value = 0;
  memcpy(&value, at, sizeof(value));
  return value;
}

// מוחק קובץ יחיד. `read-only` מנוקה ומנסים שוב: קבצים שהועתקו מ-CD או
// מכונן שהוגן מפני כתיבה נושאים את הדגל הזה, ו-`DeleteFileW` נכשל עליו.
bool DeleteOne(const std::wstring& path) {
  if (DeleteFileW(path.c_str())) return true;
  const DWORD error = GetLastError();
  if (error == ERROR_FILE_NOT_FOUND || error == ERROR_PATH_NOT_FOUND) return true;
  if (error != ERROR_ACCESS_DENIED) return false;
  SetFileAttributesW(path.c_str(), FILE_ATTRIBUTE_NORMAL);
  return DeleteFileW(path.c_str()) != 0;
}

bool RemoveEmptyDir(const std::wstring& path) {
  if (RemoveDirectoryW(path.c_str())) return true;
  const DWORD error = GetLastError();
  if (error == ERROR_FILE_NOT_FOUND || error == ERROR_PATH_NOT_FOUND) return true;
  if (error != ERROR_ACCESS_DENIED) return false;
  SetFileAttributesW(path.c_str(), FILE_ATTRIBUTE_DIRECTORY);
  return RemoveDirectoryW(path.c_str()) != 0;
}

// המרה **קפדנית** ל-UTF-16 של נתיב שהגיע מהאינדקס.
//
// ⚠️ למה לא [Utf16] המשותף: הוא נועד לנתונים שכבר עברו אימות, ולכן הוא
// מתרגם רצף UTF-8 פגום לתו ההחלפה (U+FFFD) במקום להיכשל. כאן זה בדיוק
// מה שאסור — בייט שנפגם בהעתקה היה הופך לנתיב אחר שנפרס בשקט תחת שם
// שגוי. `MB_ERR_INVALID_CHARS` הופך את זה לכשל.
bool StrictUtf16(const std::string& utf8, std::wstring& out) {
  if (utf8.empty()) return false;
  const int size =
      MultiByteToWideChar(CP_UTF8, MB_ERR_INVALID_CHARS, utf8.data(),
                          static_cast<int>(utf8.size()), nullptr, 0);
  if (size <= 0) return false;
  out.assign(static_cast<size_t>(size), L'\0');
  return MultiByteToWideChar(CP_UTF8, MB_ERR_INVALID_CHARS, utf8.data(),
                             static_cast<int>(utf8.size()), out.data(),
                             size) == size;
}

// ממיר נתיב מהאינדקס (POSIX, יחסי ל-`Data\`) לנתיב ווינדוס יחסי.
//
// ⚠️ החבילה נבנית אצלנו, אבל היא מגיעה למשתמש כקובץ שהורד מהרשת — ולכן
// האינדקס שבה הוא **קלט לא-מהימן** לכל דבר. בלי הבדיקות האלה `..\..\`
// או `C:\` בשדה נתיב היו הופכים את הפריסה לכתיבה חופשית לכל מקום
// בכונן. אותו שיקול בדיוק כמו ב-`ReadDataFile` שב-main.cpp.
bool SafeRelativePath(const std::string& utf8, std::wstring& out) {
  std::wstring wide;
  if (!StrictUtf16(utf8, wide)) return false;

  // תווים שאין להם מה לחפש בנתיב:
  //   `:`       כונן (`C:`) או זרם חלופי (`file:stream`) — שניהם יוצאים
  //             מהתיקייה.
  //   `<>"|?*`  פסולים בשם קובץ בווינדוס; `CreateFileW` היה נכשל עליהם
  //             ממילא, וכשל מוקדם אומר "החבילה פגומה" במקום "לא ניתן
  //             לכתוב".
  //   `\0`      ⚠️ הוא UTF-8 **חוקי**, ולכן `MB_ERR_INVALID_CHARS` אינו
  //             עוצר אותו — אבל `c_str()` כן נקטע בו. שני נתיבים
  //             שנבדלים רק אחריו היו נכתבים לאותו קובץ, הפריסה הייתה
  //             "מצליחה", והחותמת הייתה ננעלת על מראה חסרת קובץ שלא
  //             תיפרס שוב לעולם. כאן נופלים גם שאר תווי הבקרה.
  for (const wchar_t c : wide) {
    if (c < 0x20) return false;
    if (wcschr(L"<>:\"|?*", c) != nullptr) return false;
  }

  out.clear();
  size_t start = 0;
  while (true) {
    const size_t slash = wide.find_first_of(L"/\\", start);
    const size_t end = slash == std::wstring::npos ? wide.size() : slash;
    const std::wstring segment = wide.substr(start, end - start);
    // מקטע ריק תופס גם נתיב מוחלט (`\foo`) וגם `//`; `.` ו-`..` הם
    // היציאה מהתיקייה עצמה.
    if (segment.empty() || segment == L"." || segment == L"..") return false;
    // ⚠️ **`..` שהתחפש.** ווינדוס גוזמת נקודות ורווחים מסוף מקטע,
    // ולכן `.. `, `...` ו-`. .` מגיעים למערכת הקבצים כ-`..` — כלומר
    // בדיוק היציאה מהתיקייה שנפסלה בשורה שמעל, אחרי שהשוואת המחרוזות
    // שם לא זיהתה אותם. הפסילה כאן היא של כל מקטע שנגמר בנקודה או
    // ברווח, וזה **מכיל** את כל המשפחה הזאת: מקטע שכולו נקודות ורווחים
    // נגמר בהכרח באחד מהם.
    //
    // אותה שורה סוגרת גם התנגשות שקטה: `a.` נוצר על הדיסק כ-`a`, ושתי
    // רשומות כאלה היו נכתבות לאותו קובץ בלי שאיש ידע. שם אמיתי במראה
    // אינו יכול להסתיים כך ממילא — מערכת הקבצים אינה מרשה ליצור אותו.
    if (segment.back() == L'.' || segment.back() == L' ') return false;
    if (!out.empty()) out += L'\\';
    out += segment;
    if (slash == std::wstring::npos) break;
    start = slash + 1;
  }
  return !out.empty();
}

std::wstring ParentOf(const std::wstring& path) {
  const size_t slash = path.find_last_of(L"\\/");
  return slash == std::wstring::npos ? std::wstring{} : path.substr(0, slash);
}

// ── חלון ההתקדמות ────────────────────────────────────────────────────────────

constexpr wchar_t kProgressClass[] = L"OtzariaPluginStoreSetupWindow";

// המחוון עובד ב"אלפיות" ולא באחוזים: הוא מצויר ברוחב של מאות פיקסלים,
// ורזולוציה של 1% הייתה נותנת קפיצות גלויות.
constexpr int kProgressRange = 1000;

// המידות בפיקסלים לוגיים (‎96 DPI); [ProgressWindow::Create] מכפיל אותן
// ב-DPI בפועל.
constexpr int kBoxWidth = 460;
constexpr int kBoxHeight = 152;
constexpr int kBoxMargin = 26;

// ה-DPI של המסך הראשי. החלון הזה קצר-חיים ונפתח במרכז המסך הראשי, ולכן
// אין כאן מעקב אחרי `WM_DPICHANGED` — הוא ייסגר הרבה לפני שמישהו יגרור
// אותו למסך שני.
int SystemDpi() {
  HDC screen = GetDC(nullptr);
  if (screen == nullptr) return 96;
  const int dpi = GetDeviceCaps(screen, LOGPIXELSX);
  ReleaseDC(nullptr, screen);
  return dpi > 0 ? dpi : 96;
}

LRESULT CALLBACK ProgressProc(HWND window, UINT message, WPARAM wparam,
                              LPARAM lparam) {
  switch (message) {
    case WM_CTLCOLORSTATIC:
      // בלי זה הטקסטים מצוירים על מלבן אפור-כפתור, והחלון נראה שבור.
      SetBkMode(reinterpret_cast<HDC>(wparam), TRANSPARENT);
      return reinterpret_cast<LRESULT>(GetSysColorBrush(COLOR_WINDOW));

    case WM_CLOSE:
      // אין ביטול — ראו overlay.h. בליעה שקטה עדיפה על חלון שנעלם
      // ומשאיר פריסה חצי-גמורה שרצה ברקע בלי שום חיווי.
      return 0;

    default:
      break;
  }
  return DefWindowProcW(window, message, wparam, lparam);
}

}  // namespace

// ── זיהוי ────────────────────────────────────────────────────────────────────

bool HasOverlay(const std::wstring& exe_path, OverlayInfo& out) {
  // `FILE_SHARE_READ` בלבד ומספיק: הקובץ הזה הוא קובץ ההרצה של התהליך
  // הרץ, וווינדוס ממילא מרשה לקרוא ממנו ולא לכתוב אליו.
  ScopedHandle file(CreateFileW(exe_path.c_str(), GENERIC_READ, FILE_SHARE_READ,
                                nullptr, OPEN_EXISTING, FILE_ATTRIBUTE_NORMAL,
                                nullptr));
  if (!file.valid()) return false;

  LARGE_INTEGER size{};
  if (!GetFileSizeEx(file.get(), &size)) return false;
  const auto total = static_cast<uint64_t>(size.QuadPart);
  if (total <= kOverlayFooterSize) return false;

  uint8_t footer[kOverlayFooterSize]{};
  if (!ReadAt(file.get(), total - kOverlayFooterSize, footer, sizeof(footer))) {
    return false;
  }
  // ה-exe הרזה מגיע לכאן בכל הרצה. אין חבילה = אין שגיאה, ואין שורת
  // יומן — זה המצב הרגיל.
  if (memcmp(footer, kOverlayMagic, sizeof(kOverlayMagic)) != 0) return false;

  OverlayInfo info;
  info.index_offset = LoadU64(footer + 8);
  info.index_size = LoadU64(footer + 16);
  info.data_offset = LoadU64(footer + 24);

  // כל מה שאפשר לאמת מול הגודל בפועל, מאומת כאן — כדי שהקוד שאחרי
  // ההצלחה יוכל לסמוך על המספרים בלי לבדוק אותם שוב.
  if (info.data_offset == 0 || info.data_offset > info.index_offset) return false;
  if (info.index_offset > total || info.index_size > total) return false;
  if (info.index_offset + info.index_size != total - kOverlayFooterSize) {
    return false;
  }

  // החותמת חייבת להיות hex נקי: היא נכתבת כשורה בקובץ טקסט ומושווית
  // כמחרוזת, ולא נכניס לשם בייטים שרירותיים מקובץ פגום.
  info.stamp.assign(reinterpret_cast<const char*>(footer + 32), kOverlayStampChars);
  for (const char c : info.stamp) {
    const bool hex = (c >= '0' && c <= '9') || (c >= 'a' && c <= 'f') ||
                     (c >= 'A' && c <= 'F');
    if (!hex) return false;
  }

  info.payload_size = info.index_offset - info.data_offset;
  out = info;
  return true;
}

// ── פריסה ────────────────────────────────────────────────────────────────────

bool ExtractOverlay(const std::wstring& exe_path, const OverlayInfo& info,
                    const std::wstring& data_dir, const ProgressFn& on_progress,
                    std::wstring& error) {
  if (info.index_size > kMaxIndexBytes) {
    error = L"האינדקס של החבילה גדול מהסביר — הקובץ כנראה פגום.";
    return false;
  }

  // `FILE_FLAG_SEQUENTIAL_SCAN` — הקריאה כאן היא מעבר אחד קדימה על
  // ‎96MB, וזה בדיוק מה שהדגל אומר למטמון של ווינדוס.
  ScopedHandle source(CreateFileW(exe_path.c_str(), GENERIC_READ,
                                  FILE_SHARE_READ, nullptr, OPEN_EXISTING,
                                  FILE_FLAG_SEQUENTIAL_SCAN, nullptr));
  if (!source.valid()) {
    error = L"פתיחת קובץ ההתקנה לקריאה נכשלה: " + MessageForError(GetLastError());
    return false;
  }

  // האינדקס **כן** נטען לזיכרון — הוא מטא-דאטה, לא המטען.
  std::vector<uint8_t> index(static_cast<size_t>(info.index_size));
  if (!index.empty() &&
      !ReadAt(source.get(), info.index_offset, index.data(), index.size())) {
    error = L"קריאת האינדקס של החבילה נכשלה — הקובץ כנראה לא הועתק במלואו.";
    return false;
  }

  struct Entry {
    std::wstring path;
    uint64_t size;
  };
  std::vector<Entry> entries;

  // פירוק האינדקס. כל שדה נבדק מול מה שנשאר, כדי שאינדקס קטוע ייפול
  // כאן ולא בגישה מחוץ לתחום.
  size_t at = 0;
  if (index.size() < sizeof(uint32_t)) {
    error = L"האינדקס של החבילה קטוע.";
    return false;
  }
  const uint32_t count = LoadU32(index.data());
  at += sizeof(uint32_t);
  // ⚠️ גם המספר הזה מגיע מהקובץ, ו-`reserve` הוא הקצאה **לפני** שנקראה
  // ולו רשומה אחת. כל רשומה תופסת לפחות 12 בייט, ולכן אינדקס באורך
  // ידוע חוסם את מספר הרשומות שיכולות להיות בו. בלי החסם הזה `count`
  // פגום (‎4 מיליארד) היה מבקש עשרות GB, נופל ב-`bad_alloc` — ומפיל את
  // התהליך בלי הודעה, במקום להגיד למשתמש שהחבילה פגומה.
  if (count > (index.size() - at) / 12) {
    error = L"האינדקס של החבילה קטוע.";
    return false;
  }
  entries.reserve(count);

  uint64_t declared = 0;
  for (uint32_t i = 0; i < count; ++i) {
    if (index.size() - at < 12) {
      error = L"האינדקס של החבילה קטוע.";
      return false;
    }
    const uint32_t path_bytes = LoadU32(index.data() + at);
    const uint64_t file_bytes = LoadU64(index.data() + at + 4);
    at += 12;
    if (index.size() - at < path_bytes) {
      error = L"האינדקס של החבילה קטוע.";
      return false;
    }
    const std::string utf8(reinterpret_cast<const char*>(index.data() + at),
                           path_bytes);
    at += path_bytes;

    Entry entry;
    if (!SafeRelativePath(utf8, entry.path)) {
      error = L"החבילה מכילה נתיב שאינו חוקי — יש להוריד אותה מחדש.";
      return false;
    }
    // ⚠️ חיסור ולא חיבור: `declared += file_bytes` נבדק רק בסוף, ושני
    // גדלים סביב ‎2^63 יכולים לגלוש ולהחזיר סכום שמסתדר עם המטען —
    // כלומר לעבור את הבדיקה שאחרי הלולאה עם רשומה שגודלה חצי מרחב
    // הכתובות. בצורה הזאת האינווריאנטה `declared <= payload_size`
    // נשמרת בכל צעד, ואין גלישה אפשרית.
    if (file_bytes > info.payload_size - declared) {
      error = L"החבילה אינה עקבית (סכום הקבצים אינו תואם לגודל המטען).";
      return false;
    }
    entry.size = file_bytes;
    declared += file_bytes;
    entries.push_back(std::move(entry));
  }

  // סכום הגדלים חייב לכסות **בדיוק** את אזור התוכן. הלולאה כבר פסלה
  // סכום גדול מדי, וכאן נופל אינדקס שמכסה פחות מהמטען — גם הוא חבילה
  // פגומה, ולא "נפרוס מה שיש".
  if (declared != info.payload_size) {
    error = L"החבילה אינה עקבית (סכום הקבצים אינו תואם לגודל המטען).";
    return false;
  }

  if (!CreateDirectories(data_dir)) {
    error = L"יצירת תיקיית הנתונים נכשלה: " + MessageForError(GetLastError());
    return false;
  }

  // מעבר אחד קדימה: התוכן שמור בסדר האינדקס, ולכן אחרי הקפיצה הזאת אין
  // עוד ולו קפיצה אחת — רק קריאה רציפה.
  LARGE_INTEGER start{};
  start.QuadPart = static_cast<LONGLONG>(info.data_offset);
  if (!SetFilePointerEx(source.get(), start, nullptr, FILE_BEGIN)) {
    error = L"מיקום הקריאה בחבילה נכשל.";
    return false;
  }

  std::vector<uint8_t> buffer(kCopyChunk);
  uint64_t done = 0;
  if (on_progress) on_progress(0, info.payload_size);

  for (const Entry& entry : entries) {
    const std::wstring full = JoinPath(data_dir, entry.path);
    const std::wstring parent = ParentOf(full);
    if (!parent.empty() && !CreateDirectories(parent)) {
      error = L"יצירת התיקייה נכשלה:\n" + parent + L"\n" +
              MessageForError(GetLastError());
      return false;
    }

    ScopedHandle dest(CreateFileW(full.c_str(), GENERIC_WRITE, 0, nullptr,
                                  CREATE_ALWAYS, FILE_ATTRIBUTE_NORMAL, nullptr));
    if (!dest.valid()) {
      error = L"כתיבת הקובץ נכשלה:\n" + full + L"\n" +
              MessageForError(GetLastError());
      return false;
    }

    uint64_t left = entry.size;
    while (left > 0) {
      const DWORD want =
          static_cast<DWORD>(left < buffer.size() ? left : buffer.size());
      DWORD read = 0;
      if (!ReadFile(source.get(), buffer.data(), want, &read, nullptr) ||
          read == 0) {
        error = L"קריאה מהחבילה נכשלה — הקובץ כנראה לא הועתק במלואו.";
        return false;
      }
      if (!WriteAll(dest.get(), buffer.data(), read)) {
        error = L"כתיבת הקובץ נכשלה:\n" + full + L"\n" +
                MessageForError(GetLastError());
        return false;
      }
      left -= read;
      done += read;
      // אחרי כל גוש ולא אחרי כל קובץ: יש כאן קובצי `.otzplugin` של
      // עשרות MB, ומחוון שקופא עליהם נראה כמו תוכנה תקועה.
      if (on_progress) on_progress(done, info.payload_size);
    }
  }

  return true;
}

// ── העותק הרזה ───────────────────────────────────────────────────────────────

// האם העותק הרזה שכבר יושב ב-[dest] זהה לזה שהיינו כותבים מהחבילה.
//
// ⚠️ השוואת **בייטים** ולא רק גודל: שני בינאריים שונים יכולים בקלות
// לצאת באותו אורך, והסתמכות על הגודל לבדו הייתה משאירה את המשתמש עם
// exe ישן בלי שאיש ידע. `source` נפתח כבר על ידי הקורא ולכן מועבר
// כ-handle; ההשוואה מזיזה את המצביע שלו, והקורא היחיד קורא לה רק
// במסלול שבו הוא חוזר מיד ואינו קורא ממנו יותר.
static bool SlimCopyMatches(HANDLE source, uint64_t data_offset,
                            const std::wstring& dest) {
  // ⚠️ שיתוף מלא, ובכלל זה `FILE_SHARE_DELETE`: הקובץ שאנחנו בודקים
  // הוא קובץ הרצה של תהליך שרץ עכשיו, ובלי זה הפתיחה עצמה תיכשל.
  ScopedHandle existing(CreateFileW(
      dest.c_str(), GENERIC_READ,
      FILE_SHARE_READ | FILE_SHARE_WRITE | FILE_SHARE_DELETE, nullptr,
      OPEN_EXISTING, FILE_FLAG_SEQUENTIAL_SCAN, nullptr));
  if (!existing.valid()) return false;

  LARGE_INTEGER size{};
  if (!GetFileSizeEx(existing.get(), &size)) return false;
  if (static_cast<uint64_t>(size.QuadPart) != data_offset) return false;

  std::vector<uint8_t> mine(kCopyChunk);
  std::vector<uint8_t> theirs(kCopyChunk);
  uint64_t at = 0;
  while (at < data_offset) {
    const uint64_t left = data_offset - at;
    const size_t want = static_cast<size_t>(left < kCopyChunk ? left : kCopyChunk);
    if (!ReadAt(source, at, mine.data(), want)) return false;
    if (!ReadAt(existing.get(), at, theirs.data(), want)) return false;
    if (memcmp(mine.data(), theirs.data(), want) != 0) return false;
    at += want;
  }
  return true;
}

bool WriteSlimCopy(const std::wstring& exe_path, uint64_t data_offset,
                   const std::wstring& dest, std::wstring& error) {
  ScopedHandle source(CreateFileW(exe_path.c_str(), GENERIC_READ,
                                  FILE_SHARE_READ, nullptr, OPEN_EXISTING,
                                  FILE_FLAG_SEQUENTIAL_SCAN, nullptr));
  if (!source.valid()) {
    error = L"פתיחת קובץ ההתקנה לקריאה נכשלה: " + MessageForError(GetLastError());
    return false;
  }

  ScopedHandle target(CreateFileW(dest.c_str(), GENERIC_WRITE, 0, nullptr,
                                  CREATE_ALWAYS, FILE_ATTRIBUTE_NORMAL, nullptr));
  if (!target.valid()) {
    const DWORD open_error = GetLastError();
    // ⚠️ המקרה השכיח כאן הוא **שהחנות פתוחה עכשיו**: הטוען של ווינדוס
    // מחזיק את קובץ ההרצה של תהליך רץ בלי לשתף כתיבה, ולכן שום share
    // mode שלנו לא יקבל אותה. אבל בשלב הזה המראה כבר נפרסה בהצלחה —
    // וכשמה שיושב שם הוא בדיוק העותק שהיינו כותבים, אין שום דבר לעשות
    // וגם אין על מה להיכשל. כשל כאן היה מודיע למשתמש שההתקנה נכשלה
    // בדיוק כשהיא הצליחה.
    if (open_error == ERROR_SHARING_VIOLATION &&
        SlimCopyMatches(source.get(), data_offset, dest)) {
      return true;
    }
    error = L"כתיבת קובץ ההרצה נכשלה:\n" + dest + L"\n" +
            MessageForError(open_error);
    return false;
  }

  // ה-PE שנוצר כאן הוא **בייט-לבייט** ה-exe שנבנה ונבדק: המטען שורשר
  // אחריו ולא נגע בו, ולכן חיתוך בגודל המקורי מחזיר בדיוק אותו.
  std::vector<uint8_t> buffer(kCopyChunk);
  uint64_t left = data_offset;
  while (left > 0) {
    const DWORD want =
        static_cast<DWORD>(left < buffer.size() ? left : buffer.size());
    DWORD read = 0;
    if (!ReadFile(source.get(), buffer.data(), want, &read, nullptr) ||
        read == 0) {
      error = L"קריאה מקובץ ההתקנה נכשלה.";
      return false;
    }
    if (!WriteAll(target.get(), buffer.data(), read)) {
      error = L"כתיבת קובץ ההרצה נכשלה:\n" + dest + L"\n" +
              MessageForError(GetLastError());
      return false;
    }
    left -= read;
  }
  return true;
}

bool LaunchAndForget(const std::wstring& exe_path, std::wstring& error) {
  // `CreateProcessW` כותב לתוך שורת הפקודה, ולכן היא מאגר ולא קבוע.
  std::wstring command = L"\"" + exe_path + L"\"";

  STARTUPINFOW startup{};
  startup.cb = sizeof(startup);
  PROCESS_INFORMATION process{};

  // ה-cwd הוא התיקייה של ה-exe עצמו — שם יושבת `Data\` שהוא עומד לפתוח.
  const std::wstring working_dir = ParentOf(exe_path);
  const BOOL ok = CreateProcessW(
      exe_path.c_str(), command.data(), nullptr, nullptr, FALSE,
      DETACHED_PROCESS, nullptr,
      working_dir.empty() ? nullptr : working_dir.c_str(), &startup, &process);
  if (!ok) {
    error = L"הרצת החנות נכשלה: " + MessageForError(GetLastError());
    return false;
  }

  // מנותק: לא ממתינים לו, וסגירת ה-handles אינה הורגת אותו.
  CloseHandle(process.hThread);
  CloseHandle(process.hProcess);
  return true;
}

// ── מחיקה רקורסיבית ──────────────────────────────────────────────────────────

bool RemoveTree(const std::wstring& path) {
  const DWORD attributes = GetFileAttributesW(path.c_str());
  if (attributes == INVALID_FILE_ATTRIBUTES) return true;  // כבר אינה שם
  if ((attributes & FILE_ATTRIBUTE_DIRECTORY) == 0) return DeleteOne(path);

  // ⚠️ אותה הגנה שמופעלת בהמשך על הילדים, אבל על **השורש** עצמו — וזה
  // המקרה המסוכן באמת: הקורא היחיד כאן מוחק את `Data\plugins`, ומי
  // שמריץ מכונן קטן מפנה אותה לא פעם ל-junction על כונן אחר. כניסה
  // פנימה הייתה מוחקת את מה שיושב בצד השני של הקישור, מחוץ ל-`Data\`
  // לגמרי. מוחקים את הקישור ולא את מה שהוא מצביע אליו.
  if ((attributes & FILE_ATTRIBUTE_REPARSE_POINT) != 0) {
    return RemoveEmptyDir(path);
  }

  bool ok = true;
  WIN32_FIND_DATAW found{};
  HANDLE search = FindFirstFileW(JoinPath(path, L"*").c_str(), &found);
  if (search != INVALID_HANDLE_VALUE) {
    do {
      const std::wstring name = found.cFileName;
      if (name == L"." || name == L"..") continue;
      const std::wstring child = JoinPath(path, name);

      if ((found.dwFileAttributes & FILE_ATTRIBUTE_DIRECTORY) == 0) {
        ok = DeleteOne(child) && ok;
        continue;
      }
      // ⚠️ **לא נכנסים** לקישור (junction/symlink) — מוחקים את הקישור
      // עצמו. בלי זה מחיקת `Data\plugins` הייתה יכולה לזלוג דרך קישור
      // אל כל מקום אחר בכונן.
      if ((found.dwFileAttributes & FILE_ATTRIBUTE_REPARSE_POINT) != 0) {
        ok = RemoveEmptyDir(child) && ok;
      } else {
        ok = RemoveTree(child) && ok;
      }
    } while (FindNextFileW(search, &found));
    FindClose(search);
  }
  return RemoveEmptyDir(path) && ok;
}

// ── קובץ החותמת ──────────────────────────────────────────────────────────────

bool ReadStampFile(const std::wstring& path, StampFile& out) {
  ScopedHandle file(CreateFileW(path.c_str(), GENERIC_READ, FILE_SHARE_READ,
                                nullptr, OPEN_EXISTING, FILE_ATTRIBUTE_NORMAL,
                                nullptr));
  if (!file.valid()) return false;

  // שתי שורות: חותמת של 64 תווים ונתיב. תקרה נדיבה ובלי לשאול על הגודל
  // — קובץ גדול מזה אינו קובץ החותמת שלנו.
  char raw[4096]{};
  DWORD read = 0;
  if (!ReadFile(file.get(), raw, sizeof(raw), &read, nullptr) || read == 0) {
    return false;
  }

  const std::string text(raw, read);
  const size_t break_at = text.find_first_of("\r\n");
  out.stamp = text.substr(0, break_at == std::string::npos ? text.size() : break_at);

  out.installer.clear();
  if (break_at != std::string::npos) {
    size_t second = text.find_first_not_of("\r\n", break_at);
    if (second != std::string::npos) {
      const size_t end = text.find_first_of("\r\n", second);
      out.installer = Utf16(
          text.substr(second, end == std::string::npos ? text.size() - second
                                                       : end - second));
    }
  }
  // שורה ראשונה שאינה חותמת = קובץ זר או פגום, ולא "חותמת ריקה".
  return out.stamp.size() == kOverlayStampChars;
}

bool WriteStampFile(const std::wstring& path, const StampFile& value,
                    std::wstring& error) {
  ScopedHandle file(CreateFileW(path.c_str(), GENERIC_WRITE, 0, nullptr,
                                CREATE_ALWAYS, FILE_ATTRIBUTE_NORMAL, nullptr));
  if (!file.valid()) {
    error = L"כתיבת חותמת החבילה נכשלה:\n" + path + L"\n" +
            MessageForError(GetLastError());
    return false;
  }

  // `\r\n` כדי שהקובץ יהיה קריא ב-Notepad — הוא נועד גם לעין אנושית
  // שמנסה להבין למה החנות פרסה שוב.
  const std::string text =
      value.stamp + "\r\n" + Utf8(value.installer) + "\r\n";
  if (!WriteAll(file.get(), text.data(), text.size())) {
    error = L"כתיבת חותמת החבילה נכשלה:\n" + path;
    return false;
  }

  // ⚠️ ה-flush הזה הוא **כל** ההגנה: הקובץ הזה נכתב אחרון בכוונה, וכל
  // עוד הוא לא הגיע לדיסק ההרצה הבאה תפרוס מחדש. (מול נפילת חשמל
  // באמצע זה אינו ערובה מלאה — קובצי המטען עצמם אינם מסונכרנים אחד-אחד,
  // כי זה היה מכפיל את זמן הפריסה על כונן USB. מול תהליך שנהרג, שזה
  // התרחיש האמיתי, זה מספיק.)
  FlushFileBuffers(file.get());
  return true;
}

// ── חלון ההתקדמות ────────────────────────────────────────────────────────────

bool ProgressWindow::Create(HINSTANCE instance, const std::wstring& title,
                            const std::wstring& headline) {
  INITCOMMONCONTROLSEX controls{};
  controls.dwSize = sizeof(controls);
  controls.dwICC = ICC_PROGRESS_CLASS;
  InitCommonControlsEx(&controls);

  WNDCLASSEXW window_class{};
  window_class.cbSize = sizeof(window_class);
  window_class.lpfnWndProc = ProgressProc;
  window_class.hInstance = instance;
  window_class.hIcon = LoadIconW(instance, MAKEINTRESOURCEW(IDI_APP_ICON));
  window_class.hCursor = LoadCursorW(nullptr, IDC_ARROW);
  window_class.hbrBackground = GetSysColorBrush(COLOR_WINDOW);
  window_class.lpszClassName = kProgressClass;
  // רישום כפול מחזיר `ERROR_CLASS_ALREADY_EXISTS` וזה בסדר — יש כאן
  // חלון אחד לכל היותר בכל התהליך.
  RegisterClassExW(&window_class);

  const int dpi = SystemDpi();
  const auto scale = [dpi](int dip) { return MulDiv(dip, dpi, 96); };
  const int width = scale(kBoxWidth);
  const int height = scale(kBoxHeight);
  const int margin = scale(kBoxMargin);
  const int inner = width - margin * 2;

  RECT work{};
  if (!SystemParametersInfoW(SPI_GETWORKAREA, 0, &work, 0)) {
    work = {0, 0, GetSystemMetrics(SM_CXSCREEN), GetSystemMetrics(SM_CYSCREEN)};
  }
  const int left = work.left + (work.right - work.left - width) / 2;
  const int top = work.top + (work.bottom - work.top - height) / 2;

  // `WS_POPUP | WS_BORDER`: תיבה נקייה בלי שורת כותרת ובלי X — אין כאן
  // ביטול, וכפתור סגירה שאינו עושה דבר גרוע מהיעדרו.
  // `WS_EX_APPWINDOW` בכל זאת שם אותה בשורת המשימות, כדי שמי שהעביר
  // אליה מיקוד בטעות יוכל לחזור.
  // `WS_EX_LAYOUTRTL` הופך גם את הטקסטים וגם את כיוון המילוי של המחוון
  // — הממשק כולו עברי.
  window_ = CreateWindowExW(WS_EX_APPWINDOW | WS_EX_LAYOUTRTL, kProgressClass,
                            title.c_str(), WS_POPUP | WS_BORDER, left, top,
                            width, height, nullptr, nullptr, instance, nullptr);
  if (window_ == nullptr) return false;

  // גופן ההודעות של המערכת — אותו גופן שדיאלוגים של ווינדוס משתמשים בו,
  // ולא ה-`SYSTEM_FONT` המיושן שהוא ברירת המחדל של חלון גולמי.
  NONCLIENTMETRICSW metrics{};
  metrics.cbSize = sizeof(metrics);
  if (SystemParametersInfoW(SPI_GETNONCLIENTMETRICS, sizeof(metrics), &metrics,
                            0)) {
    font_ = CreateFontIndirectW(&metrics.lfMessageFont);
  }

  const auto add_label = [&](int y, int label_height, const std::wstring& text) {
    HWND label = CreateWindowExW(0, L"STATIC", text.c_str(),
                                 WS_CHILD | WS_VISIBLE | SS_LEFT, margin,
                                 scale(y), inner, scale(label_height), window_,
                                 nullptr, instance, nullptr);
    if (label != nullptr && font_ != nullptr) {
      SendMessageW(label, WM_SETFONT, reinterpret_cast<WPARAM>(font_), TRUE);
    }
    return label;
  };

  add_label(26, 22, headline);
  bar_ = CreateWindowExW(0, PROGRESS_CLASSW, nullptr, WS_CHILD | WS_VISIBLE,
                         margin, scale(62), inner, scale(16), window_, nullptr,
                         instance, nullptr);
  if (bar_ != nullptr) {
    SendMessageW(bar_, PBM_SETRANGE32, 0, kProgressRange);
  }
  detail_ = add_label(92, 20, L"");

  ShowWindow(window_, SW_SHOW);
  // `UpdateWindow` מכריח ציור **מיד**, בלי להמתין לסבב ההודעות הבא: כל
  // הנקודה בחלון הזה היא שהוא נראה לפני שהפריסה מתחילה לחסום.
  UpdateWindow(window_);
  return true;
}

void ProgressWindow::Update(uint64_t done, uint64_t total) {
  if (window_ == nullptr) return;

  const int percent =
      total == 0 ? 100 : static_cast<int>((done * 100) / total);
  if (percent != shown_percent_) {
    shown_percent_ = percent;
    if (bar_ != nullptr) {
      const int position =
          total == 0 ? kProgressRange
                     : static_cast<int>((done * kProgressRange) / total);
      SendMessageW(bar_, PBM_SETPOS, static_cast<WPARAM>(position), 0);
    }
    if (detail_ != nullptr) {
      // רק אחוז, בלי שם הקובץ ובלי MB: מספר אחד שמתקדם הוא כל מה
      // שמשתמש קורא בחלון שנעלם אחרי כמה שניות, וטקסט מעורב עברית-לטינית
      // בחלון ממורר הוא בדיוק המקום שבו הכיווניות יוצאת עקומה.
      wchar_t text[64];
      swprintf(text, 64, L"%d%%", percent);
      SetWindowTextW(detail_, text);
    }
  }
  Pump();
}

void ProgressWindow::Pump() {
  // הפריסה רצה על ה-thread הזה וחוסמת אותו. בלי ריקון התור ווינדוס
  // מסמנת את החלון כ"אינו מגיב", מכהה אותו, ומציירת עליו את מה שהיה
  // מאחוריו.
  //
  // למה כאן ולא thread עובד: כל מה שהחלון עושה הוא להראות מספר, ואין
  // בו שום פעולה שהמשתמש יכול לעשות. thread שני היה מוסיף סנכרון
  // ומסלולי סגירה בלי להוסיף דבר שנראה על המסך.
  MSG message;
  while (PeekMessageW(&message, nullptr, 0, 0, PM_REMOVE)) {
    TranslateMessage(&message);
    DispatchMessageW(&message);
  }
}

void ProgressWindow::Close() {
  if (window_ != nullptr) {
    DestroyWindow(window_);
    window_ = nullptr;
    bar_ = nullptr;
    detail_ = nullptr;
    // ההריסה מייצרת הודעות; בלי ריקון התור החלון נשאר מצויר על המסך עד
    // שמישהו אחר יריץ סבב הודעות — וזה יקרה רק אחרי שה-WebView2 יעלה.
    Pump();
  }
  if (font_ != nullptr) {
    DeleteObject(font_);
    font_ = nullptr;
  }
}

}  // namespace otz
