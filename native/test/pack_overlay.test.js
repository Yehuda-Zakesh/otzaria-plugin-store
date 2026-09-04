// אריזת המראה לסוף ה-exe — הלוך-חזור מלא: אורזים באמת, ואז פורסים כאן
// לפי הפורמט המתועד ומשווים בייט-לבייט.
//
// ── למה כך ולא בדיקת יחידה ───────────────────────────────────────────────────
// הצד השני של הפורמט הזה אינו JS אלא C++ (`overlay` ב-native/src), והוא
// אינו זמין ל-`node --test`. לכן הפורש כאן נכתב **מהתיעוד שבראש
// pack_overlay.mjs** ולא מקוד האורז: אם האורז יסטה מהמבנה המתועד,
// הבדיקה תיפול — וזו בדיוק הסטייה שהיתה מייצרת exe שנבנה בהצלחה ואינו
// מצליח לחלץ את עצמו אצל המשתמש.
//
// ⚠️ החותמת נבדקת כאן על **יציבות**: הג'וב השבועי מפרסם רק כשהמראה
// השתנתה, והחותמת היא מה שמזהה חבילה. חותמת שמושפעת מזמן או מסדר סריקה
// הייתה מפיצה ‎96MB זהים בכל שבוע.

import assert from 'node:assert/strict';
import {after, before, describe, it} from 'node:test';
import {execFile} from 'node:child_process';
import {mkdtemp, mkdir, readFile, rm, writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {dirname, join} from 'node:path';
import {fileURLToPath} from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const TOOL = join(here, '..', 'tools', 'pack_overlay.mjs');

const MAGIC = 'OTZBNDL1';
const FOOTER_SIZE = 96;

let root;
const at = (...parts) => join(root, ...parts);

/** מריץ את הסקריפט ומחזיר את קוד היציאה והפלט, בלי לזרוק. */
function run(...args) {
  return new Promise((resolve) => {
    execFile(process.execPath, [TOOL, ...args], {encoding: 'utf8'},
             (error, stdout, stderr) => {
               resolve({code: error ? (error.code ?? 1) : 0, stdout, stderr});
             });
  });
}

/**
 * הפורש — לפי המבנה המתועד בלבד:
 *
 *   [ה-exe][תוכן הקבצים ברצף][אינדקס][footer בן 96 בייט]
 *   אינדקס: count(u32), ולכל קובץ path_len(u32) size(u64) path(utf8)
 *   footer: magic(8) indexOffset(u64) indexLength(u64) exeSize(u64) sha256(hex)
 */
function unpack(bundle) {
  const footer = bundle.subarray(bundle.length - FOOTER_SIZE);
  const parsed = {
    magic: footer.toString('latin1', 0, 8),
    indexOffset: Number(footer.readBigUInt64LE(8)),
    indexLength: Number(footer.readBigUInt64LE(16)),
    exeSize: Number(footer.readBigUInt64LE(24)),
    digest: footer.toString('latin1', 32, 96),
    files: [],
  };

  const index = bundle.subarray(parsed.indexOffset,
                                parsed.indexOffset + parsed.indexLength);
  let cursor = 4;
  let dataAt = parsed.exeSize;
  const count = index.readUInt32LE(0);
  for (let i = 0; i < count; i++) {
    const pathLength = index.readUInt32LE(cursor);
    const size = Number(index.readBigUInt64LE(cursor + 4));
    const path = index.toString('utf8', cursor + 12, cursor + 12 + pathLength);
    cursor += 12 + pathLength;
    parsed.files.push({path, size,
                       bytes: bundle.subarray(dataAt, dataAt + size)});
    dataAt += size;
  }
  parsed.payloadEnd = dataAt;
  return parsed;
}

/** תיקיית Data קטנה אך מייצגת: תת-תיקייה, שם עברי, ובינארי. */
async function makeData(dir, {plugin = 'תוכן התוסף הראשון'} = {}) {
  await mkdir(join(dir, 'plugins', 'com.example.תוסף'), {recursive: true});
  await mkdir(join(dir, 'images'), {recursive: true});
  await writeFile(join(dir, 'catalog.json'),
                  JSON.stringify({name: 'קטלוג', plugins: 1}));
  await writeFile(join(dir, 'plugins', 'com.example.תוסף', 'plugin-1.0.otzplugin'),
                  plugin, 'utf8');
  await writeFile(join(dir, 'images', 'icon.webp'), Buffer.alloc(300, 0xab));
  return dir;
}

/** "exe" — סתם בייטים; הבדיקה כאן היא על הצירוף, לא על PE. */
const EXE_BYTES = Buffer.alloc(2048, 0x4d);

before(async () => {
  root = await mkdtemp(join(tmpdir(), 'otzaria-overlay-'));
  await writeFile(at('app.exe'), EXE_BYTES);
});

after(async () => {
  await rm(root, {recursive: true, force: true});
});

describe('pack_overlay — הלוך-חזור מול הפורמט', () => {
  let bundle;
  let parsed;

  before(async () => {
    const data = await makeData(at('Data'));
    const result = await run(at('app.exe'), data, at('bundle.exe'));
    assert.equal(result.code, 0, result.stderr);
    bundle = await readFile(at('bundle.exe'));
    parsed = unpack(bundle);
  });

  it('ה-exe המקורי נשאר בייט-לבייט בתחילת הקובץ', async () => {
    // ⚠️ זו ההבטחה שבגללה נבחר שרשור ולא resource: מה שמופץ הוא **בדיוק**
    // הבינארי שנבנה ונחתם, ולא בינארי שנבנה מחדש סביב המטען. שינוי של
    // בייט אחד כאן שובר את החתימה.
    assert.equal(parsed.exeSize, EXE_BYTES.length);
    assert.deepEqual(bundle.subarray(0, parsed.exeSize), EXE_BYTES);
  });

  it('ה-footer הוא 96 בייט עם החתימה OTZBNDL1', () => {
    // הגודל קבוע והמיקום בסוף, כדי שהמחלץ ימצא אותו בקפיצה אחת בלי
    // לסרוק ‎96MB. `MAGIC` הוא מה שמבדיל בין exe עם מטען לבין exe בלעדיו.
    assert.equal(parsed.magic, MAGIC);
    assert.equal(parsed.digest.length, 64, 'sha256 בהקסה תופס 64 תווים');
    assert.match(parsed.digest, /^[0-9a-f]{64}$/);
  });

  it('החישוב סוגר בדיוק: exe + מטען + אינדקס + footer', () => {
    // אם החשבון הזה אינו מדויק, המחלץ קורא מ-offset שגוי ומקבל זבל —
    // בלי שום שגיאה שתסביר למה.
    assert.equal(parsed.indexOffset, parsed.payloadEnd);
    assert.equal(bundle.length,
                 parsed.indexOffset + parsed.indexLength + FOOTER_SIZE);
  });

  it('כל קובץ יוצא זהה למקור, כולל השם העברי והבינארי', async () => {
    const expected = {
      'catalog.json': await readFile(at('Data', 'catalog.json')),
      'images/icon.webp': await readFile(at('Data', 'images', 'icon.webp')),
      'plugins/com.example.תוסף/plugin-1.0.otzplugin':
          await readFile(at('Data', 'plugins', 'com.example.תוסף',
                            'plugin-1.0.otzplugin')),
    };
    assert.equal(parsed.files.length, 3);
    for (const file of parsed.files) {
      assert.ok(file.path in expected, `קובץ לא צפוי: ${file.path}`);
      assert.equal(file.size, expected[file.path].length, file.path);
      assert.deepEqual(file.bytes, expected[file.path], file.path);
    }
  });

  it("הנתיבים נשמרים ב-'/' ולא ב-'\\'", () => {
    // אותו כלל כמו הקטלוג: מה שנשמר ניטרלי, וההרכבה לנתיב ווינדוס נעשית
    // אצל המחלץ. `\` בתוך המחרוזת היה הופך לחלק משם הקובץ.
    for (const file of parsed.files) {
      assert.ok(!file.path.includes('\\'), file.path);
    }
  });

  it('האינדקס ממוין', () => {
    // ⚠️ לא קוסמטי: החותמת נגזרת מהסדר הזה, ומיון הוא מה שהופך אותה
    // לתלויה בתוכן בלבד ולא בסדר שמערכת הקבצים החזירה.
    const paths = parsed.files.map((file) => file.path);
    assert.deepEqual(paths, [...paths].sort());
  });
});

describe('pack_overlay — החותמת', () => {
  it('שתי אריזות של אותה מראה נותנות אותה חותמת', async () => {
    // ⚠️ זו הבדיקה שמונעת פרסום שבועי של ‎96MB זהים. כל תלות בזמן, ב-mtime
    // או בסדר הסריקה הייתה מייצרת חותמת אחרת בכל ריצה — והמחלץ אצל
    // המשתמש היה מפרש כל חבילה כחדשה ופורש הכול מחדש.
    const data = await makeData(at('יציבה'));
    await run(at('app.exe'), data, at('a.exe'));
    await run(at('app.exe'), data, at('b.exe'));
    const a = unpack(await readFile(at('a.exe')));
    const b = unpack(await readFile(at('b.exe')));
    assert.equal(a.digest, b.digest);
    // ולא רק החותמת — החבילה כולה זהה.
    assert.deepEqual(await readFile(at('a.exe')), await readFile(at('b.exe')));
  });

  it('שינוי תוכן של קובץ אחד משנה את החותמת', async () => {
    // הצד השני של אותו מטבע: חותמת שאינה זזה על שינוי אמיתי הייתה
    // משאירה אצל המשתמש את הפרישה הישנה, כי המחלץ משווה חותמות בלבד.
    const data = await makeData(at('שונה'), {plugin: 'תוכן התוסף הראשון'});
    await run(at('app.exe'), data, at('c.exe'));
    const first = unpack(await readFile(at('c.exe'))).digest;

    await writeFile(join(data, 'plugins', 'com.example.תוסף',
                         'plugin-1.0.otzplugin'),
                    'תוכן התוסף השני!!', 'utf8');
    await run(at('app.exe'), data, at('d.exe'));
    assert.notEqual(unpack(await readFile(at('d.exe'))).digest, first);
  });

  it('שם קובץ שהשתנה משנה את החותמת גם כשהתוכן זהה', async () => {
    // הנתיבים נכנסים לחותמת לפני התוכן, כי מראה שבה בילד הוחלף בבילד
    // אחר באותו גודל ותוכן-לכאורה היא עדיין מראה אחרת.
    const data = await makeData(at('שמות'));
    await run(at('app.exe'), data, at('e.exe'));
    const first = unpack(await readFile(at('e.exe'))).digest;

    await rm(join(data, 'images', 'icon.webp'));
    await writeFile(join(data, 'images', 'icon2.webp'), Buffer.alloc(300, 0xab));
    await run(at('app.exe'), data, at('f.exe'));
    assert.notEqual(unpack(await readFile(at('f.exe'))).digest, first);
  });
});

describe('pack_overlay — שימוש שגוי', () => {
  it('בלי ארגומנטים — יציאה 2', async () => {
    // 2 ולא 1: הג'וב מבדיל בין "אין מה לארוז" לבין "הופעל לא נכון".
    const result = await run();
    assert.equal(result.code, 2);
    assert.match(result.stderr, /usage/);
  });

  it('תיקיית Data ריקה — יציאה 1, ובלי לכתוב חבילה', async () => {
    // ⚠️ חבילה בלי מטען היא exe שנראה תקין ואינו מוצא מה לחלץ. עדיף
    // להיכשל בג'וב מאשר לפרסם אותה.
    const empty = at('ריקה');
    await mkdir(empty, {recursive: true});
    const result = await run(at('app.exe'), empty, at('empty.exe'));
    assert.equal(result.code, 1);
    assert.match(result.stderr, /ריקה/);
  });
});
