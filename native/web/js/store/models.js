// המודלים של החנות — פורט של `packages/plugins_manager/lib/src/models/`.
//
// שני היצרנים שקוראים נתונים מבחוץ (`fromApi` מהאתר, `fromJson` מהקטלוג
// השמור) מסדרים בעצמם את רשימת הבילדים בסדר יורד: **ההכרעה נשענת על
// הסדר**, ואין לסמוך על מה שהאתר החזיר.

import {
  isCompatibleWithApp,
  lowestSupportedAppVersion,
  resolveCompatibleVersion,
  resolveTargets,
} from './compatibility.js';
import {absoluteUrl} from './net_headers.js';
import {comparePluginVersions} from '../util/version.js';

// ── מצב התוסף מול ההתקנה בפועל ───────────────────────────────────────────────
//
// `unknown` אינו "שגיאה": הוא המצב התקין של תוסף שקובץ ה-.otzplugin שלו
// עוד לא ירד, ולכן ה-manifestId שלו טרם חולץ ואי אפשר להשוות אותו לכלום.
//
// `incompatible` גם הוא מצב תקין: לתוסף אין אף בילד שירוץ על גרסת אוצריא
// שבמחשב — בדרך כלל כי הוא דורש גרסה חדשה יותר.
export const InstallStatus = Object.freeze({
  notInstalled: 'notInstalled',
  upToDate: 'upToDate',
  updateAvailable: 'updateAvailable',
  unknown: 'unknown',
  incompatible: 'incompatible',
});

// ── עזרי קריאה סובלנית ───────────────────────────────────────────────────────
// שדה חסר או פגום נופל לברירת המחדל שלו, כדי שקטלוג שנפגם חלקית לא יאבד
// את כל התוספים.

const str = (value) => typeof value === 'string' ? value : '';
const int = (value) => Number.isInteger(value) ? value : 0;
/** `ratingAvg` חוזר מהאתר כשלם כשאין לו שבר (`5` ולא `5.0`). */
const num = (value) => typeof value === 'number' && Number.isFinite(value)
    ? value : 0;
const strList = (value) =>
    Array.isArray(value) ? value.filter((v) => typeof v === 'string') : [];
const nonEmptyStr = (value) =>
    typeof value === 'string' && value.length > 0 ? value : null;

/** תמיד חמישה מספרים — פילוח קטוע היה מפיל את שורות הפירוט בדף התוסף. */
function breakdown(value) {
  if (!Array.isArray(value)) return [0, 0, 0, 0, 0];
  const out = [];
  for (let i = 0; i < 5; i++) {
    out.push(i < value.length && Number.isInteger(value[i]) ? value[i] : 0);
  }
  return out;
}

// ── קובץ ה-.otzplugin כפי שהוא יושב במראה ────────────────────────────────────

export class PluginLocalFile {
  constructor({relativePath, fileName, ext, size}) {
    /**
     * יחסי לשורש תיקיית התוספים במראה — כך שהעתקת התיקייה לכונן אחר
     * (או לאות כונן אחרת ב-USB) לא שוברת את הקטלוג.
     */
    this.relativePath = relativePath;
    this.fileName = fileName;
    this.ext = ext;
    this.size = size;
  }

  toJSON() {
    return {
      path: this.relativePath,
      fileName: this.fileName,
      ext: this.ext,
      size: this.size,
    };
  }

  static fromJson(json) {
    if (json === null || typeof json !== 'object') return null;
    const path = json.path;
    if (typeof path !== 'string' || path.length === 0) return null;
    return new PluginLocalFile({
      relativePath: path,
      fileName: typeof json.fileName === 'string' ? json.fileName : path,
      ext: str(json.ext),
      size: int(json.size),
    });
  }
}

// ── בילד אחד של תוסף ─────────────────────────────────────────────────────────

