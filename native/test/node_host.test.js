// שכבת ה-fs שה-CI מריץ בה את `PluginMirrorSync` — מול מערכת קבצים אמיתית.
//
// ── למה יש כאן בדיקות בכלל ───────────────────────────────────────────────────
// `node_host.mjs` אינו מחליט דבר על תוספים; הוא **חיקוי של חוזה ה-host**
// (`native/src/fsapi.cpp`). כל פרט שנקבע שם ולא הועתק לכאן במדויק מייצר
// את הכשל הגרוע ביותר שיש לפרויקט הזה: CI שמצליח, מפרסם חבילה, והתוכנה
// אצל המשתמש מתנהגת אחרת. ולהפך — הקוד שקורא לשכבה הזאת נכתב מול ה-host,
// ולכן הוא נשען על הפרטים האלה בלי לבדוק אותם.
//
// הפרטים שנבדקים כאן הם בדיוק אלה שמסומנים "כמו ב-host" במקור.

import assert from 'node:assert/strict';
import {after, before, describe, it} from 'node:test';
import {mkdtemp, mkdir, readdir, readFile, rm, writeFile}
    from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';

import {fs} from '../tools/node_host.mjs';

/** תיקיית עבודה זמנית — הבדיקות כאן נוגעות בדיסק אמיתי ולא ב-mock. */
let root;
const at = (...parts) => join(root, ...parts);

before(async () => {
  root = await mkdtemp(join(tmpdir(), 'otzaria-host-'));
});

after(async () => {
  await rm(root, {recursive: true, force: true});
});

describe('list — הסריקה שכל מפת המראה נבנית ממנה', () => {
  it('תיקייה שאינה קיימת מחזירה רשימה ריקה ולא זורקת', async () => {
    // ⚠️ כמו ב-host. הקורא (`mirror_store.js`) סורק תיקיית תוסף לפני
    // שהיא קיימת — בסנכרון הראשון אין אף אחת מהן. חריג כאן היה מפיל את
    // הסנכרון כולו במקום להתחיל אותו.
    assert.deepEqual(await fs.list(at('אין-כזאת')), []);
  });

  it('נתיב שהוא קובץ ולא תיקייה מחזיר אף הוא רשימה ריקה', async () => {
    // ENOTDIR ולא ENOENT — קוד שגיאה אחר, אותה משמעות לקורא: אין כאן
    // תוכן לסרוק.
    const file = at('קובץ.txt');
    await writeFile(file, 'x');
    assert.deepEqual(await fs.list(file), []);
  });

  it('תיקייה ריקה — רשימה ריקה, וזה אינו כשל', async () => {
    const dir = at('ריקה');
    await mkdir(dir);
    assert.deepEqual(await fs.list(dir), []);
  });

  it('כל רשומה היא {name, dir, size, modified}, ותיקיות מסומנות', async () => {
    // ארבעת השדות האלה הם כל מה שהקורא מקבל, ו-`dir` הוא מה שמפריד בין
    // "תיקיית תוסף" לבין "קובץ בילד". סימון שגוי שלו היה גורר ניסיון
    // לקרוא תיקייה כקובץ .otzplugin.
    const dir = at('מראה');
    await mkdir(join(dir, 'תת-תיקייה'), {recursive: true});
    await writeFile(join(dir, 'בילד.otzplugin'), 'שנים עשר');

    const entries = (await fs.list(dir)).sort((a, b) =>
        a.name < b.name ? -1 : 1);
    assert.equal(entries.length, 2);

    const [file, sub] = entries;
    assert.equal(file.name, 'בילד.otzplugin');
    assert.equal(file.dir, false);
    // ⚠️ בבייטים ולא בתווים: 'שנים עשר' הוא 8 תווים ו-15 בייטים ב-UTF-8.
    // גודל שנמדד בתווים היה מכריז על "התוסף השתנה" בכל סנכרון.
    assert.equal(file.size, Buffer.byteLength('שנים עשר', 'utf8'));
    assert.ok(file.modified > 0, 'חותמת הזמן חייבת להיות מספר של ממש');

    assert.equal(sub.name, 'תת-תיקייה');
    assert.equal(sub.dir, true);
  });

  it('הגודל אינו 0 — הנתיב הפנימי ל-stat חייב להיות נתיב אמיתי', async () => {
    // ⚠️ זו הרגרסיה היקרה: `list` מצרפת את שם הרשומה לנתיב כדי לעשות
    // עליה stat, וצירוף שאינו של הפלטפורמה נכשל בשקט ומחזיר `size: 0`
    // לכל קובץ. התוצאה היא מראה שנראית מלאה ושכל קבציה "ריקים", וההשוואה
    // מול הקטלוג הייתה מורידה הכול מחדש בכל ריצה.
    const dir = at('גדלים');
    await mkdir(dir);
    await writeFile(join(dir, 'a.bin'), Buffer.alloc(4096, 7));
    const [entry] = await fs.list(dir);
    assert.equal(entry.size, 4096);
  });
});

