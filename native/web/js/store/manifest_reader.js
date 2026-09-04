// מחלץ את ה-id האמיתי של התוסף מתוך `manifest.json` שבקובץ ה-.otzplugin.
// פורט של
// `packages/plugins_manager/lib/src/services/plugin_manifest_reader.dart`.
//
// **למה זה קריטי:** ה-`id` שה-API הציבורי מחזיר הוא מזהה מסד-הנתונים של
// האתר, ואילו אוצריא מתקינה תחת `installed/<manifest.id>/`. השוואה לפי
// ה-id של הקטלוג לעולם לא תזהה תוסף מותקן.
//
// ── איך קוראים ZIP בלי ספרייה ────────────────────────────────────────────────
// בגרסת ה-Flutter זה נעשה עם `package:archive`, שקרא את **כל** הקובץ
// לזיכרון (`readAsBytesSync`) — עשרות MB בשביל קובץ JSON של שורות בודדות.
//
// כאן אין ספריית ZIP, ובכל זאת אין צורך בה:
//
//   1. הפורמט עצמו נקרא ידנית — EOCD בזנב, ומשם הספרייה המרכזית. שתי
//      קריאות **מוקדיות** של קילובייטים, לא של הקובץ כולו.
//   2. הפרישה נעשית ב-`DecompressionStream('deflate-raw')`, שהוא חלק
//      מהפלטפורמה — ה-WebView2 שרץ כאן הוא Chromium מודרני, ו-Node תומך
//      בו גם הוא (ולכן הקוד הזה נבדק).
//
// זה גם מה שמאפשר ל-host להישאר טיפש: הוא חושף `fs.readBase64(path,
// offset, length)` ולא יודע מה זה ZIP.

/** חתימות הפורמט. */
const EOCD_SIGNATURE = 0x06054b50;
const CENTRAL_SIGNATURE = 0x02014b50;

/** גודל הזנב שנקרא לחיפוש ה-EOCD: 22 בתים + עד 64KB של הערה. */
const EOCD_SEARCH_SIZE = 66 * 1024;

/** שיטות הדחיסה שאנחנו יודעים לקרוא. */
const STORED = 0;
const DEFLATED = 8;

const MANIFEST_ENTRY_NAME = 'manifest.json';

/**
 * האם הקטע [offset..offset+length) יושב כולו בתוך קובץ בגודל [fileSize].
 *
 * כל מיקום וגודל שהקורא הזה משתמש בהם נלקחים מתוך ה-ZIP עצמו, ולכן הם
 * קלט לא-מהימן: קובץ קטוע או פגום מצהיר עליהם כרצונו.
 */
function withinFile(offset, length, fileSize) {
  return Number.isFinite(offset) && Number.isFinite(length) &&
      offset >= 0 && length >= 0 && offset + length <= fileSize;
}