/**
 * הגרסה החיה או אחת מההיסטוריות, עם **טווח התאימות שלה לגרסת אוצריא**.
 * זהו הנתון שמאפשר להוריד למחשב המנותק את הבילד שבאמת ירוץ אצלו, ולא את
 * האחרון שפורסם.
 *
 * `compatibleWith` הוא גרסת אוצריא המינימלית ו-`maxAppVersion` המקסימלית;
 * שדה ריק פירושו גבול פתוח (ראו `isCompatibleWithApp`).
 */
export class PluginVersionEntry {
  constructor(fields) {
    this.version = fields.version;
    /** `stable` / `beta` / `experimental` — בשלות הבילד. */
    this.status = fields.status ?? '';
    /** גרסת אוצריא המינימלית. ריק = אין רצפה. */
    this.compatibleWith = fields.compatibleWith ?? '';
    /** גרסת אוצריא המקסימלית. `null` = אין תקרה. */
    this.maxAppVersion = fields.maxAppVersion ?? null;
    /** כתובת מוחלטת לקובץ ה-.otzplugin של הבילד הזה בדיוק. */
    this.downloadUrl = fields.downloadUrl ?? '';
    this.requiresNetwork = fields.requiresNetwork ?? false;
    this.fileSize = fields.fileSize ?? 0;
    this.releasedAt = fields.releasedAt ?? '';
    this.supportsDirectInstall = fields.supportsDirectInstall ?? true;
    /** זו הגרסה החיה של התוסף באתר. */
    this.isLatest = fields.isLatest ?? false;
  }

  /** בונה רשומה מתוך `versions[]` של `/api/plugins`. */
  static fromApi(json, baseUrl) {
    if (json === null || typeof json !== 'object') return null;
    const version = str(json.version);
    if (version.length === 0) return null;
    return new PluginVersionEntry({
      version,
      status: str(json.status),
      compatibleWith: str(json.compatibleWith),
      maxAppVersion: nonEmptyStr(json.maxAppVersion),
      downloadUrl: absoluteUrl(str(json.downloadUrl), baseUrl),
      requiresNetwork: json.requiresNetwork === true,
      fileSize: int(json.pluginFileSize),
      releasedAt: str(json.releasedAt),
      // ברירת המחדל היא true — רק `false` מפורש מכבה.
      supportsDirectInstall: json.supportsDirectInstall !== false,
      isLatest: json.isLatest === true,
    });
  }

  /** קריאה מהקטלוג השמור. הכתובת כבר מוחלטת שם, ולכן אין baseUrl. */
  static fromJson(json) {
    return PluginVersionEntry.fromApi(json, '');
  }

  toJSON() {
    return {
      version: this.version,
      status: this.status,
      compatibleWith: this.compatibleWith,
      maxAppVersion: this.maxAppVersion,
      downloadUrl: this.downloadUrl,
      requiresNetwork: this.requiresNetwork,
      pluginFileSize: this.fileSize,
      releasedAt: this.releasedAt,
      supportsDirectInstall: this.supportsDirectInstall,
      isLatest: this.isLatest,
    };
  }
}

/**
 * מיון יורד **יציב**: האתר כבר מחזיר ממוין, אבל ההכרעה נשענת על הסדר
 * ולכן אינה סומכת עליו. שוויון שומר על סדר המקור.
 */
function sortedDescending(entries) {
  return entries
      .map((entry, index) => ({entry, index}))
      .sort((a, b) => {
        const byVersion = comparePluginVersions(b.entry.version,
                                                a.entry.version);
        return byVersion !== 0 ? byVersion : a.index - b.index;
      })
      .map((pair) => pair.entry);
}

function versionsFrom(value, baseUrl) {
  if (!Array.isArray(value)) return [];
  const out = [];
  for (const raw of value) {
    const entry = PluginVersionEntry.fromApi(raw, baseUrl);
    if (entry !== null) out.push(entry);
  }
  return out;
}

// ── תוסף בקטלוג המקומי ───────────────────────────────────────────────────────

