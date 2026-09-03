// הרשת, דרך WinHTTP.
//
// ── חלוקת העבודה מול JS ──────────────────────────────────────────────────────
// ה-host **מעביר בייטים ומחזיר כותרות גולמיות**, ולא מחליט כלום:
// פירוק `Content-Disposition`, מפת הסיומות לפי `Content-Type` ובחירת שם
// הקובץ הסופי כולם ב-JS (`net_headers.js`), ולכן מכוסים בבדיקות
// `node --test`. בגרסת ה-Flutter הלוגיקה הזאת ישבה בתוך
// `PluginStoreClient.downloadAsset` ולא הייתה נגישה בלי רשת אמיתית.
//
// לכן [Download] כותב ל-`<dest_path>` שנמסר לו ומחזיר את הכותרות; ה-JS
// הוא שמחליט לאיזה שם להעביר אותו אחר כך.
#pragma once

#include <string>

#include "fsapi.h"

namespace otz::netapi {

// זמן קצוב לקבלת התשובה ולקריאות ה-JSON הקטנות במלואן.
inline constexpr int kDefaultTimeoutMs = 20000;

// זמן קצוב ל**חוסר התקדמות** בגוף התשובה, ולא למשך ההורדה כולה: קובץ
// תוסף שוקל עשרות MB, ודדליין יחיד על ההורדה נכשל עליו בכל חיבור איטי
// גם כשהיא התקדמה יפה.
//
// מיושם כ-`WINHTTP_OPTION_RECEIVE_TIMEOUT`, שהוא בדיוק "עברו כך וכך בלי
// שהגיע בייט" — אותה סמנטיקה של `stallTimeout` בגרסת ה-Flutter, בלי
// טיימר משלנו.
inline constexpr int kDefaultStallMs = 30000;

// מאתחל את סשן ה-WinHTTP. נקרא פעם אחת בעלייה; `false` = אין רשת בכלל
// במחשב הזה, וכל הפעולות יחזירו כשל מנוסח.
bool Init();
void Shutdown();

// GET שמחזיר `{status, contentType, body}`. הגוף מוחזר כטקסט — כל
// הקריאות שמשתמשות בזה הן JSON.
//
// כשל **רשת** (אין חיבור, שם שלא נפתר, פסק זמן) מוחזר כ-`Fail`; קוד
// מצב שאינו 200 מוחזר כהצלחה עם ה-`status`, וה-JS הוא שמנסח את ההודעה
// — כך `loadFailed(what, status)` נשאר איתו.
Result Get(const std::wstring& url, int timeout_ms = kDefaultTimeoutMs);

// מוריד בזרימה אל [dest_path] ומחזיר
// `{status, size, contentType, contentDisposition}`.
//
// הקובץ נכתב במלואו לפני שהוא נחשב תקין, והקורא ב-JS הוא שמעביר אותו
// לשם הסופי — כך הורדה שנקטעה באמצע לא משאירה קובץ חלקי שנראה כתוסף
// תקין. תשובה שאינה 200 אינה כותבת קובץ בכלל.
Result Download(const std::wstring& url, const std::wstring& dest_path,
                int timeout_ms = kDefaultTimeoutMs,
                int stall_ms = kDefaultStallMs);

}  // namespace otz::netapi
