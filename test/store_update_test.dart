import 'dart:convert';
import 'dart:io';

import 'package:flutter/material.dart';
import 'package:flutter_localizations/flutter_localizations.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';
import 'package:otzaria_l10n/otzaria_l10n.dart';
import 'package:otzaria_plugin_store/src/controllers/store_update_controller.dart';
import 'package:otzaria_plugin_store/src/self_update/store_release_client.dart';
import 'package:otzaria_plugin_store/src/self_update/store_version.dart';
import 'package:otzaria_plugin_store/src/services/app_logger.dart';
import 'package:otzaria_plugin_store/src/theme/theme_exports.dart';
import 'package:otzaria_plugin_store/src/widgets/widgets_exports.dart';

import 'test_support.dart';

/// כמו `wrap` שב-`test_harness.dart`, אבל **עם** `navigatorKey` — בלעדיו
/// `UiSnack` אינו מוצא overlay ומדלג בשקט, וההודעה שנבדקת כאן לא מוצגת
/// כלל. ה-harness המשותף אינו מציב אותו כי אף מסך אחר אינו בודק snack.
Widget wrapWithSnacks(Widget child) => MaterialApp(
      navigatorKey: navigatorKey,
      localizationsDelegates: const [
        GlobalCupertinoLocalizations.delegate,
        GlobalMaterialLocalizations.delegate,
        GlobalWidgetsLocalizations.delegate,
      ],
      supportedLocales: const [Locale('he', 'IL'), Locale('en')],
      locale: const Locale('he', 'IL'),
      theme: AppThemeData.light(
        AppThemeData.createColorScheme(
          AppSeedColors.defaultLight,
          Brightness.light,
        ),
      ),
      builder: (context, navigator) => AppStringsScope(
        strings: AppL10n.stringsFor(AppLanguage.hebrew),
        child: navigator ?? const SizedBox.shrink(),
      ),
      home: Scaffold(body: child),
    );

/// גוף תשובה של GitHub לרשימת releases, עם רק השדות שהלקוח קורא.
String _releasesJson(List<Map<String, Object?>> releases) =>
    jsonEncode(releases);

Map<String, Object?> _release(
  String tag, {
  bool draft = false,
  bool prerelease = false,
  String? htmlUrl,
}) =>
    {
      'tag_name': tag,
      'draft': draft,
      'prerelease': prerelease,
      'html_url': htmlUrl ?? 'https://github.com/x/y/releases/tag/$tag',
    };

StoreReleaseClient _clientReturning(String body, {int status = 200}) =>
    StoreReleaseClient(
      httpClient: MockClient((_) async => http.Response(
            body,
            status,
            headers: {'content-type': 'application/json'},
          )),
    );

