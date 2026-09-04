// מצב מסך החנות. פורט של
// `lib/src/controllers/plugins_module_controller.dart`.
//
// `load` בלבד נקרא בפתיחה: הוא קורא מהתיקייה המקומית וסורק את ההתקנה של
// אוצריא, ולא נוגע ברשת. `sync` היא הפעולה היחידה שדורשת אינטרנט.

import {S} from './strings.js';
import {InstallStatus, PluginStoreHome} from './store/models.js';
import {EMPTY_ONLINE_STATUS} from './store/online_peek.js';
import {SyncPhase} from './store/mirror_sync.js';

export const Status = Object.freeze({
  idle: 'idle',
  loading: 'loading',
  ready: 'ready',
  syncing: 'syncing',
  error: 'error',
});

/** סינון לפי סטטוס התוסף בחנות. */
export const StatusFilter = Object.freeze({
  all: 'all',
  stable: 'stable',
  beta: 'beta',
  experimental: 'experimental',
});

/**
 * שלושת המסכים של החנות באתר, במקום שלושת ה-routes שלה:
 * `/plugins` (דף בית אצור), `/plugins/all` ו-`/plugins/category/<slug>`.
 */
export const Page = Object.freeze({
  home: 'home',
  all: 'all',
  category: 'category',
});

/** כל כמה זמן נסרקת תיקיית התוספים אחרי מסירה לאוצריא, ועד מתי. */
const INSTALL_WATCH_INTERVAL_MS = 1000;
const INSTALL_WATCH_TIMEOUT_MS = 5 * 60 * 1000;

export class StoreController {
  constructor({manager, probe, releaseClient, log = () => {}}) {
    this.manager = manager;
    this.probe = probe;
    /**
     * מברר מהן גרסאות אוצריא שהמראה נבנית עבורן. נדרש **רק** למסלולים
     * המקוונים (סנכרון והצצה); הטעינה וההתקנה אינן נוגעות בו.
     */
    this.releaseClient = releaseClient;
    this.log = log;

    this.status = Status.idle;
    this.errorMessage = null;

    /** קטגוריות החנות בסדר שנקבע באתר. ריק במראה ישנה. */
    this.categories = [];
    this.home = PluginStoreHome.empty;
    this.lastSync = null;
    /** שורש קובצי החנות — ממנו נבנים נתיבי התמונות. */
    this.pluginsDir = null;

    /**
     * גרסת אוצריא שבמחשב **הזה**. היא אינה קובעת מה יורד — היא קובעת
     * מה **מוצג**: תוסף שאין במראה בילד שירוץ עליה אינו מופיע בחנות.
     * `null` = לא ידוע (הזיהוי טרם הסתיים), ואז אין מול מה לסנן.
     */
    this.appVersion = null;

    /**
     * גרסאות אוצריא שהמראה נבנתה עבורן, כפי שנשמרו בקטלוג. ריק במראה
     * שסונכרנה לפני שהשדה נוסף — ראו `StorePlugin.mirrorTargets`.
     */
    this.targetAppVersions = [];

    // ── ניווט ──────────────────────────────────────────────────────────────
    /**
     * החנות נפתחת בדף הבית האצור, בדיוק כמו באתר; מראה בלי קטגוריות
     * (סנכרון ישן) נופלת ל"כל התוספים" — אין לה דף בית להציג.
     */
    this.view = Page.home;
    this.openCategorySlug = null;
    /** התוסף שדף הפרטים שלו פתוח, או null. */
    this.openPluginId = null;

    // ── סינון (מסך "כל התוספים", כמו באתר) ─────────────────────────────────
    this.search = '';
    /** החנות נפתחת על "הכול" — המשתמש בא לראות מה קיים, לא רק את היציב. */
    this.statusFilter = StatusFilter.all;
    this.tagFilter = null;
    /**
     * הצג רק מה שלא מותקן או שיש לו עדכון — פועל כברירת מחדל, כמו בחנות
     * המקורית: המשתמש בא לעדכן, לא לגלול על מה שכבר מותקן.
     */
    this.hideInstalled = true;

    // ── בדיקה קלה ברשת ─────────────────────────────────────────────────────
    this.onlineStatus = null;
    this.onlineCheckError = null;
    this.onlineCheckedAt = null;

    // ── סנכרון ─────────────────────────────────────────────────────────────
    this.lastSyncOutcome = null;
    this.syncMessage = null;
    this.syncProgress = null;
    this.syncWarnings = [];
    this.syncCancelled = false;

    this.#catalogPlugins = [];
    this.#targetVersions = null;
    this.#installed = new Map();
    this.#listeners = new Set();
    this.#pendingInstalls = new Map();
    this.#installWatch = null;
    this.#loading = null;
    this.#installDoneListeners = new Set();
    this.#invalidateDerived();
  }

