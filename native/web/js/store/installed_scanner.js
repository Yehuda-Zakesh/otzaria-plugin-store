// סורק את התוספים שאוצריא כבר התקינה במחשב הזה. פורט של
// `packages/plugins_manager/lib/src/services/installed_plugins_scanner.dart`.
//
// המבנה של אוצריא:
// `<pluginsDir>/installed/<manifestId>/<הוצאה>/manifest.json`,
// וה-`version` שבתוכו הוא הגרסה המותקנת בפועל. תיקיית ההוצאה היא
// `current` בהתקנות הישנות ו-`.release-<hash>` בחדשות — **שתיהן**
// נסרקות, אחרת כל תוסף שהותקן במבנה החדש נראה כלא-מותקן.
//
// הנתיב **מתגלה ולא מונח כקבוע**: קודם נתיב שנמסר במפורש, אחר כך
// ההתקנה שזוהתה (התקנה ניידת שומרת את הנתונים לידה ולא ב-`%APPDATA%`),
// ולבסוף ברירת המחדל של הפלטפורמה. תיקייה שלא קיימת מחזירה מפה ריקה
// בשקט — זה המצב התקין כשאוצריא לא מותקנת או שאין עדיין תוספים.

/** שם תיקיית המשנה שאוצריא מתקינה לתוכה כל תוסף. */
export const INSTALLED_DIR_NAME = 'installed';

/** תיקיות ההוצאה — המבנה הישן והחדש. */
const CURRENT_DIR_NAME = 'current';
const RELEASE_DIR_PREFIX = '.release-';

/**
 * סימון ההתקנה הניידת של אוצריא, ליד ה-executable שלה, ותיקיית הנתונים
 * שהוא מפעיל. **חייבים להישאר תואמים ל-`LibraryDbLocator`** של אוצריא —
 * אותו זיהוי בדיוק.
 */
const PORTABLE_MARKER_FILE_NAME = 'portable.marker';
const PORTABLE_DATA_FOLDER_NAME = 'otzaria_data';

const dirNameOf = (path) => {
  const cut = path.replace(/[\\/]+$/, '').lastIndexOf('\\');
  return cut < 0 ? path : path.slice(0, cut);
};

const baseNameOf = (path) => {
  const trimmed = path.replace(/[\\/]+$/, '');
  const cut = trimmed.lastIndexOf('\\');
  return cut < 0 ? trimmed : trimmed.slice(cut + 1);
};

export class InstalledPluginsScanner {
  /**
   * @param {{fs: object, env: {appData?: string, programData?: string},
   *          customPluginsDir?: string|null,
   *          otzariaLaunchPath?: string|null}} options
   */
  constructor({fs, env, customPluginsDir = null, otzariaLaunchPath = null}) {
    this.fs = fs;
    this.env = env;
    this.customPluginsDir = customPluginsDir;
    this.otzariaLaunchPath = otzariaLaunchPath;
  }

  /** מחזיר `Map<manifestId, גרסה מותקנת>`. */
  async scan() {
    const root = await this.resolveInstalledDir();
    if (root === null) return new Map();
    if (!await this.fs.dirExists(root)) return new Map();

    const result = new Map();
    const entries = await this.fs.list(root);
    for (const entry of entries) {
      if (!entry.dir) continue;
      const version = await this.#readInstalledVersion(`${root}\\${entry.name}`);
      if (version !== null) result.set(entry.name, version);
    }
    return result;
  }

  /**
   * תיקיית ה-`installed` שתיסרק בפועל, או null אם אי אפשר לגזור אותה.
   */
  async resolveInstalledDir() {
    const plugins = await this.resolvePluginsDir();
    if (plugins === null) return null;
    // מי שמוסר נתיב יכול להצביע על `plugins` או ישירות על
    // `plugins\installed`.
    return baseNameOf(plugins).toLowerCase() === INSTALLED_DIR_NAME
        ? plugins
        : `${plugins}\\${INSTALLED_DIR_NAME}`;
  }

