import 'dart:ui';

import 'package:otzaria_l10n/otzaria_l10n.dart';

/// שפת מערכת ההפעלה, מצומצמת לשפות שהתוכנה מדברת. פורט של
/// `launcher_app/lib/src/settings/app_settings.dart` — שם היא הייתה
/// ברירת המחדל של הגדרת השפה; כאן, בלי מסך הגדרות, היא **השפה**.
///
/// `PlatformDispatcher` ולא `Platform.localeName` — הראשון הוא שפת *הממשק*
/// של המערכת, השני רק תבנית האזור (מחשב באנגלית עם אזור "ישראל" מדווח שם
/// עברית). `instance` ישירות ולא דרך `WidgetsBinding`, כדי שגם קריאה לפני
/// אתחול ה-binding תעבוד — `main` קורא לזה מוקדם.
AppLanguage systemLanguage() {
  final locales = PlatformDispatcher.instance.locales;
  // מערכת שלא דיווחה שום locale — עברית, שפת הבית של התוכנה. זה שונה
  // ממחשב שדיווח שפה אחרת, שאותו [AppLanguage.forLanguageCode] שולח
  // לאנגלית.
  if (locales.isEmpty) return AppLanguage.hebrew;
  return AppLanguage.forLanguageCode(locales.first.languageCode);
}
