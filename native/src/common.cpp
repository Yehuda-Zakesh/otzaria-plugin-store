#include "common.h"

#include <mutex>

namespace otz {
namespace {

std::mutex g_log_mutex;
std::wstring g_log_path;

// שני התווים שאסורים גולמיים ב-JSON ומחייבים escape משלהם, מעל תווי
// הבקרה. הגרש הבודד אינו ביניהם — JSON אינו דורש לו escape.
constexpr char kQuote = '"';
constexpr char kBackslash = '\\';

// ⚠️ עובד על **בייט** של UTF-8, לא על תו של UTF-16. זה מכוון: תו מעל
// ה-BMP (אימוג'י, וגם שמות תיקיות שמכילים אותו) הוא זוג surrogate בשני
// `wchar_t`, והמרה של כל אחד מהם לבדו הייתה מוסרת ל-UTF-8 חצי-זוג —
// שאותו ווינדוס מחליף בשקט ב-U+FFFD. התוצאה הייתה נתיב מקולקל שחוזר
// ל-JS ונכשל בכל פעולת קובץ אחריו. לכן ההמרה נעשית פעם אחת על המחרוזת
// כולה, וכאן רק בורחים מהבייטים שמחייבים זאת.
void AppendEscaped(std::string& out, char byte) {
  switch (byte) {
    case kQuote: out += "\\\""; return;
    case kBackslash: out += "\\\\"; return;
    case '\b': out += "\\b"; return;
    case '\f': out += "\\f"; return;
    case '\n': out += "\\n"; return;
    case '\r': out += "\\r"; return;
    case '\t': out += "\\t"; return;
    default: break;
  }
  // דרך `unsigned char`: `char` הוא מסומן ב-MSVC, ובלי ההמרה כל בייט
  // של UTF-8 מעל 0x7F היה נראה שלילי ונופל לענף תווי הבקרה.
  const auto value = static_cast<unsigned char>(byte);
  if (value < 0x20) {
    // `\u00XX` — JSON אוסר תווי בקרה גולמיים בתוך מחרוזת.
    char buffer[7];
    wsprintfA(buffer, "\\u%04x", static_cast<unsigned>(value));
    out += buffer;
    return;
  }
  // כל השאר יוצא כמו שהוא ב-UTF-8. אין בריחה ל-`\uXXXX` לתווים שאינם
  // ASCII: העברית עוברת כ-UTF-8 תקין, וזה מה ש-JSON מצפה לו.
  out += byte;
}

}  // namespace

std::wstring Utf16(std::string_view utf8) {
  if (utf8.empty()) return {};
  const int size = MultiByteToWideChar(CP_UTF8, 0, utf8.data(),
                                       static_cast<int>(utf8.size()), nullptr, 0);
  if (size <= 0) return {};
  std::wstring result(static_cast<size_t>(size), L'\0');
  MultiByteToWideChar(CP_UTF8, 0, utf8.data(), static_cast<int>(utf8.size()),
                      result.data(), size);
  return result;
}

std::string Utf8(std::wstring_view utf16) {
  if (utf16.empty()) return {};
  const int size = WideCharToMultiByte(CP_UTF8, 0, utf16.data(),
                                       static_cast<int>(utf16.size()),
                                       nullptr, 0, nullptr, nullptr);
  if (size <= 0) return {};
  std::string result(static_cast<size_t>(size), '\0');
  WideCharToMultiByte(CP_UTF8, 0, utf16.data(), static_cast<int>(utf16.size()),
                      result.data(), size, nullptr, nullptr);
  return result;
}

std::vector<std::wstring> SplitFields(std::wstring_view message) {
  std::vector<std::wstring> fields;
  size_t start = 0;
  while (true) {
    const size_t end = message.find(kFieldSeparator, start);
    if (end == std::wstring_view::npos) {
      fields.emplace_back(message.substr(start));
      return fields;
    }
    fields.emplace_back(message.substr(start, end - start));
    start = end + 1;
  }
}

std::string JsonString(std::string_view text) {
  std::string out;
  // רוב הבייטים יוצאים כמו שהם, ולכן זו כמעט תמיד ההקצאה היחידה.
  out.reserve(text.size() + 2);
  out += '"';
  for (const char byte : text) AppendEscaped(out, byte);
  out += '"';
  return out;
}

// ההמרה ל-UTF-8 קודמת ל-escaping ונעשית על המחרוזת **כולה** — ראו
// [AppendEscaped]. `Utf8` מחזיר `std::string`, ולכן זו קריאה לעומס
// שמעליו ולא רקורסיה.
std::string JsonString(std::wstring_view text) { return JsonString(Utf8(text)); }

std::string JsonBool(bool value) { return value ? "true" : "false"; }

std::string JsonNumber(long long value) { return std::to_string(value); }

std::string JsonObject(
    const std::vector<std::pair<std::string, std::string>>& fields) {
  std::string out = "{";
  bool first = true;
  for (const auto& [key, value] : fields) {
    if (!first) out += ',';
    first = false;
    out += JsonString(key);
    out += ':';
    out += value;
  }
  out += '}';
  return out;
}

std::string JsonArray(const std::vector<std::string>& items) {
  std::string out = "[";
  bool first = true;
  for (const auto& item : items) {
    if (!first) out += ',';
    first = false;
    out += item;
  }
  out += ']';
  return out;
}

void LogInit(const std::wstring& log_file_path, const std::wstring& version) {
  {
    std::lock_guard<std::mutex> guard(g_log_mutex);
    g_log_path = log_file_path;
  }
  LogInfo(L"── חנות התוספים " + version + L" ──");
}

void LogLine(std::wstring_view level, std::wstring_view message) {
  std::lock_guard<std::mutex> guard(g_log_mutex);
  if (g_log_path.empty()) return;

  // נפתח ונסגר בכל שורה. היומן הזה מקבל עשרות שורות בהרצה, לא אלפים,
  // והחזקת handle פתוח הייתה חוסמת ניקוי של התיקייה בזמן שהתוכנה רצה.
  HANDLE file = CreateFileW(g_log_path.c_str(), FILE_APPEND_DATA,
                            FILE_SHARE_READ | FILE_SHARE_WRITE, nullptr,
                            OPEN_ALWAYS, FILE_ATTRIBUTE_NORMAL, nullptr);
  if (file == INVALID_HANDLE_VALUE) return;

  SYSTEMTIME now;
  GetLocalTime(&now);
  wchar_t stamp[32];
  wsprintfW(stamp, L"%04d-%02d-%02d %02d:%02d:%02d", now.wYear, now.wMonth,
            now.wDay, now.wHour, now.wMinute, now.wSecond);

  std::wstring line = std::wstring(stamp) + L" [" + std::wstring(level) + L"] " +
                      std::wstring(message) + L"\r\n";
  // UTF-8 בלי BOM: הקובץ נפתח בהוספה, ו-BOM בכל פתיחה היה מפזר אותו
  // באמצע הקובץ.
  const std::string utf8 = Utf8(line);
  DWORD written = 0;
  WriteFile(file, utf8.data(), static_cast<DWORD>(utf8.size()), &written, nullptr);
  CloseHandle(file);
}

std::wstring MessageForError(DWORD error) {
  if (error == 0) return {};
  LPWSTR buffer = nullptr;
  const DWORD length = FormatMessageW(
      FORMAT_MESSAGE_ALLOCATE_BUFFER | FORMAT_MESSAGE_FROM_SYSTEM |
          FORMAT_MESSAGE_IGNORE_INSERTS,
      nullptr, error, MAKELANGID(LANG_NEUTRAL, SUBLANG_DEFAULT),
      reinterpret_cast<LPWSTR>(&buffer), 0, nullptr);
  if (length == 0 || buffer == nullptr) {
    return L"שגיאה " + std::to_wstring(error);
  }
  std::wstring message(buffer, length);
  LocalFree(buffer);
  // FormatMessage מסיים ב-CRLF, שאין לו מקום בהודעה שנכנסת לאמצע שורה.
  while (!message.empty() &&
         (message.back() == L'\r' || message.back() == L'\n' ||
          message.back() == L' ')) {
    message.pop_back();
  }
  return message;
}

}  // namespace otz