/**
 * מיזוג של המטא-דאטה מ-`/api/plugins` עם הנתיבים היחסיים של הקבצים
 * שירדו למראה.
 *
 * **הקבצים הם מפה, לא קובץ אחד** (`localFiles`): המראה נבנית עבור עד שתי
 * גרסאות של אוצריא, ולכל אחת עשוי להתאים בילד אחר של אותו תוסף.
 */
export class StorePlugin {
  constructor(fields) {
    /**
     * מזהה מסד-הנתונים של האתר. **אינו** המזהה שאוצריא משתמשת בו
     * לתיקיית ההתקנה — לשם כך יש `manifestId`.
     */
    this.id = fields.id ?? '';
    this.name = fields.name ?? '';
    this.shortDescription = fields.shortDescription ?? '';
    this.description = fields.description ?? '';
    /** הגרסה **החיה** באתר. אינה בהכרח זו שתותקן: ראו installTarget. */
    this.version = fields.version ?? '';
    this.status = fields.status ?? '';
    this.author = fields.author ?? '';
    this.updatedAt = fields.updatedAt ?? '';
    this.originalDate = fields.originalDate ?? '';
    this.compatibleWith = fields.compatibleWith ?? '';
    this.maxAppVersion = fields.maxAppVersion ?? null;
    this.requiresNetwork = fields.requiresNetwork ?? false;
    this.tags = fields.tags ?? [];
    this.homepage = fields.homepage ?? '';
    this.downloadCount = fields.downloadCount ?? 0;
    this.supportsDirectInstall = fields.supportsDirectInstall ?? false;

    /**
     * דירוג המשתמשים כפי שהאתר מחשב אותו. **לקריאה בלבד** — הדירוג נעשה
     * באתר (דורש חשבון), והמראה רק נושאת את התוצאה אל המחשב הלא-מקוון.
     */
    this.ratingAvg = fields.ratingAvg ?? 0;
    this.ratingCount = fields.ratingCount ?? 0;
    /** מדרגים שהתקנת התוסף אצלם נרשמה בפועל. */
    this.ratingVerifiedCount = fields.ratingVerifiedCount ?? 0;
    /** חמישה מספרים, מכוכב אחד ועד חמישה. */
    this.ratingBreakdown = fields.ratingBreakdown ?? [0, 0, 0, 0, 0];

    /**
     * כל הבילדים שהאתר מכיר — החי וההיסטוריים — ממוינים מהגבוה לנמוך.
     * זה מה שמאפשר להכריע אופליין איזה בילד מתאים לגרסת אוצריא שבמחשב.
     */
    this.versions = fields.versions ?? [];

    /**
     * "תוסף נבחר" — האצירה הידנית של דף הבית. באתר השדה עדיין נקרא
     * `isPinned` (תאימות לאחור), ומשמעותו כיום featured.
     */
    this.isFeatured = fields.isFeatured ?? false;

    /**
     * כתובת מוחלטת להורדת קובץ התוסף — נשמרת בקטלוג כדי שהתקנה תוכל
     * להשלים קובץ חסר גם בלי סנכרון מלא מחדש.
     */
    this.remoteDownloadUrl = fields.remoteDownloadUrl ?? '';

    /**
     * הכתובות שמהן ירדו התמונות, כפי שהאתר החזיר אותן. נשמרות כדי
     * שסנכרון הבא ידע אם התמונה בכלל השתנתה — אחרת כל סנכרון הוריד את
     * כולן מחדש.
     */
    this.remoteImageUrl = fields.remoteImageUrl ?? '';
    this.remoteScreenshotUrls = fields.remoteScreenshotUrls ?? [];

    this.imagePath = fields.imagePath ?? null;
    this.screenshotPaths = fields.screenshotPaths ?? [];

    /**
     * ה-slug של כל קטגוריה שהתוסף משובץ בה. אינו מגיע מ-`/api/plugins`
     * אלא מחושב בסנכרון מתוך רשימות החברות של הקטגוריות.
     */
    this.categorySlugs = fields.categorySlugs ?? [];

    /** `גרסת הבילד -> הקובץ שלו במראה`. רק בילדים שהקובץ שלהם ירד. */
    this.localFiles = fields.localFiles ?? new Map();

    /**
     * ה-id האמיתי מתוך `manifest.json` שבקובץ ה-.otzplugin. זהו המפתח
     * היחיד שמותר להשוות מולו את התוספים המותקנים
     * (`installed/<manifestId>/`).
     */
    this.manifestId = fields.manifestId ?? null;
  }

