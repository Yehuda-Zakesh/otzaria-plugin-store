// נקודת הכניסה היחידה שהממשק מדבר איתה. פורט של
// `packages/plugins_manager/lib/src/plugins_manager.dart`.
//
// שני מסלולים: **סנכרון** ([sync]) רץ במחשב שיש בו אינטרנט וממלא את
// המראה, ואילו **טעינה והתקנה** ([load], [install]) עובדות מול המראה
// בלבד ולכן פועלות במחשב לא-מקוון.

import {S} from '../strings.js';
import {InstalledPluginsScanner} from './installed_scanner.js';
import {PluginLocalFile, PluginCatalog} from './models.js';
import {PluginMirrorSync} from './mirror_sync.js';
import {PluginMirrorStore} from './mirror_store.js';
import {PluginOnlinePeek} from './online_peek.js';
import {PluginStoreClient, describeError} from './store_client.js';
import {readPluginManifestId} from './manifest_reader.js';

/** תוצאת ניסיון פעולה מול מערכת ההפעלה — מוחזרת כערך ולא כחריג. */
export const ok = () => ({success: true, error: null});
export const failure = (error) => ({success: false, error});

export class PluginsManager {
  /**
   * @param {{paths: object, fs: object, net: object, sys: object,
   *          env: object, otzariaLaunchPath: () => Promise<string|null>,
   *          baseUrl?: string}} options
   */
  constructor({paths, fs, net, sys, env, otzariaLaunchPath, baseUrl}) {
    this.fs = fs;
    this.sys = sys;
    this.env = env;
    this.otzariaLaunchPath = otzariaLaunchPath;

    this.client = new PluginStoreClient({baseUrl, net, fs});
    this.store = new PluginMirrorStore(paths, fs);
    /** לקריאת ה-manifest מתוך ה-ZIP — ראו `manifest_reader.js`. */
    this.io = {
      stat: (path) => fs.stat(path),
      readBase64: (path, offset, length) => fs.readBase64(path, offset, length),
    };
  }

  /**
   * קורא את הקטלוג המקומי וסורק את ההתקנה האמיתית. **לא נוגע ברשת** —
   * זו הפעולה שרצה בפתיחת המסך.
   */
  async load() {
    return {
      catalog: await this.store.load(),
      installed: await this.scanInstalled(),
      pluginsDir: this.store.pluginsDir,
    };
  }

  /**
   * סורק **רק** את ההתקנה של אוצריא, בלי לקרוא את הקטלוג. קיים בנפרד
   * כדי שהממשק יוכל לרענן את המפה אחרי שנתיב ההתקנה התברר — לפניו
   * הסריקה קראה תיקייה אחרת לגמרי.
   */
  async scanInstalled() {
    return await new InstalledPluginsScanner({
      fs: this.fs,
      env: this.env,
      otzariaLaunchPath: await this.otzariaLaunchPath(),
    }).scan();
  }

  /**
   * מסנכרן את הקטלוג והקבצים מהאתר אל המראה. דורש אינטרנט. מוריד
   * **רק** את מה שחסר או השתנה.
   */
  async sync({appVersions = [], onProgress, isCancelled} = {}) {
    const sync = new PluginMirrorSync({
      client: this.client,
      store: this.store,
      io: this.io,
    });
    return await sync.sync({appVersions, onProgress, isCancelled});
  }

  /**
   * בודק ברשת אם יש בחנות תוסף חדש או גרסה חדשה — **בקשה קלה אחת**,
   * בלי להוריד קובץ ובלי לגעת במראה. זורק כמו [sync] כשאין רשת;
   * המתקשר הוא שמחליט שזה מצב תקין.
   */
  async peekOnlineUpdates({appVersions = []} = {}) {
    return await new PluginOnlinePeek({
      client: this.client,
      store: this.store,
    }).peek({appVersions});
  }

  /** נתיב מוחלט לנכס שנשמר בקטלוג כנתיב יחסי, או null אם אין נכס. */
  assetPath(relativePath) {
    if (!relativePath) return null;
    return this.store.absolutePath(relativePath);
  }

  /** שם הקובץ המוצע לשמירה, לפי מה שהאתר החזיר ב-Content-Disposition. */
  suggestedFileName(plugin, appVersion, targetAppVersions = []) {
    const target = plugin.installTarget(appVersion, targetAppVersions);
    const local = plugin.localFileFor(target?.version) ?? plugin.anyLocalFile;
    return local?.fileName ?? `${plugin.name}${local?.ext ?? '.otzplugin'}`;
  }

  /** מעתיק את קובץ ה-.otzplugin ליעד שהמשתמש בחר. */
  async saveCopy(plugin, destPath, appVersion, targetAppVersions = []) {
    const target = plugin.installTarget(appVersion, targetAppVersions);
    const local = plugin.localFileFor(target?.version);
    if (local === null || !await this.store.hasAsset(local.relativePath)) {
      return failure(S.domain.fileNotAvailableSyncFirst);
    }
    try {
      await this.fs.copy(this.store.absolutePath(local.relativePath), destPath);
      return ok();
    } catch (error) {
      return failure(S.domain.saveFailed(describeError(error)));
    }
  }

