// "האם המראה שנבנתה שונה מזו שכבר פורסמה?" — התשובה שקובעת אם הג'וב
// השבועי מפרסם חבילה חדשה או יוצא בשקט.
//
//   node native/tools/mirror_changed.mjs <catalog לפני> <catalog אחרי>
//                                        <רשימת קבצים לפני> <תיקיית plugins>
//   node native/tools/mirror_changed.mjs --inventory <תיקיית plugins>
//
// יוצא 0 = יש שינוי (יש לפרסם), 1 = אין שינוי, 2 = שימוש שגוי.
//
// ── למה השוואה ולא גיבוב של ה-API ────────────────────────────────────────────
// הפיתוי הוא לגבב את `/api/plugins` ולהשוות. זה שגוי כאן: התשובה נושאת
// `downloadCount` ו-`ratingAvg` שזזים כל שעה, וגיבוב שלה היה מכריז על
// שינוי כמה פעמים ביום ומפרסם ‎96MB זהים.
//
// לכן הגלאי הוא **התוצאה**: הג'וב זורע את החבילה הקודמת, מריץ את
// `PluginMirrorSync` (שכבר יודע בדיוק מה השתנה — זה כל תפקידו של
// `#plan`), ומשווה את המראה שיצאה לזו שנזרעה. אין כאן הגדרה שנייה של
// "מה נחשב שינוי" שתוכל להיפרד מזו שבקוד.
//
// ⚠️ מה שזז מעצמו מנוטרל מההשוואה — חותמת הזמן והמונים. ראו
// [VOLATILE_KEYS]: בלי זה הג'וב היה מפרסם בכל ריצה.

import {readFile, readdir, stat} from 'node:fs/promises';
// צירוף של הפלטפורמה: השם שנרשם ברשימה נבנה בנפרד ב-`/` (ראו
// `inventory`), וזה כאן משמש למעבר על הדיסק בלבד.
import {join as joinHere} from 'node:path';

// `--inventory <תיקיית plugins>` מדפיס את הרשימה בלבד — כך הג'וב מייצר
// את קובץ ה"לפני" מיד אחרי פרישת החבילה הקודמת, באותו קוד שמייצר את
// ה"אחרי". שתי רשימות שנוצרו בשני מימושים אינן ניתנות להשוואה.
if (process.argv[2] === '--inventory') {
  const root = process.argv[3];
  if (!root) {
    console.error('usage: node mirror_changed.mjs --inventory <pluginsDir>');
    process.exit(2);
  }
  process.stdout.write(await inventory(root));
  process.exit(0);
}

const [beforePath, afterPath, beforeInventoryPath, pluginsDir] =
    process.argv.slice(2);
if (!beforePath || !afterPath || !beforeInventoryPath || !pluginsDir) {
  console.error('usage: node mirror_changed.mjs <catalog לפני> <catalog אחרי> ' +
                '<רשימת קבצים לפני> <תיקיית plugins>');
  process.exit(2);
}

/**
 * שדות שזזים בלי שהמראה השתנתה, ולכן אינם נספרים בהשוואה:
 *
 * • `lastSync` — חותמת זמן, זזה בכל ריצה מעצם הגדרתה.
 * • המונים — `downloadCount` ודירוגים. הם נשמרים בקטלוג כי הממשק מציג
 *   אותם, אבל הם משתנים באתר כמה פעמים ביום. בלי הנטרול הזה הג'וב היה
 *   מפרסם ‎96MB **בכל ריצה**, כי תמיד מישהו הוריד תוסף בינתיים. נמדד:
 *   סנכרון שדילג על כל 38 התוספים ולא הוריד דבר עדיין הפיק קטלוג שונה,
 *   ובכל ההבדל היה מונה ההורדות של תוסף אחד.
 *
 * המחיר מדוד ומקובל: החבילה נושאת מונים מהיום שבו נארזה. הם מתרעננים
 * בסנכרון אצל מי שיש לו רשת, ואצל המנותק הם ממילא מספר לידיעה בלבד.
 */
const VOLATILE_KEYS = new Set([
  'lastSync', 'downloadCount',
  'ratingAvg', 'ratingCount', 'ratingVerifiedCount', 'ratingBreakdown',
]);

/** מסיר את [VOLATILE_KEYS] בכל עומק — לא רק ברמה העליונה. */
function stripVolatile(value) {
  if (Array.isArray(value)) return value.map(stripVolatile);
  if (value === null || typeof value !== 'object') return value;
  const out = {};
  for (const [key, inner] of Object.entries(value)) {
    if (!VOLATILE_KEYS.has(key)) out[key] = stripVolatile(inner);
  }
  return out;
}

/** הקטלוג בלי מה שזז מעצמו, כמחרוזת יציבה להשוואה. */
async function stableCatalog(path) {
  try {
    return JSON.stringify(stripVolatile(JSON.parse(await readFile(path, 'utf8'))));
  } catch {
    // אין קטלוג קודם (פרסום ראשון) או שהוא פגום — שינוי, בהגדרה.
    return null;
  }
}

/**
 * רשימת הקבצים שבמראה עם גדליהם, ממוינת.
 *
 * הקטלוג לבדו אינו מספיק: קובץ שנמחק מהדיסק בלי שהקטלוג ישתנה (למשל
 * הורדה שנכשלה בריצה קודמת ונרשמה מהרשומה הישנה) הוא הבדל אמיתי בין
 * החבילות, והמשתמש המנותק הוא זה שמגלה אותו.
 */
async function inventory(root) {
  const out = [];
  async function walk(dir, prefix) {
    let entries;
    try {
      entries = await readdir(dir, {withFileTypes: true});
    } catch {
      return;
    }
    for (const entry of entries) {
      const full = joinHere(dir, entry.name);
      const name = prefix ? `${prefix}/${entry.name}` : entry.name;
      if (entry.isDirectory()) await walk(full, name);
      else out.push(`${name}\t${(await stat(full)).size}`);
    }
  }
  await walk(root, '');
  out.sort();
  return out.join('\n');
}

const before = await stableCatalog(beforePath);
const after = await stableCatalog(afterPath);

if (after === null) {
  console.error('הקטלוג שנבנה אינו קריא — אין מה לפרסם');
  process.exit(2);
}

if (before === null) {
  console.log('אין חבילה קודמת להשוות אליה — מפרסמים');
  process.exit(0);
}

if (before !== after) {
  console.log('הקטלוג השתנה — מפרסמים');
  process.exit(0);
}

// הקטלוג זהה; נשאר לוודא שגם הקבצים עצמם זהים. הרשימה "לפני" נכתבת
// בג'וב מיד אחרי פרישת החבילה הקודמת ולפני הסנכרון.
const previous = await readFile(beforeInventoryPath, 'utf8').catch(() => null);
if (previous !== null && previous !== await inventory(pluginsDir)) {
  console.log('קובצי המראה השתנו — מפרסמים');
  process.exit(0);
}

console.log('המראה זהה לזו שפורסמה — אין מה לפרסם');
process.exit(1);
