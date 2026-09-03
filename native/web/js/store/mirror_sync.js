// מסנכרן את הקטלוג מהאתר אל המראה המקומית. פורט של
// `packages/plugins_manager/lib/src/services/plugin_mirror_sync.dart`.
//
// רץ **רק** על המחשב המקוון; משם הכול עובד אופליין.
//
// ⚠️ הקובץ הזה נושא הרבה החלטות שנולדו מתקלות אמיתיות בשטח. כל הערה
// שמתחילה ב-"למה" כאן היא כזו, והועברה כלשונה — אין לפשט אותן בלי להבין
// מה הן מונעות.

import {S} from '../strings.js';
import {PluginCatalog, PluginLocalFile, PluginStoreCategory,
        PluginStoreHome, StorePlugin} from './models.js';
import {readPluginManifestId} from './manifest_reader.js';
import {describeError} from './store_client.js';
import {runPooled} from './pool.js';

/** שלב בדיווח ההתקדמות. */
export const SyncPhase = Object.freeze({
  start: 'start',
  plugin: 'plugin',
  warning: 'warning',
  done: 'done',
});

/**
 * ארבעה תוספים בו-זמנית. הקבצים כאן קטנים והזמן הולך על סיבובי
 * הלוך-חזור, ולכן זה בדיוק המקום שבו מקביליות משתלמת — ראו `pool.js`.
 */
export const DEFAULT_MAX_CONCURRENT_PLUGINS = 4;

export class PluginMirrorSync {
  constructor({client, store, io,
               maxConcurrentPlugins = DEFAULT_MAX_CONCURRENT_PLUGINS}) {
    this.client = client;
    this.store = store;
    /** `{stat, readBase64}` — לקריאת ה-manifest מתוך ה-ZIP. */
    this.io = io;
    this.maxConcurrentPlugins = maxConcurrentPlugins;
  }

