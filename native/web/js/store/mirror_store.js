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

// ── בטיחות נתיבים ────────────────────────────────────────────────────────────
// שני כללים, ושניהם נשענים על `DOT_SEGMENT`:
//
//   • **בכתיבה** (`sanitizeId`, `sanitizeVersion`) — שם שמגיע מהאתר נכנס
//     לשם קובץ או תיקייה, ולכן הוא מסונן: כל מה שאינו אות/ספרה/`.`/`-`/
//     `+`/`_` מוחלף.
//   • **בקריאה** (`resolveAgainst`) — נתיב שנקרא מהקטלוג **נפסל** ולא
//     מסונן. קטלוג שנפגם או נערך ביד הוא המצב היחיד שבו נתיב כזה מגיע
//     לכאן, וזה מצב שהקורא חייב לדעת עליו.
//
// ⚠️ הסינון של הכתיבה אינו מוחל על הקריאה בכוונה: מראה שנכתבה ע"י גרסה
// ותיקה (לפני `sanitizeId`) עשויה לשאת תיקייה בשם שאינו ASCII, והיא
// חייבת להמשיך להיקרא. מה שנפסל הוא **יציאה מהמראה**, לא תו לא-שגרתי.

/** מקטע נתיב שהוא התיקייה עצמה או ההורה שלה. */
const DOT_SEGMENT = /^\.+$/;

/** תו שאינו מותר בשם שנבנה מנתון שהגיע מהרשת. */
const UNSAFE_NAME_CHARS = /[^A-Za-z0-9.+_-]/g;

/** נתיב מוחלט: אות כונן, שורש, או UNC. */
const ABSOLUTE_PATH = /^(?:[A-Za-z]:|[\\/])/;

/**
 * שמות הנכסים שהסנכרון **עצמו** יוצר בתיקיית התוסף — ורק הם מועמדים
 * למחיקה ב-`pruneUnusedFiles`. ראו `PluginMirrorSync.#syncImages`
 * ו-`pluginFilePathNoExt`.
 */
