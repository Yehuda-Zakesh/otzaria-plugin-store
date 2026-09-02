# חנות התוספים של אוצריא — אפליקציה עצמאית

שכפול של **מסך חנות התוספים** מתוך `Otzaria_Offline_update` (הלאנצ'ר "עדכוני
אוצריא"), כאפליקציה נפרדת לגמרי: קובץ EXE **אחד** של ~11MB, בלי מודול התוכנה,
בלי הספרייה, בלי תוכנות נוספות, בלי FAQ, בלי מסך הגדרות ובלי עדכון עצמי.

החנות עצמה מתנהגת **בדיוק** כמו שם — אותו קוד, אותן בדיקות.

> **הפרויקט המקורי לא נגע.** אין כאן שום תלות בעץ של `Otzaria_Offline_update`:
> שלוש החבילות שהחנות צריכה מועתקות לתוך [`packages/`](packages), והשינויים
> שנעשו בהן מסומנים למטה. אף קובץ במקור לא שונה.

---

## מה יש כאן

```
otzaria_plugin_store/
├─ lib/
│  ├─ main.dart                      נקודת כניסה: חלון, לוג, נתיבים
│  └─ src/
│     ├─ app.dart                    MaterialApp + StoreShell (מה שנשאר מ-AppShell)
│     ├─ app_version.dart
│     ├─ controllers/                plugins_module_controller + progress_notifier
│     ├─ screens/plugins/            12 קובצי מסך החנות — הועתקו כמו שהם
│     ├─ screens/setup_error_screen.dart
│     ├─ services/                   לוג, נתיבים, דיאלוגי קבצים, זיהוי אוצריא
│     ├─ theme/                      שכבת העיצוב (6 קבצים) — הועתקה כמו שהיא
│     ├─ widgets/                    הרכיבים המשותפים שהחנות צריכה (15)
│     └─ l10n/                       app_strings_scope + system_language
├─ packages/
│  ├─ plugins_manager/               כל הלוגיקה של החנות (Dart טהור) + 260 בדיקות
│  ├─ otzaria_l10n/                  כל המלל, עברית ואנגלית
│  └─ otzaria_manager/               רק כדי לזהות איפה אוצריא מותקנת ובאיזו גרסה
├─ windows/                          ה-runner של Flutter (חלון מוגדל, אייקון, שם)
├─ windows_stub/                     האריזה ל-EXE אחד (stub ב-C + סקריפטי PowerShell)
└─ test/                             115 בדיקות — הועברו מהלאנצ'ר כמו שהן
```

## בנייה

```powershell
flutter pub get
flutter build windows --release
.\windows_stub\package.ps1          # → build\חנות התוספים.exe  (~11.4MB)
```

`package.ps1` דורש Visual Studio עם כלי C++ (בשביל ה-stub ובשביל ה-CRT שנוסע
איתו). הסקריפטים נשמרים עם BOM, ולכן רצים גם ב-PowerShell 5.1 וגם ב-pwsh 7.

### בדיקות

```powershell
flutter analyze ; flutter test               # 117 עוברות
cd packages\otzaria_l10n    ; dart analyze ; dart test   #  25
cd packages\plugins_manager ; dart analyze ; dart test   # 260
cd packages\otzaria_manager ; dart analyze ; dart test   # 266
```

## גרסאות ופרסום

**המספור הוא מספר שלם אחד: 1, 2, 3…** התג הוא `v1`, `v2`, וכן הלאה.

הגרסה יושבת בשני קבצים שאינם יכולים לקרוא זה את זה — `pubspec.yaml` (ממנו
`build_stub.ps1` צורב את מרקר ה-`.ready` ואת משאב הגרסה של ה-EXE) ו-
`lib/src/app_version.dart` (מה שהתוכנה מדווחת ורושמת ללוג). `tool/set_version.sh`
מציב את שניהם יחד, ו-`test/app_version_test.dart` נכשל אם הם נפרדו.

`pubspec.yaml` מחזיק את **הגרסה שפורסמה לאחרונה**; `0` = עוד לא פורסם דבר.

### מה ה-CI עושה

[`.github/workflows/ci.yml`](.github/workflows/ci.yml) — על כל push ו-PR:

| ג'וב | מה |
|---|---|
| `version` | מחשב את המספר הבא: `max(pubspec, התג הגבוה) + 1` |
| `packages` (×3) | `dart analyze` + `dart test` על שלוש החבילות, ב-ubuntu במקביל |
| `app` | מציב את הגרסה, `flutter analyze` + `test` + `build windows`, ואורז ל-EXE |
| `publish` | **רק ב-push ל-main שהכול עבר בו:** מקדם את הגרסה בריפו, מתייג, ומעלה release |

שני דברים ששווה לדעת:

* **`publish` אינו בונה מחדש** — הוא מפרסם את הארטיפקט של `app`, כך שמה
  שמופץ הוא בדיוק מה שנבדק.
* **התג נבדק פעמיים** — בתחילת הריצה ושוב לפני התיוג. אם התג נתפס בינתיים
  הג'וב נכשל ברעש, כי לדרוס release קיים בקבצים של בנייה אחרת זו הפגיעה
  הגרועה מכולן.
* **נכס ה-release מקבל שם לטיני** (`Otzaria-Plugin-Store.exe`): גיטהאב מנקה
  תווים שאינם ASCII משמות נכסים, ושם שכולו עברית היה מתפרסם כ-`default.exe`.
  השם שעל הדיסק נשאר `חנות התוספים.exe`.

[`build-exe.yml`](.github/workflows/build-exe.yml) הוא בנייה ידנית
(`workflow_dispatch`) לארטיפקט בדיקה בלבד — בלי בדיקות ובלי פרסום.

### לפרסם גרסה חדשה

`git push` ל-`main`. זה הכול — אם הכול עבר, יש release חדש עם המספר הבא.

## איך זה עובד בהרצה

1. **ה-stub** (ה-EXE שמפיצים) נושא בתוכו את ערמת הקבצים כ-resource ופורש
   אותה ל-`app-files\` שלידו בהרצה הראשונה. מרקר `.ready` נושא את גרסת
   ה-payload, ולכן EXE חדש מעל `app-files` ישנה מחלץ מחדש מעצמו.
2. **תיקיית הנתונים** היא `OtzariaData\` שצמודה ל-EXE ואינה ניתנת לשינוי —
   כך הכול נוסע יחד על כונן נייד. כשאין הרשאת כתיבה אבל יש מראה, ההרצה
   נמשכת במצב קריאה והלוג עובר ל-`%LOCALAPPDATA%\OtzariaPluginStore`.
3. **המראה** יושבת ב-`OtzariaData\mirror\plugins\` — **אותו מבנה בדיוק כמו
   בלאנצ'ר**, ולכן כונן שהלאנצ'ר כבר מילא נקרא כאן כמו שהוא, בלי סנכרון מחדש.
4. **זיהוי אוצריא** רץ בעלייה במקביל לטעינת הקטלוג, מקומית ובלי רשת. ממנו
   נגזרת תיקיית התוספים של התקנה **ניידת**, ואליו נמסרת ההתקנה הישירה דרך
   `otzaria://plugin/install-local`. הגרסה שנקראת מההתקנה קובעת איזה בילד של
   כל תוסף מוצג ומותקן.
5. **סנכרון מהאתר** הוא הפעולה היחידה שדורשת אינטרנט, והיא תמיד יזומה בלחיצה.

## מה שונה מהלאנצ'ר

| | הלאנצ'ר | כאן |
|---|---|---|
| מסכים | 6 + סרגל ניווט | החנות בלבד |
| הגדרות | מסך מלא (שפה, ערכת נושא, צבעים, גודל טקסט, מצב סייפר) | אין — לפי המערכת |
| עדכון עצמי | יש — מוצא release ב-GitHub, מוריד ומחליף את ה-EXE בעצמו | **אין** — הורדה ידנית מדף ה-releases |
| `PayloadCheck` | בודק ערמת קבצים לא-תואמת | אין — מרקר ה-`.ready` של ה-stub מכסה את מסלול העדכון |
| גרסאות אוצריא לסנכרון | היציבה + הלא-יציבה שהכונן נושא | הגרסה שמותקנת במחשב הזה |
| קובץ לוג | `logs\launcher.log` | `logs\plugin_store.log` |
| קובץ מצב הזיהוי | `otzaria_install_state.json` בשורש | `plugin_store\otzaria_install_state.json` |
| שם ה-EXE | `עדכוני אוצריא.exe` | `חנות התוספים.exe` |

שתי השורות שלפני האחרונה אינן קוסמטיות: הן מה שמאפשר לשני ה-EXE לשבת באותה
תיקייה, לחלוק את אותה מראה, ולא לדרוך זה על הלוג והמצב של זה.

## השינויים בחבילות שהועתקו

מלבד זה, `packages/` הוא העתק מדויק:

* **`otzaria_manager` — `otzaria_app_locator.dart`:** נוספו שלושה שמות
  ל-`_ourOwnExeNames`. שם ה-EXE הפנימי של החנות מכיל "otzaria", ובלי הפסילה
  חנות שהועתקה ל-`C:\אוצריא` הייתה מזהה את **עצמה** כאוצריא, קוראת את הגרסה
  שלה, ומסננת לפיה את בילדי התוספים. (מאותה סיבה שם ה-EXE שמפיצים הוא
  "חנות התוספים" ולא "חנות התוספים של אוצריא".)
* **`plugins_manager`, `otzaria_l10n`:** ללא שינוי כלל.

## תלויות

`plugins_manager`, `otzaria_l10n`, `otzaria_manager` (מקומיות), ומהחוץ:
`path`, `file_picker` (דיאלוג "שמור עותק"), `fluentui_system_icons` (אותם
אייקונים כמו באוצריא), `window_manager` (שורת כותרת מותאמת + החזרת מיקוד
מקלדת אחרי דיאלוג קבצים).

`crypto`, `flutter_markdown_plus`, `path_provider`, `sqlite3`, `cupertino_icons`
ו-`seforim_library_updater` **אינם** כאן — הם שירתו מסכים שלא הועתקו.

## רישיון

הקוד מכוסה ב-[`LICENSE`](LICENSE) של פרויקט אוצריא — Personal Use License 1.0.
סעיפים 2–5 שם אוסרים הפצה, שיתוף או פרסום של הקוד ושל גרסאות נגזרות בלי אישור
בכתב מפרויקט אוצריא — ולכן הריפו הזה נוצר **פרטי**.
