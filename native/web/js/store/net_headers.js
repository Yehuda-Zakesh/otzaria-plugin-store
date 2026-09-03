// פירוק כותרות התשובה של הורדת נכס — פורט של החלקים הרלוונטיים ב-
// `packages/plugins_manager/lib/src/services/plugin_store_client.dart`.
//
// ── למה זה כאן ולא בצד ה-C++ ─────────────────────────────────────────────────
// ה-host מוריד בייטים ומחזיר את הכותרות **גולמיות**; ההחלטה על שם הקובץ
// והסיומת היא כאן. זה מכוון: בגרסת ה-Flutter הלוגיקה הזאת ישבה בתוך
// `downloadAsset`, ולכן אי אפשר היה לבדוק אותה בלי רשת אמיתית. כאן היא
// פונקציה טהורה שמכוסה ב-`node --test`.

/** סדר ההסקה זהה למקור: Content-Disposition, אחר כך Content-Type. */
export const EXT_BY_CONTENT_TYPE = Object.freeze({
  'image/png': '.png',
  'image/jpeg': '.jpg',
  'image/jpg': '.jpg',
  'image/webp': '.webp',
  'image/gif': '.gif',
  'image/svg+xml': '.svg',
});

const FILENAME_UTF8 = /filename\*=UTF-8''([^;]+)/i;
const FILENAME_PLAIN = /filename="?([^";]+)"?/i;

/** הסיומת של שם קובץ, כולל הנקודה. ריק כשאין. */
export function extensionOf(fileName) {
  const dot = fileName.lastIndexOf('.');
  // נקודה בתחילת השם היא קובץ מוסתר ולא סיומת.
  return dot > 0 ? fileName.slice(dot) : '';
}

/**
 * מפרק כותרת `Content-Disposition` לשם קובץ וסיומת.
 *
 * תומך גם בצורת `filename*=UTF-8''` (שמות עבריים מגיעים כך) וגם
 * ב-`filename="..."`. מחזיר `null` כשאין שם.
 *
 * @returns {{name: string, ext: string}|null}
 */
export function parseContentDisposition(header) {
  if (!header) return null;

  const utf8Match = FILENAME_UTF8.exec(header);
  if (utf8Match !== null) {
    try {
      const name = decodeURIComponent(utf8Match[1]);
      return {name, ext: extensionOf(name)};
    } catch {
      // כתובת מקודדת פגומה — ננסה את הצורה הפשוטה למטה.
    }
  }

  const plainMatch = FILENAME_PLAIN.exec(header);
  if (plainMatch !== null) {
    const name = plainMatch[1];
    return {name, ext: extensionOf(name)};
  }
  return null;
}

/**
 * מכריע את הסיומת ואת השם המקורי של נכס שירד, מתוך הכותרות.
 *
 * סדר ההסקה זהה למקור: `Content-Disposition`, אחר כך `Content-Type`,
 * ולבסוף [preferredExt] שהקורא ביקש.
 *
 * @param {{contentType?: string, contentDisposition?: string}} headers
 * @param {string} preferredExt
 * @returns {{ext: string, originalName: string|null}}
 */
export function resolveAssetNaming(headers, preferredExt = '') {
  const fromDisposition = parseContentDisposition(headers.contentDisposition);
  const contentType = (headers.contentType ?? '').split(';')[0].trim()
      .toLowerCase();

  let ext = preferredExt;
  let originalName = null;

  if (fromDisposition !== null) {
    if (fromDisposition.ext) ext = fromDisposition.ext;
    originalName = fromDisposition.name;
  } else if (contentType in EXT_BY_CONTENT_TYPE) {
    ext = EXT_BY_CONTENT_TYPE[contentType];
  }

  return {ext, originalName};
}

/**
 * הופך כתובת יחסית למוחלטת מול [baseUrl]. כתובת שכבר מוחלטת חוזרת כמו
 * שהיא, וכתובת ריקה נשארת ריקה.
 */
export function absoluteUrl(url, baseUrl) {
  if (!url) return '';
  if (url.startsWith('http://') || url.startsWith('https://')) return url;
  return `${baseUrl}${url}`;
}