  /** תיקיית ה-`plugins` של אוצריא, לפי סדר העדיפות שבתיאור המודול. */
  async resolvePluginsDir() {
    if (this.customPluginsDir) return this.customPluginsDir;

    const portable = await this.portablePluginsDir(this.otzariaLaunchPath);
    if (portable !== null) return portable;

    const candidates = this.defaultPluginsDirs();
    for (const dir of candidates) {
      if (await this.fs.dirExists(`${dir}\\${INSTALLED_DIR_NAME}`)) return dir;
    }
    return candidates.length === 0 ? null : candidates[0];
  }

  /**
   * תיקיית התוספים של התקנה **ניידת** — `<exeDir>\otzaria_data\plugins` —
   * או null כשההתקנה שזוהתה אינה ניידת.
   *
   * הסימון הוא התנאי; תיקיית נתונים קיימת לצד קובץ ההרצה מתקבלת גם
   * בלעדיו, כדי שהתקנה שהסימון שלה נמחק לא תיפול חזרה ל-`%APPDATA%` של
   * מחשב אחר לגמרי.
   */
  async portablePluginsDir(launchPath) {
    if (!launchPath) return null;
    const exeDir = dirNameOf(launchPath);
    const plugins = `${exeDir}\\${PORTABLE_DATA_FOLDER_NAME}\\plugins`;
    if (await this.fs.fileExists(`${exeDir}\\${PORTABLE_MARKER_FILE_NAME}`) ||
        await this.fs.dirExists(`${plugins}\\${INSTALLED_DIR_NAME}`)) {
      return plugins;
    }
    return null;
  }

  /**
   * שורשי הנתונים של אוצריא, לפי סדר עדיפות — התקנה למשתמש הנוכחי לפני
   * התקנה מערכתית.
   */
  defaultPluginsDirs() {
    const dirs = [];
    if (this.env.appData) {
      dirs.push(`${this.env.appData}\\otzaria\\plugins`);
    }
    if (this.env.programData) {
      dirs.push(`${this.env.programData}\\otzaria\\plugins`);
    }
    return dirs;
  }

  /** הגרסה המותקנת של תוסף אחד — מתוך תיקיית ההוצאה הפעילה שלו. */
  async #readInstalledVersion(pluginDir) {
    for (const dir of await this.#releaseDirs(pluginDir)) {
      const version = await this.#versionIn(dir);
      if (version !== null) return version;
    }
    return null;
  }

  /**
   * תיקיות ההוצאה של תוסף, בסדר עדיפות. `current` קודמת כי היא המצביע
   * המפורש של המבנה הישן; אחריה `.release-<hash>` מהחדשה לישנה, כי זו
   * שאוצריא כתבה אחרונה היא הפעילה.
   */
  async #releaseDirs(pluginDir) {
    const result = [];
    const current = `${pluginDir}\\${CURRENT_DIR_NAME}`;
    if (await this.fs.dirExists(current)) result.push(current);

    let entries;
    try {
      entries = await this.fs.list(pluginDir);
    } catch {
      return result; // תיקייה שאי אפשר לקרוא — מה שנמצא עד כה
    }

    const releases = entries.filter(
        (entry) => entry.dir && entry.name.startsWith(RELEASE_DIR_PREFIX));
    // מיון משני לפי השם, כדי ששתי הוצאות באותה חותמת זמן ייבחרו בקביעות.
    releases.sort((a, b) => {
      const byTime = (b.modified ?? 0) - (a.modified ?? 0);
      return byTime !== 0 ? byTime : b.name.localeCompare(a.name);
    });
    for (const entry of releases) result.push(`${pluginDir}\\${entry.name}`);
    return result;
  }

  async #versionIn(releaseDir) {
    try {
      const path = `${releaseDir}\\manifest.json`;
      if (!await this.fs.fileExists(path)) return null;
      const decoded = JSON.parse(
          (await this.fs.readText(path)).replace(/^﻿/, ''));
      if (decoded === null || typeof decoded !== 'object') return null;
      const version = decoded.version;
      return typeof version === 'string' && version.length > 0 ? version : null;
    } catch {
      return null; // מניפסט פגום — מתעלמים בשקט מההוצאה הזו
    }
  }
}
