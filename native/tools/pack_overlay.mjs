// מצרף מראה שלמה (`Data\`) לסוף ה-exe שכבר נבנה ופורסם, ומייצר את
// החבילה המלאה.
//
//   node native/tools/pack_overlay.mjs <exe רזה> <תיקיית Data> <exe פלט>
//
// ── למה שרשור ולא resource ───────────────────────────────────────────────────
// המטען הוא ~‎96MB, וכל מה שהוא צריך הוא לזרום לדיסק פעם אחת. RCDATA היה
// דורש בנייה מחדש של ה-exe סביבו — כלומר בינארי שאינו זה שנבדק ופורסם —
// ובנוסף `rc.exe`/`link.exe` עם גוש כזה הם עסק כבד. שרשור לסוף ה-PE
// משאיר את הבינארי המקורי **בייט-לבייט** ומאפשר קריאה ב-offset בלי
// למפות דבר לזיכרון.
//
// ⚠️ **אין דחיסה, במכוון.** ה-`.otzplugin` הם ZIP וה-image הם webp/png:
// LZMS עליהם מחזיר אחוזים בודדים תמורת פרישה של ‎96MB לזיכרון. הקבצים
// נשמרים גולמיים, וכך החילוץ הוא העתקה בזרימה בלי הקצאה גדולה אחת.
//
// ── המבנה ────────────────────────────────────────────────────────────────────
//   [ ה-exe המקורי, ללא שינוי ]
//   [ תוכן הקבצים, ברצף, בסדר האינדקס ]
//   [ אינדקס: count(u32), ואז לכל קובץ path_len(u32) size(u64) path(utf8) ]
//   [ footer: 96 בייט קבועים בסוף הקובץ ]
//
// ה-footer בסוף ובגודל קבוע כדי שהקורא יוכל למצוא אותו בקפיצה אחת, בלי
// לסרוק ובלי לדעת מראש כמה גדול המטען.

import {createReadStream, createWriteStream} from 'node:fs';
import {readdir, stat, readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {pipeline} from 'node:stream/promises';
// צירוף של הפלטפורמה: הנתיב שנשמר בחבילה נבנה בנפרד ב-`/` (ראו
// `collect`), וזה כאן משמש לקריאה מהדיסק בלבד.
import {join} from 'node:path';

// חייב להתאים ל-`kOverlayMagic` ב-native/src/overlay.h.
const MAGIC = 'OTZBNDL1';
const FOOTER_SIZE = 96;

const [exePath, dataDir, outPath] = process.argv.slice(2);
if (!exePath || !dataDir || !outPath) {
  console.error('usage: node pack_overlay.mjs <exe> <Data dir> <out exe>');
  process.exit(2);
}

/**
 * כל הקבצים תחת [root], בנתיבים יחסיים בסגנון POSIX וממוינים.
 *
 * **ממוין** כדי שהחותמת תהיה תלויה בתוכן בלבד ולא בסדר שמערכת הקבצים
 * החזירה — אחרת אותה מראה בדיוק הייתה מקבלת חותמת אחרת בכל ריצה,
 * והג'וב היה מפרסם חבילה זהה.
 *
 * `/` ולא `\` — אותו כלל כמו הנתיבים שבקטלוג: מה שנשמר הוא ניטרלי,
 * וההרכבה לנתיב ווינדוס נעשית אצל הקורא.
 */
async function collect(root, prefix = '') {
  const out = [];
  for (const entry of await readdir(root, {withFileTypes: true})) {
    const full = join(root, entry.name);
    const name = prefix ? `${prefix}/${entry.name}` : entry.name;
    if (entry.isDirectory()) out.push(...await collect(full, name));
    else out.push({path: name, full, size: (await stat(full)).size});
  }
  return out.sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
}

const files = await collect(dataDir);
if (files.length === 0) {
  console.error(`${dataDir} ריקה — אין מה לארוז`);
  process.exit(1);
}

// ── האינדקס ──────────────────────────────────────────────────────────────────
const parts = [];
const count = Buffer.alloc(4);
count.writeUInt32LE(files.length);
parts.push(count);
for (const file of files) {
  const path = Buffer.from(file.path, 'utf8');
  const header = Buffer.alloc(12);
  header.writeUInt32LE(path.length, 0);
  header.writeBigUInt64LE(BigInt(file.size), 4);
  parts.push(header, path);
}
const index = Buffer.concat(parts);

// ── הכתיבה ───────────────────────────────────────────────────────────────────
const exeSize = (await stat(exePath)).size;
const out = createWriteStream(outPath);

// החותמת מזהה את החבילה: המחלץ משווה אותה למה שרשום ב-`Data\`, ולפי זה
// יודע אם התיקייה שלידו היא של החבילה הזאת או של קודמת. היא נגזרת
// מהנתיבים ומהתוכן — לא מהזמן — כדי ששתי ריצות על אותה מראה ייתנו אותה
// חבילה ולא יגררו פרסום מיותר.
//
// ⚠️ **האינדקס כולו** נכנס לחותמת, ולא רק שרשור הנתיבים. האינדקס נושא
// את מספר הקבצים, אורך כל נתיב וגודל כל קובץ — כלומר הוא **ממסגר** את
// זרם התוכן שנכנס אחריו. בלי המסגור החותמת הייתה
// `sha256(שרשור הנתיבים ‖ שרשור התוכן)`, ואז שתי מראות שונות שהשרשורים
// שלהן מזדהים מקבלות אותה חותמת: קובץ `ab` שתוכנו `XY` מול שני קבצים
// `a`=`X` ו-`b`=`Y` נותנים את אותם שני שרשורים בדיוק. המחלץ אצל
// המשתמש מכריע לפי החותמת **בלבד** (`main.cpp`), ולכן התנגשות כזאת
// משאירה אצלו את הפרישה הישנה בלי שום סימן.
//
// הצד ה-C++ מתייחס לחותמת כאל 64 תווי hex אטומים — הוא מאמת את הצורה
// ומשווה מחרוזות, ואינו מחשב אותה מחדש — ולכן שינוי הנוסחה כאן אינו
// דורש שינוי שם. מחירו הוא פרסום אחד נוסף: כל מראה קיימת מקבלת חותמת
// חדשה פעם אחת, והמשתמשים פורסים מחדש פעם אחת.
const digest = createHash('sha256');
digest.update(index);

await pipeline(createReadStream(exePath), out, {end: false});

let written = 0;
for (const file of files) {
  const bytes = await readFile(file.full);
  digest.update(bytes);
  if (!out.write(bytes)) await new Promise((r) => out.once('drain', r));
  written += bytes.length;
}

const indexOffset = exeSize + written;
out.write(index);

const footer = Buffer.alloc(FOOTER_SIZE);
footer.write(MAGIC, 0, 'latin1');
footer.writeBigUInt64LE(BigInt(indexOffset), 8);
footer.writeBigUInt64LE(BigInt(index.length), 16);
footer.writeBigUInt64LE(BigInt(exeSize), 24);
footer.write(digest.digest('hex'), 32, 'latin1');
out.write(footer);

await new Promise((resolve, reject) => {
  out.on('error', reject);
  out.end(resolve);
});

const mb = (bytes) => `${(bytes / 1048576).toFixed(1)}MB`;
console.log(`${outPath}`);
console.log(`  exe: ${mb(exeSize)} | מטען: ${mb(written)} | קבצים: ${files.length}`);
console.log(`  סה"כ: ${mb(exeSize + written + index.length + FOOTER_SIZE)}`);
