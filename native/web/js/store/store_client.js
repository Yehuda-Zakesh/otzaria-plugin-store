// לקוח ה-API הציבורי של חנות התוספים באתר אוצריא.
// פורט של
// `packages/plugins_manager/lib/src/services/plugin_store_client.dart`.
//
// ── מה השתנה מול המקור ───────────────────────────────────────────────────────
// ההורדה עצמה נעשית ב-host (WinHTTP) ולא כאן, ולכן:
//
//   • **הזרימה לדיסק** — הבייטים לא עוברים דרך ה-JS בכלל. תוסף של עשרות
//     MB אינו יושב ב-RAM, בדיוק כמו במקור, אבל בלי `_streamToFile`.
//   • **ה-stall timeout** הוא `WINHTTP_OPTION_RECEIVE_TIMEOUT`, שהוא
//     ממש "עברו כך וכך בלי שהגיע בייט" — אותה סמנטיקה, בלי טיימר משלנו.
//   • **`.part` והחלפה** נשארו כאן: ה-host כותב לשם שנמסר לו, וההעברה
//     לשם הסופי נעשית אחרי שהכותרות הוכרעו. הורדה שנקטעה אינה משאירה
//     קובץ שנראה כתוסף תקין.

import {S} from '../strings.js';
import {absoluteUrl, resolveAssetNaming} from './net_headers.js';

export const DEFAULT_BASE_URL = 'https://otzaria.org';

/** כשל שמנוסח למשתמש. טיפוס נפרד כדי שהממשק יציג אותו כמו שהוא. */
export class PluginStoreError extends Error {
  constructor(message) {
    super(message);
    this.name = 'PluginStoreError';
  }
}

export class PluginStoreClient {
  /**
   * @param {{baseUrl?: string, net: object, fs: object,
   *          timeoutMs?: number, stallMs?: number}} options
   */
  constructor({baseUrl = DEFAULT_BASE_URL, net, fs, timeoutMs = 20000,
               stallMs = 30000}) {
    this.baseUrl = baseUrl.replace(/\/+$/, '');
    this.net = net;
    this.fs = fs;
    /** זמן קצוב לקבלת התשובה ולקריאות ה-JSON הקטנות במלואן. */
    this.timeoutMs = timeoutMs;
    /** זמן קצוב ל**חוסר התקדמות** בגוף התשובה. */
    this.stallMs = stallMs;
  }

  /**
   * שולף את רשימת התוספים המאושרים. זורק [PluginStoreError] על כל כשל —
   * זה הכשל היחיד שכן צריך לעצור סנכרון (בלי רשימה אין מה לסנכרן).
   *
   * הרשימה מגיעה כשהיא כבר ממוינת: התוספים הנבחרים ראשונים בסדר האצירה
   * של האתר, ואחריהם השאר מהחדש לישן. **הסדר נשמר כמות שהוא.**
   */
  async fetchCatalog() {
    const decoded = await this.#getJson('/api/plugins', S.domain.whatPluginList);
    if (!Array.isArray(decoded)) {
      throw new PluginStoreError(S.domain.responseNotPluginList);
    }
    return decoded.filter((e) => e !== null && typeof e === 'object' &&
                                 !Array.isArray(e));
  }

  /**
   * שולף את דף הבית האצור של החנות — טקסטים, תוספים נבחרים וסיכומי
   * הקטגוריות, הכול בקריאה אחת.
   */
  async fetchStoreHome() {
    return asObject(await this.#getJson('/api/plugins/store-home',
                                        S.domain.whatStoreStructure));
  }

  /**
   * שולף דף קטגוריה שלם — כל התוספים המשובצים בה, בסדר שנקבע באתר.
   * בלי `limit` האתר מחזיר את כל הרשימה, וזה מה שנדרש למראה.
   */
  async fetchCategory(slug) {
    return asObject(await this.#getJson(
        `/api/plugins/categories/${encodeURIComponent(slug)}`,
        S.domain.whatCategory(slug)));
  }

  /** GET + פענוח JSON עם הודעות שגיאה למשתמש. [what] נכנס להודעה. */
  async #getJson(path, what) {
    let response;
    try {
      response = await this.net.get(`${this.baseUrl}${path}`, this.timeoutMs);
    } catch (error) {
      throw new PluginStoreError(S.domain.siteUnreachable(describeError(error)));
    }
    if (response.status !== 200) {
      throw new PluginStoreError(S.domain.loadFailed(what, response.status));
    }
    try {
      return JSON.parse(response.body);
    } catch {
      throw new PluginStoreError(S.domain.responseNotJson(what));
    }
  }

  /**
   * מוריד נכס יחיד אל [destPathNoExt] + הסיומת שהוסקה.
   *
   * @returns {Promise<{path: string, ext: string, size: number,
   *                    originalName: string|null}>}
   */
  async downloadAsset(url, destPathNoExt, preferredExt = '') {
    // ⚠️ ההורדה נכתבת ל-`.part` ורק אחר כך מוחלפת ביעד: הורדה שנקטעה
    // באמצע לא תשאיר קובץ חלקי שנראה כתוסף תקין, והקובץ הקודם שבמראה
    // נשאר שלם עד הרגע האחרון. אותו כלל בדיוק כמו במקור.
    const partPath = `${destPathNoExt}.part`;

    let result;
    try {
      result = await this.net.download(this.absolute(url), partPath,
                                       this.timeoutMs, this.stallMs);
    } catch (error) {
      await this.#discard(partPath);
      throw new PluginStoreError(
          S.domain.siteUnreachable(describeError(error)));
    }

    if (result.status !== 200) {
      await this.#discard(partPath);
      throw new PluginStoreError(S.domain.httpStatusFor(result.status, url));
    }

    const {ext, originalName} = resolveAssetNaming(result, preferredExt);
    const destPath = destPathNoExt + ext;
    try {
      await this.fs.rename(partPath, destPath);
    } catch (error) {
      await this.#discard(partPath);
      throw new PluginStoreError(`${destPath}: ${describeError(error)}`);
    }

    return {path: destPath, ext, size: result.size, originalName};
  }

  /** מנקה `.part` שנשאר מהורדה שלא הושלמה. כשל בניקוי אינו מעניין. */
  async #discard(partPath) {
    try {
      await this.fs.remove(partPath);
    } catch {
      // אין מה לעשות, ואין למי לדווח.
    }
  }

  absolute(url) {
    return absoluteUrl(url, this.baseUrl);
  }
}

/**
 * מתרגמת כשל רשת להודעה למשתמש.
 *
 * ה-host כבר מנסח את השגיאות השכיחות בעברית (`NetworkError` ב-netapi.cpp),
 * ולכן כאן נשאר רק להוציא את הטקסט. במקור זה היה המקום שבו
 * `TimeoutException` ("Future not completed") הוחלף בהודעה אמיתית.
 */
export function describeError(error) {
  if (error === null || error === undefined) return S.domain.networkTimedOut;
  return error.message ?? String(error);
}

function asObject(decoded) {
  if (decoded === null || typeof decoded !== 'object' ||
      Array.isArray(decoded)) {
    throw new PluginStoreError(S.domain.responseUnexpectedShape);
  }
  return decoded;
}