/** ממיר base64 לבתים. */
function bytesFromBase64(base64) {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

/**
 * קורא את ה-manifest כולו מתוך קובץ .otzplugin.
 *
 * **לא זורק** — מחזיר `null` אם הקובץ אינו ZIP תקין, חסר manifest, או
 * שהקריאה נכשלה מכל סיבה אחרת. תוסף בודד עם קובץ פגום פשוט לא ישווה
 * למותקן, וזה עדיף על הפלת הסנכרון כולו.
 *
 * @param {string} pluginFilePath נתיב מוחלט לקובץ
 * @param {{readBase64: (path: string, offset: number, length: number)
 *          => Promise<string>, stat: (path: string)
 *          => Promise<{size: number}>}} io
 * @returns {Promise<Object|null>}
 */
export async function readPluginManifest(pluginFilePath, io) {
  try {
    const {size} = await io.stat(pluginFilePath);
    if (size <= 0) return null;

    const entry = await findManifestEntry(pluginFilePath, size, io);
    if (entry === null) return null;

    const text = await readEntryText(pluginFilePath, entry, size, io);
    if (text === null) return null;

    // הסרת BOM: עורכים בווינדוס שומרים לעיתים JSON עם U+FEFF מוביל,
    // ו-`JSON.parse` נופל עליו.
    const decoded = JSON.parse(text.replace(/^﻿/, ''));
    return decoded !== null && typeof decoded === 'object' &&
           !Array.isArray(decoded)
        ? decoded
        : null;
  } catch {
    return null;
  }
}

/**
 * מחזיר את ה-id, או `null` אם הקובץ אינו ZIP תקין / חסר manifest / ה-id
 * ריק.
 */
export async function readPluginManifestId(pluginFilePath, io) {
  const manifest = await readPluginManifest(pluginFilePath, io);
  const id = manifest?.id;
  return typeof id === 'string' && id.trim().length > 0 ? id.trim() : null;
}

/** מאתר את רשומת ה-manifest בספרייה המרכזית של ה-ZIP. */
async function findManifestEntry(path, fileSize, io) {
  const tailSize = Math.min(EOCD_SEARCH_SIZE, fileSize);
  const tailOffset = fileSize - tailSize;
  const tail = bytesFromBase64(
      await io.readBase64(path, tailOffset, tailSize));
  const tailView = new DataView(tail.buffer, tail.byteOffset, tail.byteLength);

  // ה-EOCD מחופש מהסוף: ההערה שאחריו באורך משתנה, ולכן אין לו מקום קבוע.
  let eocd = -1;
  for (let i = tail.length - 22; i >= 0; i--) {
    if (tailView.getUint32(i, true) === EOCD_SIGNATURE) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0) return null;

  const centralSize = tailView.getUint32(eocd + 12, true);
  const centralOffset = tailView.getUint32(eocd + 16, true);
  // 0xFFFFFFFF פירושו ZIP64, שאותו איננו קוראים. קובץ תוסף אינו מתקרב
  // ל-4GB, ולכן זה מצב שלא אמור לקרות — ואם קרה, מוטב להחזיר null.
  if (centralOffset === 0xffffffff || centralSize === 0xffffffff) return null;
  if (centralSize === 0) return null;
  // ⚠️ הגדלים והמיקומים מגיעים **מתוך הקובץ**, ולכן הם נבדקים מולו לפני
  // שמבקשים מה-host לקרוא לפיהם. קובץ פגום שמצהיר על ספרייה מרכזית של
  // כמעט 4GB היה גורם להקצאה בגודל הזה בצד ה-host בשביל תוסף של מאות
  // קילובייטים.
  if (!withinFile(centralOffset, centralSize, fileSize)) return null;

  const central = bytesFromBase64(
      await io.readBase64(path, centralOffset, centralSize));
  const view = new DataView(central.buffer, central.byteOffset,
                            central.byteLength);
  const decoder = new TextDecoder('utf-8');

  let cursor = 0;
  while (cursor + 46 <= central.length) {
    if (view.getUint32(cursor, true) !== CENTRAL_SIGNATURE) break;

    const method = view.getUint16(cursor + 10, true);
    const compressedSize = view.getUint32(cursor + 20, true);
    const uncompressedSize = view.getUint32(cursor + 24, true);
    const nameLength = view.getUint16(cursor + 28, true);
    const extraLength = view.getUint16(cursor + 30, true);
    const commentLength = view.getUint16(cursor + 32, true);
    const localOffset = view.getUint32(cursor + 42, true);

    const name = decoder.decode(
        central.subarray(cursor + 46, cursor + 46 + nameLength));

    if (name === MANIFEST_ENTRY_NAME) {
      return {method, compressedSize, uncompressedSize, localOffset};
    }

    cursor += 46 + nameLength + extraLength + commentLength;
  }
  return null;
}

/** קורא ופורש רשומה בודדת. */
async function readEntryText(path, entry, fileSize, io) {
  // הכותרת המקומית: 30 בתים קבועים, ואחריהם שם וה-extra באורך משתנה.
  // הגדלים נלקחים מהספרייה המרכזית ולא מכאן — כשדגל 3 דלוק הם אפס כאן.
  if (!withinFile(entry.localOffset, 30, fileSize)) return null;
  const header = bytesFromBase64(await io.readBase64(path, entry.localOffset, 30));
  const headerView = new DataView(header.buffer, header.byteOffset,
                                  header.byteLength);
  const nameLength = headerView.getUint16(26, true);
  const extraLength = headerView.getUint16(28, true);

  const dataOffset = entry.localOffset + 30 + nameLength + extraLength;
  if (entry.compressedSize === 0) return null;
  // אותה בדיקה כמו על הספרייה המרכזית: `compressedSize` הוא נתון מהקובץ
  // עצמו, ורשומה שמצהירה על יותר ממה שיש בו אינה ניתנת לקריאה.
  if (!withinFile(dataOffset, entry.compressedSize, fileSize)) return null;

  const compressed = bytesFromBase64(
      await io.readBase64(path, dataOffset, entry.compressedSize));

  if (entry.method === STORED) {
    return new TextDecoder('utf-8').decode(compressed);
  }
  if (entry.method !== DEFLATED) return null;

  // `deflate-raw` ולא `deflate`: ב-ZIP הנתונים הם deflate **בלי** מעטפת
  // zlib, ופרישה עם המעטפת נכשלת על הבית הראשון.
  const stream = new Blob([compressed]).stream()
      .pipeThrough(new DecompressionStream('deflate-raw'));
  return await new Response(stream).text();
}
