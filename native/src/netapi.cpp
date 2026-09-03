#include "netapi.h"

// common.h מביא את windows.h, שעליו winhttp.h נשען.
#include "common.h"
#include "paths.h"

#include <winhttp.h>

#include <vector>

namespace otz::netapi {
namespace {

HINTERNET g_session = nullptr;

// ה-User-Agent שאיתו החנות מזדהה מול otzaria.org ומול GitHub. GitHub API
// דוחה בקשה בלי User-Agent, ולכן זה אינו קוסמטי.
constexpr wchar_t kUserAgent[] = L"OtzariaPluginStore";

class ScopedInternet {
 public:
  explicit ScopedInternet(HINTERNET handle) : handle_(handle) {}
  ~ScopedInternet() { Close(); }

  ScopedInternet(const ScopedInternet&) = delete;
  ScopedInternet& operator=(const ScopedInternet&) = delete;

  // ניתן להעברה: [OpenGet] בונה את החיבור והבקשה ומציב אותם לתוך
  // ה-[Request] של הקורא. בלי אלה ההצבה הזאת אינה מתקמפלת.
  ScopedInternet(ScopedInternet&& other) noexcept : handle_(other.handle_) {
    other.handle_ = nullptr;
  }
  ScopedInternet& operator=(ScopedInternet&& other) noexcept {
    if (this != &other) {
      Close();
      handle_ = other.handle_;
      other.handle_ = nullptr;
    }
    return *this;
  }

  HINTERNET get() const { return handle_; }
  bool valid() const { return handle_ != nullptr; }

 private:
  void Close() {
    if (handle_ != nullptr) {
      WinHttpCloseHandle(handle_);
      handle_ = nullptr;
    }
  }

