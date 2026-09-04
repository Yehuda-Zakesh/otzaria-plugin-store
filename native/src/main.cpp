// ה-exe של חנות התוספים: חלון Win32 חסר-מסגרת שמאכלס WebView2 אחד,
// ומגיש לו את הממשק **מהזיכרון**.
//
// ── מה יש כאן ומה אין ────────────────────────────────────────────────────────
// אין חילוץ, אין תיקיית `app-files`, אין exe שני ואין DLL לידו: ה-loader
// של WebView2 מקושר סטטית, וקובצי הממשק יושבים כ-resource בתוך ה-exe.
// מה שנוצר ליד התוכנה זו **רק** תיקיית `Data\`.
//
// היוצא היחיד מהכלל הוא ה**חבילה** — אותו exe בדיוק עם מראה של ~‎96MB
// משורשרת לסופו, בשביל מחשב מנותק. גם היא אינה מתקינה דבר: היא פורסת
// את `Data\`, כותבת לצדה את אותו exe בלי המטען, מפעילה אותו ויוצאת.
// ראו [RunOverlaySetup] כאן ו-overlay.h.
//
// ── החלון חסר-המסגרת ─────────────────────────────────────────────────────────
// הסגנון הוא `WS_POPUP | WS_THICKFRAME`: בלי `WS_CAPTION`, ולכן DWM אינו
// מצייר שורת כותרת בכלל, ועם מסגרת עבה שנותנת את הצל ואת פינות ווינדוס 11.
//
// `WM_NCCALCSIZE` מחזיר את **כל** החלון כאזור-לקוח, כדי שלא תישאר שולית
// מסגרת גלויה סביב התוכן. המשמעות היא שאין אזור לא-לקוח שווינדוס יכולה
// לתפוס בו לגרירה או לשינוי גודל — ולכן שני אלה מגיעים מה-JS:
//
//   שורת הכותרת   mousedown → `win.dragMove`   → WM_NCLBUTTONDOWN HTCAPTION
//   שולי החלון     mousedown → `win.resizeStart` → WM_NCLBUTTONDOWN HTLEFT/…
//
// זה נראה עקום ביחס ל"פשוט לתת לווינדוס לטפל", אבל זה מה שנותן את שני
// הדברים יחד: התנהגות חלון **מקורית** (snap, גרירה למסך אחר, כיווץ
// לשולי המסך) בלי שום שולית גלויה סביב התוכן.
//
// `WM_GETMINMAXINFO` מגביל הגדלה לאזור העבודה של המסך — בלעדיו חלון
// `WS_POPUP` שמוגדל מכסה את שורת המשימות.

// common.h ראשון — הוא מביא את windows.h, שעליו כל השאר נשען.
#include "common.h"

#include <dwmapi.h>
#include <shlwapi.h>
#include <wrl/client.h>
// event.h הוא זה שמגדיר את `Microsoft::WRL::Callback` — בלעדיו כל
// המטפלים של WebView2 נופלים ב-"undeclared identifier".
#include <wrl/event.h>
#include <wrl/implements.h>

#include <cwchar>
#include <exception>
#include <memory>
#include <string>
#include <vector>

#include "WebView2.h"
#include "bridge.h"
#include "netapi.h"
#include "overlay.h"
#include "paths.h"
#include "resource.h"
#include "sysapi.h"
#include "version.h"
#include "webres.h"

using Microsoft::WRL::Callback;
using Microsoft::WRL::ComPtr;