describe('remove — "המצב המבוקש הושג"', () => {
  it('קובץ שאינו קיים הוא הצלחה', async () => {
    // כמו ב-host. הקורא גורע בילד ישן אחרי שהחדש ירד; אם ריצה קודמת
    // נקטעה אחרי המחיקה ולפני עדכון הקטלוג, המחיקה תתבצע שוב — וזה
    // אינו מצב שגיאה.
    assert.equal(await fs.remove(at('מעולם-לא-היה.otzplugin')), true);
  });

  it('קובץ קיים נמחק', async () => {
    const file = at('למחיקה.bin');
    await writeFile(file, 'x');
    assert.equal(await fs.remove(file), true);
    assert.equal(await fs.kind(file), 'none');
  });
});

describe('writeText/readText — הקטלוג נכתב ונקרא בעברית', () => {
  it('הלוך-חזור על טקסט עברי (UTF-8)', async () => {
    // כל שמות התוספים בקטלוג הם עברית. קידוד שגוי כאן אינו מתגלה
    // כשגיאה אלא כשמות משובשים בכל דף בחנות.
    const path = at('קטלוג', 'catalog.json');
    const text = JSON.stringify({name: 'תוסף לדוגמה', note: 'שלום ✡'});
    assert.equal(await fs.writeText(path, text), true);
    assert.equal(await fs.readText(path), text);
    // ובאמת UTF-8 על הדיסק, ולא ברירת מחדל אחרת של המערכת:
    assert.equal((await readFile(path)).toString('utf8'), text);
  });

  it('תיקיית האב נוצרת מאליה', async () => {
    // כמו ב-host: הקורא כותב קטלוג לתיקייה שטרם קיימת בפרסום הראשון.
    const path = at('חדשה', 'עמוק', 'יותר', 'file.json');
    await fs.writeText(path, '{}');
    assert.equal(await fs.readText(path), '{}');
  });

  it('לא נשאר קובץ ‎.tmp אחרי כתיבה מוצלחת', async () => {
    // הכתיבה היא דרך קובץ זמני ושינוי שם, כדי שקטלוג לא יישאר חצי-כתוב.
    // אם ה-tmp שורד, הוא נכנס לחבילה ומתגלה כקובץ זר אצל המשתמש.
    const dir = at('זמניים');
    await fs.writeText(join(dir, 'catalog.json'), '{"a":1}');
    assert.deepEqual(await readdir(dir), ['catalog.json']);
  });

  it('כתיבה חוזרת דורסת ואינה מוסיפה', async () => {
    const path = at('דריסה.json');
    await fs.writeText(path, 'ארוך מאוד מאוד');
    await fs.writeText(path, 'קצר');
    assert.equal(await fs.readText(path), 'קצר');
  });
});

describe('kind — הבדיקה שמחליפה "האם קיים"', () => {
  it("'file' / 'dir' / 'none'", async () => {
    // שלושה ערכים ולא בוליאני: הקורא צריך להבחין בין "אין" לבין "יש,
    // אבל זה תיקייה" — שגיאת המשתמש הנפוצה של תיקייה בשם של קובץ.
    const file = at('kind.txt');
    const dir = at('kind-dir');
    await writeFile(file, 'x');
    await mkdir(dir);
    assert.equal(await fs.kind(file), 'file');
    assert.equal(await fs.kind(dir), 'dir');
    assert.equal(await fs.kind(at('kind-none')), 'none');
  });

  it('fileExists/dirExists נגזרים ממנו ואינם זורקים', async () => {
    assert.equal(await fs.fileExists(at('kind.txt')), true);
    assert.equal(await fs.fileExists(at('kind-dir')), false);
    assert.equal(await fs.dirExists(at('kind-dir')), true);
    assert.equal(await fs.dirExists(at('kind-none')), false);
  });
});