  HINTERNET handle_;
};

std::wstring NetworkError(const std::wstring& what, const std::wstring& url) {
  const DWORD code = GetLastError();
  std::wstring message;
  switch (code) {
    // הודעות מנוסחות לשלושת הכשלים השכיחים; השאר נופל להודעת המערכת.
    case ERROR_WINHTTP_TIMEOUT:
      message = L"פסק זמן בחיבור לרשת";
      break;
    case ERROR_WINHTTP_NAME_NOT_RESOLVED:
      message = L"לא ניתן לאתר את השרת — נראה שאין חיבור לאינטרנט";
      break;
    case ERROR_WINHTTP_CANNOT_CONNECT:
      message = L"לא ניתן להתחבר לשרת";
      break;
    case ERROR_WINHTTP_CONNECTION_ERROR:
      message = L"החיבור לשרת נקטע";
      break;
    case ERROR_WINHTTP_SECURE_FAILURE:
      message = L"אימות האבטחה של החיבור נכשל";
      break;
    default: {
      // שגיאות WinHTTP יושבות במודול שלו, לא בטבלה המערכתית.
      HMODULE module = GetModuleHandleW(L"winhttp.dll");
      LPWSTR buffer = nullptr;
      const DWORD length = FormatMessageW(
          FORMAT_MESSAGE_ALLOCATE_BUFFER | FORMAT_MESSAGE_FROM_HMODULE |
              FORMAT_MESSAGE_FROM_SYSTEM | FORMAT_MESSAGE_IGNORE_INSERTS,
          module, code, MAKELANGID(LANG_NEUTRAL, SUBLANG_DEFAULT),
          reinterpret_cast<LPWSTR>(&buffer), 0, nullptr);
      if (length > 0 && buffer != nullptr) {
        message.assign(buffer, length);
        LocalFree(buffer);
        while (!message.empty() && (message.back() == L'\r' ||
                                    message.back() == L'\n' ||
                                    message.back() == L' ')) {
          message.pop_back();
        }
      } else {
        message = L"שגיאת רשת " + std::to_wstring(code);
      }
      break;
    }
  }
  return what + L": " + message + L"\n" + url;
}

// כותרת תשובה אחת כמחרוזת, או ריק כשאינה קיימת.
std::wstring ResponseHeader(HINTERNET request, const wchar_t* name) {
  DWORD size = 0;
  WinHttpQueryHeaders(request, WINHTTP_QUERY_CUSTOM, name,
                      WINHTTP_NO_OUTPUT_BUFFER, &size, WINHTTP_NO_HEADER_INDEX);
  if (GetLastError() != ERROR_INSUFFICIENT_BUFFER || size == 0) return {};

  std::wstring value(size / sizeof(wchar_t), L'\0');
  if (!WinHttpQueryHeaders(request, WINHTTP_QUERY_CUSTOM, name, value.data(),
                           &size, WINHTTP_NO_HEADER_INDEX)) {
    return {};
  }
  value.resize(size / sizeof(wchar_t));
  while (!value.empty() && value.back() == L'\0') value.pop_back();
  return value;
}

DWORD StatusCode(HINTERNET request) {
  DWORD status = 0;
  DWORD size = sizeof(status);
  if (!WinHttpQueryHeaders(request,
                           WINHTTP_QUERY_STATUS_CODE | WINHTTP_QUERY_FLAG_NUMBER,
                           WINHTTP_HEADER_NAME_BY_INDEX, &status, &size,
                           WINHTTP_NO_HEADER_INDEX)) {
    return 0;
  }
  return status;
}

// מבנה בקשה פתוחה — חיבור + בקשה, שנסגרים יחד.
struct Request {
  ScopedInternet connection{nullptr};
  ScopedInternet request{nullptr};
};

// פותח בקשת GET ומקבל את הכותרות. `false` = כשל רשת, ו-`error` מנוסח.
bool OpenGet(const std::wstring& url, int timeout_ms, int stall_ms,
             Request& out, std::wstring& error) {
  URL_COMPONENTS parts{};
  parts.dwStructSize = sizeof(parts);
  parts.dwSchemeLength = static_cast<DWORD>(-1);
  parts.dwHostNameLength = static_cast<DWORD>(-1);
  parts.dwUrlPathLength = static_cast<DWORD>(-1);
  parts.dwExtraInfoLength = static_cast<DWORD>(-1);
  if (!WinHttpCrackUrl(url.c_str(), static_cast<DWORD>(url.size()), 0, &parts)) {
    error = L"כתובת שאינה תקינה: " + url;
    return false;
  }

  const std::wstring host(parts.lpszHostName, parts.dwHostNameLength);
  std::wstring path(parts.lpszUrlPath, parts.dwUrlPathLength);
  if (parts.dwExtraInfoLength > 0) {
    path.append(parts.lpszExtraInfo, parts.dwExtraInfoLength);
  }
  if (path.empty()) path = L"/";

  out.connection = ScopedInternet(
      WinHttpConnect(g_session, host.c_str(), parts.nPort, 0));
  if (!out.connection.valid()) {
    error = NetworkError(L"פתיחת החיבור נכשלה", url);
    return false;
  }

  const DWORD flags =
      parts.nScheme == INTERNET_SCHEME_HTTPS ? WINHTTP_FLAG_SECURE : 0;
  out.request = ScopedInternet(WinHttpOpenRequest(
      out.connection.get(), L"GET", path.c_str(), nullptr, WINHTTP_NO_REFERER,
      WINHTTP_DEFAULT_ACCEPT_TYPES, flags));
  if (!out.request.valid()) {
    error = NetworkError(L"בניית הבקשה נכשלה", url);
    return false;
  }

  // ה-receive timeout הוא **מפתח**: הוא זמן ההמתנה לבייטים הבאים, ולכן
  // הוא בדיוק ה-stall timeout של גרסת ה-Flutter. הוא מתאפס בכל מנה.
  WinHttpSetTimeouts(out.request.get(), timeout_ms, timeout_ms, timeout_ms,
                     stall_ms);

  // דחיסה שקופה. `WinHttpSetOption` הזה קיים מ-Windows 8.1; כשל בו אינו
  // מזיק — השרת פשוט ישלח לא-דחוס.
  DWORD decompression = WINHTTP_DECOMPRESSION_FLAG_ALL;
  WinHttpSetOption(out.request.get(), WINHTTP_OPTION_DECOMPRESSION,
                   &decompression, sizeof(decompression));

  if (!WinHttpSendRequest(out.request.get(), WINHTTP_NO_ADDITIONAL_HEADERS, 0,
                          WINHTTP_NO_REQUEST_DATA, 0, 0, 0)) {
    error = NetworkError(L"שליחת הבקשה נכשלה", url);
    return false;
  }
  if (!WinHttpReceiveResponse(out.request.get(), nullptr)) {
    error = NetworkError(L"לא התקבלה תשובה מהשרת", url);
    return false;
  }
  return true;
}

}  // namespace

bool Init() {
  // AUTOMATIC_PROXY מכבד את הגדרות הפרוקסי של המשתמש (כולל WPAD), וזה מה
  // שנדרש ברשת ארגונית. הוא קיים מ-Windows 8.1; בכשל נופלים להגדרת
  // ה-WinHTTP המערכתית, שהיא מה שהיה קודם.
  g_session = WinHttpOpen(kUserAgent, WINHTTP_ACCESS_TYPE_AUTOMATIC_PROXY,
                          WINHTTP_NO_PROXY_NAME, WINHTTP_NO_PROXY_BYPASS, 0);
  if (g_session == nullptr) {
    g_session = WinHttpOpen(kUserAgent, WINHTTP_ACCESS_TYPE_DEFAULT_PROXY,
                            WINHTTP_NO_PROXY_NAME, WINHTTP_NO_PROXY_BYPASS, 0);
  }
  if (g_session == nullptr) return false;

  // הפניות נענות אוטומטית (ברירת המחדל) — הורדת נכס מ-GitHub עוברת דרך
  // הפניה ל-CDN, ובלעדיה כל ההורדות היו מחזירות 302.
  DWORD protocols = WINHTTP_FLAG_SECURE_PROTOCOL_TLS1_2;
#ifdef WINHTTP_FLAG_SECURE_PROTOCOL_TLS1_3
  protocols |= WINHTTP_FLAG_SECURE_PROTOCOL_TLS1_3;
#endif
  WinHttpSetOption(g_session, WINHTTP_OPTION_SECURE_PROTOCOLS, &protocols,
                   sizeof(protocols));
  return true;
}

void Shutdown() {
  if (g_session != nullptr) {
    WinHttpCloseHandle(g_session);
    g_session = nullptr;
  }
}

Result Get(const std::wstring& url, int timeout_ms) {
  if (g_session == nullptr) return Result::Fail(L"שכבת הרשת לא אותחלה");

  Request request;
  std::wstring error;
  if (!OpenGet(url, timeout_ms, timeout_ms, request, error)) {
    return Result::Fail(error);
  }

  const DWORD status = StatusCode(request.request.get());
  const std::wstring content_type = ResponseHeader(request.request.get(),
                                                   L"Content-Type");

  std::string body;
  while (true) {
    DWORD available = 0;
    if (!WinHttpQueryDataAvailable(request.request.get(), &available)) {
      return Result::Fail(NetworkError(L"קריאת התשובה נכשלה", url));
    }
    if (available == 0) break;

    // תקרה על תשובת JSON — הקטלוג הוא מאות KB, לא מאות MB.
    constexpr size_t kMaxBody = 64u * 1024 * 1024;
    if (body.size() + available > kMaxBody) {
      return Result::Fail(L"התשובה מהשרת גדולה מהצפוי: " + url);
    }

    const size_t offset = body.size();
    body.resize(offset + available);
    DWORD read = 0;
    if (!WinHttpReadData(request.request.get(), body.data() + offset, available,
                         &read)) {
      return Result::Fail(NetworkError(L"קריאת התשובה נכשלה", url));
    }
    body.resize(offset + read);
    if (read == 0) break;
  }

  return Result::Ok(JsonObject({
      {"status", JsonNumber(status)},
      {"contentType", JsonString(content_type)},
      {"body", JsonString(body)},
  }));
}

Result Download(const std::wstring& url, const std::wstring& dest_path,
                int timeout_ms, int stall_ms) {
  if (g_session == nullptr) return Result::Fail(L"שכבת הרשת לא אותחלה");

  Request request;
  std::wstring error;
  if (!OpenGet(url, timeout_ms, stall_ms, request, error)) {
    return Result::Fail(error);
  }

  const DWORD status = StatusCode(request.request.get());
  const std::wstring content_type =
      ResponseHeader(request.request.get(), L"Content-Type");
  const std::wstring disposition =
      ResponseHeader(request.request.get(), L"Content-Disposition");

  // תשובה שאינה 200 אינה כותבת קובץ, וגם אינה מרוקנת את הגוף: שרת
  // שממשיך לשדר היה מזרים נכס שלם רק כדי שנדווח כשל. ה-handle נסגר
  // ביציאה ומנתק אותו.
  if (status != 200) {
    return Result::Ok(JsonObject({
        {"status", JsonNumber(status)},
        {"size", JsonNumber(0)},
        {"contentType", JsonString(content_type)},
        {"contentDisposition", JsonString(disposition)},
    }));
  }

  const size_t slash = dest_path.find_last_of(L"\\/");
  if (slash != std::wstring::npos && !CreateDirectories(dest_path.substr(0, slash))) {
    return Result::Fail(L"יצירת תיקיית היעד נכשלה: " + dest_path);
  }

  HANDLE file = CreateFileW(dest_path.c_str(), GENERIC_WRITE, 0, nullptr,
                            CREATE_ALWAYS, FILE_ATTRIBUTE_NORMAL, nullptr);
  if (file == INVALID_HANDLE_VALUE) {
    return Result::Fail(L"פתיחת קובץ היעד נכשלה (" + dest_path + L"): " +
                        MessageForError(GetLastError()));
  }

  long long total = 0;
  std::vector<uint8_t> buffer(64 * 1024);
  bool failed = false;
  std::wstring failure;

  while (true) {
    DWORD read = 0;
    if (!WinHttpReadData(request.request.get(), buffer.data(),
                         static_cast<DWORD>(buffer.size()), &read)) {
      failure = NetworkError(L"ההורדה נקטעה", url);
      failed = true;
      break;
    }
    if (read == 0) break;

    DWORD written = 0;
    if (!WriteFile(file, buffer.data(), read, &written, nullptr) ||
        written != read) {
      failure = L"כתיבת הקובץ שירד נכשלה (" + dest_path + L"): " +
                MessageForError(GetLastError());
      failed = true;
      break;
    }
    total += written;
  }

  const bool flushed = FlushFileBuffers(file) != 0;
  CloseHandle(file);

  if (failed || !flushed) {
    // הורדה שנקטעה לא משאירה קובץ חלקי מאחוריה.
    DeleteFileW(dest_path.c_str());
    return Result::Fail(failed ? failure
                               : (L"סגירת הקובץ שירד נכשלה: " + dest_path));
  }

  return Result::Ok(JsonObject({
      {"status", JsonNumber(status)},
      {"size", JsonNumber(total)},
      {"contentType", JsonString(content_type)},
      {"contentDisposition", JsonString(disposition)},
  }));
}

}  // namespace otz::netapi