  /**
   * הבילדים להכרעה. קטלוג ישן (או אתר בלי `versions`) מקבל רשומה אחת
   * שנבנית מהשדות העליונים — בדיוק `buildLiveVersionEntry` של האתר.
   */
  get versionEntries() {
    return this.versions.length > 0 ? this.versions : [this.#liveEntry()];
  }

  #liveEntry() {
    return new PluginVersionEntry({
      version: this.version,
      status: this.status,
      compatibleWith: this.compatibleWith,
      maxAppVersion: this.maxAppVersion,
      downloadUrl: this.remoteDownloadUrl,
      requiresNetwork: this.requiresNetwork,
      supportsDirectInstall: this.supportsDirectInstall,
      isLatest: true,
    });
  }

  /** הקובץ שירד עבור בילד מסוים, או null אם הבילד אינו במראה. */
  localFileFor(version) {
    if (version === null || version === undefined) return null;
    return this.localFiles.get(version) ?? null;
  }

  /** קובץ כלשהו שירד — לתצוגה בלבד, כשאין גרסת אוצריא להכריע לפיה. */
  get anyLocalFile() {
    const exact = this.localFiles.get(this.version);
    if (exact !== undefined) return exact;
    for (const file of this.localFiles.values()) return file;
    return null;
  }

  /**
   * הבילד הגבוה ביותר שתואם ל-[appVersion], בין אם הקובץ שלו במראה
   * ובין אם לא. `null` = לתוסף אין מה להציע לגרסה הזו.
   */
  compatibleFor(appVersion) {
    return resolveCompatibleVersion(this.versionEntries, appVersion);
  }

  /**
   * הבילדים שהמראה **אמורה** לנשוא — אחד לכל גרסה ב-[targetAppVersions],
   * ממוינים יורד. בלי תלות בשאלה אם הקובץ שלהם כבר ירד.
   *
   * רשימה ריקה של גרסאות יעד = מראה שנכתבה לפני שהיעד נשמר בקטלוג, או
   * בירור שנכשל. אז **כל** הבילדים הם מועמדים, כמו לפני השינוי: מראה
   * ותיקה נושאת בילד שנבחר לפי גרסת המחשב המסנכרן, ופסילתו הייתה מסתירה
   * תוסף שקובץ עובד שלו יושב על הכונן.
   */
  mirrorTargets(targetAppVersions = []) {
    return targetAppVersions.length > 0
        ? resolveTargets(this.versionEntries, targetAppVersions)
        : this.versionEntries;
  }

  /**
   * האם המראה נושאת בילד שירוץ על [appVersion] — התנאי להצגת התוסף
   * בחנות. `false` = התוסף אינו מוצג כלל: אין מה להציע למחשב הזה, וכל
   * מה שהצגתו הייתה מייצרת הוא כפתור התקנה שדורש אינטרנט במחשב שאין בו.
   */
  runsOn(appVersion, targetAppVersions = []) {
    return this.mirrorTargets(targetAppVersions)
        .some((entry) => isCompatibleWithApp(entry, appVersion));
  }