  /**
   * זורק רק אם רשימת התוספים עצמה לא נטענה. כשל בנכס בודד מדווח
   * כ-`warning` והסנכרון ממשיך.
   *
   * **הסנכרון מתוכנן לפני שהוא מתחיל**: קודם נקבע לכל תוסף מה בכלל חסר
   * במראה (השוואת מטא-דאטה + בדיקת קיום קבצים, בלי רשת), ורק מי שחסר לו
   * משהו נכנס ללולאה. תוסף שכבר מעודכן אינו נוגע ברשת, אינו מדווח
   * התקדמות, ואינו נספר במונה — כך "3 מתוך 3" הוא באמת מה שיורד עכשיו,
   * ולא "3 מתוך 40" שרובם רק נבדקים.
   *
   * @param {{appVersions?: string[],
   *          onProgress?: (progress: object) => void,
   *          isCancelled?: () => boolean}} options
   */
  async sync({appVersions = [], onProgress, isCancelled} = {}) {
    const report = (progress) => onProgress?.(progress);
    const cancelled = () => isCancelled?.() ?? false;

    await this.store.ensureDirs();
    report({phase: SyncPhase.start, message: S.domain.syncLoadingCatalog});

    const remote = await this.client.fetchCatalog();
    const previousCatalog = await this.store.load();

    // רשימה ריקה היא JSON תקין ולכן `fetchCatalog` לא זורק עליה — אבל
    // לכתוב אותה על קטלוג קיים פירושו למחוק חנות שלמה ממחשב לא-מקוון
    // בגלל תקלה זמנית באתר. נכשלים במקום, והמראה נשארת כפי שהיא.
    if (remote.length === 0 && previousCatalog.plugins.length > 0) {
      throw new Error(S.domain.syncEmptyCatalogRejected);
    }

    const existing = new Map();
    for (const plugin of previousCatalog.plugins) existing.set(plugin.id, plugin);

    const plans = [];
    for (const raw of remote) {
      plans.push(await this.#plan(raw, existing, appVersions));
    }
    const todo = plans.filter((plan) => plan.hasWork);

    const fetched = new Map();
    const failed = [];
    const total = todo.length;
    let done = 0;

    // התוספים מסונכרנים במקביל: כל אחד הוא כמה קבצים קטנים שרובם המתנה
    // לשרת, ובטור ההמתנות האלה מצטברות לרוב זמן הסנכרון. בדיקת הביטול
    // בתוך המשימה — משימה שממתינה בתור בזמן שבוטלה פשוט לא מתחילה.
    await runPooled(
        todo.map((plan) => async () => {
          if (cancelled()) return;
          done++;

          let plugin = plan.plugin;
          report({
            phase: SyncPhase.plugin,
            message: S.domain.syncPlugin(plugin.name, done, total),
            current: done,
            total,
          });

          await this.store.fs.mkdirs(this.store.pluginDir(plugin.id));
          plugin = await this.#syncImages(plan, plugin, report);
          const files = await this.#syncPluginFiles(plan, plugin, report);
          plugin = files.plugin;

          fetched.set(plugin.id, plugin);
          if (!files.ok) failed.push(plugin.name);
        }),
        this.maxConcurrentPlugins);

    const wasCancelled = cancelled();

    // תוסף שלא הגיע תורו בביטול חייב להישאר על הרשומה הקודמת: הרשומה
    // החדשה מתארת גרסה שקובץ שלה לא ירד, וזה בדיוק מה שהיה גורם לסנכרון
    // הבא לדלג עליו לנצח.
    const plugins = plans.map((plan) => {
      const updated = fetched.get(plan.plugin.id);
      if (updated !== undefined) return updated;
      return wasCancelled && plan.hasWork
          ? (plan.previous ?? plan.plugin)
          : plan.plugin;
    });
    const syncedIds = new Set(plugins.map((plugin) => plugin.id));

    // סנכרון שבוטל באמצע לא מושך מבנה חדש — המבנה הקודם נשאר תואם למה
    // שכבר במראה יותר מרשימה חלקית שנבנתה על חצי קטלוג.
    const structure = wasCancelled
        ? {home: previousCatalog.home, categories: previousCatalog.categories,
           slugsOf: () => []}
        : await this.#syncStructure(syncedIds, previousCatalog, report);

    const catalog = new PluginCatalog({
      lastSync: new Date(),
      plugins: plugins.map((plugin) =>
          plugin.copyWith({categorySlugs: structure.slugsOf(plugin.id)})),
      categories: structure.categories,
      home: structure.home,
    });
    await this.store.save(catalog);

    // בילד שכבר אינו בקטלוג (גרסת אוצריא שבכונן זזה) נמחק מהדיסק — אחרת
    // כל עדכון של אוצריא היה מוסיף שכבת בילדים ישנים על הכונן הנייד.
    // **לא בביטול**: שם הקטלוג הוא הישן, והניקוי היה מוחק את מה שכן ירד.
    if (!wasCancelled) {
      for (const plugin of catalog.plugins) {
        await this.store.pruneUnusedFiles(plugin);
      }
    }

    const skipped = plans.length - done;
    report({
      phase: SyncPhase.done,
      message: S.domain.syncDoneCounts(done, skipped),
      current: done,
      total,
    });

    return {
      catalog,
      fetched: done,
      skipped,
      failed,
      // ליומן בלבד: הבחירה עצמה שקופה למשתמש, אבל "למה התוסף הזה לא על
      // הכונן" חייב להיות ניתן לענות עליו.
      incompatible: plans
          .filter((plan) => plan.isIncompatible)
          .map((plan) =>
              `${plan.plugin.name} (${plan.plugin.lowestSupportedApp ?? '?'})`),
      get hasFailures() {
        return this.failed.length > 0;
      },
    };
  }

  /**
   * מה חסר לתוסף הזה במראה — כל ההחלטות במקום אחד, ובלי רשת. השלבים
   * שמורידים בפועל רק מבצעים את מה שנקבע כאן.
   */
  async #plan(raw, existing, appVersions) {
    const remote = StorePlugin.fromApi(raw, this.client.baseUrl);
    const previous = existing.get(remote.id) ?? null;

    // שומרים על מה שכבר יש מקומית, ומעדכנים רק את מה שבאמת ירד עכשיו.
    let plugin = remote.copyWith({
      imagePath: previous?.imagePath ?? null,
      screenshotPaths: previous?.screenshotPaths ?? [],
      localFiles: previous?.localFiles ?? new Map(),
      manifestId: previous?.manifestId ?? null,
    });

    // בילד לכל גרסת אוצריא שהכונן נושא. בילד שכבר במראה נשמר, וזה שאינו
    // מבוקש עוד נושר מהקטלוג — הקובץ שלו נמחק בסוף הסנכרון.
    const keep = new Map();
    const missing = [];
    const targets = plugin.targetsFor(appVersions);
    for (const target of targets) {
      if (!target.downloadUrl) continue;
      if (await this.#buildUnchanged(target, plugin, previous)) {
        keep.set(target.version, plugin.localFileFor(target.version));
      } else {
        missing.push(target);
      }
    }
    plugin = plugin.copyWith({localFiles: keep});

    const needsImage = Boolean(plugin.remoteImageUrl) &&
        !await this.#imageUnchanged(plugin, previous);
    const needsScreenshots = plugin.remoteScreenshotUrls.length > 0 &&
        !await this.#screenshotsUnchanged(plugin, previous);
    // תוסף שסונכרן לפני שה-manifestId נכנס לקטלוג — מחלצים אותו מהקובץ
    // הקיים בלי להוריד מחדש. קריאת ZIP מקומית, לא רשת.
    const needsManifestId = plugin.manifestId === null && keep.size > 0;

    return {
      plugin,
      previous,
      needsImage,
      needsScreenshots,
      missingBuilds: missing,
      // אין אף בילד תואם — לא כשל, אבל כן דבר שכדאי שיהיה ביומן.
      isIncompatible: targets.length === 0 && Boolean(plugin.remoteDownloadUrl),
      needsManifestId,
      get hasWork() {
        return this.needsImage || this.needsScreenshots ||
            this.missingBuilds.length > 0 || this.needsManifestId;
      },
    };
  }