namespace otz {
namespace {

// ── קבועים ───────────────────────────────────────────────────────────────────

constexpr wchar_t kWindowClass[] = L"OtzariaPluginStoreWindow";
constexpr wchar_t kWindowTitle[] = L"חנות התוספים של אוצריא";

// המקור שממנו הממשק נטען. `.invalid` שמור ב-RFC 2606 ולעולם אינו נפתר
// ב-DNS — כך שאין שום מצב שבו בקשה של הממשק יוצאת בטעות לרשת.
constexpr wchar_t kAppOrigin[] = L"https://app.otzaria.invalid";
constexpr wchar_t kAppStartUrl[] = L"https://app.otzaria.invalid/index.html";
constexpr wchar_t kResourceFilter[] = L"https://app.otzaria.invalid/*";

// התחילית שמאחריה מוגשים קבצים מתוך `Data\` — האייקונים וצילומי המסך
// של התוספים. כך הממשק מציג אותם ב-`<img src>` רגיל, בלי `file://`
// (שה-WebView2 חוסם מדף https) ובלי להעביר תמונות שלמות דרך הגשר.
constexpr wchar_t kDataPathPrefix[] = L"/data/";

// גודל החלון בפתיחה, לפני ההגדלה. זהה לגרסת ה-Flutter (main.cpp של
// ה-runner), וכמוה החלון נפתח מוגדל.
constexpr int kInitialWidth = 1280;
constexpr int kInitialHeight = 720;

// גודל מינימלי — זהה ל-`windowManager.setMinimumSize(900, 620)`.
constexpr int kMinWidth = 900;
constexpr int kMinHeight = 620;

// הודעת החלון שדרכה עבודה מ-thread עובד חוזרת ל-thread של הממשק.
// ה-lParam הוא `std::function<void()>*` שהוקצה בערמה.
constexpr UINT WM_OTZ_DISPATCH = WM_APP + 1;

// ── מצב גלובלי ───────────────────────────────────────────────────────────────
// תהליך עם חלון אחד ו-WebView אחד. מצב גלובלי כאן פשוט יותר מהעברת
// מצביע דרך `GWLP_USERDATA`, ואין כאן חלון שני שיתחרה עליו.

HWND g_window = nullptr;
ComPtr<ICoreWebView2Controller> g_controller;
ComPtr<ICoreWebView2> g_webview;
WebBundle g_bundle;
std::unique_ptr<Bridge> g_bridge;
AppPaths g_paths;
bool g_dark_mode = false;

// ── עזרים ────────────────────────────────────────────────────────────────────

// מפענח `%D7%90` בנתיב שהגיע מה-URL. הנתיבים של קובצי התוספים מכילים
// עברית, וה-WebView2 מקודד אותם.
std::wstring PercentDecode(std::wstring_view text) {
  // הפענוח נעשה על **בייטים** ואז מומר מ-UTF-8: `%D7%90` הוא שני בייטים
  // של תו אחד, ופענוח לתווים בודדים היה שובר אותו.
  std::string bytes;
  bytes.reserve(text.size());

  // ⚠️ המקטעים שאינם מקודדים נאספים ומומרים **בגוש**. המרה של יחידת
  // UTF-16 בודדת הייתה שוברת זוג surrogate — תו מעל ה-BMP יוצא בשני
  // `wchar_t`, וכל אחד מהם לבדו אינו תו חוקי וווינדוס מחליף אותו
  // ב-U+FFFD. הנתיב שהיה נבנה כאן פשוט לא היה קיים על הדיסק.
  std::wstring plain;
  const auto flush = [&bytes, &plain] {
    if (plain.empty()) return;
    bytes += Utf8(plain);
    plain.clear();
  };

  for (size_t i = 0; i < text.size(); ++i) {
    if (text[i] == L'%' && i + 2 < text.size()) {
      const auto hex = [](wchar_t c) -> int {
        if (c >= L'0' && c <= L'9') return c - L'0';
        if (c >= L'a' && c <= L'f') return c - L'a' + 10;
        if (c >= L'A' && c <= L'F') return c - L'A' + 10;
        return -1;
      };
      const int high = hex(text[i + 1]);
      const int low = hex(text[i + 2]);
      if (high >= 0 && low >= 0) {
        flush();
        bytes.push_back(static_cast<char>(high * 16 + low));
        i += 2;
        continue;
      }
    }
    // ⚠️ `+` אינו רווח כאן. הקידוד הזה שייך ל-query בלבד, והקורא כבר
    // חתך אותה ב-`?`; בנתיב `+` הוא פלוס ממש, ורווח מגיע כ-`%20`
    // (`encodeURIComponent` ב-`assetUrl`, שגם מוציא פלוס כ-`%2B`).
    // תרגום שלו לרווח היה מחזיר 404 על קובץ ששמו מכיל פלוס.
    plain.push_back(text[i]);
  }
  flush();
  return Utf16(bytes);
}

bool IsMaximized() {
  WINDOWPLACEMENT placement{};
  placement.length = sizeof(placement);
  return GetWindowPlacement(g_window, &placement) &&
         placement.showCmd == SW_SHOWMAXIMIZED;
}

// מעביר עבודה ל-thread של הממשק. נקרא מ-threads עובדים.
void PostToUi(std::function<void()> work) {
  auto* heap = new std::function<void()>(std::move(work));
  if (!PostMessageW(g_window, WM_OTZ_DISPATCH, 0,
                    reinterpret_cast<LPARAM>(heap))) {
    // החלון כבר נעלם — אין למי למסור, ואין להשאיר דליפה.
    delete heap;
  }
}

// מוסר מחרוזת JSON ל-JS. **רק מה-thread של הממשק.**
void SendToJs(const std::string& json) {
  if (g_webview == nullptr) return;
  g_webview->PostWebMessageAsString(Utf16(json).c_str());
}

// אירוע שאינו תשובה לבקשה — הממשק מאזין לו.
void SendEvent(const std::string& name,
               const std::vector<std::pair<std::string, std::string>>& fields) {
  std::vector<std::pair<std::string, std::string>> all;
  all.emplace_back("event", JsonString(name));
  for (const auto& field : fields) all.push_back(field);
  SendToJs(JsonObject(all));
}

void ApplyDarkModeToFrame() {
  // צובע את מסגרת החלון (הצל והפינות) בהתאם לערכה, כדי שהחלון לא
  // ייראה כמו חלון בהיר עם תוכן כהה. אותו שיקול כמו ב-`win32_window.cpp`
  // של ה-runner בגרסת ה-Flutter.
  const BOOL dark = g_dark_mode ? TRUE : FALSE;
  DwmSetWindowAttribute(g_window, DWMWA_USE_IMMERSIVE_DARK_MODE, &dark,
                        sizeof(dark));
}

void SendWindowState() {
  SendEvent("windowState", {{"maximized", JsonBool(IsMaximized())}});
}

// ── הגשת הממשק ומהדיסק ───────────────────────────────────────────────────────

// בונה תשובת WebView2 מבייטים בזיכרון.
HRESULT MakeResponse(ICoreWebView2Environment* environment,
                     const void* data, size_t size,
                     const std::wstring& content_type,
                     ICoreWebView2WebResourceResponse** out) {
  // SHCreateMemStream מעתיק את הבייטים, ולכן החוצץ שלנו יכול להשתחרר.
  IStream* stream = SHCreateMemStream(static_cast<const BYTE*>(data),
                                      static_cast<UINT>(size));
  if (stream == nullptr) return E_OUTOFMEMORY;

  // `Cache-Control: no-store` — הממשק מגיע מתוך ה-exe, ואין שום סיבה
  // שה-WebView יחזיק עותק שלו בדיסק בין הרצות.
  const std::wstring headers =
      L"Content-Type: " + content_type + L"\r\nCache-Control: no-store";
  const HRESULT hr = environment->CreateWebResourceResponse(
      stream, 200, L"OK", headers.c_str(), out);
  stream->Release();
  return hr;
}

HRESULT MakeNotFound(ICoreWebView2Environment* environment,
                     ICoreWebView2WebResourceResponse** out) {
  return environment->CreateWebResourceResponse(nullptr, 404, L"Not Found",
                                                L"", out);
}

// קורא קובץ מתוך `Data\` להגשה כתמונה. מחזיר `false` כשאינו קיים.
bool ReadDataFile(const std::wstring& relative, std::vector<uint8_t>& out) {
  // ⚠️ חוסם יציאה מהתיקייה. הנתיב מגיע מתוך הקטלוג, שמגיע מהרשת, ולכן
  // הוא **קלט לא-מהימן** לכל דבר. בלי החסימה הזאת `..\..\` בשדה נתיב
  // הפך את התוכנה לקורא-קבצים כללי עבור כל מי ששולט בקטלוג.
  if (relative.find(L"..") != std::wstring::npos) return false;
  if (relative.find(L':') != std::wstring::npos) return false;

  std::wstring path = JoinPath(g_paths.PluginsDir(), relative);
  // גם הנתיב המורכב נבדק: המקטעים עצמם יכולים להיות תקינים ובכל זאת
  // להצביע החוצה דרך קישור.
  HANDLE file = CreateFileW(path.c_str(), GENERIC_READ, FILE_SHARE_READ,
                            nullptr, OPEN_EXISTING, FILE_ATTRIBUTE_NORMAL,
                            nullptr);
  if (file == INVALID_HANDLE_VALUE) return false;

  LARGE_INTEGER size{};
  // תקרה: תמונה של תוסף, לא קובץ ההתקנה שלו.
  constexpr long long kMaxImageBytes = 32LL * 1024 * 1024;
  if (!GetFileSizeEx(file, &size) || size.QuadPart > kMaxImageBytes) {
    CloseHandle(file);
    return false;
  }

  out.resize(static_cast<size_t>(size.QuadPart));
  size_t done = 0;
  while (done < out.size()) {
    DWORD read = 0;
    if (!ReadFile(file, out.data() + done,
                  static_cast<DWORD>(out.size() - done), &read, nullptr)) {
      const DWORD error = GetLastError();
      LogError(L"קריאת קובץ להגשה נכשלה: " + path + L" — " +
               MessageForError(error));
      break;
    }
    if (read == 0) break;
    done += read;
  }
  CloseHandle(file);

  // ⚠️ קריאה חלקית אינה הצלחה חלקית. הקורא מגיש כל `true` כתשובת 200,
  // ותמונה קטועה נראית בממשק כתקלה שלו ואינה משאירה שום עקבה. 404 על
  // קובץ שלא הצלחנו לקרוא הוא גם נכון וגם ניתן לאיתור.
  const bool complete = done == out.size();
  out.resize(done);
  return complete;
}

// ── פריסת החבילה ─────────────────────────────────────────────────────────────
// רץ **לפני** שה-WebView2 עולה, וברוב ההרצות אינו רץ בכלל: ה-exe הרזה
// אינו נושא מטען, ו-[HasOverlay] חוזר `false` אחרי קריאה של 96 בייט.

// שם קובץ ההרצה הרזה שנכתב לצד החבילה. חייב להתאים ל-`$appFileName`
// שב-native/build.ps1 ול-`OriginalFilename` שב-app.rc — זה אותו קובץ.
constexpr wchar_t kSlimExeName[] = L"חנות התוספים.exe";

// מריץ את הפריסה אם צריך. `true` = התוכנה סיימה את תפקידה בהרצה הזאת
// ועליה לצאת עם [exit_code]; `false` = להמשיך ולעלות כרגיל.
bool RunOverlaySetup(HINSTANCE instance, const OverlayInfo& overlay,
                     int& exit_code) {
  const std::wstring exe_path = ExecutablePath();
  const std::wstring stamp_path = JoinPath(g_paths.data_dir, kStampFileName);

  // כבר נפרסה. קורה כשמריצים את החבילה עצמה פעם שנייה — ואז היא פשוט
  // חנות רגילה שבמקרה שוקלת ‎96MB.
  StampFile existing;
  if (ReadStampFile(stamp_path, existing) && existing.stamp == overlay.stamp) {
    LogInfo(L"החבילה כבר פרוסה — ממשיכים כרגיל");
    return false;
  }

  // ⚠️ הפריסה **חייבת** את התיקייה שליד ה-exe: `Data\` אינה ניתנת
  // להזזה (ראו paths.h), ולכן אין כאן מסלול חלופי לתיקיית המשתמש.
  // כשל שקט כאן היה משאיר את המשתמש עם חנות ריקה בלי לדעת למה.
  if (!g_paths.error.empty() || g_paths.read_only) {
    LogError(L"אי אפשר לפרוס את החבילה — התיקייה אינה כותבת: " +
             g_paths.data_dir);
    const std::wstring message =
        L"החנות נושאת איתה את כל קובצי התוספים, וכדי לפרוס אותם היא צריכה "
        L"לכתוב לתיקייה שלידה:\n" +
        g_paths.data_dir +
        L"\n\nהמיקום הזה אינו מאפשר כתיבה. יש להעתיק את הקובץ למקום שניתן "
        L"לכתוב בו — למשל לתיקיית ההורדות או לכונן נייד — ולהריץ אותו משם.";
    MessageBoxW(nullptr, message.c_str(), kWindowTitle, MB_ICONERROR | MB_OK);
    exit_code = 1;
    return true;
  }

  LogInfo(L"פריסת החבילה מתחילה");
  ProgressWindow progress;
  progress.Create(instance, kWindowTitle,
                  L"מכינה את חנות התוספים להרצה ראשונה…");

  // ── הניקוי ────────────────────────────────────────────────────────────
  // ⚠️ **סדר הפעולות כאן הוא ההגנה כולה.** החותמת נמחקת ראשונה: פריסה
  // שתיקטע אחרי שהמראה כבר נמחקה אבל לפני שהחדשה נחתה חייבת להיראות
  // בהרצה הבאה כ"לא נפרס", ולא כ"נפרסה החבילה הקודמת".
  DeleteFileW(stamp_path.c_str());

  // המראה היא **נגזרת** של החבילה ולא נתוני משתמש, וההחלפה סיטונית:
  // מה ששורד מפריסה קודמת הוא תוספים שכבר אינם בקטלוג הזה, שהיו נשארים
  // בתיקייה לנצח.
  //
  // ⚠️ נמחקים **רק** שני אלה. `state.json` ו-`logs\` יושבים באותה
  // תיקייה בדיוק (ראו paths.h) והם מקומיים למכונה — מה שזוהה על התקנת
  // אוצריא שבמחשב הזה, ומה שקרה בהרצות הקודמות. מחיקה שלהם הייתה גורמת
  // לזיהוי מחדש בכל עדכון חבילה, ומוחקת בדיוק את היומן שמסביר תקלה.
  RemoveTree(g_paths.PluginsDir());
  DeleteFileW(g_paths.CatalogPath().c_str());

  // ── הפריסה ────────────────────────────────────────────────────────────
  // ⚠️ ה-`catch` אינו קוסמטי. כל שדות האורך שנפרסים כאן מגיעים מקובץ
  // שהמשתמש הוריד מהרשת, ולמרות שכולם נבדקים, הקצאה שנכשלת (‏`vector`
  // על מכונה עמוסה) זורקת — ובלי תפיסה החריג היה מפיל את התהליך
  // בדיאלוג של ווינדוס, במקום להגיד למשתמש שהחבילה פגומה ושכדאי
  // להוריד אותה מחדש.
  std::wstring error;
  bool extracted = false;
  try {
    extracted = ExtractOverlay(
        exe_path, overlay, g_paths.data_dir,
        [&progress](uint64_t done, uint64_t total) {
          progress.Update(done, total);
        },
        error);
  } catch (const std::exception& thrown) {
    error = L"שגיאה בלתי צפויה בפריסה: " + Utf16(thrown.what());
  } catch (...) {
    error = L"שגיאה בלתי צפויה בפריסה.";
  }
  if (!extracted) {
    progress.Close();
    LogError(L"פריסת החבילה נכשלה: " + error);
    MessageBoxW(nullptr,
                (L"פריסת קובצי החנות נכשלה.\n\n" + error).c_str(), kWindowTitle,
                MB_ICONERROR | MB_OK);
    exit_code = 1;
    return true;
  }

  // ── החותמת, אחרונה ────────────────────────────────────────────────────
  // רק עכשיו, אחרי שהקובץ האחרון נחת. השורה השנייה היא הנתיב של החבילה
  // עצמה — זה מה שמאפשר ל-exe הרזה להציע למשתמש למחוק אותה (ראו
  // `installerPath` ב-bridge.cpp).
  StampFile stamp;
  stamp.stamp = overlay.stamp;
  stamp.installer = exe_path;
  if (!WriteStampFile(stamp_path, stamp, error)) {
    progress.Close();
    LogError(L"כתיבת החותמת נכשלה: " + error);
    MessageBoxW(nullptr, error.c_str(), kWindowTitle, MB_ICONERROR | MB_OK);
    exit_code = 1;
    return true;
  }

  // ── העותק הרזה ────────────────────────────────────────────────────────
  const std::wstring slim = JoinPath(ExecutableDir(), kSlimExeName);

  // ⚠️ החבילה **היא** התהליך שרץ עכשיו, ובווינדוס אי אפשר לכתוב לקובץ
  // ההרצה של תהליך רץ. זה קורה כשמישהו שינה לחבילה את שמה לשם של ה-exe
  // הרזה: אין למי למסור את השרביט, והתשובה הנכונה היא פשוט להמשיך
  // ולעלות — התוכנה כאן עובדת, היא רק גדולה.
  if (lstrcmpiW(slim.c_str(), exe_path.c_str()) == 0) {
    progress.Close();
    LogInfo(L"החבילה כבר נושאת את שם ה-exe הרזה — ממשיכים בלי עותק");
    return false;
  }

  if (!WriteSlimCopy(exe_path, overlay.data_offset, slim, error)) {
    progress.Close();
    LogError(L"כתיבת העותק הרזה נכשלה: " + error);
    MessageBoxW(nullptr,
                (L"כתיבת קובץ ההרצה של החנות נכשלה.\n\n" + error).c_str(),
                kWindowTitle, MB_ICONERROR | MB_OK);
    exit_code = 1;
    return true;
  }

  // ── מסירת השרביט ──────────────────────────────────────────────────────
  progress.Close();
  if (!LaunchAndForget(slim, error)) {
    // ההרצה נכשלה אבל הכול כבר על הדיסק — עדיף להמשיך ולעלות מכאן מאשר
    // להציג שגיאה על תוכנה שבפועל מוכנה לגמרי.
    LogError(L"הרצת העותק הרזה נכשלה, ממשיכים בתהליך הזה: " + error);
    return false;
  }

  LogInfo(L"הפריסה הסתיימה — השרביט נמסר ל-" + slim);
  exit_code = 0;
  return true;
}

// ── פעולות שמחייבות את ה-thread של הממשק ─────────────────────────────────────

void HandleWindowCommand(const std::wstring& command,
                         const std::vector<std::wstring>& args,
                         long long request_id) {
  if (command == L"win.minimize") {
    ShowWindow(g_window, SW_MINIMIZE);
    g_bridge->ReplyOk(request_id, "true");
    return;
  }
  if (command == L"win.maximizeToggle") {
    ShowWindow(g_window, IsMaximized() ? SW_RESTORE : SW_MAXIMIZE);
    g_bridge->ReplyOk(request_id, "true");
    return;
  }
  if (command == L"win.close") {
    g_bridge->ReplyOk(request_id, "true");
    PostMessageW(g_window, WM_CLOSE, 0, 0);
    return;
  }
  if (command == L"win.state") {
    g_bridge->ReplyOk(request_id,
                      JsonObject({{"maximized", JsonBool(IsMaximized())}}));
    return;
  }
  if (command == L"win.dragMove") {
    // מוסר את הגרירה לווינדוס עצמה. זה מה שמביא איתו את כל ההתנהגות
    // המקורית: snap לשולי המסך, גרירה בין מסכים, וביטול ב-Esc.
    g_bridge->ReplyOk(request_id, "true");
    ReleaseCapture();
    SendMessageW(g_window, WM_NCLBUTTONDOWN, HTCAPTION, 0);
    return;
  }
  if (command == L"win.resizeStart") {
    const std::wstring edge = args.empty() ? std::wstring{} : args[0];
    // אותו רעיון כמו בגרירה, לכל אחד משמונת הכיוונים.
    WPARAM hit = 0;
    if (edge == L"left") hit = HTLEFT;
    else if (edge == L"right") hit = HTRIGHT;
    else if (edge == L"top") hit = HTTOP;
    else if (edge == L"bottom") hit = HTBOTTOM;
    else if (edge == L"topleft") hit = HTTOPLEFT;
    else if (edge == L"topright") hit = HTTOPRIGHT;
    else if (edge == L"bottomleft") hit = HTBOTTOMLEFT;
    else if (edge == L"bottomright") hit = HTBOTTOMRIGHT;

    if (hit == 0) {
      g_bridge->ReplyError(request_id, L"כיוון שינוי גודל שאינו מוכר: " + edge);
      return;
    }
    g_bridge->ReplyOk(request_id, "true");
    ReleaseCapture();
    SendMessageW(g_window, WM_NCLBUTTONDOWN, hit, 0);
    return;
  }
  if (command == L"sys.saveDialog") {
    const std::wstring suggested = args.empty() ? std::wstring{} : args[0];
    const Result result = sysapi::SaveFileDialog(g_window, suggested);
    if (result.ok) {
      g_bridge->ReplyOk(request_id, result.json);
    } else {
      g_bridge->ReplyError(request_id, result.error);
    }
    return;
  }

  g_bridge->ReplyError(request_id, L"פקודת חלון שאינה מוכרת: " + command);
}

// ── WebView2 ─────────────────────────────────────────────────────────────────

void ResizeWebView() {
  if (g_controller == nullptr) return;
  RECT bounds{};
  GetClientRect(g_window, &bounds);
  g_controller->put_Bounds(bounds);
}

HRESULT OnWebViewReady(ICoreWebView2Environment* environment,
                       ICoreWebView2Controller* controller) {
  g_controller = controller;
  g_controller->get_CoreWebView2(&g_webview);
  if (g_webview == nullptr) return E_FAIL;

  ComPtr<ICoreWebView2Settings> settings;
  if (SUCCEEDED(g_webview->get_Settings(&settings)) && settings != nullptr) {
    // תפריט ההקשר של הדפדפן ("רענן", "הצג מקור") אינו שייך לתוכנה
    // שאמורה להיראות כאפליקציה.
    settings->put_AreDefaultContextMenusEnabled(FALSE);
    settings->put_IsStatusBarEnabled(FALSE);
    // כלי הפיתוח נשארים זמינים כשמריצים עם המשתנה — ככה מנפים את הממשק
    // בלי בנייה נפרדת.
    settings->put_AreDevToolsEnabled(
        GetEnvironmentVariableW(L"OTZARIA_STORE_DEVTOOLS", nullptr, 0) > 0
            ? TRUE
            : FALSE);
    // מקשי ההאצה של הדפדפן (Ctrl+P, Ctrl+F, F5) אינם רלוונטיים כאן.
    // הם יושבים על `ICoreWebView2Settings3` ולא על הבסיס, ולכן דרך
    // QueryInterface — ב-Runtime ותיק הוא פשוט אינו קיים, וזה בסדר.
    ComPtr<ICoreWebView2Settings3> settings3;
    if (SUCCEEDED(settings.As(&settings3)) && settings3 != nullptr) {
      settings3->put_AreBrowserAcceleratorKeysEnabled(FALSE);
    }
  }

  // ── הגשת הממשק ─────────────────────────────────────────────────────────
  g_webview->AddWebResourceRequestedFilter(
      kResourceFilter, COREWEBVIEW2_WEB_RESOURCE_CONTEXT_ALL);

  EventRegistrationToken token{};
  ComPtr<ICoreWebView2Environment> env(environment);
  g_webview->add_WebResourceRequested(
      Callback<ICoreWebView2WebResourceRequestedEventHandler>(
          [env](ICoreWebView2*, ICoreWebView2WebResourceRequestedEventArgs* args)
              -> HRESULT {
            ComPtr<ICoreWebView2WebResourceRequest> request;
            if (FAILED(args->get_Request(&request)) || request == nullptr) {
              return S_OK;
            }
            LPWSTR raw_uri = nullptr;
            if (FAILED(request->get_Uri(&raw_uri)) || raw_uri == nullptr) {
              return S_OK;
            }
            const std::wstring uri(raw_uri);
            CoTaskMemFree(raw_uri);

            // המסנן אמור להבטיח את התחילית, אבל `substr` על מחרוזת קצרה
            // ממנה זורק חריג — ומ-callback של COM אין לו לאן לצאת.
            if (uri.rfind(kAppOrigin, 0) != 0) return S_OK;

            // הנתיב שאחרי המקור, בלי query ובלי fragment.
            std::wstring path = uri.substr(wcslen(kAppOrigin));
            const size_t cut = path.find_first_of(L"?#");
            if (cut != std::wstring::npos) path.resize(cut);
            if (path.empty() || path == L"/") path = L"/index.html";

            ComPtr<ICoreWebView2WebResourceResponse> response;
            HRESULT hr = E_FAIL;

            // קובץ מתוך `Data\` — תמונה או צילום מסך של תוסף.
            if (path.rfind(kDataPathPrefix, 0) == 0) {
              const std::wstring relative =
                  PercentDecode(path.substr(wcslen(kDataPathPrefix)));
              std::vector<uint8_t> bytes;
              if (ReadDataFile(relative, bytes)) {
                hr = MakeResponse(env.Get(), bytes.data(), bytes.size(),
                                  ContentTypeFor(Utf8(relative)), &response);
              } else {
                hr = MakeNotFound(env.Get(), &response);
              }
            } else {
              // קובץ ממשק מתוך החבילה שב-exe.
              const std::string key = Utf8(path.substr(1));
              if (const std::vector<uint8_t>* file = g_bundle.Find(key)) {
                hr = MakeResponse(env.Get(), file->data(), file->size(),
                                  ContentTypeFor(key), &response);
              } else {
                hr = MakeNotFound(env.Get(), &response);
              }
            }

            // ⚠️ `put_Response(nullptr)` אינו "תשובה ריקה" אלא "אינני
            // מטפל בבקשה": ה-WebView2 היה יוצא איתה לרשת, אל מקור
            // `.invalid` שלעולם אינו נפתר, והמשתמש היה מקבל חלון ריק
            // בלי שום רמז. אין מה למסור — אבל יש מה לרשום.
            if (FAILED(hr) || response == nullptr) {
              LogError(L"בניית התשובה נכשלה עבור " + path + L": " +
                       MessageForError(static_cast<DWORD>(hr)));
              return S_OK;
            }
            args->put_Response(response.Get());
            return S_OK;
          })
          .Get(),
      &token);

  // ── הודעות מה-JS ───────────────────────────────────────────────────────
  g_webview->add_WebMessageReceived(
      Callback<ICoreWebView2WebMessageReceivedEventHandler>(
          [](ICoreWebView2*, ICoreWebView2WebMessageReceivedEventArgs* args)
              -> HRESULT {
            // ⚠️ המטפלים כאן אינם מוסרים לעולם, והגשר נהרס **לפני**
            // ה-WebView2 (ראו סוף `wWinMain`). שחרור ה-WebView2 הוא
            // קריאת COM בין תהליכים, וה-STA שואב הודעות בזמן ההמתנה —
            // כך שהודעה שכבר הייתה בדרך יכולה להגיע לכאן אחרי ההריסה.
            if (g_bridge == nullptr) return S_OK;

            LPWSTR message = nullptr;
            if (FAILED(args->TryGetWebMessageAsString(&message)) ||
                message == nullptr) {
              return S_OK;
            }
            const std::wstring text(message);
            CoTaskMemFree(message);
            g_bridge->HandleMessage(text);
            return S_OK;
          })
          .Get(),
      &token);

  // ── קישור חיצוני נפתח בדפדפן, לא בתוך התוכנה ───────────────────────────
  // בלי זה, לחיצה על "דף הבית של התוסף" הייתה מחליפה את הממשק בדף אינטרנט
  // בתוך החלון, בלי דרך לחזור.
  g_webview->add_NavigationStarting(
      Callback<ICoreWebView2NavigationStartingEventHandler>(
          [](ICoreWebView2*, ICoreWebView2NavigationStartingEventArgs* args)
              -> HRESULT {
            LPWSTR raw_uri = nullptr;
            if (FAILED(args->get_Uri(&raw_uri)) || raw_uri == nullptr) {
              return S_OK;
            }
            const std::wstring uri(raw_uri);
            CoTaskMemFree(raw_uri);
            if (uri.rfind(kAppOrigin, 0) == 0) return S_OK;

            args->put_Cancel(TRUE);
            sysapi::OpenExternalUrl(uri);
            return S_OK;
          })
          .Get(),
      &token);

  g_webview->add_NewWindowRequested(
      Callback<ICoreWebView2NewWindowRequestedEventHandler>(
          [](ICoreWebView2*, ICoreWebView2NewWindowRequestedEventArgs* args)
              -> HRESULT {
            LPWSTR raw_uri = nullptr;
            if (SUCCEEDED(args->get_Uri(&raw_uri)) && raw_uri != nullptr) {
              const std::wstring uri(raw_uri);
              CoTaskMemFree(raw_uri);
              sysapi::OpenExternalUrl(uri);
            }
            args->put_Handled(TRUE);
            return S_OK;
          })
          .Get(),
      &token);

  ResizeWebView();
  g_webview->Navigate(kAppStartUrl);
  return S_OK;
}

void CreateWebView() {
  const std::wstring cache_dir = g_paths.WebViewCacheDir();
  CreateDirectories(cache_dir);

  const HRESULT hr = CreateCoreWebView2EnvironmentWithOptions(
      nullptr, cache_dir.c_str(), nullptr,
      Callback<ICoreWebView2CreateCoreWebView2EnvironmentCompletedHandler>(
          [](HRESULT result, ICoreWebView2Environment* environment) -> HRESULT {
            if (FAILED(result) || environment == nullptr) {
              LogError(L"אתחול ה-WebView2 נכשל: " +
                       MessageForError(static_cast<DWORD>(result)));
              // הודעה אחת ויציאה, במקום תהליך שרץ בלי חלון גלוי.
              // הרכיב עצמו אינו באחריות התוכנה הזאת — אוצריא מביאה אותו.
              MessageBoxW(nullptr,
                          L"רכיב התצוגה של ווינדוס (WebView2) לא נטען, "
                          L"ולכן החנות אינה יכולה לעלות.",
                          kWindowTitle, MB_ICONERROR | MB_OK);
              PostQuitMessage(1);
              return S_OK;
            }

            // ה-`environment` נמסר לנו בהשאלה לאורך הקריאה הזאת בלבד,
            // והמטפל שלמטה מוחזק אחריה — עד שיצירת ה-controller תיגמר.
            // לכן ComPtr ולא מצביע גולמי: ספירת ההפניות היא מה שמחזיק
            // אותו בחיים עד אז.
            environment->CreateCoreWebView2Controller(
                g_window,
                Callback<ICoreWebView2CreateCoreWebView2ControllerCompletedHandler>(
                    [env = ComPtr<ICoreWebView2Environment>(environment)](
                        HRESULT create_result,
                        ICoreWebView2Controller* controller) -> HRESULT {
                      if (FAILED(create_result) || controller == nullptr) {
                        LogError(L"יצירת ה-WebView2 נכשלה");
                        PostQuitMessage(1);
                        return S_OK;
                      }
                      return OnWebViewReady(env.Get(), controller);
                    })
                    .Get());
            return S_OK;
          })
          .Get());

  if (FAILED(hr)) {
    LogError(L"CreateCoreWebView2EnvironmentWithOptions נכשל");
    MessageBoxW(nullptr,
                L"רכיב התצוגה של ווינדוס (WebView2) אינו זמין במחשב הזה.",
                kWindowTitle, MB_ICONERROR | MB_OK);
    PostQuitMessage(1);
  }
}

// ── החלון ────────────────────────────────────────────────────────────────────

LRESULT CALLBACK WindowProc(HWND window, UINT message, WPARAM wparam,
                            LPARAM lparam) {
  switch (message) {
    case WM_NCCALCSIZE:
      // כל החלון הוא אזור-לקוח: כך לא נשארת שולית מסגרת גלויה סביב
      // התוכן. ראו ההסבר בראש הקובץ — הגרירה ושינוי הגודל מגיעים מה-JS.
      if (wparam == TRUE) return 0;
      break;

    case WM_GETMINMAXINFO: {
      auto* info = reinterpret_cast<MINMAXINFO*>(lparam);
      info->ptMinTrackSize.x = kMinWidth;
      info->ptMinTrackSize.y = kMinHeight;

      // הגדלה עד אזור העבודה בלבד. בלי זה חלון `WS_POPUP` מוגדל מכסה
      // את שורת המשימות.
      HMONITOR monitor = MonitorFromWindow(window, MONITOR_DEFAULTTONEAREST);
      MONITORINFO monitor_info{};
      monitor_info.cbSize = sizeof(monitor_info);
      if (GetMonitorInfoW(monitor, &monitor_info)) {
        const RECT& work = monitor_info.rcWork;
        info->ptMaxPosition.x = work.left - monitor_info.rcMonitor.left;
        info->ptMaxPosition.y = work.top - monitor_info.rcMonitor.top;
        info->ptMaxSize.x = work.right - work.left;
        info->ptMaxSize.y = work.bottom - work.top;
        info->ptMaxTrackSize = info->ptMaxSize;
      }
      return 0;
    }

    case WM_SIZE:
      ResizeWebView();
      // כפתור ההגדלה בממשק מתחלף לפי המצב, ולכן הוא צריך לדעת עליו.
      if (g_webview != nullptr) SendWindowState();
      return 0;

    case WM_SETTINGCHANGE:
      // המשתמש החליף ערכה בהגדרות ווינדוס בזמן שהתוכנה פתוחה.
      if (lparam != 0 &&
          lstrcmpiW(reinterpret_cast<const wchar_t*>(lparam),
                    L"ImmersiveColorSet") == 0) {
        const bool dark = sysapi::IsSystemDarkMode();
        if (dark != g_dark_mode) {
          g_dark_mode = dark;
          ApplyDarkModeToFrame();
          if (g_webview != nullptr) {
            SendEvent("themeChanged", {{"dark", JsonBool(g_dark_mode)}});
          }
        }
      }
      break;

    case WM_OTZ_DISPATCH: {
      // עבודה שחזרה מ-thread עובד.
      auto* work = reinterpret_cast<std::function<void()>*>(lparam);
      if (work != nullptr) {
        (*work)();
        delete work;
      }
      return 0;
    }

    case WM_ERASEBKGND:
      // ה-WebView מכסה את כל אזור-הלקוח וצובע אותו בעצמו. ציור רקע כאן
      // רק יוצר הבהוב לבן בשינוי גודל.
      return 1;

    case WM_CLOSE:
      DestroyWindow(window);
      return 0;

    case WM_DESTROY:
      PostQuitMessage(0);
      return 0;

    default:
      break;
  }
  return DefWindowProcW(window, message, wparam, lparam);
}

bool CreateAppWindow(HINSTANCE instance) {
  WNDCLASSEXW window_class{};
  window_class.cbSize = sizeof(window_class);
  window_class.style = CS_HREDRAW | CS_VREDRAW;
  window_class.lpfnWndProc = WindowProc;
  window_class.hInstance = instance;
  window_class.hIcon = LoadIconW(instance, MAKEINTRESOURCEW(IDI_APP_ICON));
  window_class.hCursor = LoadCursorW(nullptr, IDC_ARROW);
  // רקע ה-panel, כדי שהרגע שבין יצירת החלון לעליית ה-WebView לא יהבהב
  // בלבן. הגוון נלקח מ-`--panel-bg` שבערכה.
  window_class.hbrBackground = CreateSolidBrush(
      g_dark_mode ? RGB(0x00, 0x00, 0x00) : RGB(0xF6, 0xED, 0xE5));
  window_class.lpszClassName = kWindowClass;
  if (RegisterClassExW(&window_class) == 0) return false;

  // בלי `WS_CAPTION`: DWM אינו מצייר שורת כותרת. עם `WS_THICKFRAME`:
  // צל, פינות מעוגלות בווינדוס 11, והתנהגות הגדלה/כיווץ מקורית.
  // `WS_CLIPCHILDREN` מונע הבהוב מעל חלון ה-WebView.
  const DWORD style = WS_POPUP | WS_THICKFRAME | WS_MINIMIZEBOX |
                      WS_MAXIMIZEBOX | WS_SYSMENU | WS_CLIPCHILDREN;

  g_window = CreateWindowExW(0, kWindowClass, kWindowTitle, style,
                             CW_USEDEFAULT, CW_USEDEFAULT, kInitialWidth,
                             kInitialHeight, nullptr, nullptr, instance, nullptr);
  if (g_window == nullptr) return false;

  ApplyDarkModeToFrame();

  // פינות מעוגלות בווינדוס 11. כשל (ווינדוס 10) אינו מזיק — הן פשוט
  // נשארות מרובעות, כמו כל חלון אחר שם.
  const DWORD corner = 2;  // DWMWCP_ROUND
  DwmSetWindowAttribute(g_window, 33 /* DWMWA_WINDOW_CORNER_PREFERENCE */,
                        &corner, sizeof(corner));
  return true;
}

}  // namespace
}  // namespace otz