  /**
   * הבילד שיותקן במחשב שמריץ [appVersion]: הגבוה **מבין אלה שהמראה
   * נושאת** שתואם לו ושהקובץ שלו יושב במראה. כשאף אחד מהם לא ירד מוחזר
   * הגבוה שתואם, כדי שהממשק יאמר "הקובץ לא ירד" ולא "אין תוסף".
   *
   * ⚠️ **רק מתוך בילדי המראה**, ולא מכל ההיסטוריה: בילד היסטורי שתואם
   * למחשב הזה אך אינו יעד של המראה לא יירד לעולם, והחזרתו הייתה מייצרת
   * "טרם ירד — יש לבצע סנכרון" שאין דרך לפתור.
   */
  installTarget(appVersion, targetAppVersions = []) {
    let compatible = null;
    for (const entry of this.mirrorTargets(targetAppVersions)) {
      if (!isCompatibleWithApp(entry, appVersion)) continue;
      if (compatible === null) compatible = entry;
      if (this.localFiles.has(entry.version)) return entry;
    }
    return compatible;
  }

  /** הבילדים שצריכים לרדת עבור גרסאות היעד של המראה. */
  targetsFor(appVersions) {
    return resolveTargets(this.versionEntries, appVersions);
  }

  /**
   * גרסת אוצריא המינימלית שמריצה בילד כלשהו של התוסף — לשורת היומן
   * שמסבירה למה תוסף לא ירד.
   */
  get lowestSupportedApp() {
    return lowestSupportedAppVersion(this.versionEntries);
  }

  /**
   * מצב התוסף מול מפת המותקנים (`manifestId -> גרסה מותקנת`), ביחס
   * ל-[appVersion] של אוצריא שבמחשב הזה.
   *
   * @param {Map<string,string>|Object} installed
   */
  statusAgainst(installed, appVersion, targetAppVersions = []) {
    const target = this.installTarget(appVersion, targetAppVersions);
    if (target === null) return InstallStatus.incompatible;

    const key = this.manifestId;
    if (!key) return InstallStatus.unknown;

    const installedVersion = installed instanceof Map
        ? installed.get(key)
        : installed[key];
    if (installedVersion === undefined || installedVersion === null) {
      return InstallStatus.notInstalled;
    }
    return comparePluginVersions(target.version, installedVersion) > 0
        ? InstallStatus.updateAvailable
        : InstallStatus.upToDate;
  }

  /**
   * האם התוסף תואם לטקסט חיפוש חופשי. אותם שדות שהחיפוש החכם באתר מדרג
   * (שם, תגיות, תקציר, מפתח, תיאור) — כאן בלי דירוג, כי החיפוש מקומי.
   */
  matchesQuery(query) {
    if (!query || query.trim().length === 0) return true;
    const q = query.toLowerCase();
    return this.name.toLowerCase().includes(q) ||
        this.shortDescription.toLowerCase().includes(q) ||
        this.description.toLowerCase().includes(q) ||
        this.author.toLowerCase().includes(q) ||
        this.tags.some((t) => t.toLowerCase().includes(q));
  }

  /** מחזיר עותק עם שדות מוחלפים. שדה שלא נמסר נשאר כמו שהוא. */
  copyWith(changes) {
    return new StorePlugin({...this, ...changes});
  }

  /** בונה רשומה מתשובת `/api/plugins`. */
  static fromApi(json, baseUrl) {
    return new StorePlugin({
      id: str(json.id),
      name: str(json.name),
      shortDescription: str(json.shortDescription),
      description: str(json.description),
      version: str(json.version),
      status: str(json.status),
      author: str(json.author),
      updatedAt: str(json.updatedAt),
      originalDate: str(json.originalDate),
      compatibleWith: str(json.compatibleWith),
      maxAppVersion: nonEmptyStr(json.maxAppVersion),
      requiresNetwork: json.requiresNetwork === true,
      tags: strList(json.tags),
      homepage: str(json.homepage),
      downloadCount: int(json.downloadCount),
      supportsDirectInstall: json.supportsDirectInstall === true,
      isFeatured: json.isPinned === true,
      ratingAvg: num(json.ratingAvg),
      ratingCount: int(json.ratingCount),
      ratingVerifiedCount: int(json.ratingVerifiedCount),
      ratingBreakdown: breakdown(json.ratingBreakdown),
      remoteDownloadUrl: absoluteUrl(str(json.downloadUrl), baseUrl),
      versions: sortedDescending(versionsFrom(json.versions, baseUrl)),
      // כמו שהאתר שלח, בלי להפוך למוחלט: הן נשמרות כדי להשוות מול
      // התשובה הבאה, וההורדה עצמה כבר יודעת להשלים כתובת יחסית.
      remoteImageUrl: str(json.image),
      remoteScreenshotUrls: strList(json.screenshots).filter((u) => u),
      localFiles: new Map(),
    });
  }