  /**
   * מסנכרן את **מבנה** החנות — הקטגוריות המנוהלות והטקסטים של דף הבית.
   *
   * כשל כאן אינו מפיל את הסנכרון: המראה שומרת את המבנה הקודם (כך שגם
   * אתר ישן בלי הנתיבים האלה, או קריאה שנפלה, לא מוחקים קטגוריות שכבר
   * ירדו).
   */
  async #syncStructure(syncedIds, previous, report) {
    report({phase: SyncPhase.plugin, message: S.domain.syncCategories});

    let home;
    try {
      home = await this.client.fetchStoreHome();
    } catch (error) {
      report({
        phase: SyncPhase.warning,
        message: S.domain.syncStructureFailed(describeError(error)),
      });
      return makeStructure(previous.home, previous.categories);
    }

    const rawCategories = home.categories;
    const categories = [];
    if (Array.isArray(rawCategories)) {
      for (const raw of rawCategories) {
        if (raw === null || typeof raw !== 'object') continue;
        const summary = PluginStoreCategory.fromApi(raw);
        if (!summary.slug) continue;
        categories.push(
            await this.#categoryMembers(summary, syncedIds, previous, report));
      }
    }

    // תשובה תקינה אך חסרת מבנה (אתר ישן, שדה שהשתנה) אינה עילה למחוק את
    // מה שכבר במראה — אותו כלל בדיוק כמו בכשל הבקשה עצמה, למעלה.
    if (categories.length === 0 && previous.categories.length > 0) {
      report({
        phase: SyncPhase.warning,
        message: S.domain.syncStructureFailed(S.domain.syncStructureEmpty),
      });
      return makeStructure(previous.home, previous.categories);
    }

    const settings = home.settings;
    return makeStructure(
        PluginStoreHome.fromApi(
            settings !== null && typeof settings === 'object' ? settings : {}),
        categories);
  }