  /**
   * מתקין את התוסף באוצריא דרך `otzaria://plugin/install-local`.
   *
   * **למה דווקא כך, ולא חילוץ ה-ZIP בעצמנו:** אוצריא מנהלת רישום פנימי
   * לתוספים המותקנים (מעבר לתיקיית `installed/`), ופרישה ידנית של
   * הארכיון עוקפת אותו. `install-local` קורא את הקובץ ישירות מהדיסק
   * ולכן עובד **בלי שום גישה לרשת** — זה בדיוק המסלול שהמחשב הלא-מקוון
   * צריך. (ה-`install?url=` הישן דורש אינטרנט ולכן אינו בשימוש.)
   *
   * אם קובץ התוסף חסר מהמראה הוא מורד עכשיו — וזה הצעד היחיד כאן שדורש
   * אינטרנט.
   */
  async install(plugin, appVersion, targetAppVersions = []) {
    const target = plugin.installTarget(appVersion, targetAppVersions);
    if (target === null) return failure(S.domain.noCompatibleBuild);

    let local = plugin.localFileFor(target.version);
    if (local === null || !await this.store.hasAsset(local.relativePath)) {
      local = await this.#fetchMissingFile(plugin, target);
      if (local === null) return failure(S.domain.pluginFileNotAvailable);
    }

    const pluginFilePath = this.store.absolutePath(local.relativePath);
    if (!await this.fs.fileExists(pluginFilePath)) {
      return failure(S.domain.localPluginFileMissing);
    }
    if (!pluginFilePath.toLowerCase().endsWith('.otzplugin')) {
      return failure(S.domain.badPluginExtension);
    }

    return await this.#openProtocolUrl(installLocalUrl(pluginFilePath));
  }

  /**
   * מוסר את ה-URL לאוצריא.
   *
   * ⚠️ כשידוע נתיב ההתקנה, ה-URL נמסר **לקובץ ההרצה עצמו** ולא למערכת
   * ההפעלה — בדיוק מה שהרישום ברג'יסטרי היה עושה
   * (`"otzaria.exe" "%1"`). התקנה **ניידת** אינה רושמת את הסכימה
   * `otzaria://` בכלל, ולכן בלי זה ההתקנה שם נכשלה ב"ודא שאוצריא
   * מותקנת".
   */
  async #openProtocolUrl(url) {
    try {
      const launchPath = await this.otzariaLaunchPath();
      // נתיב שכבר לא קיים (אוצריא נמחקה/הכונן נותק מאז הזיהוי) נופל
      // חזרה למטפל הפרוטוקול של מערכת ההפעלה.
      if (launchPath && await this.fs.fileExists(launchPath)) {
        await this.sys.launch(launchPath, url);
        return ok();
      }
      await this.sys.openUrl(url);
      return ok();
    } catch (error) {
      return failure(S.domain.otzariaOpenFailed(describeError(error)));
    }
  }

  /** מוריד בילד חסר ומעדכן את הקטלוג. מחזיר null אם לא הצליח. */
  async #fetchMissingFile(plugin, target) {
    if (!target.downloadUrl) return null;

    try {
      await this.fs.mkdirs(this.store.pluginDir(plugin.id));
      const asset = await this.client.downloadAsset(
          target.downloadUrl,
          this.store.pluginFilePathNoExt(plugin.id, target.version),
          '.otzplugin');

      const file = new PluginLocalFile({
        relativePath: this.store.relativePath(asset.path),
        fileName: asset.originalName ?? `${plugin.name}${asset.ext}`,
        ext: asset.ext,
        size: asset.size,
      });

      const localFiles = new Map(plugin.localFiles);
      localFiles.set(target.version, file);
      const manifestId = plugin.manifestId ??
          await readPluginManifestId(asset.path, this.io);
      const updated = plugin.copyWith({localFiles, manifestId});

      // ⚠️ הקטגוריות וטקסטי דף הבית **חייבים** לנסוע איתם: בלעדיהם
      // השמירה הזאת מוחקת את כל מבנה החנות מהמראה בגלל הורדה של קובץ
      // בודד.
      const catalog = await this.store.load();
      await this.store.save(new PluginCatalog({
        lastSync: catalog.lastSync,
        home: catalog.home,
        categories: catalog.categories,
        plugins: catalog.plugins.map(
            (p) => p.id === updated.id ? updated : p),
      }));

      return file;
    } catch {
      return null;
    }
  }

  /** פותח כתובת חיצונית (דף הבית של תוסף) בדפדפן. */
  async openExternalUrl(url) {
    try {
      await this.sys.openUrl(url);
      return ok();
    } catch (error) {
      return failure(describeError(error));
    }
  }
}

/**
 * ה-URL שנמסר למערכת ההפעלה. חשוף בנפרד כדי שבדיקות יאמתו אותו בלי
 * להפעיל מטפל פרוטוקול אמיתי.
 */
export function installLocalUrl(pluginFilePath) {
  return 'otzaria://plugin/install-local?path=' +
      encodeURIComponent(pluginFilePath);
}