int WINAPI wWinMain(HINSTANCE instance, HINSTANCE, PWSTR, int) {
  using namespace otz;

  // ── מה שחייב לקרות לפני החלון ─────────────────────────────────────────────
  if (!sysapi::Init()) {
    MessageBoxW(nullptr, L"אתחול COM נכשל.", kWindowTitle, MB_ICONERROR | MB_OK);
    return 1;
  }

  g_paths = ResolveAppPaths();
  CreateDirectories(JoinPath(g_paths.state_dir, L"logs"));
  LogInit(g_paths.LogFilePath(), APP_VERSION_W);
  if (!g_paths.error.empty()) {
    // לא יציאה: הממשק מציג את ההסבר, וזה כל מה שהתוכנה יכולה לעשות כאן.
    LogError(L"תיקיית הנתונים אינה כותבת — מוצג מסך שגיאה");
  }
  if (g_paths.read_only) {
    LogInfo(L"הכונן לקריאה בלבד — היומן והמצב נכתבים ל-" + g_paths.state_dir);
  }

  // ── החבילה, לפני כל השאר ──────────────────────────────────────────────────
  // חייב לרוץ לפני שה-WebView2 עולה: הממשק קורא את `Data\` מיד בעלייתו,
  // ואם היא עומדת להיפרס אין טעם שהוא יראה אותה קודם. ברוב ההרצות זו
  // קריאה של 96 בייט שחוזרת ריקה.
  OverlayInfo overlay;
  if (HasOverlay(ExecutablePath(), overlay)) {
    int exit_code = 0;
    if (RunOverlaySetup(instance, overlay, exit_code)) return exit_code;
  }

  g_dark_mode = sysapi::IsSystemDarkMode();

  // חבילת הממשק. כשל כאן הוא כשל **בנייה** ולא מצב ריצה.
  if (!g_bundle.LoadFromResource(instance, IDR_WEB_BUNDLE)) {
    MessageBoxW(nullptr,
                L"חבילת קובצי הממשק חסרה או פגומה בקובץ ההרצה.\n"
                L"זו תקלת בנייה — יש להוריד את התוכנה מחדש.",
                kWindowTitle, MB_ICONERROR | MB_OK);
    return 1;
  }

  if (!netapi::Init()) {
    // לא יציאה: כל העבודה מול המראה המקומית עובדת בלי רשת, וזה בדיוק
    // התרחיש שהתוכנה נבנתה בשבילו.
    LogError(L"אתחול שכבת הרשת נכשל — פעולות רשת לא יעבדו בהרצה הזאת");
  }

  g_bridge = std::make_unique<Bridge>(g_paths, APP_VERSION_W);

  if (!CreateAppWindow(instance)) {
    MessageBoxW(nullptr, L"יצירת החלון נכשלה.", kWindowTitle,
                MB_ICONERROR | MB_OK);
    return 1;
  }

  g_bridge->Attach(PostToUi, SendToJs, HandleWindowCommand);
  CreateWebView();

  // מוגדל בפתיחה — כמו `ShowWindow(SW_SHOWMAXIMIZED)` ב-runner של
  // גרסת ה-Flutter.
  ShowWindow(g_window, SW_SHOWMAXIMIZED);
  UpdateWindow(g_window);

  MSG message{};
  while (GetMessageW(&message, nullptr, 0, 0)) {
    TranslateMessage(&message);
    DispatchMessageW(&message);
  }

  // סדר הפירוק חשוב: הגשר קודם (הוא עוצר את ה-threads העובדים ומסמן
  // שאין למי להשיב), ורק אחריו ה-WebView והרשת.
  g_bridge.reset();
  g_controller = nullptr;
  g_webview = nullptr;
  netapi::Shutdown();
  return static_cast<int>(message.wParam);
}
