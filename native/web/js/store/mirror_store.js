// שכבת האחסון של החנות בתוך תיקיית הנתונים.
// פורט של
// `packages/plugins_manager/lib/src/services/plugin_mirror_store.dart`.
//
// ── המבנה, ומה השתנה ─────────────────────────────────────────────────────────
// בגרסת ה-Flutter הקטלוג ישב תחת `<mirrorDir>/plugins/`, כשכן של מראת
// הספרייה ומראת התוכנה — כי הלאנצ'ר נשא את שלושתן. החנות העצמאית נושאת
// רק את עצמה, ולכן המבנה כאן שטוח:
//
//   Data\catalog.json
//   Data\plugins\<pluginId>\{image.*, screenshot-N.*, plugin-<version>.otzplugin}
//
// **קובץ לכל בילד**, כי המראה נבנית עבור עד שתי גרסאות של אוצריא (ראו
// `otzaria_release_client.js`) ולכל אחת עשוי להתאים בילד אחר של אותו תוסף. `plugin.otzplugin` בלי גרסה הוא השם הישן
// ונשאר קריא — ראו `StorePlugin.fromJson`.
//
// כל הנתיבים בקטלוג נשמרים **יחסית** ל-`plugins\`, כדי שהמראה תעבוד גם
// כשהיא נפתחת מאות כונן אחרת.

import {PluginCatalog} from './models.js';

export class PluginMirrorStore {
  /**
   * @param {{dataDir: string, pluginsDir: string, catalogPath: string}} paths
   * @param {object} fs שכבת הקבצים של הגשר
   */
  constructor(paths, fs) {
    this.dataDir = paths.dataDir;
    this.pluginsDir = paths.pluginsDir;
    this.catalogPath = paths.catalogPath;
    this.fs = fs;
  }

  pluginDir(pluginId) {
    return `${this.pluginsDir}\\${pluginId}`;
  }

  /** נתיב מוחלט לנכס שנשמר בקטלוג כנתיב יחסי. */
  absolutePath(relativePath) {
    return PluginMirrorStore.resolveAgainst(this.pluginsDir, relativePath);
  }

  /**
   * הנתיב היחסי שיש לשמור בקטלוג עבור קובץ מוחלט שירד. **תמיד עם `/`**,
   * כדי שקטלוג שנכתב בווינדוס ייקרא נכון גם אם ייפתח במערכת אחרת.
   */
  relativePath(absolutePath) {
    const root = this.pluginsDir.replace(/[\\/]+$/, '');
    let relative = absolutePath;
    if (relative.toLowerCase().startsWith(root.toLowerCase())) {
      relative = relative.slice(root.length);
    }
    return relative.replace(/\\/g, '/').replace(/^\/+/, '');
  }

  /**
   * מרכיב נתיב מוחלט מנתיב יחסי בסגנון POSIX שנשמר בקטלוג. חשוף כ-static
   * כדי שגם שכבת ה-UI תוכל לבנות נתיבי תמונות בלי לגשת לדיסק.
   */
  static resolveAgainst(root, relativePath) {
    const parts = String(relativePath).split('/').filter((s) => s.length > 0);
    return [root.replace(/[\\/]+$/, ''), ...parts].join('\\');
  }

  async ensureDirs() {
    await this.fs.mkdirs(this.pluginsDir);
  }

  /**
   * קורא את הקטלוג. קובץ חסר או פגום מחזיר קטלוג ריק — זה המצב התקין
   * לפני הסנכרון הראשון.
   */
  async load() {
    try {
      if (!await this.fs.fileExists(this.catalogPath)) {
        return PluginCatalog.empty;
      }
      const decoded = JSON.parse(await this.fs.readText(this.catalogPath));
      if (decoded === null || typeof decoded !== 'object' ||
          Array.isArray(decoded)) {
        return PluginCatalog.empty;
      }
      return PluginCatalog.fromJson(decoded);
    } catch {
      return PluginCatalog.empty;
    }
  }

  /**
   * כתיבה **אטומית** (קובץ זמני + החלפה) — כדי שניתוק באמצע כתיבה לא
   * ישאיר קטלוג חצי-כתוב. האטומיות ממומשת בצד ה-host
   * (`fsapi::WriteTextAtomic`).
   */
  async save(catalog) {
    await this.ensureDirs();
    await this.fs.writeText(this.catalogPath,
                            JSON.stringify(catalog.toJSON(), null, 2));
  }

  /** האם הנכס שנשמר בקטלוג קיים בפועל על הדיסק. */
  async hasAsset(relativePath) {
    if (!relativePath) return false;
    return await this.fs.fileExists(this.absolutePath(relativePath));
  }

  /** האם הקובץ של בילד מסוים קיים בפועל על הדיסק. */
  async hasFileFor(plugin, version) {
    const local = plugin.localFileFor(version);
    return local === null ? false : await this.hasAsset(local.relativePath);
  }

  /**
   * שם הקובץ (בלי סיומת) של בילד מסוים בתוך תיקיית התוסף. הגרסה נכנסת
   * לשם כדי ששני בילדים של אותו תוסף יוכלו לשכון זה לצד זה.
   */
  pluginFilePathNoExt(pluginId, version) {
    return `${this.pluginDir(pluginId)}\\plugin-` +
        PluginMirrorStore.sanitizeVersion(version);
  }

  /**
   * גרסאות תוסף הן semver ולכן בטוחות לשמות קבצים, אבל שם קובץ נבנה כאן
   * מנתון שמגיע מהרשת — כל מה שאינו אות/ספרה/`.`/`-`/`+`/`_` מוחלף.
   */
  static sanitizeVersion(version) {
    return String(version).replace(/[^A-Za-z0-9.+_-]/g, '_');
  }

  /**
   * מוחק קובצי בילד שכבר אינם בקטלוג — כשגרסת היעד של אוצריא זזה, הבילד
   * שהתאים לקודמת אינו נחוץ עוד, וכונן נייד אינו המקום לצבור אותם.
   * מחזיר כמה נמחקו.
   */
  async pruneUnusedFiles(plugin) {
    const dir = this.pluginDir(plugin.id);
    if (!await this.fs.dirExists(dir)) return 0;

    const keep = new Set();
    for (const file of plugin.localFiles.values()) {
      keep.add(this.absolutePath(file.relativePath).toLowerCase());
    }

    let removed = 0;
    const entries = await this.fs.list(dir);
    for (const entry of entries) {
      if (entry.dir) continue;
      const name = entry.name.toLowerCase();
      if (!name.startsWith('plugin')) continue;
      const full = `${dir}\\${entry.name}`;
      if (keep.has(full.toLowerCase())) continue;
      try {
        await this.fs.remove(full);
        removed++;
      } catch {
        // קובץ נעול (אנטי-וירוס, העתקה שרצה) — לא סיבה להפיל סנכרון.
      }
    }
    return removed;
  }
}
