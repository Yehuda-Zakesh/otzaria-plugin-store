import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter_localizations/flutter_localizations.dart';
import 'package:otzaria_l10n/otzaria_l10n.dart';
import 'package:path/path.dart' as p;

import 'controllers/plugins_module_controller.dart';
import 'controllers/store_update_controller.dart';
import 'screens/plugins/plugins_screen.dart';
import 'services/app_paths.dart';
import 'services/otzaria_install_probe.dart';
import 'services/url_opener.dart';
import 'theme/theme_exports.dart';
import 'widgets/widgets_exports.dart';

/// שורש האפליקציה. אין כאן `ListenableBuilder` על הגדרות כמו בלאנצ'ר —
/// לחנות העצמאית אין מסך הגדרות, ולכן השפה, ערכת הנושא וגודל הטקסט הם
/// אלה של מערכת ההפעלה, ואינם משתנים בזמן ריצה.
class PluginStoreApp extends StatelessWidget {
  const PluginStoreApp({super.key, required this.paths});

  final AppPaths paths;

  @override
  Widget build(BuildContext context) => materialApp(
        language: AppL10n.language,
        home: StoreShell(paths: paths),
      );
}

/// עוטף את [SetupErrorScreen] ב-MaterialApp משלו — כשאין לאן לכתוב בכלל
/// אין ממשק להציג, רק את ההסבר. שפת המערכת, שבה נוסחה גם ההודעה עצמה.
class SetupErrorApp extends StatelessWidget {
  const SetupErrorApp({super.key, required this.child});

  final Widget child;

  @override
  Widget build(BuildContext context) =>
      materialApp(language: AppL10n.language, home: child);
}

/// הקונפיגורציה של ה-MaterialApp — שפה, כיווניות וערכת הנושא. פורט של
/// `_materialApp` שבלאנצ'ר, בלי הפרמטרים שהיו באים מההגדרות.
///
/// ה-`locale` הוא שקובע גם את כיוון הכתיבה: עברית → RTL, אנגלית → LTR, דרך
/// `GlobalWidgetsLocalizations`. אין כאן נגיעה ישירה ב-[Directionality].
Widget materialApp({required Widget home, required AppLanguage language}) {
  final strings = AppL10n.stringsFor(language);

  return MaterialApp(
    navigatorKey: navigatorKey,
    title: strings.plugins.breadcrumbRoot,
    debugShowCheckedModeBanner: false,
    localizationsDelegates: const [
      GlobalCupertinoLocalizations.delegate,
      GlobalMaterialLocalizations.delegate,
      GlobalWidgetsLocalizations.delegate,
    ],
    supportedLocales: const [Locale('he', 'IL'), Locale('en')],
    locale: switch (language) {
      AppLanguage.hebrew => const Locale('he', 'IL'),
      AppLanguage.english => const Locale('en'),
    },
    theme: AppThemeData.light(
      AppThemeData.createColorScheme(
        AppSeedColors.defaultLight,
        Brightness.light,
      ),
    ),
    darkTheme: AppThemeData.dark(
      AppThemeData.createColorScheme(
        AppSeedColors.defaultDark,
        Brightness.dark,
      ),
    ),
    // ב-`builder` ולא סביב `home`: כאן זה יושב **מעל** ה-Navigator, ולכן גם
    // דיאלוגים ומסלולים שנפתחים מעליו מוצאים את המלל.
    builder: (context, child) => AppStringsScope(
      strings: strings,
      child: child ?? const SizedBox.shrink(),
    ),
    home: home,
  );
}

/// המסגרת שבתוכה יושבת החנות: שורת הכותרת המותאמת ומתחתיה המסך עצמו.
///
/// זה מה שנשאר מ-`AppShell` שבלאנצ'ר אחרי שהורדו ממנו חמישה המסכים
/// האחרים וסרגל הניווט — ולכן גם [IndexedStack] אינו נחוץ כאן: יש מסך אחד,
/// והוא תמיד בעץ.
class StoreShell extends StatefulWidget {
  const StoreShell({super.key, required this.paths, this.showWindowButtons});

  final AppPaths paths;

  /// כפתורי החלון. `null` = לפי הפלטפורמה; בבדיקות widget מוזרק `false`.
  final bool? showWindowButtons;

