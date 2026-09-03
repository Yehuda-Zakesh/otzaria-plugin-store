// הגשר בין ה-JS לבין מערכת ההפעלה.
//
// ── מה עובר בו ───────────────────────────────────────────────────────────────
//   JS  → host   `<reqId>\x1f<command>\x1f<arg0>\x1f<arg1>…`
//   host → JS    `{"id":<reqId>,"ok":true,"result":<json>}`
//                `{"id":<reqId>,"ok":false,"error":"…"}`
//
// ── למה יש כאן בכלל threads ──────────────────────────────────────────────────
// ה-WebView2 הוא STA: כל נגיעה בו חייבת להיות מה-thread שיצר את החלון.
// אבל הורדה של תוסף היא עשרות MB, וקריאת קטלוג היא I/O — ולהריץ אותן על
// אותו thread פירושו חלון קפוא לאורך כל הסנכרון.
//
// לכן: הפקודות שנוגעות בדיסק וברשת נזרקות ל-[WorkerPool], והתשובה חוזרת
// ל-thread של הממשק דרך [UiDispatcher] לפני שהיא נמסרת ל-JS. הפקודות
// שחייבות את ה-thread של הממשק (דיאלוג שמירה, פעולות חלון) רצות בו
// ישירות ואינן נכנסות לתור.
#pragma once

#include <atomic>
#include <condition_variable>
#include <deque>
#include <functional>
#include <mutex>
#include <string>
#include <thread>
#include <vector>

#include "paths.h"

namespace otz {

// מריץ עבודה על ה-thread של הממשק. ממומש ב-main.cpp מעל הודעת חלון.
using UiDispatcher = std::function<void(std::function<void()>)>;

// מוסר מחרוזת JSON ל-JS. נקרא **רק** מה-thread של הממשק.
using JsSender = std::function<void(const std::string&)>;

// בקשה לפתוח דיאלוג שמירה — מחייב את ה-thread של הממשק ואת ה-HWND.
using WindowCommand = std::function<void(const std::wstring& command,
                                         const std::vector<std::wstring>& args,
                                         long long request_id)>;

// תור עבודה עם מספר קבוע של threads.
//
// ארבעה, כמו `PluginMirrorSync.defaultMaxConcurrentPlugins`: הקבצים כאן
// קטנים והזמן הולך על סיבובי הלוך-חזור לשרת, ולכן זה בדיוק המקום שבו
// מקביליות משתלמת. ראו את ההסבר ב-`download_pool.dart`.
class WorkerPool {
 public:
  static constexpr size_t kDefaultWorkers = 4;

  void Start(size_t workers = kDefaultWorkers);
  void Stop();
  void Post(std::function<void()> job);

  ~WorkerPool() { Stop(); }

 private:
  void Run();

  std::vector<std::thread> threads_;
  std::deque<std::function<void()>> jobs_;
  std::mutex mutex_;
  std::condition_variable ready_;
  bool stopping_ = false;
};

class Bridge {
 public:
  Bridge(AppPaths paths, std::wstring version);
  ~Bridge();

  // נקרא פעם אחת אחרי שהחלון וה-WebView2 קיימים.
  void Attach(UiDispatcher ui, JsSender send_to_js, WindowCommand window);

  // ההודעה שהגיעה מ-JS. **נקרא מה-thread של הממשק.**
  void HandleMessage(const std::wstring& message);

  // תשובה לבקשה שהופנתה ל-main.cpp (דיאלוג שמירה, מצב החלון).
  // נקרא מה-thread של הממשק.
  void ReplyOk(long long request_id, const std::string& json);
  void ReplyError(long long request_id, const std::wstring& error);

  const AppPaths& paths() const { return paths_; }

 private:
  // מריץ את הפקודה על thread עובד ומשיב כשהיא נגמרת.
  void RunAsync(long long request_id, std::function<struct Result()> job);

  AppPaths paths_;
  std::wstring version_;

  UiDispatcher ui_;
  JsSender send_to_js_;
  WindowCommand window_;
  WorkerPool pool_;

  // נדלק בהריסה: תשובה שחוזרת מ-thread עובד אחרי שהחלון נסגר לא
  // תיגע ב-WebView2 שכבר אינו קיים.
  std::atomic<bool> closing_{false};
};

}  // namespace otz