  /**
   * דף הבית מחזיר תוספים רק לקטגוריות שמסומנות להצגה בו, ולכן החברות
   * המלאה נשלפת תמיד מדף הקטגוריה עצמו.
   */
  async #categoryMembers(summary, syncedIds, previous, report) {
    let ids = summary.pluginIds;
    try {
      ids = PluginStoreCategory
          .fromApi(await this.client.fetchCategory(summary.slug))
          .pluginIds;
    } catch (error) {
      report({
        phase: SyncPhase.warning,
        message: S.domain.syncCategoryFailed(summary.name,
                                             describeError(error)),
      });
      const known = previous.categoryBySlug(summary.slug);
      if (known !== null) ids = known.pluginIds;
    }

    // תוסף שאינו בקטלוג שירד עכשיו (הוסר מהחנות, או שהסנכרון לא הגיע
    // אליו) לא נספר ולא מוצג בקטגוריה.
    return summary.copyWith({
      pluginIds: ids.filter((id) => syncedIds.has(id)),
    });
  }

  /** מוריד את מה שהתכנון סימן — התמונה וצילומי המסך, כל אחד בנפרד. */
  async #syncImages(plan, plugin, report) {
    let result = plugin;
    const dir = this.store.pluginDir(plugin.id);

    if (plan.needsImage) {
      try {
        const asset = await this.client.downloadAsset(
            plugin.remoteImageUrl, `${dir}\\image`);
        result = result.copyWith(
            {imagePath: this.store.relativePath(asset.path)});
      } catch (error) {
        report({
          phase: SyncPhase.warning,
          message: S.domain.syncImageFailed(plugin.name, describeError(error)),
        });
      }
    }

    if (plan.needsScreenshots) {
      const shotUrls = plugin.remoteScreenshotUrls;
      const shots = [];
      for (let i = 0; i < shotUrls.length; i++) {
        try {
          const asset = await this.client.downloadAsset(
              shotUrls[i], `${dir}\\screenshot-${i}`);
          shots.push(this.store.relativePath(asset.path));
        } catch (error) {
          report({
            phase: SyncPhase.warning,
            message: S.domain.syncScreenshotFailed(plugin.name,
                                                   describeError(error)),
          });
        }
      }
      if (shots.length > 0) result = result.copyWith({screenshotPaths: shots});
    }

    return result;
  }

  /**
   * אותה כתובת, אותו `updatedAt`, והקובץ עדיין על הדיסק. `updatedAt`
   * נדרש כי האתר יכול להחליף את תוכן התמונה מתחת לאותה כתובת.
   */
  async #imageUnchanged(plugin, previous) {
    return previous !== null &&
        sameSource(previous.remoteImageUrl, plugin.remoteImageUrl) &&
        previous.updatedAt === plugin.updatedAt &&
        await this.store.hasAsset(previous.imagePath);
  }

  async #screenshotsUnchanged(plugin, previous) {
    if (previous === null ||
        previous.updatedAt !== plugin.updatedAt ||
        !(previous.remoteScreenshotUrls.length === 0 ||
          sameUrls(previous.remoteScreenshotUrls,
                   plugin.remoteScreenshotUrls)) ||
        previous.screenshotPaths.length !==
            plugin.remoteScreenshotUrls.length) {
      return false;
    }
    // כולם או כלום: צילום אחד שנעלם מהדיסק מחזיר את כל הסדרה להורדה, כי
    // השמות נגזרים מהאינדקס ברשימה.
    for (const path of previous.screenshotPaths) {
      if (!await this.store.hasAsset(path)) return false;
    }
    return true;
  }

  /**
   * הבילד הזה כבר במראה: קובץ רשום לגרסה שלו, הקובץ עדיין על הדיסק,
   * והכתובת שממנה הוא ירד לא השתנתה מתחתיו.
   */
  async #buildUnchanged(target, plugin, previous) {
    if (!await this.store.hasFileFor(plugin, target.version)) return false;
    const known = previous?.versionEntries
        .find((entry) => entry.version === target.version) ?? null;
    return known === null ||
        sameSource(known.downloadUrl, target.downloadUrl);
  }

  /**
   * מוריד את הבילדים שהתכנון סימן — אחד לכל גרסת אוצריא שהכונן נושא
   * ושהבילד שלה עוד לא במראה. `ok: false` = לפחות אחד מהם נכשל.
   */
  async #syncPluginFiles(plan, plugin, report) {
    if (plan.missingBuilds.length === 0) {
      // קטלוג ישן בלי manifestId — מחלצים מקובץ שכבר במראה, בלי רשת.
      const known = plugin.anyLocalFile;
      if (plan.needsManifestId && known !== null) {
        const id = await readPluginManifestId(
            this.store.absolutePath(known.relativePath), this.io);
        if (id !== null) {
          return {plugin: plugin.copyWith({manifestId: id}), ok: true};
        }
      }
      return {plugin, ok: true};
    }

    const files = new Map(plugin.localFiles);
    let manifestId = plugin.manifestId;
    let ok = true;

    for (const target of plan.missingBuilds) {
      try {
        const asset = await this.client.downloadAsset(
            target.downloadUrl,
            this.store.pluginFilePathNoExt(plugin.id, target.version),
            '.otzplugin');
        files.set(target.version, new PluginLocalFile({
          relativePath: this.store.relativePath(asset.path),
          fileName: asset.originalName ?? `${plugin.name}${asset.ext}`,
          ext: asset.ext,
          size: asset.size,
        }));
        if (manifestId === null) {
          manifestId = await readPluginManifestId(asset.path, this.io);
        }
      } catch (error) {
        ok = false;
        report({
          phase: SyncPhase.warning,
          message: S.domain.syncPluginFileFailed(plugin.name,
                                                 describeError(error)),
        });
      }
    }

    // בילד שנכשל אינו נרשם, ולכן הסנכרון הבא ינסה אותו שוב. אבל אז גם
    // אין מה להתקין — ולכן בילד ישן שכבר יושב במראה נשאר בקטלוג במקום
    // להימחק ב-`pruneUnusedFiles`. עדיף בילד ישן שרץ מכלום.
    const previous = plan.previous;
    if (!ok && previous !== null) {
      for (const [version, file] of previous.localFiles) {
        if (files.has(version)) continue;
        if (await this.store.hasAsset(file.relativePath)) {
          files.set(version, file);
        }
      }
    }

    return {plugin: plugin.copyWith({localFiles: files, manifestId}), ok};
  }
}

