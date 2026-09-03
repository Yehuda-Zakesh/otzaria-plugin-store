#include "bridge.h"

#include "common.h"
#include "fsapi.h"
#include "netapi.h"
#include "sysapi.h"

namespace otz {
namespace {

// משתנה סביבה, או ריק כשאינו מוגדר. הזיהוי של אוצריא נשען עליהם
// (`%LOCALAPPDATA%\Programs\Otzaria` וכו'), וכך הם מגיעים ל-JS במקום
// אחד ולא בקריאה נפרדת לכל אחד.
std::wstring EnvironmentValue(const wchar_t* name) {
  const DWORD needed = GetEnvironmentVariableW(name, nullptr, 0);
  if (needed == 0) return {};
  std::wstring value(needed, L'\0');
  const DWORD written = GetEnvironmentVariableW(name, value.data(), needed);
  if (written == 0) return {};
  value.resize(written);
  return value;
}

// ארגומנט לפי אינדקס, או ריק כשלא נמסר. כל הפקודות מקבלות את
// הארגומנטים שלהן דרך זה, כדי שהודעה קטועה תיתן שדה ריק ולא קריסה.
std::wstring Arg(const std::vector<std::wstring>& fields, size_t index) {
  // fields[0] הוא ה-reqId ו-fields[1] הפקודה; הארגומנטים מתחילים ב-2.
  const size_t at = index + 2;
  return at < fields.size() ? fields[at] : std::wstring{};
}

long long ArgNumber(const std::vector<std::wstring>& fields, size_t index,
                    long long fallback) {
  const std::wstring text = Arg(fields, index);
  if (text.empty()) return fallback;
  try {
    return std::stoll(text);
  } catch (...) {
    // שדה שאינו מספר — נופלים לברירת המחדל ולא מפילים את הבקשה.
    return fallback;
  }
}

}  // namespace

// ── WorkerPool ───────────────────────────────────────────────────────────────

void WorkerPool::Start(size_t workers) {
  for (size_t i = 0; i < workers; ++i) {
    threads_.emplace_back([this] { Run(); });
  }
}

void WorkerPool::Stop() {
  {
    std::lock_guard<std::mutex> guard(mutex_);
    if (stopping_) return;
    stopping_ = true;
  }
  ready_.notify_all();
  for (auto& thread : threads_) {
    if (thread.joinable()) thread.join();
  }
  threads_.clear();
}

void WorkerPool::Post(std::function<void()> job) {
  {
    std::lock_guard<std::mutex> guard(mutex_);
    if (stopping_) return;
    jobs_.push_back(std::move(job));
  }
  ready_.notify_one();
}

void WorkerPool::Run() {
  while (true) {
    std::function<void()> job;
    {
      std::unique_lock<std::mutex> lock(mutex_);
      ready_.wait(lock, [this] { return stopping_ || !jobs_.empty(); });
      // עבודה שנשארה בתור בזמן כיבוי אינה מתחילה — בדיוק כמו בדיקת
      // הביטול ב-`runPooled`.
      if (stopping_) return;
      job = std::move(jobs_.front());
      jobs_.pop_front();
    }
    // חריג מעבודה בודדת לא מפיל את ה-thread ואיתו את כל התור.
    try {
      job();
    } catch (...) {
      LogError(L"עבודה ברקע נפלה בחריג");
    }
  }
}

// ── Bridge ───────────────────────────────────────────────────────────────────

Bridge::Bridge(AppPaths paths, std::wstring version)
    : paths_(std::move(paths)), version_(std::move(version)) {
  pool_.Start();
}

Bridge::~Bridge() {
  closing_ = true;
  pool_.Stop();
}

void Bridge::Attach(UiDispatcher ui, JsSender send_to_js, WindowCommand window) {
  ui_ = std::move(ui);
  send_to_js_ = std::move(send_to_js);
  window_ = std::move(window);
}

void Bridge::ReplyOk(long long request_id, const std::string& json) {
  if (closing_ || !send_to_js_) return;
  send_to_js_(JsonObject({
      {"id", JsonNumber(request_id)},
      {"ok", "true"},
      {"result", json},
  }));
}

void Bridge::ReplyError(long long request_id, const std::wstring& error) {
  if (closing_ || !send_to_js_) return;
  send_to_js_(JsonObject({
      {"id", JsonNumber(request_id)},
      {"ok", "false"},
      {"error", JsonString(error)},
  }));
}

void Bridge::RunAsync(long long request_id, std::function<Result()> job) {
  pool_.Post([this, request_id, job = std::move(job)] {
    Result result = job();
    if (closing_) return;
    // התשובה חוזרת ל-thread של הממשק לפני שהיא נוגעת ב-WebView2.
    ui_([this, request_id, result = std::move(result)] {
      if (result.ok) {
        ReplyOk(request_id, result.json);
      } else {
        ReplyError(request_id, result.error);
      }
    });
  });
}

void Bridge::HandleMessage(const std::wstring& message) {
  const std::vector<std::wstring> fields = SplitFields(message);
  if (fields.size() < 2) {
    LogError(L"הודעה פגומה מהממשק");
    return;
  }

  long long request_id = 0;
  try {
    request_id = std::stoll(fields[0]);
  } catch (...) {
    LogError(L"מזהה בקשה שאינו מספר: " + fields[0]);
    return;
  }
  const std::wstring& command = fields[1];

  // ── קבצים ─────────────────────────────────────────────────────────────────
  if (command == L"fs.readText") {
    const std::wstring path = Arg(fields, 0);
    RunAsync(request_id, [path] { return fsapi::ReadText(path); });
    return;
  }
  if (command == L"fs.writeText") {
    const std::wstring path = Arg(fields, 0);
    // הטקסט הוא השדה השני, וייתכן שהוא מאות KB (הקטלוג). הוא אינו
    // יכול להכיל את מפריד השדות, ולכן הוא עובר שלם.
    const std::string text = Utf8(Arg(fields, 1));
    RunAsync(request_id, [path, text] {
      return fsapi::WriteTextAtomic(path, text);
    });
    return;
  }
  if (command == L"fs.kind") {
    const std::wstring path = Arg(fields, 0);
    RunAsync(request_id, [path] { return fsapi::PathKind(path); });
    return;
  }
  if (command == L"fs.stat") {
    const std::wstring path = Arg(fields, 0);
    RunAsync(request_id, [path] { return fsapi::Stat(path); });
    return;
  }
  if (command == L"fs.list") {
    const std::wstring path = Arg(fields, 0);
    RunAsync(request_id, [path] { return fsapi::ListDir(path); });
    return;
  }
  if (command == L"fs.mkdirs") {
    const std::wstring path = Arg(fields, 0);
    RunAsync(request_id, [path] { return fsapi::MakeDirs(path); });
    return;
  }
  if (command == L"fs.delete") {
    const std::wstring path = Arg(fields, 0);
    RunAsync(request_id, [path] { return fsapi::DeleteFileAt(path); });
    return;
  }
  if (command == L"fs.copy") {
    const std::wstring from = Arg(fields, 0);
    const std::wstring to = Arg(fields, 1);
    RunAsync(request_id, [from, to] { return fsapi::CopyFileTo(from, to); });
    return;
  }
  if (command == L"fs.rename") {
    const std::wstring from = Arg(fields, 0);
    const std::wstring to = Arg(fields, 1);
    RunAsync(request_id, [from, to] { return fsapi::Rename(from, to); });
    return;
  }
  if (command == L"fs.readBase64") {
    const std::wstring path = Arg(fields, 0);
    const auto offset = static_cast<uint64_t>(ArgNumber(fields, 1, 0));
    const auto length = static_cast<uint32_t>(ArgNumber(fields, 2, 0));
    RunAsync(request_id, [path, offset, length] {
      return fsapi::ReadBase64(path, offset, length);
    });
    return;
  }

  // ── רשת ───────────────────────────────────────────────────────────────────
  if (command == L"net.get") {
    const std::wstring url = Arg(fields, 0);
    const auto timeout =
        static_cast<int>(ArgNumber(fields, 1, netapi::kDefaultTimeoutMs));
    RunAsync(request_id, [url, timeout] { return netapi::Get(url, timeout); });
    return;
  }
  if (command == L"net.download") {
    const std::wstring url = Arg(fields, 0);
    const std::wstring dest = Arg(fields, 1);
    const auto timeout =
        static_cast<int>(ArgNumber(fields, 2, netapi::kDefaultTimeoutMs));
    const auto stall =
        static_cast<int>(ArgNumber(fields, 3, netapi::kDefaultStallMs));
    RunAsync(request_id, [url, dest, timeout, stall] {
      return netapi::Download(url, dest, timeout, stall);
    });
    return;
  }

  // ── מערכת ─────────────────────────────────────────────────────────────────
  if (command == L"sys.openUrl") {
    // ShellExecute רץ על ה-thread של הממשק: הוא COM/STA, והוא מהיר.
    const std::wstring url = Arg(fields, 0);
    const Result result = sysapi::OpenExternalUrl(url);
    if (result.ok) {
      ReplyOk(request_id, result.json);
    } else {
      ReplyError(request_id, result.error);
    }
    return;
  }
  if (command == L"sys.launch") {
    const std::wstring exe = Arg(fields, 0);
    const std::wstring argument = Arg(fields, 1);
    RunAsync(request_id, [exe, argument] {
      return sysapi::LaunchDetached(exe, argument);
    });
    return;
  }
  if (command == L"sys.exeVersion") {
    const std::wstring path = Arg(fields, 0);
    RunAsync(request_id,
             [path] { return sysapi::ReadExeProductVersion(path); });
    return;
  }
  if (command == L"sys.registryDirs") {
    // סריקת הרג'יסטרי לוקחת ~200ms — לא על ה-thread של הממשק.
    RunAsync(request_id, [] { return sysapi::OtzariaRegistryInstallDirs(); });
    return;
  }
  if (command == L"sys.runningOtzaria") {
    RunAsync(request_id, [] { return sysapi::FindRunningOtzaria(); });
    return;
  }

  // ── התוכנה עצמה ───────────────────────────────────────────────────────────
  if (command == L"app.info") {
    ReplyOk(request_id, JsonObject({
                            {"version", JsonString(version_)},
                            {"dataDir", JsonString(paths_.data_dir)},
                            {"pluginsDir", JsonString(paths_.PluginsDir())},
                            {"catalogPath", JsonString(paths_.CatalogPath())},
                            {"stateDir", JsonString(paths_.state_dir)},
                            {"stateFile", JsonString(paths_.StateFilePath())},
                            {"exePath", JsonString(ExecutablePath())},
                            {"readOnly", JsonBool(paths_.read_only)},
                            {"darkMode", JsonBool(sysapi::IsSystemDarkMode())},
                            // ריק = הכול תקין. כשיש כאן טקסט, הממשק מציג
                            // אותו כמסך שגיאה ואינו טוען את החנות — פורט
                            // של `SetupErrorScreen`.
                            {"setupError", JsonString(paths_.error)},
                            // המיקומים שהזיהוי של אוצריא סורק.
                            {"env", JsonObject({
                                        {"localAppData",
                                         JsonString(EnvironmentValue(L"LOCALAPPDATA"))},
                                        {"appData",
                                         JsonString(EnvironmentValue(L"APPDATA"))},
                                        {"programFiles",
                                         JsonString(EnvironmentValue(L"ProgramFiles"))},
                                        {"programData",
                                         JsonString(EnvironmentValue(L"ProgramData"))},
                                    })},
                        }));
    return;
  }

  if (command == L"app.log") {
    // ⚠️ היומן הוא **הדרך היחידה** לדעת מה קרה אצל המשתמש: הממשק רץ
    // בתוך WebView2, ושגיאת JS שאין לה יעד נעלמת עם החלון. לכן גם
    // `window.onerror` נמסר לכאן.
    const std::wstring level = Arg(fields, 0);
    const std::wstring text = Arg(fields, 1);
    LogLine(level.empty() ? L"INFO" : level, text);
    ReplyOk(request_id, "true");
    return;
  }

  // ── דיאלוג ופעולות חלון ───────────────────────────────────────────────────
  // כולן מחייבות את ה-thread של הממשק ואת ה-HWND, ולכן מופנות ל-main.cpp.
  if (command == L"sys.saveDialog" || command.rfind(L"win.", 0) == 0) {
    if (window_) {
      window_(command, std::vector<std::wstring>(fields.begin() + 2, fields.end()),
              request_id);
    } else {
      ReplyError(request_id, L"החלון אינו זמין");
    }
    return;
  }

  ReplyError(request_id, L"פקודה שאינה מוכרת: " + command);
}

}  // namespace otz
