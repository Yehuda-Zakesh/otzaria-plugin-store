// "יש משהו חדש בחנות?" — קריאת מטא-דאטה אחת מול הקטלוג שכבר במראה, בלי
// להוריד נכס ובלי לכתוב דבר. פורט של
// `packages/plugins_manager/lib/src/services/plugin_online_peek.dart`.

import {StorePlugin} from './models.js';

export class PluginOnlinePeek {
  constructor({client, store}) {
    this.client = client;
    this.store = store;
  }

  /**
   * [appVersions] — אותן גרסאות אוצריא שהסנכרון יקבל. **חובה שיהיו
   * זהות**: ההצצה אמורה לדווח בדיוק על מה שסנכרון היה מביא.
   */
  async peek({appVersions = []} = {}) {
    const remote = await this.client.fetchCatalog();
    const local = await this.store.load();

    // הקטלוג אינו עדות לקיום הקובץ: מחיקה ידנית, העתקה חלקית של הכונן
    // או הורדה שנכשלה משאירות רשומה מלאה בלי קובץ. `PluginMirrorSync`
    // בודק דיסק לפני שהוא מוריד, וההצצה חייבת לשאול בדיוק אותה שאלה.
    const present = new Map();
    for (const plugin of local.plugins) {
      const have = new Set();
      for (const [version, file] of plugin.localFiles) {
        if (await this.store.hasAsset(file.relativePath)) have.add(version);
      }
      present.set(plugin.id, have);
    }

    return comparePeek({
      remote,
      local,
      presentBuilds: present,
      baseUrl: this.client.baseUrl,
      appVersions,
    });
  }
}

/**
 * ההשוואה עצמה, בלי רשת ובלי דיסק — [presentBuilds] הן, לכל מזהה תוסף,
 * גרסאות הבילד שהקובץ שלהן נמצא בפועל במראה.
 *
 * השאלה הנשאלת כאן היא **בדיוק** זו של `PluginMirrorSync.#plan`: לכל
 * גרסת אוצריא שהכונן נושא נבחר הבילד התואם, ונבדק אם הוא כבר במראה. כל
 * השוואה "חכמה" אחרת הייתה מדווחת עדכון שסנכרון לא מביא, או להפך.
 *
 * חשוף בנפרד כדי שבדיקות יאמתו אותו בלי רשת ובלי דיסק.
 */
export function comparePeek({remote, local, baseUrl, presentBuilds,
                             appVersions = []}) {
  const mirrored = new Map();
  for (const plugin of local.plugins) mirrored.set(plugin.id, plugin);

  const fresh = [];
  const updated = [];
  const missing = [];

  for (const raw of remote) {
    const plugin = StorePlugin.fromApi(raw, baseUrl);
    if (!plugin.id) continue;

    // תוסף שאין לו קובץ להוריד בכלל אינו "חסר" — אין מה להביא לו.
    const targets = plugin.targetsFor(appVersions)
        .filter((target) => Boolean(target.downloadUrl));

    const known = mirrored.get(plugin.id);
    if (known === undefined) {
      // תוסף שאין לו אף בילד שירוץ על מה שבכונן אינו "חדש": סנכרון לא
      // יביא לו כלום, וההצצה חייבת לומר את מה שהסנכרון יעשה.
      if (targets.length > 0 || !plugin.remoteDownloadUrl) {
        fresh.push(plugin.name);
      }
      continue;
    }

    const have = presentBuilds.get(plugin.id) ?? new Set();
    const needsWork = targets.some((target) => needsFetch(target, known, have));
    if (!needsWork) continue;

    // **גרסה חדשה** באתר לעומת **קובץ שחסר** מהכונן. השניים נראים אחרת
    // למשתמש ולכן נספרים בנפרד: בילד שהמראה כבר מתארת (הגרסה שנרשמה
    // בקטלוג, או בילד שנרשם לו קובץ) ואינו על הדיסק הוא חוסר — נמחק, לא
    // הועתק, או הורדה שנכשלה. כל בילד אחר הוא גרסה חדשה.
    const describes = targets.some((target) =>
        target.version === known.version ||
        known.localFiles.has(target.version));
    if (describes) missing.push(plugin.name);
    else updated.push(plugin.name);
  }

  return {
    newPlugins: fresh,
    updatedPlugins: updated,
    missingPlugins: missing,
    totalOnline: remote.length,
    get newCount() { return this.newPlugins.length; },
    get updatedCount() { return this.updatedPlugins.length; },
    get missingCount() { return this.missingPlugins.length; },
    get hasUpdates() {
      return this.newPlugins.length > 0 || this.updatedPlugins.length > 0 ||
          this.missingPlugins.length > 0;
    },
  };
}

/** המקבילה של `PluginMirrorSync.#buildUnchanged`, בלי גישה לדיסק. */
function needsFetch(target, known, have) {
  if (!have.has(target.version)) return true;
  const recorded = known.versionEntries
      .find((entry) => entry.version === target.version) ?? null;
  // כתובת ריקה ברשומה הקודמת = קטלוג ישן, לא כתובת שהשתנתה.
  return recorded !== null &&
      Boolean(recorded.downloadUrl) &&
      recorded.downloadUrl !== target.downloadUrl;
}

/** מצב ריק — אחרי סנכרון מוצלח, וכשעדיין לא נבדק. */
export const EMPTY_ONLINE_STATUS = Object.freeze({
  newPlugins: [],
  updatedPlugins: [],
  missingPlugins: [],
  totalOnline: 0,
  newCount: 0,
  updatedCount: 0,
  missingCount: 0,
  hasUpdates: false,
});