const OUR_ASSET_NAME = /^(?:plugin|image|screenshot-)/i;

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
    return `${this.pluginsDir}\\${PluginMirrorStore.sanitizeId(pluginId)}`;
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
   *
   * ⚠️ **זורק על נתיב שיוצא מ-[root].** הפיצול היה על `/` בלבד וסינן רק
   * מקטעים ריקים, ולכן `../../outside/x` נפתר מחוץ למראה, ו-`..\..\x`
   * שרד בכלל כמקטע **אחד** שמכיל מפרידים. `saveCopy` ו-`install` שניהם
   * צורכים את התוצאה, כך שקטלוג פגום או שנערך ביד יכול היה להצביע על
   * קובץ כלשהו בכונן.
   *
   * הכשל **רועש ולא מוצמד לגבול**: נתיב כזה אינו טעות שאפשר לתקן בשקט
   * אלא סימן שהקטלוג פגום, והקוראים כאן (`hasAsset`, `assetPath`) יודעים
   * להתייחס לזה כ"הנכס אינו זמין".
   */
  static resolveAgainst(root, relativePath) {
    const text = String(relativePath);
    if (ABSOLUTE_PATH.test(text)) {
      throw new Error(`נתיב מוחלט בקטלוג המראה: ${text}`);
    }

    // שני המפרידים: הקטלוג נכתב עם `/`, אבל מראה ותיקה או עריכה ידנית
    // עשויות לשאת `\` — ופיצול על `/` לבדו השאיר אותו בתוך המקטע.
    const parts = text.split(/[\\/]+/).filter((s) => s.length > 0);
    if (parts.length === 0) {
      throw new Error('נתיב ריק בקטלוג המראה');
    }
    for (const part of parts) {
      if (DOT_SEGMENT.test(part)) {
        throw new Error(`נתיב שיוצא מתיקיית התוספים: ${text}`);
      }
    }

    return [String(root).replace(/[\\/]+$/, ''), ...parts].join('\\');
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

  /**
   * האם הנכס שנשמר בקטלוג קיים בפועל על הדיסק.
   *
   * ⚠️ כשל בקריאת הדיסק (הרשאה, כונן שנותק באמצע) נענה ב-`false` ולא
   * בחריג: השאלה היחידה שנשאלת כאן היא "אפשר לדלג על ההורדה?", והתשובה
   * הבטוחה כשאי אפשר לדעת היא "לא". הפונקציה הזאת נקראת מתוך שלב
   * ה**תכנון** של הסנכרון, שרץ לפני שנשמר משהו — חריג ממנה הפיל את
   * הסנכרון כולו לפני שהקטלוג נכתב.
   */
  async hasAsset(relativePath) {
    if (!relativePath) return false;
    try {
      return await this.fs.fileExists(this.absolutePath(relativePath));
    } catch {
      return false;
    }
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
    return String(version).replace(UNSAFE_NAME_CHARS, '_');
  }

  /**
   * מזהה התוסף נכנס לשם **תיקייה**, והוא מגיע מהאתר בדיוק כמו הגרסה —
   * ולכן הוא עובר את אותו סינון בדיוק.
   *
   * ⚠️ שתי צורות שהסינון של הגרסה לבדו אינו תופס, ושתיהן מוציאות את
   * ההורדה מ-`plugins\` החוצה:
   *
   *   • `.` ו-`..` — התיקייה עצמה וההורה שלה. אלה אינם תווים אסורים,
   *     ולכן הם שורדים את ההחלפה ומחייבים טיפול נפרד.
   *   • מזהה **ריק** (רשומה שהגיעה מהאתר בלי `id`), שהיה הופך את
   *     `pluginDir` לשורש `plugins\` עצמו — וההורדות היו נוחתות שם לצד
   *     הקטלוג. `PluginMirrorSync` מדלג על רשומות כאלה מלכתחילה, וזו
   *     הרשת השנייה.
   */
  static sanitizeId(pluginId) {
    const safe = String(pluginId).replace(UNSAFE_NAME_CHARS, '_');
    if (safe.length === 0) return '_';
    return DOT_SEGMENT.test(safe) ? '_'.repeat(safe.length) : safe;
  }

  /**
   * מוחק נכסים שכבר אינם בקטלוג — כשגרסת היעד של אוצריא זזה, הבילד
   * שהתאים לקודמת אינו נחוץ עוד, וכונן נייד אינו המקום לצבור אותם.
   * מחזיר כמה נמחקו.
   *
   * ⚠️ **גם התמונה וצילומי המסך, ולא רק הבילדים.** האתר יכול להסיר תמונה
   * או לקצר את רשימת הצילומים, והקבצים שהמראה כבר לא מפנה אליהם נשארו
   * על הכונן לנצח — `screenshot-3.png` ו-`screenshot-4.png` של רשימה
   * שהתכווצה לשלושה.
   *
   * נמחק **רק** מה שהסנכרון עצמו יוצר (`plugin*`, `image*`,
   * `screenshot-*`) ואינו מוזכר בקטלוג. קובץ שמישהו הניח בתיקייה אינו
   * שלנו, ולכן אינו נוגע לנו.
   *
   * תיקייה שנותרה **ריקה לגמרי** אחרי המחיקה נמחקת גם היא — ראו
   * `#removeIfEmpty`.
   */
  async pruneUnusedFiles(plugin) {
    const dir = this.pluginDir(plugin.id);
    if (!await this.fs.dirExists(dir)) return 0;

    const keep = new Set();
    const remember = (relativePath) => {
      if (!relativePath) return;
      try {
        keep.add(this.absolutePath(relativePath).toLowerCase());
      } catch {
        // נתיב פגום בקטלוג אינו מגן על קובץ, אבל גם אינו מפיל ניקוי.
      }
    };
    for (const file of plugin.localFiles.values()) remember(file.relativePath);
    remember(plugin.imagePath);
    for (const path of plugin.screenshotPaths) remember(path);

    let removed = 0;
    const entries = await this.fs.list(dir);
    for (const entry of entries) {
      if (entry.dir) continue;
      if (!OUR_ASSET_NAME.test(entry.name)) continue;
      const full = `${dir}\\${entry.name}`;
      if (keep.has(full.toLowerCase())) continue;
      try {
        await this.fs.remove(full);
        removed++;
      } catch {
        // קובץ נעול (אנטי-וירוס, העתקה שרצה) — לא סיבה להפיל סנכרון.
      }
    }

    if (removed > 0) await this.#removeIfEmpty(dir);
    return removed;
  }

  /**
   * מוחק את תיקיית התוסף אם **לא נשאר בה כלום**.
   *
   * ⚠️ **למה זה נחוץ:** תיקייה ריקה אינה שורדת את סבב האריזה-ופרישה של
   * החבילה היומית (ארכיון אינו נושא תיקיות ריקות), ולכן `diff -r` שמאמת
   * את הפרישה מול המקור נכשל והבנייה נופלת — על תיקייה שאין בה דבר.
   *
   * ⚠️ **הבדיקה היא רשימה חדשה מהדיסק, לא חשבון של מה שנמחק.** הספירה
   * שלנו אינה יודעת על תמונה, על צילום מסך, על בילד שעדיין מוחזק
   * בקטלוג, על `.part` משיטוט קודם או על קובץ שהמחיקה שלו נכשלה — וכל
   * אחד מהם הופך את המחיקה כאן להרסנית. תיקייה נמחקת רק כשהרשימה
   * המחודשת חוזרת **ריקה לחלוטין**, כולל תת-תיקיות.
   */
  async #removeIfEmpty(dir) {
    try {
      const left = await this.fs.list(dir);
      if (left.length > 0) return;
      // ה-host מוחק **קבצים** (`DeleteFileW`); מחיקת תיקייה היא יכולת
      // נפרדת, ומראה שנפרסה ע"י host ישן פשוט לא תנקה אותה.
      await this.fs.removeDir?.(dir);
    } catch {
      // תיקייה נעולה, או host בלי `removeDir` — שארית ריקה אינה סיבה
      // להפיל סנכרון שהצליח.
    }
  }
}
