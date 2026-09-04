// מברר מהן גרסאות **אוצריא** שהמראה נבנית עבורן, מתוך ה-releases של
// `Otzaria/otzaria`.
//
// ── למה בכלל, ולא הגרסה שבמחשב ───────────────────────────────────────────────
// המראה נבנית במחשב מקוון ונצרכת במחשב **אחר**, לא-מקוון. סינון לפי
// הגרסה שבמחשב המסנכרן פירושו שכונן שנבנה על מחשב עם אוצריא ישנה נושא
// בילדים ישנים, ומחשב היעד — שגרסתו אחרת — מקבל "טרם ירד, יש לבצע
// סנכרון" בדיוק במקום שאין בו אינטרנט. לכן היעד הוא מה שהריפו מפרסם,
// ולא מה שמותקן כאן.
//
// ── שתי גרסאות, ולא אחת ──────────────────────────────────────────────────────
// כשה-release האחרון מסומן `prerelease`, מי שעל ערוץ היציב אינו מריץ
// אותו — ובילד שנבחר לפיו לא בהכרח יעלה אצלו. לכן במצב הזה מתבררות
// **שתיהן**: האחרונה, והיציבה האחרונה. `resolveTargets` יגזור מהן בילד
// לכל אחת, וכשהשתיים נפתרות לאותו בילד יורד אחד.
//
// ⚠️ **הדגל, לא השם.** בריפו הזה כל ה-releases נקראים
// "Otzaria X (Preview from dev)" — כולל אלה שאינם prerelease. השם אינו
// סימן לכלום, והדגל `prerelease` הוא הנתון היחיד שאפשר להכריע לפיו.

import {comparePluginVersions} from '../util/version.js';

const OWNER = 'Otzaria';
const REPO = 'otzaria';
const API_BASE = 'https://api.github.com';

/**
 * דף אחד. הגרסה האחרונה והיציבה האחרונה נמצאות בראש הרשימה בפועל, ודף
 * שני היה מאריך את הסנכרון בשביל היסטוריה שאינה מעניינת אותנו.
 */
const PAGE_SIZE = 30;

/**
 * תג גרסה של אוצריא: `0.9.96+736`, `v0.9.96`, `0.9.96`.
 *
 * ⚠️ מקטע prerelease (`-pr-715`, `-dev-110`) **נפסל**: אלה בילדים של
 * בקשות משיכה ושל dev, ולא גרסה שמישהו מריץ. הם אמורים לשאת גם את הדגל
 * `prerelease`, אבל בריפו הזה יש בפועל תגים כאלה בלי הדגל — ולכן התג
 * נבדק בנפרד ולא נסמך עליו.
 */
const RELEASE_TAG = /^v?(\d+(?:\.\d+)*)(?:\+\d+)?$/;

/** דף ה-releases, כשצריך להצביע על מקום ולא על גרסה. */
export const OTZARIA_RELEASES_PAGE_URL =
    `https://github.com/${OWNER}/${REPO}/releases`;

/**
 * הגרסה שבתוך התג, בלי `v` ובלי מספר הבילד (`+736`), או `null` כשאינו
 * תג גרסה.
 *
 * מספר הבילד נחתך כי הוא **אינו** חלק מהגרסה שהתוספים מצהירים עליה:
 * `compatibleWith` באתר הוא `0.9.96`, וההשוואה מולו צריכה להיות מול
 * אותו מספר בדיוק.
 */
export function otzariaVersionOf(tag) {
  const match = RELEASE_TAG.exec(String(tag ?? '').trim());
  return match === null ? null : match[1];
}

export class OtzariaReleaseClient {
  constructor({net, timeoutMs = 20000}) {
    this.net = net;
    /**
     * זמן קצוב — חובה: בלעדיו מחשב שמחובר לרשת בלי מסלול לאינטרנט היה
     * תולה את הסנכרון כולו לפני שהוא מתחיל.
     */
    this.timeoutMs = timeoutMs;
  }

  /**
   * הגרסאות שהמראה תיבנה עבורן, מהגבוהה לנמוכה: הגרסה האחרונה, ואם היא
   * `prerelease` — גם היציבה האחרונה שמתחתיה.
   *
   * רשימה **ריקה** כשאין אף release עם תג גרסה. המתקשר מתייחס אליה
   * כ"אין מול מה לסנן", בדיוק כמו לכשל.
   *
   * @returns {Promise<{versions: string[], latest: string|null,
   *                    latestStable: string|null,
   *                    latestIsPrerelease: boolean}>}
   */
  async fetchTargetVersions() {
    const url =
        `${API_BASE}/repos/${OWNER}/${REPO}/releases?per_page=${PAGE_SIZE}`;
    // ⚠️ GitHub מחזיר 403 לכל בקשה בלי User-Agent. ה-host קובע אותו
    // ברמת הסשן (`kUserAgent` ב-netapi.cpp), ולכן אין צורך בכותרת כאן.
    const response = await this.net.get(url, this.timeoutMs);
    if (response.status !== 200) {
      throw new Error(`GitHub החזיר ${response.status} עבור ${url}`);
    }

    const decoded = JSON.parse(response.body);
    if (!Array.isArray(decoded)) {
      throw new Error(`אין releases ב-${OWNER}/${REPO}`);
    }
    return pickTargetVersions(decoded);
  }
}

/**
 * הבחירה עצמה, בלי רשת — חשוף כדי שבדיקות יאמתו אותה על תשובה מוקלטת.
 *
 * הגבוהה ולא הראשונה ברשימה: סדר הפרסום אינו סדר הגרסאות (release
 * שנערך ידנית, תיקון שפורסם לגרסה ותיקה אחרי החדשה), ובחירת "הראשון"
 * הייתה תלוית-מזל.
 *
 * @param {Array<object>} releases תשובת `/releases` של GitHub
 */
export function pickTargetVersions(releases) {
  let latest = null;
  let latestStable = null;

  for (const entry of releases) {
    if (entry === null || typeof entry !== 'object') continue;
    // draft אינו קיים לציבור; תג שאינו גרסה (או בילד PR/dev) אינו גרסה
    // שמישהו מריץ.
    if (entry.draft === true) continue;
    const version = otzariaVersionOf(entry.tag_name);
    if (version === null) continue;

    if (latest === null || comparePluginVersions(version, latest) > 0) {
      latest = version;
    }
    if (entry.prerelease !== true &&
        (latestStable === null ||
         comparePluginVersions(version, latestStable) > 0)) {
      latestStable = version;
    }
  }

  const latestIsPrerelease = latest !== null &&
      (latestStable === null || comparePluginVersions(latest, latestStable) > 0);

  // סדר יורד, כדי שהצרכנים יקבלו את הגרסאות במפורש מהגבוהה לנמוכה.
  const versions = [];
  if (latest !== null) versions.push(latest);
  if (latestIsPrerelease && latestStable !== null) {
    versions.push(latestStable);
  }

  return {versions, latest, latestStable, latestIsPrerelease};
}
