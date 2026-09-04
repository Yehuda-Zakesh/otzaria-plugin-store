// נקודת הכניסה של הממשק.
//
// פורט של `lib/main.dart` ו-`lib/src/app.dart`: מסגרת החלון, זיהוי
// אוצריא, טעינת הקטלוג מהמראה, ובדיקה אחת של גרסה חדשה.
//
// ⚠️ סדר הפעולות כאן אינו שרירותי, והוא זהה למקור:
//
//   1. `app.info` — הנתיבים והערכה, לפני שיש ממשק.
//   2. `setupError` — כשאין לאן לכתוב, זה כל מה שהתוכנה יכולה לעשות.
//   3. הזיהוי של אוצריא יוצא **במקביל** לטעינת הקטלוג. מי שתלוי בו
//      (בחירת הבילד) ממתין ל-`ensureDetected`.
//   4. בדיקת הגרסה החדשה — הפעולה היחידה שיוצאת לרשת בלי שהמשתמש לחץ.

import {appInfo, fs, net, sys, logToFile} from './bridge.js';
import {createTitleBar, installResizeEdges, installTheme} from './shell.js';
import {S} from './strings.js';
import {StoreController} from './controller.js';
import {PluginsManager} from './store/plugins_manager.js';
import {OtzariaInstallProbe} from './store/otzaria_probe.js';
import {StoreReleaseClient, isStoreVersionNewer}
    from './store/store_release_client.js';
import {OtzariaReleaseClient} from './store/otzaria_release_client.js';
import {formatBytes} from './util/bytes.js';
import {h, icon, replace} from './ui/dom.js';
import {installIconSprite} from './ui/icons.js';
import {actionButton, iconButton} from './ui/components.js';
import {renderStore, resetLocalViewState} from './ui/screens.js';
import {showSnack, showError} from './ui/overlays.js';

const APP_TITLE = 'חנות התוספים';

/**
 * יומן — נכתב לקובץ דרך ה-host. אין כאן `AppLogger` נפרד: ה-host הוא
 * שמחזיק את הקובץ, ומכאן רק נמסר המלל.
 */
const log = (message) => {
  console.log(message);
  void logToFile('INFO', message);
};

/**
 * מפנה כל שגיאה שלא נתפסה אל היומן.
 *
 * ⚠️ בלי זה שגיאת JS נעלמת עם החלון: אין קונסולה למשתמש, ו-WebView2
 * אינו כותב לשום מקום. זו המקבילה של `runZonedGuarded` ושל
 * `FlutterError.onError` שהיו ב-`main.dart`.
 */
function installErrorReporting() {
  window.addEventListener('error', (event) => {
    const where = event.filename
        ? ` (${event.filename}:${event.lineno}:${event.colno})`
        : '';
    void logToFile('ERROR', `שגיאה בממשק: ${event.message}${where}`);
  });
  window.addEventListener('unhandledrejection', (event) => {
    const reason = event.reason;
    const detail = reason?.stack ?? reason?.message ?? String(reason);
    void logToFile('ERROR', `דחייה שלא נתפסה: ${detail}`);
  });
}

