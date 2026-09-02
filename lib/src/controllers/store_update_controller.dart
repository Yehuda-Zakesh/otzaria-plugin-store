import 'dart:async';

import 'package:flutter/foundation.dart';

import '../app_version.dart';
import '../self_update/store_release_client.dart';
import '../self_update/store_version.dart';
import '../services/app_logger.dart';

/// בודק **פעם אחת בהרצה** אם יצא release חדש של חנות התוספים, כדי שהממשק
/// יוכל להציג על כך שורה.
///
/// **אין כאן עדכון עצמי.** בשונה מהלאנצ'ר, שמוריד את ה-exe ומחליף את עצמו
/// (`launcher_app/lib/src/self_update/`), כאן מסתיים הסיפור בכתובת שנפתחת
/// בדפדפן. זו החלטה מכוונת: כל מה שהחלפת exe דורשת — הרשאות כתיבה, ניהול
/// גיבוי, הפעלה מחדש דרך ה-stub — אינו קיים באפליקציה הזאת.
///
/// כל כשל נבלע ונרשם ללוג בלבד: הבדיקה הזאת היא נוחות, ומחשב בלי אינטרנט
/// הוא מצב תקין לגמרי בתוכנה שכל שאר עבודתה מקומית.
class StoreUpdateController extends ChangeNotifier {
  StoreUpdateController({StoreReleaseClient? client})
      : _client = client ?? StoreReleaseClient();

  final StoreReleaseClient _client;

  /// ה-release החדש שנמצא, או `null` כשאין כזה (או שהבדיקה טרם רצה/נכשלה).
  StoreRelease? available;

  /// `true` בזמן הבדיקה. הממשק אינו מציג את זה — אין טעם בחיווי טעינה על
  /// משהו שהמשתמש לא ביקש — אבל זה מונע בדיקה כפולה.
  bool checking = false;

  /// המשתמש סגר את השורה. נשמר בזיכרון בלבד: אין הגדרות בתוכנה הזאת,
  /// וההודעה תחזור בהרצה הבאה — וזה בסדר, כי הגרסה עדיין חדשה.
  bool dismissed = false;

  bool _checked = false;

  /// `true` כשיש מה להציג.
  bool get hasUpdate => !dismissed && available != null;

  /// הכתובת לפתוח, או דף ה-releases כשמשום מה אין release ספציפי.
  String get pageUrl => available?.pageUrl ?? StoreReleaseClient.releasesPageUrl;

  /// מריץ את הבדיקה אם עוד לא רצה בהרצה הזאת.
  Future<void> checkOnce() async {
    if (_checked || checking) return;
    _checked = true;
    checking = true;
    notifyListeners();

    try {
      final latest = await _client.fetchLatestStable();
      if (latest != null && isStoreVersionNewer(latest.tagName, appVersion)) {
        available = latest;
        AppLogger.instance
            .info('נמצאה גרסה חדשה: ${latest.tagName} (מותקן: $appVersion)');
      }
    } catch (e) {
      // **בכוונה `info` ולא `error`**: "אין אינטרנט" הוא המצב הנפוץ אצל
      // מי שמריץ את התוכנה, ולא תקלה שראוי לחפש אחריה בלוג.
      AppLogger.instance.info('בדיקת גרסה חדשה לא הושלמה: $e');
    } finally {
      checking = false;
      notifyListeners();
    }
  }

  void dismiss() {
    dismissed = true;
    notifyListeners();
  }

  @override
  void dispose() {
    _client.dispose();
    super.dispose();
  }
}