  #catalogPlugins;
  #targetVersions;
  #installed;
  #listeners;
  #pendingInstalls;
  #installWatch;
  #loading;
  #installDoneListeners;

  // ── תצפית ────────────────────────────────────────────────────────────────

  /** נרשם לשינויי מצב. מחזיר פונקציה שמבטלת את ההרשמה. */
  subscribe(listener) {
    this.#listeners.add(listener);
    return () => this.#listeners.delete(listener);
  }

  /**
   * נרשם להודעה "אוצריא סיימה להתקין את X".
   *
   * ההתקנה נגמרת בחלון של אוצריא, והמשתמש עשוי להיות בכל מקום בממשק
   * כשההודעה מגיעה — ולכן זה ערוץ נפרד ולא שדה מצב.
   */
  onInstallDone(listener) {
    this.#installDoneListeners.add(listener);
    return () => this.#installDoneListeners.delete(listener);
  }

  /**
   * מבקש רינדור מחדש בלי ששום דבר במצב השתנה.
   *
   * נחוץ למצב תצוגה שאינו שייך לבקר — "הצג עוד נבחרים", "הצג עוד
   * תגיות", והכפתור שנמצא כרגע בטעינה. במקור אלה היו `setState` של
   * ה-widget; כאן הבקר הוא הצינור היחיד לרינדור, ולכן הוא חושף את זה
   * במפורש במקום שהמסך יחזיק ערוץ משלו.
   */
  notifyRerender() {
    this.#notify();
  }