  toJSON() {
    const localFiles = {};
    for (const [version, file] of this.localFiles) {
      localFiles[version] = file.toJSON();
    }
    return {
      id: this.id,
      name: this.name,
      shortDescription: this.shortDescription,
      description: this.description,
      version: this.version,
      status: this.status,
      author: this.author,
      updatedAt: this.updatedAt,
      originalDate: this.originalDate,
      compatibleWith: this.compatibleWith,
      maxAppVersion: this.maxAppVersion,
      requiresNetwork: this.requiresNetwork,
      tags: this.tags,
      homepage: this.homepage,
      downloadCount: this.downloadCount,
      supportsDirectInstall: this.supportsDirectInstall,
      isFeatured: this.isFeatured,
      ratingAvg: this.ratingAvg,
      ratingCount: this.ratingCount,
      ratingVerifiedCount: this.ratingVerifiedCount,
      ratingBreakdown: this.ratingBreakdown,
      remoteDownloadUrl: this.remoteDownloadUrl,
      remoteImageUrl: this.remoteImageUrl,
      remoteScreenshotUrls: this.remoteScreenshotUrls,
      image: this.imagePath,
      screenshots: this.screenshotPaths,
      categories: this.categorySlugs,
      versions: this.versions.map((entry) => entry.toJSON()),
      localFiles,
      manifestId: this.manifestId,
    };
  }

  /** קורא רשומה מהקטלוג השמור. */
  static fromJson(json) {
    const version = str(json.version);
    return new StorePlugin({
      id: str(json.id),
      name: str(json.name),
      shortDescription: str(json.shortDescription),
      description: str(json.description),
      version,
      status: str(json.status),
      author: str(json.author),
      updatedAt: str(json.updatedAt),
      originalDate: str(json.originalDate),
      compatibleWith: str(json.compatibleWith),
      maxAppVersion: nonEmptyStr(json.maxAppVersion),
      requiresNetwork: json.requiresNetwork === true,
      tags: strList(json.tags),
      homepage: str(json.homepage),
      downloadCount: int(json.downloadCount),
      supportsDirectInstall: json.supportsDirectInstall === true,
      // `isPinned` — קטלוג שנכתב לפני שהאתר שינה את המשמעות ל"נבחר".
      isFeatured: json.isFeatured === true || json.isPinned === true,
      ratingAvg: num(json.ratingAvg),
      ratingCount: int(json.ratingCount),
      ratingVerifiedCount: int(json.ratingVerifiedCount),
      ratingBreakdown: breakdown(json.ratingBreakdown),
      remoteDownloadUrl: str(json.remoteDownloadUrl),
      remoteImageUrl: str(json.remoteImageUrl),
      remoteScreenshotUrls: strList(json.remoteScreenshotUrls),
      imagePath: nonEmptyStr(json.image),
      screenshotPaths: strList(json.screenshots),
      categorySlugs: strList(json.categories),
      versions: sortedDescending(versionsFrom(json.versions, '')),
      localFiles: readLocalFiles(json, version),
      manifestId: nonEmptyStr(json.manifestId),
    });
  }
}

/**
 * קורא את מפת הקבצים, **וגם** קטלוג ישן שכתב `localFile` יחיד.
 *
 * הקובץ ההוא שייך לגרסה שנרשמה לצדו, וכך הוא ממשיך להיחשב במראה בלי
 * הורדה מחדש. בלי ההגירה הזו הסנכרון הראשון שאחרי העדכון היה מוריד את
 * כל החנות שוב.
 */