describe('readBase64 — קריאת קטע, מה ש-manifest_reader נשען עליו', () => {
  // ⚠️ זו הפונקציה היחידה שמאפשרת לקרוא `manifest.json` מתוך .otzplugin
  // בלי לפרוש את ה-ZIP: הקורא קופץ לספרייה המרכזית בסוף הקובץ ומושך
  // ממנה קטעים. offset או אורך שאינם מדויקים מייצרים "תוסף פגום" על
  // קובץ תקין לגמרי.
  const payload = Buffer.from('0123456789abcdef', 'latin1');
  let path;

  before(async () => {
    path = at('קטעים.bin');
    await writeFile(path, payload);
  });

  const decode = (b64) => Buffer.from(b64, 'base64');

  it('קטע באמצע — בדיוק הבייטים שנתבקשו', async () => {
    assert.deepEqual(decode(await fs.readBase64(path, 4, 6)),
                     payload.subarray(4, 10));
  });

  it('מההתחלה ומהסוף', async () => {
    assert.deepEqual(decode(await fs.readBase64(path, 0, 16)), payload);
    assert.deepEqual(decode(await fs.readBase64(path, 15, 1)),
                     payload.subarray(15));
  });

  it('בקשה שחורגת מסוף הקובץ מקוצצת ואינה מרפדת באפסים', async () => {
    // ⚠️ ריפוד היה נראה כמו ZIP עם זנב אפסים, והקורא היה מחפש בו חתימה
    // שאינה שם. ה-host מחזיר את מה שנקרא בפועל, ולא יותר.
    assert.deepEqual(decode(await fs.readBase64(path, 12, 100)),
                     payload.subarray(12));
    assert.equal(await fs.readBase64(path, 999, 10), '');
  });

  it('אורך 0 מחזיר מחרוזת ריקה', async () => {
    assert.equal(await fs.readBase64(path, 0, 0), '');
  });

  it('offset ואורך מתקבלים גם כמחרוזות', async () => {
    // הערכים חוצים את הגשר כ-JSON, ומגיעים לא פעם כמחרוזת. `Number()`
    // במקור הוא בדיוק בשביל זה — בלעדיו `read` היה מקבל NaN.
    assert.deepEqual(decode(await fs.readBase64(path, '4', '6')),
                     payload.subarray(4, 10));
  });
});

describe('rename/copy — יעד בתיקייה שטרם קיימת', () => {
  // כמו ב-host: ההורדה נכתבת לקובץ זמני ואז עוברת למקומה תחת
  // `plugins\<id>\`, ותיקיית התוסף אינה קיימת בהורדה הראשונה. בלי יצירת
  // האב, כל תוסף חדש היה נכשל.

  it('rename יוצר את תיקיית האב', async () => {
    const from = at('מקור-rename.bin');
    const to = at('יעד', 'תוסף', 'plugin-1.0.otzplugin');
    await writeFile(from, 'תוכן');
    assert.equal(await fs.rename(from, to), true);
    assert.equal(await fs.readText(to), 'תוכן');
    assert.equal(await fs.kind(from), 'none', 'המקור אמור להיעלם');
  });

  it('copy יוצר את תיקיית האב ומשאיר את המקור', async () => {
    const from = at('מקור-copy.bin');
    const to = at('יעד-העתקה', 'עוד', 'copy.bin');
    await writeFile(from, 'תוכן');
    assert.equal(await fs.copy(from, to), true);
    assert.equal(await fs.readText(to), 'תוכן');
    assert.equal(await fs.kind(from), 'file');
  });
});

describe('mkdirs', () => {
  it('יוצר שרשרת שלמה, וקריאה חוזרת אינה כשל', async () => {
    // כמו ב-host: התיקייה כבר קיימת בכל ריצה שנייה ואילך.
    const dir = at('שרשרת', 'א', 'ב');
    assert.equal(await fs.mkdirs(dir), true);
    assert.equal(await fs.mkdirs(dir), true);
    assert.equal(await fs.kind(dir), 'dir');
  });
});

describe('stat', () => {
  it('מחזיר {size, modified} בלבד, ו-modified שלם', async () => {
    // ⚠️ `modified` נכתב לקטלוג ומושווה שם. ערך שבור (`mtimeMs` עם שבר)
    // אינו שווה לעצמו אחרי מסע הלוך-חזור ב-JSON בגרסאות שונות, וכל
    // השוואה כזאת הייתה מכריזה על שינוי.
    const path = at('stat.bin');
    await writeFile(path, Buffer.alloc(123));
    const info = await fs.stat(path);
    assert.deepEqual(Object.keys(info).sort(), ['modified', 'size']);
    assert.equal(info.size, 123);
    assert.equal(Number.isInteger(info.modified), true);
  });

  it('קובץ שאינו קיים — זורק', async () => {
    // בניגוד ל-`list` ול-`remove`: כאן אין "מצב מבוקש", והקורא חייב
    // לדעת שאין קובץ ולא לקבל גודל 0 מזויף.
    await assert.rejects(() => fs.stat(at('אין.bin')));
  });
});