async function main() {
  installErrorReporting();
  installIconSprite();
  installResizeEdges();

  const info = await appInfo();
  installTheme(info.darkMode);

  const root = document.getElementById('shell');
  const titleBar = createTitleBar({appTitle: APP_TITLE});
  const banners = h('div.banners');
  const body = h('div.body');
  replace(root, titleBar.element, banners, body);

  // ── מסך שגיאת הגדרה ─────────────────────────────────────────────────────
  // פורט של `SetupErrorScreen`. אין לאן לכתוב כלום, ולכן אין מה להמשיך.
  if (info.setupError) {
    titleBar.setScreenTitle(S.setupError.title);
    body.className = 'body setup-error';
    replace(body,
        h('h1', {text: S.setupError.title}),
        h('p', {text: S.setupError.explanation}),
        h('p', {text: S.setupError.whatToDo}),
        h('h2.panel__title', {text: S.setupError.attemptedDirTitle}),
        h('pre.setup-error__dir', {text: info.setupError}));
    return;
  }

  titleBar.setScreenTitle(S.plugins.breadcrumbRoot);

  // ── הכונן מוגן מפני כתיבה ───────────────────────────────────────────────
  if (info.readOnly) {
    banners.append(h('div.readonly-banner',
        icon('info', 20),
        h('div.readonly-banner__text',
          h('div', {style: {fontWeight: '700'}},
            S.readOnlyDrive.bannerTitle),
          h('div', {text: S.readOnlyDrive.bannerSubtitle}))));
  }

  // ── זיהוי אוצריא ────────────────────────────────────────────────────────
  const probe = new OtzariaInstallProbe({
    fs, sys,
    env: info.env,
    statePath: info.stateFile,
    selfPath: info.exePath,
    log,
  });

  const manager = new PluginsManager({
    paths: {
      dataDir: info.dataDir,
      pluginsDir: info.pluginsDir,
      catalogPath: info.catalogPath,
    },
    fs, net, sys,
    env: info.env,
    otzariaLaunchPath: async () => {
      await probe.ensureDetected();
      return probe.launchPath;
    },
  });

  // מברר מהן גרסאות אוצריא שהמראה נבנית עבורן. נקרא **רק** כשהמשתמש
  // מסנכרן או בודק עדכונים, ולכן העלייה עצמה נשארת בלי רשת.
  const releaseClient = new OtzariaReleaseClient({net});

  const controller = new StoreController({manager, probe, releaseClient, log});

  // רינדור מלא בכל שינוי מצב. המסך הוא כמה עשרות אלמנטים, והבקר הוא
  // מקור האמת היחיד — ראו ההערה בראש `ui/screens.js`.
  let scrollTop = 0;
  /**
   * האם לקרוא את מקום הגלילה מהמסך היוצא לפני שהוא מוחלף.
   *
   * ⚠️ **הניווט מכבה את זה, וזה כל מה שמאפס את הגלילה.** הרינדור קורה
   * בתוך הניווט (`showCategory` → `#notify`), ולכן קריאה בלתי-מותנית
   * כאן דורסת מיד את האיפוס שנעשה רגע לפניה — והמסך החדש נפתח בגובה
   * שאליו גלל הקודם.
   */
  let keepScroll = true;
  controller.subscribe(() => {
    const scroller = body.querySelector('.store__scroll');
    if (keepScroll && scroller !== null) scrollTop = scroller.scrollTop;
    keepScroll = true;
    renderStore(body, controller, {readOnly: info.readOnly});
    // שמירת מקום הגלילה: בלעדיה כל דיווח התקדמות היה מקפיץ את הרשימה
    // לראש המסך.
    const next = body.querySelector('.store__scroll');
    if (next !== null) next.scrollTop = scrollTop;
    titleBar.setScreenTitle(screenTitleFor(controller));
  });

  // ניווט מאפס את מצב התצוגה המקומי ואת הגלילה.
  const resetOnNavigate = () => {
    resetLocalViewState();
    scrollTop = 0;
    keepScroll = false;
  };
  for (const method of ['showHome', 'showAllPlugins', 'showCategory',
                        'openPlugin', 'closePlugin']) {
    const original = controller[method].bind(controller);
    controller[method] = (...args) => {
      resetOnNavigate();
      return original(...args);
    };
  }

  // ההתקנה נגמרת בחלון של אוצריא, והמשתמש עשוי להיות בכל מקום בממשק
  // כשההודעה מגיעה — ולכן זה ערוץ נפרד.
  controller.onInstallDone((name) => {
    showSnack(S.plugins.installDoneSnack(name), 'success');
  });

  renderStore(body, controller, {readOnly: info.readOnly});

  // ── עלייה: קריאה מהמראה בלבד ────────────────────────────────────────────
  // הזיהוי יוצא **במקביל**, כמו במקור, ומי שתלוי בו ממתין לו.
  void probe.ensureDetected().then(() => controller.refreshInstalled());
  void controller.load();

  // ── בדיקת גרסה חדשה של החנות ────────────────────────────────────────────
  void checkForNewVersion(banners, info.version, log);

  // ── קובץ ההתקנה של החבילה, אם נשאר כזה ──────────────────────────────────
  void offerInstallerCleanup(banners, info.installerPath, log);

  // רינדור מחדש בשינוי גודל: מספר העמודות וסרגל הצד תלויים ברוחב.
  let resizeTimer = null;
  window.addEventListener('resize', () => {
    if (resizeTimer !== null) clearTimeout(resizeTimer);
    resizeTimer = setTimeout(() => controller.notifyRerender(), 120);
  });
}

/** שם המסך הפתוח, לשורת הכותרת. */
function screenTitleFor(controller) {
  const detail = controller.openPlugin_;
  if (detail !== null) return detail.name;
  switch (controller.view) {
    case 'all': return S.plugins.allPluginsPage;
    case 'category':
      return controller.openCategory?.name ?? S.plugins.breadcrumbRoot;
    default: return S.plugins.breadcrumbRoot;
  }
}