function readLocalFiles(json, version) {
  const raw = json.localFiles;
  if (raw !== null && typeof raw === 'object' && !Array.isArray(raw)) {
    const files = new Map();
    for (const [key, value] of Object.entries(raw)) {
      const file = PluginLocalFile.fromJson(value);
      if (key.length > 0 && file !== null) files.set(key, file);
    }
    if (files.size > 0) return files;
  }

  const legacy = PluginLocalFile.fromJson(json.localFile);
  if (legacy === null || version.length === 0) return new Map();
  return new Map([[version, legacy]]);
}

// ── קטגוריה מנוהלת ───────────────────────────────────────────────────────────

/**
 * ה-slug הוא המפתח היציב: הוא זה שנשמר על כל תוסף בקטלוג ולפיו מסננים.
 * מזהה מסד-הנתונים והאייקון אינם נשמרים — אין להם שימוש כאן.
 */
export class PluginStoreCategory {
  /** ברירת המחדל של האתר לכמות בשורת דף-הבית. */
  static defaultHomeLimit = 6;

  constructor({slug, name, description = '', showOnHome = false,
               homeLimit = PluginStoreCategory.defaultHomeLimit,
               pluginIds = []}) {
    this.slug = slug;
    this.name = name;
    this.description = description;
    /** האם הקטגוריה מקבלת שורה משלה בדף הבית של החנות. */
    this.showOnHome = showOnHome;
    /** כמה תוספים מוצגים באותה שורה לפני "לכל הקטגוריה". */
    this.homeLimit = homeLimit;
    /** מזהי התוספים המשובצים, **בסדר התצוגה הידני** שנקבע באתר. */
    this.pluginIds = pluginIds;
  }

  get pluginCount() {
    return this.pluginIds.length;
  }

  copyWith(changes) {
    return new PluginStoreCategory({...this, ...changes});
  }

  /**
   * בונה קטגוריה מתשובת האתר. `plugins` קיים רק בדף הקטגוריה ובקטגוריות
   * שמסומנות להצגה בדף הבית — בשאר המקרים החברות נשלפת בנפרד.
   */
  static fromApi(json) {
    return new PluginStoreCategory({
      slug: str(json.slug),
      name: str(json.name),
      description: str(json.description),
      showOnHome: json.showOnHome === true,
      homeLimit: homeLimitOf(json.homeLimit),
      pluginIds: idsFrom(json.plugins),
    });
  }

  toJSON() {
    return {
      slug: this.slug,
      name: this.name,
      description: this.description,
      showOnHome: this.showOnHome,
      homeLimit: this.homeLimit,
      plugins: this.pluginIds,
    };
  }

  /** רשומה בלי slug אינה שמישה (אין לפיה סינון) ולכן מדולגת. */
  static fromJson(json) {
    if (json === null || typeof json !== 'object') return null;
    const slug = json.slug;
    if (typeof slug !== 'string' || slug.length === 0) return null;
    return new PluginStoreCategory({
      slug,
      name: typeof json.name === 'string' ? json.name : slug,
      description: str(json.description),
      showOnHome: json.showOnHome === true,
      homeLimit: homeLimitOf(json.homeLimit),
      pluginIds: strList(json.plugins),
    });
  }
}

const homeLimitOf = (value) => Number.isInteger(value) && value > 0
    ? value : PluginStoreCategory.defaultHomeLimit;

function idsFrom(plugins) {
  if (!Array.isArray(plugins)) return [];
  const out = [];
  for (const raw of plugins) {
    if (raw !== null && typeof raw === 'object' &&
        typeof raw.id === 'string' && raw.id.length > 0) {
      out.push(raw.id);
    }
  }
  return out;
}

// ── הטקסטים האצורים של דף הבית ───────────────────────────────────────────────

export class PluginStoreHome {
  constructor({title = '', subtitle = ''} = {}) {
    this.title = title;
    this.subtitle = subtitle;
  }