void main() {
  setUpAll(() async {
    // ה-controller כותב ללוג; בלי אתחול `AppLogger.instance` זורק.
    final dir = await Directory.systemTemp.createTemp('store_update');
    addTearDown(() => deleteTempDir(dir));
    await AppLogger.init(dir.path);
  });

  group('מספור הגרסאות', () {
    test('תג תקין הוא מספר שלם, עם v או בלעדיו', () {
      expect(isStoreReleaseTag('v1'), isTrue);
      expect(isStoreReleaseTag('12'), isTrue);
      expect(storeVersionOf('v7'), 7);
      expect(storeVersionOf('7'), 7);
    });

    test('תג שאינו בצורה הזאת נפסל ואינו "בערך"', () {
      // ⚠️ זה הלב: תג בן שלושה חלקים מריפו אחר, או תג ידני, אינם גרסה
      // כאן — והשוואה סובלנית הייתה מוצאת בהם גרסה חדשה לנצח.
      for (final tag in ['v0.11.0', 'V1', 'v1.2', 'release-3', '', 'v']) {
        expect(isStoreReleaseTag(tag), isFalse, reason: tag);
        expect(storeVersionOf(tag), isNull, reason: tag);
      }
    });

    test('חדש = גבוה, ולא "שונה"', () {
      expect(isStoreVersionNewer('v2', '1'), isTrue);
      expect(isStoreVersionNewer('v1', '1'), isFalse);
      // release שנמשך חזרה אינו סיבה להציע למשתמש לרדת גרסה.
      expect(isStoreVersionNewer('v1', '2'), isFalse);
    });

    test('תג לא-תקין אינו חדש מכלום', () {
      expect(isStoreVersionNewer('v1.0.0', '0'), isFalse);
    });
  });

  group('StoreReleaseClient', () {
    test('בוחר את המספר הגבוה ולא את הראשון ברשימה', () async {
      // GitHub מחזיר לפי סדר **פרסום**, ו-release שנערך ידנית או תג ותיק
      // שפורסם מחדש הופכים את "הראשון ברשימה" לתלוי־מזל.
      final client = _clientReturning(_releasesJson([
        _release('v2'),
        _release('v5'),
        _release('v3'),
      ]));
      final latest = await client.fetchLatestStable();
      expect(latest?.version, 5);
      expect(latest?.tagName, 'v5');
    });

    test('draft ו-pre-release נפסלים', () async {
      final client = _clientReturning(_releasesJson([
        _release('v9', draft: true),
        _release('v8', prerelease: true),
        _release('v2'),
      ]));
      expect((await client.fetchLatestStable())?.version, 2);
    });

    test('תג שאינו גרסה מדולג ואינו מפיל את הבדיקה', () async {
      final client = _clientReturning(_releasesJson([
        _release('nightly'),
        _release('v4'),
      ]));
      expect((await client.fetchLatestStable())?.version, 4);
    });

    test('אין אף release תקין → null, לא חריגה', () async {
      final client = _clientReturning(_releasesJson([_release('V1')]));
      expect(await client.fetchLatestStable(), isNull);
    });

    test('כתובת הדף נלקחת מה-release, ובהיעדרה דף ה-releases', () async {
      final withUrl = _clientReturning(
        _releasesJson([_release('v3', htmlUrl: 'https://example.com/r/3')]),
      );
      expect((await withUrl.fetchLatestStable())?.pageUrl,
          'https://example.com/r/3');

      final without = _clientReturning(jsonEncode([
        {'tag_name': 'v3', 'draft': false, 'prerelease': false},
      ]));
      expect((await without.fetchLatestStable())?.pageUrl,
          StoreReleaseClient.releasesPageUrl);
    });

    test('סטטוס שאינו 200 זורק StoreUpdateCheckException', () async {
      final client = _clientReturning('rate limited', status: 403);
      await expectLater(
        client.fetchLatestStable(),
        throwsA(isA<StoreUpdateCheckException>()),
      );
    });
  });

  group('StoreUpdateController', () {
    test('כשל רשת נבלע ואינו מציג כלום', () async {
      final controller = StoreUpdateController(
        client: StoreReleaseClient(
          httpClient: MockClient((_) async => throw const SocketishError()),
        ),
      );
      addTearDown(controller.dispose);

      // בלי `expectLater(..., throws...)`: המצב התקין הוא שזה **לא** זורק.
      await controller.checkOnce();
      expect(controller.hasUpdate, isFalse);
      expect(controller.available, isNull);
    });

    test('גרסה שאינה חדשה מהמותקנת אינה מוצגת', () async {
      // `appVersion` בקוד הוא 0 עד ה-release הראשון, ולכן v0 אינו קיים —
      // נשען על ההשוואה עצמה, שנבדקה למעלה.
      final controller = StoreUpdateController(
        client: _clientReturning(_releasesJson([_release('v0')])),
      );
      addTearDown(controller.dispose);
      await controller.checkOnce();
      expect(controller.hasUpdate, isFalse);
    });

    test('גרסה חדשה מוצגת, וסגירה מסתירה אותה', () async {
      final controller = StoreUpdateController(
        client: _clientReturning(_releasesJson([_release('v99')])),
      );
      addTearDown(controller.dispose);

      await controller.checkOnce();
      expect(controller.hasUpdate, isTrue);
      expect(controller.available?.version, 99);

      controller.dismiss();
      expect(controller.hasUpdate, isFalse);
      // הגרסה עצמה נשמרת — רק ההצגה בוטלה.
      expect(controller.available?.version, 99);
    });

    test('הבדיקה רצה פעם אחת בלבד בהרצה', () async {
      var calls = 0;
      final controller = StoreUpdateController(
        client: StoreReleaseClient(
          httpClient: MockClient((_) async {
            calls++;
            return http.Response(_releasesJson([_release('v99')]), 200);
          }),
        ),
      );
      addTearDown(controller.dispose);

      await controller.checkOnce();
      await controller.checkOnce();
      await controller.checkOnce();
      expect(calls, 1);
    });
  });

  group('StoreUpdateBanner', () {
    testWidgets('אין גרסה חדשה → אינו תופס גובה', (tester) async {
      final controller = StoreUpdateController(
        client: _clientReturning(_releasesJson([])),
      );
      addTearDown(controller.dispose);

      await tester.pumpWidget(wrapWithSnacks(
        StoreUpdateBanner(controller: controller, onOpen: () async => true),
      ));
      expect(tester.getSize(find.byType(StoreUpdateBanner)).height, 0);
    });

    testWidgets('גרסה חדשה → שורה עם כפתור שפותח את הדף', (tester) async {
      final controller = StoreUpdateController(
        client: _clientReturning(_releasesJson([_release('v99')])),
      );
      addTearDown(controller.dispose);
      await controller.checkOnce();

      var opened = 0;
      await tester.pumpWidget(wrapWithSnacks(StoreUpdateBanner(
        controller: controller,
        onOpen: () async {
          opened++;
          return true;
        },
      )));

      final t = AppL10n.stringsFor(AppLanguage.hebrew).storeUpdate;
      expect(find.text(t.bannerTitle('99')), findsOneWidget);

      await tester.tap(find.text(t.bannerButton));
      await tester.pumpAndSettle();
      expect(opened, 1);
    });

    testWidgets('פתיחה שנכשלה מציגה את הכתובת להעתקה', (tester) async {
      final controller = StoreUpdateController(
        client: _clientReturning(_releasesJson([
          _release('v99', htmlUrl: 'https://example.com/r/99'),
        ])),
      );
      addTearDown(controller.dispose);
      await controller.checkOnce();

      await tester.pumpWidget(wrapWithSnacks(StoreUpdateBanner(
        controller: controller,
        onOpen: () async => false,
      )));

      final t = AppL10n.stringsFor(AppLanguage.hebrew).storeUpdate;
      await tester.tap(find.text(t.bannerButton));
      await tester.pumpAndSettle();
      expect(
        find.textContaining('https://example.com/r/99'),
        findsOneWidget,
      );

      // ל-`UiSnack` יש טיימר סגירה עצמית; בלי לקדם אותו הוא נשאר תלוי
      // בסוף הבדיקה, ו-`flutter_test` מפיל אותה על "Timer is still pending"
      // — כלומר על ההודעה שהצליחה, ולא על באג.
      await tester.pump(const Duration(seconds: 7));
      await tester.pumpAndSettle();
    });
  });
}

/// חריגה שמדמה "אין רשת" בלי לתלות את הבדיקה ב-`dart:io`.
class SocketishError implements Exception {
  const SocketishError();
  @override
  String toString() => 'Failed host lookup';
}
