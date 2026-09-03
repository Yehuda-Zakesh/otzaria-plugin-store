// בחירת בילד התוסף המתאים לגרסת אוצריא נתונה — פורט של
// `packages/plugins_manager/lib/src/services/plugin_compatibility.dart`,
// ושם פורט של `src/lib/pluginCompatibility.js` באתר. כלומר: הקוד הזה חוזר
// כאן לשפה שבה הוא נכתב במקור, כדי שהמראה האופליינית תביא בדיוק את מה
// שהאתר היה נותן לאותו משתמש.
//
// לכל בילד יש טווח: `compatibleWith` (מינימום) ו-`maxAppVersion` (תקרה).
// נבחר **הבילד הגבוה ביותר שגרסת אוצריא נופלת בטווח שלו** — כך שמחשב עם
// אוצריא ישנה מקבל את האחרון שעוד תמך בו, במקום בילד שלא יעלה אצלו.

import {comparePluginVersions} from '../util/version.js';

/**
 * האם [appVersion] נופלת בטווח התאימות של [entry].
 *
 * שדה חסר = גבול פתוח. בילדים היסטוריים שאורכבו לפני שנשמרו שדות
 * התאימות מגיעים עם `compatibleWith` ריק, ואין לפסול אותם בגלל נתון
 * חסר. גם [appVersion] ריקה (לא ידוע מה מותקן) אינה פוסלת דבר.
 */
export function isCompatibleWithApp(entry, appVersion) {
  if (!appVersion) return true;
  if (entry.compatibleWith &&
      comparePluginVersions(appVersion, entry.compatibleWith) < 0) {
    return false;
  }
  const max = entry.maxAppVersion;
  if (max && comparePluginVersions(appVersion, max) > 0) return false;
  return true;
}

/**
 * הבילד הגבוה ביותר מתוך [entries] שתואם ל-[appVersion], או `null`
 * כשאין כזה. [entries] חייבת להיות ממוינת יורד — המודל דואג לכך.
 */
export function resolveCompatibleVersion(entries, appVersion) {
  for (const entry of entries) {
    if (isCompatibleWithApp(entry, appVersion)) return entry;
  }
  return null;
}

/**
 * הבילדים שצריכים לרדת למראה עבור [appVersions] — אחד לכל גרסת אוצריא
 * שהכונן נושא, בלי כפילות כששתיהן נפתרות לאותו בילד.
 *
 * רשימת גרסאות ריקה = אין מול מה לסנן (מראת תוכנה ריקה), ואז יורד הבילד
 * החי בלבד: בדיוק ההתנהגות שהייתה לפני שהתאימות נכנסה.
 */
export function resolveTargets(entries, appVersions) {
  if (entries.length === 0) return [];
  if (appVersions.length === 0) return [entries[0]];

  const targets = new Map();
  for (const appVersion of appVersions) {
    const entry = resolveCompatibleVersion(entries, appVersion);
    if (entry !== null) targets.set(entry.version, entry);
  }
  return [...targets.values()];
}

/**
 * גרסת האוצריא הנמוכה ביותר שעדיין מריצה בילד כלשהו — הרצפה הנמוכה מכל
 * הבילדים, ולא זו של החי. מאפשר לומר למי שאין לו גרסה תואמת מה הוא באמת
 * צריך, במקום את דרישת הבילד האחרון שהיא לרוב גבוהה יותר.
 *
 * `null` כשלבילד כלשהו אין רצפה בכלל — ואז "אוצריא ישנה מדי" אינו ההסבר.
 */
export function lowestSupportedAppVersion(entries) {
  let lowest = null;
  for (const entry of entries) {
    if (!entry.compatibleWith) return null;
    if (lowest === null ||
        comparePluginVersions(entry.compatibleWith, lowest) < 0) {
      lowest = entry.compatibleWith;
    }
  }
  return lowest;
}
