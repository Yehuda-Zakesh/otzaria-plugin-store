// עזרי בסיס שכל שאר הקבצים כאן נשענים עליהם: המרות UTF, בניית JSON,
// פירוק מסגור ההודעות של הגשר, ויומן.
//
// ── למה אין כאן פרסר JSON ─────────────────────────────────────────────────────
// הצד ה-C++ **אינו מפרסר JSON בכלל**, וזו החלטה מכוונת. כל הלוגיקה של
// התוכנה יושבת ב-JS, שבו JSON הוא מבנה שפה; ה-host הוא רק מעטפת שמוסרת
// קבצים, רשת ורג'יסטרי. לכן:
//
//   JS  → host:  שדות מופרדים ב-US‏ (U+001F). התו הזה אינו חוקי בנתיב
//                ואינו מופיע בכתובת, ולכן אין צורך בשום escaping — ואין
//                פרסר שיכול לטעות.
//   host → JS:   מחרוזת JSON שנבנית כאן עם escaping בלבד ([[JsonEscape]]),
//                ו-JS עושה לה `JSON.parse`.
//
// כתיבת JSON בטוחה היא עשרים שורות; פרסור JSON נכון הוא לא, ובקוד שמקבל
// נתונים מהרשת ומטפל בעברית זה בדיוק המקום שבו פרסר תוצרת-בית נשבר.
#pragma once

// ⚠️ **הכותרת הזאת היא זו שמביאה את `windows.h` לכל הפרויקט**, ולכן היא
// חייבת להיכלל לפני כל כותרת מערכת אחרת (`shellapi.h`, `winhttp.h`,
// `wincrypt.h`, `compressapi.h`). כולן נשענות על הטיפוסים שבו, ובלעדיו
// הן נופלות ב"No Target Architecture".
//
// המשמעות המעשית: בכל `.cpp` כאן, `#include "common.h"` (או כותרת שלנו
// שכוללת אותו) בא **ראשון**.
#ifndef WIN32_LEAN_AND_MEAN
#define WIN32_LEAN_AND_MEAN
#endif
#include <windows.h>

#include <string>
#include <string_view>
#include <vector>

namespace otz {

// ── המרות קידוד ──────────────────────────────────────────────────────────────
// כל ה-Win32 כאן הוא wide, וכל מה שעובר לגשר ולקבצים הוא UTF-8. שתי
// הפונקציות האלה הן הגבול היחיד בין השניים.
std::wstring Utf16(std::string_view utf8);
std::string Utf8(std::wstring_view utf16);

// ── מסגור ההודעות של הגשר ────────────────────────────────────────────────────
// מפריד השדות. חייב להתאים ל-`FIELD_SEP` ב-native/web/js/bridge.js.
constexpr wchar_t kFieldSeparator = L'\x1f';

// מפרק הודעה שהגיעה מ-JS לשדותיה. שדה ריק נשמר כשדה ריק — הוא ארגומנט
// לגיטימי (למשל סיומת מועדפת שלא נמסרה).
std::vector<std::wstring> SplitFields(std::wstring_view message);

// ── בניית JSON ───────────────────────────────────────────────────────────────
// מחזיר את [text] כמחרוזת JSON **כולל המרכאות**, עם escaping מלא.
//
// תווי בקרה מתחת ל-0x20 יוצאים כ-`\u00XX`: JSON אוסר אותם גולמיים, ו-JS
// היה זורק `SyntaxError` על תשובה שמכילה אותם. הודעת שגיאה של מערכת
// ההפעלה יכולה בהחלט להכיל `\r\n`.
std::string JsonString(std::string_view text);
std::string JsonString(std::wstring_view text);

// `true` / `false`.
std::string JsonBool(bool value);

// מספר שלם. JSON אינו מבחין בין שלם לצף, ו-JS יקרא אותו כ-number.
std::string JsonNumber(long long value);

// אובייקט מזוגות `"key": value` שכבר מסודרים כ-JSON. הערכים נמסרים
// **מוכנים** (`JsonString(...)`, `JsonNumber(...)`), ולכן אין כאן ניחוש
// טיפוסים.
std::string JsonObject(const std::vector<std::pair<std::string, std::string>>& fields);

// מערך מערכים/אובייקטים שכבר מסודרים כ-JSON.
std::string JsonArray(const std::vector<std::string>& items);

// ── יומן ─────────────────────────────────────────────────────────────────────
// היומן נפתח על תיקיית הכתיבה (ראו `AppPaths` ב-paths.cpp) ונכתב בהוספה.
// כשל בפתיחה אינו שגיאה: התוכנה פשוט רצה בלי יומן, כמו בגרסת ה-Flutter.
void LogInit(const std::wstring& log_file_path, const std::wstring& version);
void LogLine(std::wstring_view level, std::wstring_view message);

inline void LogInfo(std::wstring_view message) { LogLine(L"INFO", message); }
inline void LogError(std::wstring_view message) { LogLine(L"ERROR", message); }

// הודעת שגיאה של מערכת ההפעלה לפי קוד — לשורת היומן ולתשובת הגשר.
std::wstring MessageForError(DWORD error);

}  // namespace otz
