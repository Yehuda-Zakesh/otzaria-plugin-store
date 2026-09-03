// תיקיית הנתונים של התוכנה — **תמיד** צמודה לקובץ ההרצה, ואינה ניתנת
// לשינוי. זו הדרישה המרכזית של עבודה מכונן נייד: הנתונים נוסעים עם
// התוכנה, ולא נשארים על המחשב שממנו הורידו אותה.
//
// פורט של `lib/src/services/app_paths.dart`, עם המבנה החדש והשטוח:
//
//   חנות התוספים.exe
//   Data\
//     catalog.json          הקטלוג הממוראה
//     plugins\<id>\...       קובצי ה-.otzplugin, האייקון וצילומי המסך
//     logs\store-<תאריך>.log
//     cache\webview2\        תיקיית הנתונים של ה-WebView2
//     state.json             מה זוהה על התקנת אוצריא שבמחשב הזה
//
// (בגרסת ה-Flutter זה היה `OtzariaData\mirror\plugins\...` בתוך `app-files`.)
#pragma once

#include <string>

namespace otz {

struct AppPaths {
  // המראה — המקור שממנו קוראים בדיקות והתקנות — תמיד לצד קובץ ההרצה.
  std::wstring data_dir;

  // לאן **כותבים**: יומן ומצב. זהה ל-[data_dir] בהרצה רגילה, ומצביע
  // לתיקיית המשתמש שבמחשב הזה כשהכונן עצמו מוגן מפני כתיבה.
  std::wstring state_dir;

  // `true` = הכונן לקריאה בלבד. ההתקנות עובדות (הן כותבות למחשב),
  // ההורדות מהרשת לא — אין לאן להוריד.
  bool read_only = false;

  // המאגר הפנימי של ה-WebView2 — **תמיד במחשב**, מחוץ ל-`Data\`.
  //
  // ⚠️ למה לא לצד התוכנה, בניגוד לכל השאר: נמדד שהוא ‎9.5MB ב-189 קבצים
  // אחרי הרצה אחת, ו-‎14MB אחרי שמונה — כלומר הוא **גדל**. מתוכם ~‎5MB הם
  // `GrShaderCache`, מטמון שיידרים שנגזר מכרטיס הגרפי של המחשב הזה
  // ולכן חסר תוקף במחשב אחר.
  //
  // גם "ליצור בכל הרצה ולמחוק בסיום" נבדק ואינו עובד: ה-WebView2 מריץ
  // תהליכי-בן ששורדים את סגירת החלון ומחזיקים מנעולים על הקבצים, והמחיקה
  // נכשלת ב-`used by another process`.
  //
  // זהו זיכרון מטמון של מנוע התצוגה, לא נתוני משתמש — ואין שום דבר בו
  // שהמשתמש יאבד אם הוא נמחק.
  std::wstring cache_dir;

  // ההסבר למשתמש כשגם המראה וגם תיקיית המשתמש אינן כותבות. ריק =
  // אין שגיאה.
  std::wstring error;

  std::wstring PluginsDir() const;
  std::wstring CatalogPath() const;
  std::wstring WebViewCacheDir() const;
  std::wstring StateFilePath() const;
  std::wstring LogFilePath() const;
};

// שם התיקייה שנוצרת לצד קובץ ההרצה.
inline constexpr wchar_t kDataDirName[] = L"Data";

// שם התיקייה תחת `%LOCALAPPDATA%` כשהכונן לקריאה בלבד.
inline constexpr wchar_t kMachineDirName[] = L"OtzariaPluginStore";

// מאתר את התיקייה הצמודה לתוכנה ומוודא שניתן לכתוב בה **בפועל**.
//
// כשלא ניתן — ויש במקום קטלוג שכבר נמלא — חוזר במצב `read_only` במקום
// להיכשל: כונן שנעל אותו מי שמחלק אותו הוא תרחיש אמיתי, וכל מסלולי
// ההתקנה כותבים למחשב ולא לכונן. `error` מתמלא רק כשגם זה לא אפשרי.
AppPaths ResolveAppPaths();

// התיקייה שבה יושב קובץ ההרצה.
std::wstring ExecutableDir();

// הנתיב המלא של קובץ ההרצה עצמו.
std::wstring ExecutablePath();

// יוצר תיקייה וכל ההורים שלה. `true` גם כשהיא כבר קיימת.
bool CreateDirectories(const std::wstring& path);

// מחבר שני מקטעי נתיב עם `\` אחד בלבד.
std::wstring JoinPath(std::wstring_view left, std::wstring_view right);

}  // namespace otz