/**
 * כתובת ריקה בצד הקודם היא **קטלוג ישן** שנכתב לפני שהשדה נוסף, לא
 * כתובת שהשתנתה. בלי החריג הזה הסנכרון הראשון אחרי העדכון היה מוריד את
 * כל תמונות החנות מחדש רק כדי למלא שדה — בדיוק ההתנהגות שבאנו לבטל.
 * `updatedAt` הוא מה שמכריע שם, והשדה נכתב לקטלוג גם בלי הורדה.
 */
function sameSource(previous, current) {
  return !previous || previous === current;
}

function sameUrls(a, b) {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    if (a[i] !== b[i]) return false;
  }
  return true;
}

/**
 * תוצאת סנכרון המבנה, ומהן נגזרת גם השיוך ההפוך (תוסף → ה-slugs שהוא
 * משובץ בהם) שנשמר על כל תוסף בקטלוג.
 */
function makeStructure(home, categories) {
  const slugsByPlugin = new Map();
  for (const category of categories) {
    for (const id of category.pluginIds) {
      const list = slugsByPlugin.get(id);
      if (list === undefined) slugsByPlugin.set(id, [category.slug]);
      else list.push(category.slug);
    }
  }
  return {
    home,
    categories,
    slugsOf: (pluginId) => slugsByPlugin.get(pluginId) ?? [],
  };
}