  @override
  State<StoreShell> createState() => _StoreShellState();
}

class _StoreShellState extends State<StoreShell> {
  late final OtzariaInstallProbe _otzaria;
  late final PluginsModuleController _plugins;
  late final StoreUpdateController _storeUpdate;
  late final StreamSubscription<String> _installDone;

  @override
  void initState() {
    super.initState();

    _otzaria = OtzariaInstallProbe(
      dataDir: widget.paths.dataDir,
      stateDir: widget.paths.stateDir,
    );
    _plugins = PluginsModuleController(
      // אותו מבנה תיקיות כמו בלאנצ'ר — `<תיקיית הנתונים>/mirror/plugins` —
      // כך שכונן שהלאנצ'ר כבר מילא נקרא כאן כמו שהוא, בלי סנכרון מחדש.
      mirrorRootDir: p.join(widget.paths.dataDir, 'mirror'),
      // ההתקנה שזוהתה: ממנה נגזרת תיקיית התוספים של התקנה ניידת, ואליה
      // נמסרת ההתקנה הישירה.
      otzariaLaunchPath: () async => _otzaria.launchPath,
      // בלאנצ'ר אלה הגרסאות שהכונן **נושא** (יציבה + לא-יציבה), כי הוא
      // מכין כונן למחשב אחר. כאן החנות רצה על המחשב שאוצריא מותקנת בו,
      // ולכן ההורדה מביאה את הבילד שתואם לגרסה שיש כאן בפועל.
      mirroredAppVersions: () async => [
        if (_otzaria.version != null) _otzaria.version!,
      ],
      installedAppVersion: () async => _otzaria.version,
      // שתי הקריאות שמעליי נשענות על הזיהוי — בלי ההמתנה הזו הן היו
      // עונות ריק, וההורדה הייתה מביאה את הבילד החי במקום את התואם.
      ensureAppVersionsKnown: _otzaria.ensureDetected,
    )..addListener(_onChange);

    // כאן ולא במסך החנות: ההתקנה נגמרת בחלון של אוצריא, והמשתמש עשוי
    // להיות בכל מקום בממשק כשההודעה מגיעה.
    _installDone = _plugins.installCompletions.listen((name) {
      if (mounted) {
        UiSnack.showSuccess(AppL10n.strings.plugins.installDoneSnack(name));
      }
    });

    // קריאה מהמראה בלבד ומהתקנת אוצריא — לא נוגע ברשת. הזיהוי יוצא
    // **במקביל**, כמו בלאנצ'ר, ומי שתלוי בו ממתין ל-`ensureDetected`.
    unawaited(_otzaria.ensureDetected().then((_) {
      if (mounted) unawaited(_plugins.refreshInstalled());
    }));
    unawaited(_plugins.load());

    // בדיקת גרסה חדשה של החנות עצמה — בקשה אחת קלה ל-GitHub, והפעולה
    // היחידה בתוכנה שיוצאת לרשת בלי שהמשתמש לחץ. כשל בה נבלע ונרשם ללוג,
    // ולכן היא גם לא מעכבת שום דבר כאן.
    _storeUpdate = StoreUpdateController()..addListener(_onChange);
    unawaited(_storeUpdate.checkOnce());
  }

  @override
  void dispose() {
    unawaited(_installDone.cancel());
    _plugins.removeListener(_onChange);
    _plugins.dispose();
    _storeUpdate.removeListener(_onChange);
    _storeUpdate.dispose();
    super.dispose();
  }

  void _onChange() {
    if (mounted) setState(() {});
  }

  @override
  Widget build(BuildContext context) => Scaffold(
        backgroundColor: AppSurfaces.panelBackground(context),
        body: Column(
          children: [
            AppTitleBar(
              appTitle: context.strings.plugins.breadcrumbRoot,
              showWindowButtons: widget.showWindowButtons,
            ),
            // מחזיר גובה אפס כשאין גרסה חדשה — ראו [StoreUpdateBanner].
            StoreUpdateBanner(
              controller: _storeUpdate,
              onOpen: () => UrlOpener.open(_storeUpdate.pageUrl),
            ),
            Expanded(
              child: PluginsScreen(
                controller: _plugins,
                readOnly: widget.paths.readOnly,
              ),
            ),
          ],
        ),
      );
}