  static empty = new PluginStoreHome();

  get isEmpty() {
    return this.title.length === 0 && this.subtitle.length === 0;
  }

  static fromApi(json) {
    return new PluginStoreHome({
      title: str(json.homeTitle),
      subtitle: str(json.homeSubtitle),
    });
  }

  toJSON() {
    return {title: this.title, subtitle: this.subtitle};
  }

  static fromJson(json) {
    if (json === null || typeof json !== 'object') {
      return PluginStoreHome.empty;
    }
    return new PluginStoreHome({
      title: str(json.title),
      subtitle: str(json.subtitle),
    });
  }
}

// ── הקטלוג המקומי כולו ───────────────────────────────────────────────────────

export class PluginCatalog {
  constructor({lastSync = null, plugins = [], categories = [],
               home = PluginStoreHome.empty, targetAppVersions = []} = {}) {
    /** מועד הסנכרון האחרון, או null אם מעולם לא סונכרן. */
    this.lastSync = lastSync;
    this.plugins = plugins;
    /**
     * גרסאות אוצריא שהסנכרון בנה את המראה עבורן, מהגבוהה לנמוכה — מה
     * שהריפו פרסם באותו רגע, ולא הגרסה שבמחשב המסנכרן.
     *
     * **נשמר בקטלוג** כי המחשב שצורך את המראה אינו מקוון ואינו יכול
     * לברר אותן בעצמו: בלעדיהן אין דרך לדעת אם תוסף חסר כי הוא אינו
     * תואם למחשב הזה, ואין מה לומר למשתמש.
     *
     * ריק במראה שסונכרנה לפני שהשדה נוסף — ואז אין הסתרה, ראו
     * `StorePlugin.mirrorTargets`.
     */
    this.targetAppVersions = targetAppVersions;
    /**
     * קטגוריות החנות, בסדר שנקבע באתר. ריק במראה שסונכרנה לפני שהאתר
     * הכניס קטגוריות, וזה מצב תקין — הממשק פשוט לא מציג שורת קטגוריות.
     */
    this.categories = categories;
    this.home = home;
  }

  static empty = new PluginCatalog();

  categoryBySlug(slug) {
    for (const category of this.categories) {
      if (category.slug === slug) return category;
    }
    return null;
  }

  toJSON() {
    return {
      lastSync: this.lastSync === null ? null : this.lastSync.toISOString(),
      targetAppVersions: this.targetAppVersions,
      home: this.home.toJSON(),
      categories: this.categories.map((c) => c.toJSON()),
      plugins: this.plugins.map((p) => p.toJSON()),
    };
  }

  /**
   * קורא קטלוג מ-JSON. רשומה בודדת שלא ניתן לפענח מדולגת בשקט — עדיף
   * קטלוג חלקי על פני מסך ריק.
   */
  static fromJson(json) {
    const plugins = [];
    if (Array.isArray(json.plugins)) {
      for (const raw of json.plugins) {
        if (raw === null || typeof raw !== 'object') continue;
        try {
          plugins.push(StorePlugin.fromJson(raw));
        } catch {
          continue;
        }
      }
    }

    const categories = [];
    if (Array.isArray(json.categories)) {
      for (const raw of json.categories) {
        const category = PluginStoreCategory.fromJson(raw);
        if (category !== null) categories.push(category);
      }
    }

    let lastSync = null;
    if (typeof json.lastSync === 'string') {
      const parsed = new Date(json.lastSync);
      if (!Number.isNaN(parsed.getTime())) lastSync = parsed;
    }

    return new PluginCatalog({
      lastSync,
      plugins,
      categories,
      // מסונן: ערך שאינו מספר גרסה היה מסתיר תוספים בלי סיבה.
      targetAppVersions: Array.isArray(json.targetAppVersions)
          ? json.targetAppVersions.filter(
              (v) => typeof v === 'string' && v.length > 0)
          : [],
      home: PluginStoreHome.fromJson(json.home),
    });
  }
}
