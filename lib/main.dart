import 'dart:async';
import 'dart:io';

import 'package:flutter/material.dart';
import 'package:otzaria_l10n/otzaria_l10n.dart';
import 'package:window_manager/window_manager.dart';

import 'src/app.dart';
import 'src/app_version.dart';
import 'src/l10n/system_language.dart';
import 'src/screens/setup_error_screen.dart';
import 'src/services/app_logger.dart';
import 'src/services/app_paths.dart';

void main() {
  // ה-logger נוצר בתוך ה-zone אבל נדרש גם למטפל השגיאות שלו — ולכן מוחזק
  // כאן, מחוץ. nullable כי שגיאה יכולה לקרות עוד לפני שהוא נבנה.
  AppLogger? logger;

  void report(String context, Object error, StackTrace? stackTrace) {
    // העתקה מקומית: `logger` הוא משתנה שנתפס ומשתנה, ולכן promotion
    // ל-non-null לא חל עליו ישירות.
    final log = logger;
    if (log != null) {
      log.error(context, error, stackTrace);
    } else {
      // עוד אין לאן לכתוב — לפחות שזה יגיע ל-stderr ולקונסולת הדיבאגר.
      debugPrint('$context (לפני אתחול הלוג): $error\n$stackTrace');
    }
  }

  // **כל** האתחול חייב לרוץ בתוך אותו zone שממנו נקרא `runApp` — Flutter
  // דורש שאתחול ה-bindings ו-`runApp` יהיו באותו zone, אחרת קונפיגורציה
  // zone-specific מתנהגת באופן לא צפוי (ובדיבאג זה assertion של
  // "Zone mismatch"). בונוס: גם כשלים באתחול עצמו נתפסים ונרשמים.
  runZonedGuarded(
    () async {
      WidgetsFlutterBinding.ensureInitialized();

      // שפת המחשב, עוד לפני שיש ממשק: כשל באתחול (למשל [AppPaths]) מנסח
      // את הודעתו מ-`AppL10n` ברגע הזריקה.
      AppL10n.use(systemLanguage());

      // תופס שגיאות שה-widgets framework עצמו זורק (למשל בתוך build/layout).
      FlutterError.onError = (details) {
        report(
          'FlutterError: ${details.exceptionAsString()}',
          details.exception,
          details.stack,
        );
        FlutterError.presentError(details);
      };

      await _prepareWindow();

      // תיקיית הנתונים צמודה לתוכנה ואינה ניתנת לשינוי — כך המראה נוסעת
      // עם קובץ ההרצה. כשאי אפשר לכתוב בה אבל יש בה מראה, ההרצה נמשכת
      // במצב קריאה (ההתקנות כותבות למחשב ולא לכונן), והלוג עובר לתיקיית
      // המשתמש. כשגם זה אינו אפשרי אין לאן לשמור *כלום* — מציגים מסך
      // הסבר ועוצרים.
      final AppPaths paths;
      try {
        paths = await AppPaths.resolve();
      } on AppPathsException catch (e) {
        debugPrint('$e');
        runApp(SetupErrorApp(child: SetupErrorScreen(error: e)));
        return;
      }

      logger = await AppLogger.init(paths.stateDir, version: appVersion);

      runApp(PluginStoreApp(paths: paths));
    },
    // רשת חיצונית: שגיאה אסינכרונית שלא נתפסה בשום try/catch עדיין
    // נכתבת ללוג במקום להיעלם בשקט.
    (error, stackTrace) => report('Uncaught zone error', error, stackTrace),
  );
}

/// מסתיר את מסגרת החלון של המערכת — מכאן והלאה שורת הכותרת היא
/// `AppTitleBar` שבתוך האפליקציה, בצבע הרקע. רץ לפני `runApp` כדי שהחלון
/// ייצבע פעם אחת בגודלו הסופי: שינוי המסגרת מאתחל את אזור-הלקוח ומבטל
/// פריים שכבר צויר. ההגדלה עצמה נעשית ב-runner (`Win32Window::Show`).
Future<void> _prepareWindow() async {
  if (!(Platform.isWindows || Platform.isLinux || Platform.isMacOS)) return;
  // כשל כאן הוא קוסמטי בלבד (נשארת מסגרת המערכת), אבל בלי ה-catch הוא היה
  // בורח לפני שיש לוג ומשאיר את המשתמש בלי חלון בכלל.
  try {
    await windowManager.ensureInitialized();
    await windowManager.setMinimumSize(const Size(900, 620));
    // ברירת המחדל של windowButtonVisibility היא true — בלי false מפורש
    // כפתורי המערכת של macOS יופיעו כפול לצד הכפתורים שלנו.
    await windowManager.setTitleBarStyle(
      TitleBarStyle.hidden,
      windowButtonVisibility: false,
    );
  } catch (e) {
    debugPrint('הכנת החלון נכשלה: $e');
  }
}