  #notify() {
    for (const listener of this.#listeners) {
      try {
        listener(this);
      } catch (error) {
        this.log(`מאזין למצב נפל: ${error?.message ?? error}`);
      }
    }
  }

  get installed() {
    return this.#installed;
  }

  set installed(value) {
    this.#installed = value;
    this.#invalidateDerived();
  }

  // ── טעינה ────────────────────────────────────────────────────────────────

  /** טוען את הקטלוג המקומי וסורק את התוספים המותקנים. ללא רשת. */
  load() {
    this.#loading = this.#load();
    return this.#loading;
  }

  async #load() {
    this.status = Status.loading;
    this.errorMessage = null;
    this.#notify();

    try {
      // לפני הקטלוג: הגרסה היא שקובעת אילו תוספים בכלל מוצגים. הזיהוי
      // רץ במקביל ועשוי לא להסתיים עדיין — `null` אינו מסתיר דבר, ומי
      // שיסיים קורא ל-`refreshInstalled` שמסנן מחדש.
      this.appVersion = this.probe.version;
      const snapshot = await this.manager.load();
      this.#catalogPlugins = snapshot.catalog.plugins;
      this.targetAppVersions = snapshot.catalog.targetAppVersions;
      this.categories = snapshot.catalog.categories;
      this.home = snapshot.catalog.home;
      this.lastSync = snapshot.catalog.lastSync;
      this.installed = snapshot.installed;
      this.pluginsDir = snapshot.pluginsDir;
      this.#invalidateDerived();
      this.#settleView();
      this.status = Status.ready;
    } catch (error) {
      this.status = Status.error;
      this.errorMessage = error?.message ?? String(error);
      this.log(`טעינת קטלוג התוספים נכשלה: ${this.errorMessage}`);
    }
    this.#notify();
  }

  /**
   * סורק מחדש **רק** את התוספים המותקנים, בלי לטעון את הקטלוג ובלי
   * להעביר את המסך למצב טעינה.
   *
   * נקרא אחרי שזיהוי אוצריא התעדכן: תיקיית התוספים נגזרת מנתיב ההתקנה,
   * וסריקה שרצה לפניו הסתכלה במקום אחר.
   */
  async refreshInstalled() {
    await this.#loading;
    if (this.status !== Status.ready) return;

    try {
      const scanned = await this.manager.scanInstalled();
      // גם הגרסה מתעדכנת כאן: היא נקראת מאותה התקנה שזה עתה זוהתה,
      // ובלעדיה החנות הייתה ממשיכה להציג בילדים לפי גרסה שכבר לא נכונה.
      const version = this.probe.version;
      if (!sameMap(this.#installed, scanned) || version !== this.appVersion) {
        this.appVersion = version;
        this.installed = scanned;
        this.#invalidateDerived();
        this.#notify();
      }
      // אחרי ההצבה, לא לפניה: מי שמאזין להודעת הסיום קורא מיד את המפה
      // החדשה. גם סריקה שלא שינתה כלום מגיעה לכאן — פסק הזמן נסגר בה.
      this.#settleInstallWatch(scanned);
    } catch (error) {
      // כישלון כאן אינו הופך את החנות לשגויה — היא כבר טעונה ומוצגת.
      this.log(`סריקת התוספים המותקנים נכשלה: ${error?.message ?? error}`);
    }
  }

  // ── המתנה להתקנה שנמסרה לאוצריא ──────────────────────────────────────────
  // ההתקנה עצמה קורית בחלון של אוצריא, ולכן הרגע שבו היא נגמרה מגיע
  // אלינו רק מהדיסק: תיקיית ההתקנה נסרקת שוב ושוב עד שהגרסה שם משתנה.
  // בלי זה המשתמש היה צריך ללחוץ "בדיקה מחדש" כדי לראות מה כבר עודכן.

  get isAwaitingInstall() {
    return this.#pendingInstalls.size > 0;
  }

  isAwaitingInstallOf(plugin) {
    return this.#pendingInstalls.has(plugin.id);
  }

  /** מתחיל להמתין להתקנה של [plugin] באוצריא. */
  watchForInstall(plugin) {
    const manifestId = plugin.manifestId;
    // בלי מזהה מניפסט אין מה לזהות בסריקה — התוסף לא ייספר כמותקן ממילא.
    if (manifestId === null) return;

    this.#pendingInstalls.set(plugin.id, {
      name: plugin.name,
      manifestId,
      versionBefore: this.#installed.get(manifestId) ?? null,
      deadline: Date.now() + INSTALL_WATCH_TIMEOUT_MS,
    });
    if (this.#installWatch === null) {
      this.#installWatch = setInterval(() => this.#tick(),
                                       INSTALL_WATCH_INTERVAL_MS);
    }
    this.#notify();
  }

  #tick() {
    // חנות שאינה מוכנה (טעינה / סנכרון / שגיאה) לא נסרקת, אבל המועד
    // שעבר חייב לסגור את ההמתנה גם אז — אחרת הטיימר רץ עד סוף ההרצה.
    if (this.status === Status.ready) {
      void this.refreshInstalled();
    } else {
      this.#settleInstallWatch(this.#installed);
    }
  }

  /**
   * סוגר את מה שהסריקה הוכיחה: גרסה שהשתנתה = ההתקנה הסתיימה, ומועד
   * שעבר = הפסקנו לחכות (המשתמש ביטל בחלון של אוצריא, או שלא סיים).
   */
  #settleInstallWatch(scanned) {
    if (this.#pendingInstalls.size === 0) return;

    const now = Date.now();
    const countBefore = this.#pendingInstalls.size;
    const done = [];

    for (const [id, pending] of [...this.#pendingInstalls]) {
      const current = scanned.get(pending.manifestId) ?? null;
      if (current !== pending.versionBefore) {
        done.push(pending.name);
        this.#pendingInstalls.delete(id);
      } else if (now > pending.deadline) {
        this.#pendingInstalls.delete(id);
      }
    }

    if (this.#pendingInstalls.size === countBefore) return; // עוד מחכים

    if (this.#pendingInstalls.size === 0 && this.#installWatch !== null) {
      clearInterval(this.#installWatch);
      this.#installWatch = null;
    }
    // גם פסק זמן משנה את מצב השורה בדיאלוג, והסריקה עצמה לא בהכרח תודיע.
    this.#notify();
    for (const name of done) {
      this.log(`אוצריא סיימה להתקין את ${name}`);
      for (const listener of this.#installDoneListeners) listener(name);
    }
  }

  // ── רשת ──────────────────────────────────────────────────────────────────

  /**
   * שואל את האתר אם יש תוסף חדש או גרסה חדשה — **בקשה קלה אחת**, בלי
   * להוריד קובץ. כשל (בעיקר "אין רשת") הוא מצב תקין ונשמר.
   */
  async checkOnline() {
    this.onlineCheckError = null;
    this.#notify();

    try {
      // אותן גרסאות שהסנכרון יקבל — אחרת ההצצה מדווחת על עדכון שההורדה
      // לא תביא, או שותקת על אחד שכן.
      this.onlineStatus = await this.manager.peekOnlineUpdates({
        appVersions: await this.#appVersions(),
      });
    } catch (error) {
      this.onlineStatus = null;
      this.onlineCheckError = error?.message ?? String(error);
      // בלי stack trace בכוונה — "אין רשת" הוא המצב הנפוץ.
      this.log(`בדיקת עדכונים ברשת (תוספים) לא הצליחה: ` +
               `${this.onlineCheckError}`);
    }
    this.onlineCheckedAt = new Date();
    this.#notify();
  }

  /** מסנכרן את הקטלוג והקבצים מהאתר אל המראה. דורש אינטרנט. */
  async sync() {
    this.status = Status.syncing;
    this.errorMessage = null;
    this.syncMessage = S.plugins.syncingOverlayStarting;
    this.syncProgress = null;
    this.syncWarnings = [];
    this.syncCancelled = false;
    this.#notify();

    try {
      const outcome = await this.manager.sync({
        appVersions: await this.#appVersions(),
        isCancelled: () => this.syncCancelled,
        onProgress: (progress) => {
          this.syncMessage = progress.message;
          if (progress.phase === SyncPhase.warning) {
            this.syncWarnings.push(progress.message);
          } else if (progress.current !== undefined &&
                     progress.total > 0) {
            this.syncProgress = progress.current / progress.total;
          }
          this.#notify();
        },
      });
      this.lastSyncOutcome = outcome;
      this.log(`סנכרון התוספים: ${outcome.fetched} ירדו, ` +
               `${outcome.skipped} דולגו, ${this.syncWarnings.length} אזהרות`);
      // ליומן בלבד: הבחירה עצמה שקופה למשתמש, אבל "למה התוסף הזה לא על
      // הכונן" חייב להיות ניתן לענות עליו.
      if (outcome.incompatible.length > 0) {
        this.log('תוספים בלי גרסה שתואמת לאוצריא: ' +
                 outcome.incompatible.join(', '));
      }
      // המראה זה עתה נמשכה מהאתר — התשובה הישנה של הבדיקה הקלה כבר לא
      // מתארת אותה, והשארתה הייתה מציגה "יש עדכונים" אחרי שהם כבר ירדו.
      // כשקובץ תוסף לא ירד המראה עדיין חסרה אותו, ולכן התשובה נשארת —
      // וכך גם בסנכרון שבוטל, שהשאיר בדיוק את אותו חוסר.
      if (!outcome.hasFailures && !this.syncCancelled) {
        this.onlineStatus = EMPTY_ONLINE_STATUS;
        this.onlineCheckedAt = new Date();
        this.onlineCheckError = null;
      }
      await this.load();
    } catch (error) {
      this.status = Status.error;
      this.errorMessage = error?.message ?? String(error);
      this.log(`סנכרון חנות התוספים נכשל: ${this.errorMessage}`);
      this.#notify();
    }
  }

  /** מבקש לעצור את הסנכרון. נבדק בין תוסף לתוסף. */
  cancelSync() {
    this.syncCancelled = true;
    this.#notify();
  }

  /**
   * הגרסאות שההורדה וההצצה מסננות לפיהן — **מה שהריפו של אוצריא פרסם**,
   * ולא מה שמותקן במחשב הזה.
   *
   * ⚠️ **למה לא הגרסה המקומית:** המראה נבנית במחשב מקוון ונצרכת במחשב
   * אחר. סינון לפי המחשב המסנכרן פירושו כונן שנושא בילדים שאינם מתאימים
   * למחשב היעד, ושם — בלי אינטרנט — אין דרך לתקן את זה. ראו
   * `otzaria_release_client.js`.
   *
   * נשמר לכל אורך ההרצה, אבל **רק בהצלחה**: תשובה ריקה מפני שאין רשת
   * אינה עובדה על הריפו, ואסור שתיתקע בזיכרון עד סוף ההרצה.
   */
  async #appVersions() {
    if (this.#targetVersions !== null) return this.#targetVersions;

    let result;
    try {
      result = await this.releaseClient.fetchTargetVersions();
    } catch (error) {
      // לא שגיאת הרצה: בלי היעד יורד הבילד האחרון של כל תוסף, וזו בדיוק
      // ההתנהגות שהייתה לפני שהתאימות נכנסה.
      this.log('בירור גרסת אוצריא האחרונה לא הצליח ' +
               `(${error?.message ?? error}) — יורד הבילד האחרון של כל תוסף`);
      return [];
    }

    if (result.versions.length === 0) {
      this.log('לא נמצאה אף גרסה של אוצריא בריפו — ' +
               'יורד הבילד האחרון של כל תוסף');
      return [];
    }

    this.log(result.latestIsPrerelease
        ? `גרסאות היעד: ${result.latest} (טרם הוגדרה כיציבה) ` +
          `ו-${result.latestStable}`
        : `גרסת היעד: ${result.latest}`);
    this.#targetVersions = result.versions;
    return result.versions;
  }

  // ── פעולות על תוסף בודד ──────────────────────────────────────────────────

  byId(id) {
    return this.#pluginsById.get(id) ?? null;
  }

  statusOf(plugin) {
    return plugin.statusAgainst(this.#installed, this.appVersion,
                                this.targetAppVersions);
  }

  /** הגרסה המותקנת של התוסף, או null אם אינו מותקן. */
  installedVersionOf(plugin) {
    return plugin.manifestId === null
        ? null
        : (this.#installed.get(plugin.manifestId) ?? null);
  }

  /**
   * הבילד שיותקן במחשב הזה — הגבוה מבין אלה שהמראה נושאת ושתואם לגרסת
   * אוצריא שכאן. `null` = אין כזה, וממילא התוסף אינו מוצג.
   */
  targetOf(plugin) {
    return plugin.installTarget(this.appVersion, this.targetAppVersions);
  }

  /** מספר הגרסה להצגה: של הבילד שיותקן, ובחוסר — של החי בקטלוג. */
  versionOf(plugin) {
    return this.targetOf(plugin)?.version ?? plugin.version;
  }

  /** האם הקובץ של הבילד שיותקן בכלל ירד למראה. */
  hasFileFor(plugin) {
    return plugin.localFileFor(this.targetOf(plugin)?.version) !== null;
  }

  suggestedFileName(plugin) {
    return this.manager.suggestedFileName(plugin, this.appVersion,
                                          this.targetAppVersions);
  }

  /** נתיב מוחלט לנכס שנשמר בקטלוג כנתיב יחסי. */
  assetPath(relativePath) {
    return this.manager.assetPath(relativePath);
  }

  saveCopy(plugin, destPath) {
    return this.manager.saveCopy(plugin, destPath, this.appVersion,
                                 this.targetAppVersions);
  }

  /**
   * מוסר את התוסף לאוצריא. ההצלחה כאן היא של ה**מסירה** בלבד — ההתקנה
   * נגמרת בחלון של אוצריא, ולכן מתחילים מיד להמתין לה על הדיסק.
   */
  async install(plugin) {
    const result = await this.manager.install(plugin, this.appVersion,
                                              this.targetAppVersions);
    if (result.success) {
      this.watchForInstall(plugin);
    } else {
      this.log(`התקנה של ${plugin.name} נכשלה: ${result.error}`);
    }
    return result;
  }

  openHomepage(url) {
    return this.manager.openExternalUrl(url);
  }

  // ── סינון וניווט ─────────────────────────────────────────────────────────

  setSearch(value) {
    if (this.search === value) return;
    this.search = value;
    this.#invalidateDerived();
    this.#notify();
  }

  setStatusFilter(value) {
    if (this.statusFilter === value) return;
    this.statusFilter = value;
    this.#invalidateDerived();
    this.#notify();
  }

  setTagFilter(value) {
    if (this.tagFilter === value) return;
    this.tagFilter = value;
    this.#invalidateDerived();
    this.#notify();
  }

  setHideInstalled(value) {
    if (this.hideInstalled === value) return;
    this.hideInstalled = value;
    this.#invalidateDerived();
    this.#notify();
  }

  showHome() {
    this.#goTo(Page.home);
  }

  /**
   * "כל התוספים" — הרשימה השטוחה עם הסינון. [query] מגיע מתיבת החיפוש
   * שבדף הבית: באתר היא מובילה לדף חיפוש צד-שרת, וכאן לסינון המקומי.
   */
  showAllPlugins(query) {
    if (query !== undefined && query !== null) this.search = query;
    this.#goTo(Page.all);
  }

  showCategory(slug) {
    this.openCategorySlug = slug;
    this.#goTo(Page.category);
  }

  /** פותח את דף הפרטים של תוסף. */
  openPlugin(id) {
    this.openPluginId = id;
    this.#notify();
  }

  closePlugin() {
    this.openPluginId = null;
    this.#notify();
  }

  get openPlugin_() {
    return this.openPluginId === null ? null : this.byId(this.openPluginId);
  }

  #goTo(target) {
    if (target !== Page.category) this.openCategorySlug = null;
    this.view = target;
    this.openPluginId = null;
    this.#invalidateDerived();
    this.#notify();
  }

  /**
   * מיישר את המסך המוצג מול הקטלוג שנטען זה עתה: בלי קטגוריות אין דף
   * בית, וקטגוריה שנעלמה מהחנות לא נשארת פתוחה.
   */
  #settleView() {
    if (this.view === Page.category && this.openCategory === null) {
      this.openCategorySlug = null;
      this.view = Page.all;
    }
    if (this.view === Page.home && !this.hasCuratedHome) {
      this.view = Page.all;
    }
    if (this.openPluginId !== null && this.byId(this.openPluginId) === null) {
      this.openPluginId = null;
    }
  }

  // ── תוצרים מחושבים, ממוזנים ──────────────────────────────────────────────
  // כל אלה נקראו ישירות מהרינדור, ולכן חושבו מחדש בכל בנייה של המסך —
  // כולל בכל דיווח התקדמות של הורדה. `filtered` לבדו הוא `statusOf` לכל
  // תוסף. הם משתנים רק כשהקטלוג או הסינון משתנים.

  #derived;

  #invalidateDerived() {
    this.#derived = {};
  }

  #memo(key, compute) {
    if (!(key in this.#derived)) this.#derived[key] = compute();
    return this.#derived[key];
  }

  /**
   * התוספים שיש מה להציע להם במחשב הזה — **מקור האמת לכל המסכים**.
   *
   * תוסף שאין במראה בילד שירוץ על גרסת אוצריא שכאן אינו מוצג כלל: לא
   * בדף הבית, לא בקטגוריה, לא בחיפוש ולא ברשימת התגיות. הצגתו הייתה
   * מייצרת כפתור התקנה שאין לו קובץ, ובמחשב לא-מקוון גם אין דרך להשיגו.
   *
   * גרסה מקומית שאינה ידועה (הזיהוי טרם הסתיים, או שאוצריא לא נמצאה)
   * אינה מסתירה דבר — ראו `isCompatibleWithApp`.
   */
  get plugins() {
    return this.#memo('plugins', () => this.#catalogPlugins.filter(
        (plugin) => plugin.runsOn(this.appVersion, this.targetAppVersions)));
  }

  /**
   * כמה תוספים הוסתרו בגלל תאימות. מוצג כשורת הסבר אחת בתחתית הרשימה:
   * חנות שחסרים בה תוספים בלי שנאמר למה אינה ניתנת לאבחון מרחוק, וזו
   * בדיוק השאלה שמגיעה מהמשתמשים.
   */
  get hiddenCount() {
    return this.#catalogPlugins.length - this.plugins.length;
  }

  /**
   * האם התוסף עובר את מתג "רק מה שלא מותקן". המתג הוא תוספת של הלאנצ'ר
   * ולכן חל על **כל** המסכים, גם על האצירה.
   */
  #passesInstalledFilter(plugin) {
    return !this.hideInstalled ||
        this.statusOf(plugin) !== InstallStatus.upToDate;
  }

  /** "כל התוספים" — חיפוש, סטטוס ותגית, מעל מתג ההתקנה. */
  get filtered() {
    return this.#memo('filtered', () => this.plugins.filter((plugin) => {
      if (!plugin.matchesQuery(this.search)) return false;
      if (this.statusFilter !== StatusFilter.all &&
          plugin.status !== this.statusFilter) {
        return false;
      }
      if (this.tagFilter !== null && !plugin.tags.includes(this.tagFilter)) {
        return false;
      }
      return this.#passesInstalledFilter(plugin);
    }));
  }

  get #pluginsById() {
    return this.#memo('byId', () => {
      const map = new Map();
      for (const plugin of this.plugins) map.set(plugin.id, plugin);
      return map;
    });
  }

  /**
   * התוספים הנבחרים, בסדר האצירה של האתר — `/api/plugins` מחזיר אותם
   * ראשונים, ולכן סדר הקטלוג הוא סדר האצירה.
   */
  get featured() {
    return this.#memo('featured', () => this.plugins.filter(
        (p) => p.isFeatured && this.#passesInstalledFilter(p)));
  }

  /**
   * הקטגוריות שמקבלות שורה בדף הבית ונשאר בהן מה להציג אחרי מתג
   * ההתקנה.
   */
  get homeCategories() {
    return this.#memo('homeCategories', () => this.categories.filter(
        (category) => category.showOnHome &&
            this.pluginsIn(category).length > 0));
  }

  /**
   * האם **קיים** דף בית אצור. נמדד על המבנה עצמו ולא על מה שנשאר אחרי
   * הסינון — אחרת כיבוי כל הכרטיסים ע"י המתג היה נראה כמו חנות ריקה.
   */
  get hasCuratedHome() {
    return this.#memo('hasCuratedHome', () =>
        this.plugins.some((p) => p.isFeatured) ||
        this.categories.some((c) => c.showOnHome && c.pluginIds.length > 0));
  }

  get openCategory() {
    if (this.openCategorySlug === null) return null;
    return this.categoryBySlug(this.openCategorySlug);
  }

  categoryBySlug(slug) {
    for (const category of this.categories) {
      if (category.slug === slug) return category;
    }
    return null;
  }

  /**
   * תוספי הקטגוריה בסדר הידני שנקבע באתר, אחרי מתג ההתקנה. [limit] הוא
   * `homeLimit` של שורת דף-הבית. מזהה שאין לו תוסף בקטלוג מדולג.
   */
  pluginsIn(category, limit = null) {
    const result = [];
    for (const id of category.pluginIds) {
      const plugin = this.#pluginsById.get(id);
      if (plugin === undefined || !this.#passesInstalledFilter(plugin)) {
        continue;
      }
      result.push(plugin);
      if (limit !== null && result.length >= limit) break;
    }
    return result;
  }

  categoryName(slug) {
    return this.categoryBySlug(slug)?.name ?? slug;
  }

  /**
   * כותרת החנות. ברירת המחדל זהה לזו שבאתר, למראה שסונכרנה לפני
   * שהטקסטים האלה נכנסו — או כשמנהלי האתר השאירו אותם ריקים.
   */
  get homeTitle() {
    return this.home.title || S.plugins.catalogTitleFallback;
  }

  get homeSubtitle() {
    return this.home.subtitle || S.plugins.catalogSubtitleFallback;
  }

  get allTags() {
    return this.#memo('allTags', () => {
      const tags = new Set();
      for (const plugin of this.plugins) {
        for (const tag of plugin.tags) tags.add(tag);
      }
      return [...tags].sort((a, b) => a.localeCompare(b, 'he'));
    });
  }

  /** תוספים שמותקנים אצל המשתמש בגרסה ישנה מזו שבחנות. */
  get updatablePlugins() {
    return this.#memo('updatable', () => this.plugins.filter(
        (p) => this.statusOf(p) === InstallStatus.updateAvailable));
  }

  get installedCount() {
    return this.#installed.size;
  }

  get hasOnlineUpdate() {
    return this.onlineStatus?.hasUpdates ?? false;
  }

  dispose() {
    if (this.#installWatch !== null) {
      clearInterval(this.#installWatch);
      this.#installWatch = null;
    }
    this.#listeners.clear();
    this.#installDoneListeners.clear();
  }
}

function sameMap(a, b) {
  if (a.size !== b.size) return false;
  for (const [key, value] of a) {
    if (b.get(key) !== value) return false;
  }
  return true;
}