/**
 * שורת ההתראה על גרסה חדשה. פורט של `StoreUpdateController` ושל
 * `StoreUpdateBanner`.
 *
 * **אין כאן עדכון עצמי** — הסיפור מסתיים בכתובת שנפתחת בדפדפן.
 *
 * כל כשל נבלע ונרשם ביומן בלבד: הבדיקה הזאת היא נוחות, ומחשב בלי
 * אינטרנט הוא מצב תקין לגמרי בתוכנה שכל שאר עבודתה מקומית.
 */
async function checkForNewVersion(banners, currentVersion, log) {
  let release = null;
  try {
    release = await new StoreReleaseClient({net}).fetchLatestStable();
  } catch (error) {
    // **בכוונה הודעה רגילה ולא שגיאה**: "אין אינטרנט" הוא המצב הנפוץ
    // אצל מי שמריץ את התוכנה, ולא תקלה שראוי לחפש אחריה ביומן.
    log(`בדיקת גרסה חדשה לא הושלמה: ${error?.message ?? error}`);
    return;
  }

  if (release === null ||
      !isStoreVersionNewer(release.tagName, currentVersion)) {
    return;
  }
  log(`נמצאה גרסה חדשה: ${release.tagName} (מותקן: ${currentVersion})`);

  const t = S.storeUpdate;
  const banner = h('div.update-banner',
      icon('arrow-download', 20),
      h('div.update-banner__text', {text: t.bannerTitle(release.version)}),
      actionButton({
        text: t.bannerButton,
        variant: 'neutral',
        onPressed: async () => {
          try {
            await sys.openUrl(release.pageUrl);
          } catch {
            // הדפדפן לא נפתח — מציגים את הכתובת עצמה כדי שאפשר יהיה
            // להעתיק אותה ביד.
            showError(t.openFailed(release.pageUrl));
          }
        },
      }),
      iconButton({
        iconName: 'dismiss',
        tooltip: t.bannerDismissTooltip,
        // נשמר בזיכרון בלבד: אין הגדרות בתוכנה הזאת, וההודעה תחזור
        // בהרצה הבאה — וזה בסדר, כי הגרסה עדיין חדשה.
        onPressed: () => banner.remove(),
      }));
  banners.append(banner);
}

/**
 * מציע למחוק את קובץ ההתקנה של החבילה המלאה, אחרי שהיא כבר פרסה את
 * עצמה והעבירה את השרביט ל-exe הרזה שרץ עכשיו.
 *
 * ⚠️ **מציע ולא מוחק.** הפיתוי הוא למחוק לבד — הקובץ הוא ~‎96MB שכל
 * תוכנו כבר יושב בתיקייה שלידו, וזה בדיוק מה שהמשתמש ביקש להימנע ממנו.
 * אבל אותה חבילה עשויה להיות מיועדת גם למחשב שני, ומחיקה שקטה של הורדה
 * בגודל כזה הייתה מאלצת להוריד אותה מחדש — במחשב שאין בו אינטרנט.
 *
 * ה-host הוא שמכריע אם יש בכלל מה למחוק: `installerPath` ריק כשהקובץ
 * נעלם, כשהוא אינו קובץ, וכשהוא קובץ ההרצה שרץ עכשיו — ראו
 * `InstallerPath()` ב-bridge.cpp.
 */
async function offerInstallerCleanup(banners, installerPath, log) {
  if (!installerPath) return;

  let size = '';
  try {
    size = formatBytes((await fs.stat(installerPath)).size);
  } catch (error) {
    // הקובץ נעלם בין הבדיקה של ה-host לכאן — אין מה להציע.
    log(`קובץ ההתקנה אינו נגיש: ${error?.message ?? error}`);
    return;
  }

  const t = S.bundleInstaller;
  const banner = h('div.update-banner',
      icon('checkmark-circle', 20),
      h('div.update-banner__text', {text: t.bannerTitle(size)}),
      actionButton({
        text: t.bannerButton,
        variant: 'neutral',
        onPressed: async () => {
          try {
            await fs.remove(installerPath);
          } catch (error) {
            showError(t.deleteFailed(error?.message ?? error));
            return;
          }
          log(`קובץ ההתקנה נמחק: ${installerPath}`);
          banner.remove();
          showSnack(t.deleted, 'success');
        },
      }),
      iconButton({
        iconName: 'dismiss',
        tooltip: t.bannerDismissTooltip,
        onPressed: () => banner.remove(),
      }));
  banners.append(banner);
}

main().catch((error) => {
  // כשל בעלייה עצמה — אין ממשק להציג בו, ולכן הוא נכתב אל הדף גולמי.
  document.body.textContent =
      `שגיאה בעליית הממשק: ${error?.message ?? error}`;
  console.error(error);
});
