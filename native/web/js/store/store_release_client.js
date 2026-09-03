// בדיקה אם יצא release חדש של החנות עצמה. פורט של
// `lib/src/self_update/store_version.dart` ו-`store_release_client.dart`.
//
// **אין כאן עדכון עצמי.** הסיפור מסתיים בכתובת שנפתחת בדפדפן — זו החלטה
// מכוונת שאושרה מחדש בפורט הזה: כל מה שהחלפת exe דורשת (הרשאות כתיבה,
// ניהול גיבוי, הפעלה מחדש) אינו קיים באפליקציה הזאת.
//
// זו הפעולה **היחידה** בתוכנה שיוצאת לרשת בלי שהמשתמש לחץ. היא זולה,
// קצובה בזמן, וכל כשל בה נבלע.

const OWNER = 'Yehuda-Zakesh';
const REPO = 'otzaria-plugin-store';
const API_BASE = 'https://api.github.com';

/** דף אחד מספיק: מחפשים את הגרסה היציבה הגבוהה, לא את כל ההיסטוריה. */
const PAGE_SIZE = 30;

/** דף ה-releases, לפתיחה בדפדפן כשאין release ספציפי להצביע עליו. */
export const RELEASES_PAGE_URL =
    `https://github.com/${OWNER}/${REPO}/releases`;

/**
 * תג של release שה-CI מפרסם: `v1`, `v2`, … עם `v` אופציונלי.
 *
 * ⚠️ תג שאינו בצורה הזאת **נפסל**, ולא מנוסה "בערך": בריפו יכול לשבת תג
 * ידני (`V1`), תג שיובא מריפו אחר (`v0.11.0`), או תג שאינו גרסה בכלל —
 * וכל השוואה מספרית סובלנית הייתה מוצאת בהם גרסה חדשה לנצח.
 */
const RELEASE_TAG = /^v?\d+$/;

/** `true` אם [tag] הוא תג גרסה בצורה שה-CI מפרסם. */
export function isStoreReleaseTag(tag) {
  return RELEASE_TAG.test(String(tag).trim());
}

/** המספר שבתוך התג, או `null` כשאינו תג גרסה. */
export function storeVersionOf(tag) {
  const trimmed = String(tag).trim();
  if (!isStoreReleaseTag(trimmed)) return null;
  const digits = trimmed.startsWith('v') || trimmed.startsWith('V')
      ? trimmed.slice(1)
      : trimmed;
  const parsed = Number.parseInt(digits, 10);
  return Number.isNaN(parsed) ? null : parsed;
}

/**
 * `true` כש-[candidate] חדשה מ-[current]. שתיהן תגים או מספרים.
 *
 * "חדש יותר" ולא "שונה": את החנות אנחנו מפרסמים בעצמנו, ו-release שנמשך
 * חזרה אינו סיבה להציע למשתמש לרדת גרסה. תג לא-תקין אינו חדש מכלום.
 */
export function isStoreVersionNewer(candidate, current) {
  const left = storeVersionOf(candidate);
  const right = storeVersionOf(current);
  if (left === null) return false;
  // גרסה מקומית שאינה מספר נחשבת 0, כדי שההתראה תעבוד ולא תיעלם בשקט.
  return left > (right ?? 0);
}

export class StoreReleaseClient {
  constructor({net, timeoutMs = 20000}) {
    this.net = net;
    /**
     * זמן קצוב לבקשה — חובה: בלעדיו מחשב שמחובר לרשת בלי מסלול
     * לאינטרנט היה תולה את הבדיקה בלי הגבלה.
     */
    this.timeoutMs = timeoutMs;
  }

  /**
   * הגרסה היציבה **הגבוהה ביותר**, או `null` אם אין אף release תקין.
   *
   * pre-release ו-draft נפסלים: הם קיימים כדי לנסות, לא כדי להציע.
   *
   * הבחירה היא לפי המספר ולא לפי הסדר שבו GitHub החזיר — סדר הפרסום
   * אינו סדר הגרסאות (release שנערך ידנית, תג ותיק שפורסם מחדש),
   * ובחירת "הראשון ברשימה" הייתה תלוית-מזל.
   *
   * @returns {Promise<{tagName: string, version: number,
   *                    pageUrl: string}|null>}
   */
  async fetchLatestStable() {
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

    let best = null;
    for (const entry of decoded) {
      if (entry === null || typeof entry !== 'object') continue;
      if (entry.draft === true) continue;
      if (entry.prerelease === true) continue;

      const release = parseRelease(entry);
      if (release === null) continue;
      if (best === null || release.version > best.version) best = release;
    }
    return best;
  }
}

/**
 * `null` כשה-release אינו נושא תג גרסה — ממשיכים לשאר במקום להפיל את
 * הבדיקה כולה.
 */
function parseRelease(json) {
  const tagName = json.tag_name;
  if (typeof tagName !== 'string') return null;
  const version = storeVersionOf(tagName);
  if (version === null) return null;

  const htmlUrl = json.html_url;
  return {
    tagName,
    version,
    // `html_url` הוא דף ה-release המדויק; בהיעדרו דף ה-releases הכללי,
    // שתמיד קיים.
    pageUrl: typeof htmlUrl === 'string' && htmlUrl.length > 0
        ? htmlUrl
        : RELEASES_PAGE_URL,
  };
}
