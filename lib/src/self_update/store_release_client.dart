import 'dart:convert';

import 'package:http/http.dart' as http;
import 'package:otzaria_l10n/otzaria_l10n.dart';

import 'store_version.dart';

/// ה-release שהבדיקה מצאה: המספר, והכתובת לפתוח בדפדפן.
class StoreRelease {
  const StoreRelease({
    required this.tagName,
    required this.version,
    required this.pageUrl,
  });

  /// התג ב-GitHub — `v1`, `v2`…
  final String tagName;

  /// המספר שבתוך התג.
  final int version;

  /// דף ה-release עצמו. **הדף ולא הקובץ**: החנות אינה מורידה ואינה מחליפה
  /// את עצמה, אלא שולחת את המשתמש למקום שבו מוסבר מה יש בגרסה ומאיפה
  /// להוריד — ראו `StoreUpdateStrings`.
  final String pageUrl;
}

/// שולף את ה-releases של **הריפו הזה** — חנות התוספים עצמה, לא אוצריא ולא
/// קטלוג התוספים. בקשה אחת, מטא-דאטה בלבד, ואף פעם לא הורדת קובץ.
///
/// זו הפעולה היחידה בתוכנה שיוצאת לרשת בלי שהמשתמש לחץ (הסנכרון של החנות
/// תמיד יזום). היא זולה, קצובה בזמן, וכל כשל בה נבלע — ראו
/// `StoreUpdateController`.
class StoreReleaseClient {
  StoreReleaseClient({
    http.Client? httpClient,
    this.timeout = const Duration(seconds: 20),
  }) : _httpClient = httpClient ?? http.Client();

  /// זמן קצוב לבקשה — חובה, בדיוק כמו ב-`PluginStoreClient`: בלעדיו מחשב
  /// שמחובר לרשת בלי מסלול לאינטרנט היה תולה את הבדיקה בלי הגבלה.
  Duration timeout;

  static const _owner = 'Yehuda-Zakesh';
  static const _repo = 'otzaria-plugin-store';
  static const _apiBase = 'https://api.github.com';

  /// דף אחד מספיק: מחפשים את הגרסה היציבה הגבוהה, לא את כל ההיסטוריה.
  static const int _pageSize = 30;

  final http.Client _httpClient;

  /// דף ה-releases, לפתיחה בדפדפן כשאין release ספציפי להצביע עליו.
  static const String releasesPageUrl =
      'https://github.com/$_owner/$_repo/releases';

  /// הגרסה היציבה **הגבוהה ביותר**, או `null` אם אין אף release תקין.
  ///
  /// pre-release ו-draft נפסלים: הם קיימים כדי לנסות, לא כדי להציע.
  ///
  /// הבחירה היא לפי המספר ולא לפי הסדר שבו GitHub החזיר — סדר הפרסום אינו
  /// סדר הגרסאות (release שנערך ידנית, תג ותיק שפורסם מחדש), ובחירת
  /// "הראשון ברשימה" הייתה תלוית־מזל.
  Future<StoreRelease?> fetchLatestStable() async {
    final uri = Uri.parse(
      '$_apiBase/repos/$_owner/$_repo/releases?per_page=$_pageSize',
    );
    final response = await _httpClient.get(
      uri,
      headers: const {
        'Accept': 'application/vnd.github+json',
        'X-GitHub-Api-Version': '2022-11-28',
        // ⚠️ חובה — GitHub מחזיר 403 לכל בקשה בלי User-Agent.
        'User-Agent': 'otzaria-plugin-store',
      },
    ).timeout(timeout);

    if (response.statusCode != 200) {
      throw StoreUpdateCheckException(
        AppL10n.strings.appDomain.githubStatus(response.statusCode, '$uri'),
      );
    }

    final decoded = jsonDecode(response.body);
    if (decoded is! List) {
      throw StoreUpdateCheckException(
        AppL10n.strings.appDomain.noReleasesAtAll('$_owner/$_repo'),
      );
    }

    StoreRelease? best;
    for (final entry in decoded) {
      if (entry is! Map<String, dynamic>) continue;
      if (entry['draft'] as bool? ?? false) continue;
      if (entry['prerelease'] as bool? ?? false) continue;

      final release = _parse(entry);
      if (release == null) continue;
      if (best == null || release.version > best.version) best = release;
    }
    return best;
  }

  /// `null` כשה-release אינו נושא תג גרסה — ממשיכים לשאר במקום להפיל את
  /// הבדיקה כולה.
  StoreRelease? _parse(Map<String, dynamic> json) {
    final tagName = json['tag_name'];
    if (tagName is! String) return null;
    final version = storeVersionOf(tagName);
    if (version == null) return null;

    final htmlUrl = json['html_url'];
    return StoreRelease(
      tagName: tagName,
      version: version,
      // `html_url` הוא דף ה-release המדויק; בהיעדרו דף ה-releases הכללי,
      // שתמיד קיים.
      pageUrl: htmlUrl is String && htmlUrl.isNotEmpty
          ? htmlUrl
          : releasesPageUrl,
    );
  }

  void dispose() => _httpClient.close();
}

/// כשל בבדיקת הגרסה. טיפוס נפרד כדי שנהיה מפורשים לגבי מה נבלע: הבדיקה
/// הזאת היא נוחות, ואין מצב שבו כשל בה אמור להפריע למשתמש.
class StoreUpdateCheckException implements Exception {
  const StoreUpdateCheckException(this.message);
  final String message;

  @override
  String toString() => message;
}
