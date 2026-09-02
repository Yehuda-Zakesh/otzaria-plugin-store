import 'dart:io';

/// פותח כתובת בדפדפן של מערכת ההפעלה.
///
/// לא נעשה שימוש ב-`url_launcher` מאותה סיבה כמו ב-`PluginDirectInstaller`
/// שב-`plugins_manager`: כאן רוצים בדיוק דבר אחד — למסור כתובת למערכת —
/// וזה שונה בין הפלטפורמות, בלי תלות ותוסף native.
///
/// מחזיר `false` במקום לזרוק, כמו `PluginInstallResult`: ה-UI מציג הודעה עם
/// הכתובת כדי שאפשר יהיה להעתיק אותה ביד, לא stack trace.
abstract final class UrlOpener {
  static Future<bool> open(String url) async {
    // רק http/https. הפונקציה הזאת מקבלת כתובת שהגיעה מ-GitHub API, ואין
    // סיבה שהיא תוכל להריץ `file:` או סכימה שרשומה למשהו אחר במחשב.
    final uri = Uri.tryParse(url);
    if (uri == null || (uri.scheme != 'http' && uri.scheme != 'https')) {
      return false;
    }

    try {
      if (Platform.isWindows) {
        // הארגומנט הריק הראשון הוא הכותרת של החלון עבור `start`; בלעדיו
        // `start` מפרש כתובת במרכאות ככותרת ולא פותח כלום.
        final result = await Process.run('cmd', ['/c', 'start', '', url]);
        return result.exitCode == 0;
      }
      if (Platform.isMacOS) {
        final result = await Process.run('/usr/bin/open', [url]);
        return result.exitCode == 0;
      }
      if (Platform.isLinux) {
        final result = await Process.run('xdg-open', [url]);
        return result.exitCode == 0;
      }
      return false;
    } on ProcessException {
      return false;
    }
  }
}
