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
// תקין לחלוטין (הפרסום הראשון).

import {open, mkdir, writeFile} from 'node:fs/promises';
import {win32} from 'node:path';

const MAGIC = 'OTZBNDL1';
const FOOTER_SIZE = 96;

// `--slim` מוציא את ה-exe שבתוך החבילה במקום את המראה.
//
// ⚠️ זה מה שמאפשר לג'וב לזהות **release חדש של החנות**. בלעדיו נוצר פער
// שקט: כשמתפרסם exe חדש המראה אינה משתנה, הגלאי אומר "אין מה לפרסם",
// והחבילה נשארת עם בינארי ישן לנצח. השוואת הבייטים כאן היא התשובה
// המדויקת — בלי לרשום בשום מקום מאיזה תג נבנתה החבילה.
const slimOnly = process.argv[2] === '--slim';
const [exePath, outDir] = process.argv.slice(slimOnly ? 3 : 2);
if (!exePath || !outDir) {
  console.error('usage: node unpack_overlay.mjs [--slim] <bundle exe> <יעד>');
  process.exit(2);
}

const handle = await open(exePath, 'r');
try {
  const {size} = await handle.stat();
  if (size < FOOTER_SIZE) {
    console.error('הקובץ קטן מ-footer — אין overlay');
    process.exit(1);
  }

  const footer = Buffer.alloc(FOOTER_SIZE);
  await handle.read(footer, 0, FOOTER_SIZE, size - FOOTER_SIZE);
  if (footer.subarray(0, 8).toString('latin1') !== MAGIC) {
    console.error('אין overlay בקובץ הזה');
    process.exit(1);
  }

  const indexOffset = Number(footer.readBigUInt64LE(8));
  const indexSize = Number(footer.readBigUInt64LE(16));
  const dataOffset = Number(footer.readBigUInt64LE(24));
  const stamp = footer.subarray(32, 96).toString('latin1');

  if (slimOnly) {
    // `outDir` הוא קובץ במצב הזה. ה-exe הרזה הוא בדיוק `dataOffset`
    // הבייטים הראשונים — ראו `pack_overlay.mjs`.
    const slim = Buffer.alloc(dataOffset);
    await handle.read(slim, 0, dataOffset, 0);
    await writeFile(outDir, slim);
    console.log(`ה-exe שבתוך החבילה נכתב אל ${outDir}`);
    process.exit(0);
  }

  const index = Buffer.alloc(indexSize);
  await handle.read(index, 0, indexSize, indexOffset);

  let cursor = 0;
  const count = index.readUInt32LE(cursor);
  cursor += 4;

  const entries = [];
  for (let i = 0; i < count; i++) {
    const pathLength = index.readUInt32LE(cursor);
    const fileSize = Number(index.readBigUInt64LE(cursor + 4));
    cursor += 12;
    entries.push({
      path: index.subarray(cursor, cursor + pathLength).toString('utf8'),
      size: fileSize,
    });
    cursor += pathLength;
  }

  // הקבצים יושבים ברצף מיד אחרי ה-exe, בסדר האינדקס.
  let at = dataOffset;
  for (const entry of entries) {
    const full = win32.join(outDir, ...entry.path.split('/'));
    await mkdir(win32.dirname(full), {recursive: true});
    const bytes = Buffer.alloc(entry.size);
    if (entry.size > 0) await handle.read(bytes, 0, entry.size, at);
    await writeFile(full, bytes);
    at += entry.size;
  }

  console.log(`נפרסו ${entries.length} קבצים אל ${outDir}`);
  console.log(`חותמת: ${stamp}`);
} finally {
  await handle.close();
}
