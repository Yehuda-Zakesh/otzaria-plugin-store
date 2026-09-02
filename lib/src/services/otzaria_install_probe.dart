import 'dart:async';

import 'package:otzaria_manager/otzaria_manager.dart';
import 'package:path/path.dart' as p;

import 'app_logger.dart';

/// מגלה **פעם אחת** איפה אוצריא מותקנת במחשב הזה ובאיזו גרסה, כדי שחנות
/// התוספים תדע שני דברים שהיא אינה יכולה לגזור בעצמה:
///
/// * **נתיב ההפעלה** — ממנו נגזרת תיקיית התוספים של התקנה **ניידת**
///   ([InstalledPluginsScanner]), ואליו נמסרת ההתקנה הישירה
///   ([PluginDirectInstaller]). התקנה ניידת אינה רושמת את הסכימה
///   `otzaria://` בכלל, ולכן בלי הנתיב ההתקנה שם נכשלת ב"ודא שאוצריא
///   מותקנת".
/// * **הגרסה המותקנת** — לפיה נבחר איזה בילד של התוסף מוצג ומותקן
///   (`plugin_compatibility.dart`). בלעדיה נבחר תמיד הבילד החי, שעשוי לא
///   לעלות על התקנה ישנה יותר.
///
/// זה **בדיוק** אותו זיהוי שהלאנצ'ר עושה: [OtzariaManager.checkForUpdate]
/// מאמת את המצב השמור מול הדיסק, אחר כך בודק תהליך רץ, ורק אם עדיין לא
/// ידוע כלום סורק את המיקומים המוכרים ואת הרג'יסטרי. הכול מקומי — הקריאה
/// **אינה נוגעת ברשת**.
///
/// כשל בזיהוי אינו שגיאת הרצה: הוא נרשם ללוג, והחנות ממשיכה עם "לא ידוע"
/// — כלומר ברירות המחדל של הפלטפורמה ומטפל הפרוטוקול, בדיוק כמו בלאנצ'ר
/// שלא זיהה התקנה.
class OtzariaInstallProbe {
  /// [stateDir] הוא תיקיית הכתיבה של האפליקציה; קובץ המצב של הזיהוי נשמר
  /// ב-**תת-תיקייה** משלנו ([stateSubdir]) ולא בשורש: כונן שנושא גם את
  /// "עדכוני אוצריא" מחזיק שם `otzaria_install_state.json` שלו, ואין שום
  /// סיבה ששתי התוכנות יכתבו לאותו קובץ.
  OtzariaInstallProbe({required String dataDir, required String stateDir})
      : _manager = OtzariaManager(
          dataDir: dataDir,
          stateDir: p.join(stateDir, stateSubdir),
        );

  /// תת-התיקייה שבה יושב קובץ המצב של הזיהוי.
  static const String stateSubdir = 'plugin_store';

  final OtzariaManager _manager;

  /// נתיב ההפעלה של אוצריא (`.exe` בווינדוס, חבילת `.app` ב-macOS), או
  /// `null` כשלא זוהתה התקנה.
  String? launchPath;

  /// הגרסה שקוראים **מההתקנה עצמה**, או `null` כשלא זוהתה.
  String? version;

  Future<void>? _inFlight;
  bool _done = false;

  /// מריץ את הזיהוי אם עוד לא רץ, וממתין לזה שכבר בדרך. כל הקוראים
  /// ([PluginsModuleController] קורא לזה לפני שהוא נשען על הגרסאות)
  /// מקבלים אותה תשובה בלי לשלם על סריקה שנייה.
  Future<void> ensureDetected() {
    if (_done) return Future.value();
    return _inFlight ??= _detect().whenComplete(() => _inFlight = null);
  }

  Future<void> _detect() async {
    try {
      final check = await _manager.checkForUpdate();
      launchPath = check.currentState?.launchPath;
      version = check.currentState?.installedTagName;
      AppLogger.instance.info(
        launchPath == null
            ? 'לא זוהתה התקנה של אוצריא במחשב הזה'
            : 'אוצריא זוהתה: $launchPath (גרסה ${version ?? '?'})',
      );
    } catch (e, st) {
      // אין כאן "מצב שגיאה" בממשק: החנות עובדת גם בלי לדעת מה מותקן.
      AppLogger.instance.error('זיהוי ההתקנה של אוצריא נכשל', e, st);
    } finally {
      _done = true;
    }
  }
}
