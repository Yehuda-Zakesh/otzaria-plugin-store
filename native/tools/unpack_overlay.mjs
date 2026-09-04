// פורס overlay מתוך חבילה מלאה חזרה לתיקיית `Data`.
//
//   node native/tools/unpack_overlay.mjs <exe חבילה> <תיקיית יעד>
//
// ── למה זה קיים ──────────────────────────────────────────────────────────────
// לא בשביל המשתמש — אצלו החילוץ נעשה ב-C++ (`native/src/overlay.cpp`).
// זה בשביל **הג'וב**: הוא זורע את המראה מהחבילה הקודמת לפני שהוא מריץ
// את הסנכרון, וכך `#plan` מוריד מ-otzaria.org רק את הדלתא. עדכון של
// תוסף אחד עולה קובץ אחד ולא 96MB.
//
// יוצא 1 כשאין overlay — הג'וב מתייחס לזה כ"אין חבילה קודמת", וזה מצב
// תקין לחלוטין (הפרסום הראשון). 2 = שימוש שגוי או חבילה פגומה.

import {open, mkdir, writeFile} from 'node:fs/promises';
// צירוף של הפלטפורמה ולא `win32` דווקא: הנתיבים בחבילה שמורים ב-`/`
// (ראו `pack_overlay.mjs`), וההרכבה לנתיב מקומי נעשית כאן. עם `win32`
// קשיח הרצה על לינוקס הייתה יוצרת קובץ אחד ששמו מכיל `\` במקום עץ
// תיקיות — בדיוק התקלה ש-bundle.yml מנטרל בכך שהוא רץ על windows.
import {dirname, join, sep} from 'node:path';

const MAGIC = 'OTZBNDL1';
const FOOTER_SIZE = 96;

/**
 * קריאה מלאה מ-offset מוחלט.
 *
 * ⚠️ `read` יחיד **רשאי להחזיר פחות ממה שביקשנו** — זו התנהגות מותרת
 * של הקריאה שמתחתיו, לא תקלה. בלי הלולאה הזאת שארית החוצץ נשארת
 * באפסים ש-`Buffer.alloc` שם, ומה שיוצא הוא קובץ שנראה בגודל הנכון
 * ותוכנו קטוע — בלי שום שגיאה. הצד ה-C++ עושה בדיוק את זה
 * ב-`ReadAt` (native/src/overlay.cpp), וכאן זה היה חסר.
 */
async function readExact(handle, buffer, position) {
  let done = 0;
  while (done < buffer.length) {
    const {bytesRead} =
        await handle.read(buffer, done, buffer.length - done, position + done);
    if (bytesRead === 0) {
      throw new Error(
          `הקובץ נגמר באמצע קריאה ב-offset ${position + done}: ` +
          `התקבלו ${done} מתוך ${buffer.length} בתים`);
    }
    done += bytesRead;
  }
  return buffer;
}

/**
 * נתיב יחסי בטוח, במקביל ל-`SafeRelativePath` שב-native/src/overlay.cpp.
 *
 * ⚠️ הצד ה-C++ **פוסל** נתיב כזה ומסרב לפרוס; בלי הבדיקה כאן הכלי הזה
 * היה פורס אותו בשמחה, ואימות ה-round-trip שב-bundle.yml היה מאשר
 * חבילה שהמשתמש אינו יכול לפתוח. `..` גם מוציא את הכתיבה מתיקיית היעד.
 */
function safeRelativePath(raw) {
  const parts = raw.split('/');
  for (const part of parts) {
    if (part === '' || part === '.' || part === '..') return null;
    if (part.includes('\\') || part.includes(':') || part.includes('\0')) {
      return null;
    }
  }
  return parts.length > 0 ? parts.join(sep) : null;
}

// `--slim` מוציא את ה-exe שבתוך החבילה במקום את המראה.
//
// ⚠️ זה מה שמאפשר לג'וב לזהות **release חדש של החנות**. בלעדיו נוצר פער
// שקט: כשמתפרסם exe חדש המראה אינה משתנה, הגלאי אומר "אין מה לפרסם",
// והחבילה נשארת עם בינארי ישן לנצח. השוואת הבייטים כאן היא התשובה
// המדויקת — בלי לרשום בשום מקום מאיזה תג נבנתה החבילה.
async function main() {
  const slimOnly = process.argv[2] === '--slim';
  const [exePath, outDir] = process.argv.slice(slimOnly ? 3 : 2);
  if (!exePath || !outDir) {
    console.error('usage: node unpack_overlay.mjs [--slim] <bundle exe> <יעד>');
    return 2;
  }

  const handle = await open(exePath, 'r');
  try {
    const {size} = await handle.stat();
    if (size < FOOTER_SIZE) {
      console.error('הקובץ קטן מ-footer — אין overlay');
      return 1;
    }

    const footer = await readExact(handle, Buffer.alloc(FOOTER_SIZE),
                                   size - FOOTER_SIZE);
    if (footer.subarray(0, 8).toString('latin1') !== MAGIC) {
      console.error('אין overlay בקובץ הזה');
      return 1;
    }

    const indexOffset = Number(footer.readBigUInt64LE(8));
    const indexSize = Number(footer.readBigUInt64LE(16));
    const dataOffset = Number(footer.readBigUInt64LE(24));
    const stamp = footer.subarray(32, 96).toString('latin1');

    if (slimOnly) {
      // `outDir` הוא קובץ במצב הזה. ה-exe הרזה הוא בדיוק `dataOffset`
      // הבייטים הראשונים — ראו `pack_overlay.mjs`.
      const slim = await readExact(handle, Buffer.alloc(dataOffset), 0);
      await writeFile(outDir, slim);
      console.log(`ה-exe שבתוך החבילה נכתב אל ${outDir}`);
      return 0;
    }

    const index = await readExact(handle, Buffer.alloc(indexSize), indexOffset);

    let cursor = 0;
    const count = index.readUInt32LE(cursor);
    cursor += 4;

    const entries = [];
    for (let i = 0; i < count; i++) {
      const pathLength = index.readUInt32LE(cursor);
      const fileSize = Number(index.readBigUInt64LE(cursor + 4));
      cursor += 12;
      const raw = index.subarray(cursor, cursor + pathLength).toString('utf8');
      cursor += pathLength;
      const relative = safeRelativePath(raw);
      if (relative === null) {
        console.error(`החבילה מכילה נתיב שאינו חוקי: ${JSON.stringify(raw)}`);
        return 2;
      }
      entries.push({path: relative, size: fileSize});
    }

    // הקבצים יושבים ברצף מיד אחרי ה-exe, בסדר האינדקס.
    let at = dataOffset;
    for (const entry of entries) {
      const full = join(outDir, entry.path);
      await mkdir(dirname(full), {recursive: true});
      await writeFile(full, await readExact(handle, Buffer.alloc(entry.size), at));
      at += entry.size;
    }

    console.log(`נפרסו ${entries.length} קבצים אל ${outDir}`);
    console.log(`חותמת: ${stamp}`);
    return 0;
  } finally {
    await handle.close();
  }
}

try {
  process.exitCode = await main();
} catch (error) {
  console.error(`הפריסה נכשלה: ${error?.stack ?? error}`);
  process.exitCode = 2;
}
