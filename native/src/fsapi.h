// פעולות הקבצים שהגשר חושף ל-JS.
//
// כל פונקציה מחזירה `Result`: הצלחה עם JSON מוכן, או כשל עם הודעה
// למשתמש. חריגים אינם חוצים את הגשר — הצד ה-JS מקבל תשובה ולא stack
// trace, בדיוק כמו ש-`PluginInstallResult` עשה בגרסת ה-Flutter.
#pragma once

#include <cstdint>
#include <string>
#include <vector>

namespace otz {

struct Result {
  bool ok = false;
  std::string json;    // כשהצליח — הערך, כ-JSON מוכן
  std::wstring error;  // כשנכשל — ההסבר למשתמש

  static Result Ok(std::string json) { return {true, std::move(json), {}}; }
  static Result Fail(std::wstring error) { return {false, {}, std::move(error)}; }
};

namespace fsapi {

// תוכן קובץ טקסט כמחרוזת JSON. BOM מוביל מוסר: עורכים בווינדוס שומרים
// לעיתים JSON עם U+FEFF, ו-`JSON.parse` נופל עליו.
Result ReadText(const std::wstring& path);

// כתיבה **אטומית**: קובץ `.tmp` לצדו ואז החלפה. ניתוק באמצע כתיבה לא
// ישאיר קטלוג חצי-כתוב — אותה התנהגות כמו `PluginMirrorStore.save`.
Result WriteTextAtomic(const std::wstring& path, const std::string& utf8_text);

// `"file"` / `"dir"` / `"none"`.
Result PathKind(const std::wstring& path);

// `{size, modified}` — modified הוא מילישניות מאז ה-epoch, כדי שיהיה
// `new Date(ms)` בצד ה-JS.
Result Stat(const std::wstring& path);

// תוכן תיקייה: מערך של `{name, dir, size, modified}`. תיקייה שאינה
// קיימת מחזירה מערך ריק — זה המצב התקין לפני הסנכרון הראשון.
Result ListDir(const std::wstring& path);

Result MakeDirs(const std::wstring& path);

// מחיקת קובץ. קובץ שאינו קיים היא הצלחה: המצב המבוקש הושג.
Result DeleteFileAt(const std::wstring& path);

// מחיקת תיקייה **ריקה בלבד**. תיקייה שאינה קיימת היא הצלחה, כמו
// ב-[DeleteFileAt]. ⚠️ `RemoveDirectoryW` מסרבת מעצמה לתיקייה שיש בה
// תוכן, וזו בדיוק הסיבה שהיא נבחרה: הקורא (`pruneUnusedFiles`) מוחק
// שארית ריקה אחרי גריעת בילדים, ומחיקה רקורסיבית שם הייתה יכולה לקחת
// איתה תמונה או בילד שהקטלוג עדיין מחזיק. הסירוב הוא רשת הביטחון
// השנייה, אחרי הבדיקה שב-JS.
Result RemoveEmptyDirAt(const std::wstring& path);

Result CopyFileTo(const std::wstring& from, const std::wstring& to);

// העברה/שינוי שם, עם דריסת היעד. זה מה שהופך הורדה לקובץ סופי: ה-JS
// מוריד ל-`<יעד>.part`, קורא את הכותרות, מחליט על הסיומת — ואז מעביר.
// הורדה שנקטעה לא משאירה מאחוריה קובץ שנראה כתוסף תקין.
Result Rename(const std::wstring& from, const std::wstring& to);

// קטע מקובץ, מקודד base64. זה מה שמאפשר ל-JS לקרוא את `manifest.json`
// מתוך ה-ZIP של ה-.otzplugin בלי לטעון קובץ של עשרות MB לזיכרון: הוא
// קורא את זנב ה-EOCD, את הספרייה המרכזית, ואז את הרשומה עצמה.
Result ReadBase64(const std::wstring& path, uint64_t offset, uint32_t length);

}  // namespace fsapi
}  // namespace otz
