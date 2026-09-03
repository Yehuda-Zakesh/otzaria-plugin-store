// חבילת קובצי הממשק שמוטמעת ב-exe ומוגשת מהזיכרון.
//
// היא נטענת פעם אחת בעלייה (פרישה של גוש LZMS אחד) ומשם כל בקשה של
// ה-WebView2 נענית מתוך הזיכרון — אין קובץ ממשק אחד על הדיסק.
#pragma once

// מביא את `windows.h` — [WebBundle::LoadFromResource] מקבל `HMODULE`.
#include "common.h"

#include <cstdint>
#include <map>
#include <string>
#include <string_view>
#include <vector>

namespace otz {

// חייב להתאים ל-`$magic` וללאלגוריתם ב-native/tools/pack_web.ps1.
constexpr char kWebBundleMagic[8] = {'O', 'T', 'Z', 'W', 'E', 'B', '1', '\0'};

class WebBundle {
 public:
  // טוען מה-resource שב-exe. `false` = החבילה חסרה או פגומה, וזה כשל
  // בנייה ולא מצב ריצה — הקורא מציג שגיאה ויוצא.
  bool LoadFromResource(HMODULE module, int resource_id);

  // תוכן קובץ לפי נתיב יחסי (`index.html`, `css/app.css`). `nullptr`
  // כשאינו בחבילה.
  const std::vector<uint8_t>* Find(std::string_view relative_path) const;

  bool empty() const { return files_.empty(); }

 private:
  std::map<std::string, std::vector<uint8_t>, std::less<>> files_;
};

// ה-Content-Type לפי סיומת הקובץ. ה-WebView2 מסתמך עליו: קובץ CSS
// שמוגש כ-`text/plain` לא מוחל, ו-JS כזה אינו מורץ.
std::wstring ContentTypeFor(std::string_view path);

}  // namespace otz
