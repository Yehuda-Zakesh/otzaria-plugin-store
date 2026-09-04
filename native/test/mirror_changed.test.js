// "האם יש מה לפרסם?" — הגלאי שקובע אם הג'וב השבועי מעלה חבילה של ‎96MB
// או יוצא בשקט.
//
// ── למה זה נבדק בקודי יציאה ──────────────────────────────────────────────────
// הקורא היחיד של הכלי הזה הוא ה-workflow, והוא קורא **רק** את קוד
// היציאה. לכן זה מה שנבדק כאן, ולא הודעות: 0 = יש שינוי, 1 = אין שינוי,
// 2 = שימוש שגוי.
//
// ⚠️ הכיוון שהכי כדאי להגן עליו הוא דווקא "אין שינוי": כלי שמכריז על
// שינוי בכל ריצה אינו נראה שבור — הוא פשוט מפרסם ‎96MB זהים כל שבוע, וזה
// מתגלה רק בחשבון. לכן רוב הבדיקות כאן הן על מה ש**אינו** נחשב שינוי.

import assert from 'node:assert/strict';
import {after, before, describe, it} from 'node:test';
import {execFile} from 'node:child_process';
import {mkdtemp, mkdir, rm, writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {dirname, join} from 'node:path';
import {fileURLToPath} from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const TOOL = join(here, '..', 'tools', 'mirror_changed.mjs');

/** קודי היציאה, בשמות — כדי שהבדיקות יקראו כמו החוזה. */
const PUBLISH = 0;
const NOTHING_TO_PUBLISH = 3;
const MISUSE = 2;

let root;
const at = (...parts) => join(root, ...parts);

function run(...args) {
  return new Promise((resolve) => {
    execFile(process.execPath, [TOOL, ...args], {encoding: 'utf8'},
             (error, stdout, stderr) => {
               resolve({code: error ? (error.code ?? 1) : 0, stdout, stderr});
             });
  });
}

/** קטלוג בצורה שהמראה מפיקה בפועל — עם חותמת זמן ועם מונים. */
const catalog = ({lastSync = '2026-01-01T00:00:00Z', version = '1.0.0',
                  downloads = 12, name = 'תוסף לדוגמה'} = {}) => ({
  lastSync,
  plugins: [{
    id: 'com.example.plugin',
    name,
    version,
    downloadCount: downloads,
    ratingAvg: 4.5,
    file: 'plugins/com.example.plugin/plugin-1.0.otzplugin',
  }],
});

const writeJson = async (path, value) =>
    await writeFile(path, JSON.stringify(value), 'utf8');

/** מראת קבצים קטנה עם תת-תיקייה, כמו `Data\plugins\<id>\`. */
async function makePlugins(dir, {size = 40} = {}) {
  await mkdir(join(dir, 'com.example.plugin'), {recursive: true});
  await writeFile(join(dir, 'com.example.plugin', 'plugin-1.0.otzplugin'),
                  Buffer.alloc(size, 1));
  await writeFile(join(dir, 'index.json'), '{}');
  return dir;
}

before(async () => {
  root = await mkdtemp(join(tmpdir(), 'otzaria-changed-'));
});

after(async () => {
  await rm(root, {recursive: true, force: true});
});

describe('mirror_changed — מה שאינו נחשב שינוי', () => {
  let plugins;
  let inventoryPath;

  before(async () => {
    plugins = await makePlugins(at('plugins'));
    inventoryPath = at('before.txt');
    const listed = await run('--inventory', plugins);
    await writeFile(inventoryPath, listed.stdout, 'utf8');
  });

  it('רק lastSync זז — אין מה לפרסם', async () => {
    // ⚠️ זו הנקודה שכל הכלי נשען עליה. `lastSync` הוא חותמת זמן והוא זז
    // בכל ריצה מעצם הגדרתו; השוואה שכוללת אותו הייתה מכריזה על שינוי
    // תמיד, והכלי כולו היה חסר משמעות.
    await writeJson(at('a.json'), catalog({lastSync: '2026-01-01T00:00:00Z'}));
    await writeJson(at('b.json'), catalog({lastSync: '2026-09-04T11:22:33Z'}));
    const result = await run(at('a.json'), at('b.json'), inventoryPath, plugins);
    assert.equal(result.code, NOTHING_TO_PUBLISH, result.stdout + result.stderr);
  });

  it('מונה הורדות שזז — אין מה לפרסם', async () => {
    // המונים נשמרים בקטלוג כי הממשק מציג אותם, אבל הם משתנים באתר כמה
    // פעמים ביום. בלי נטרול שלהם הג'וב היה מפרסם בכל ריצה — תמיד מישהו
    // הוריד תוסף בינתיים.
    await writeJson(at('c.json'), catalog({downloads: 12}));
    await writeJson(at('d.json'), catalog({downloads: 4137}));
    const result = await run(at('c.json'), at('d.json'), inventoryPath, plugins);
    assert.equal(result.code, NOTHING_TO_PUBLISH, result.stdout + result.stderr);
  });

  it('שני הצדדים זהים לחלוטין — אין מה לפרסם', async () => {
    await writeJson(at('e.json'), catalog());
    await writeJson(at('f.json'), catalog());
    const result = await run(at('e.json'), at('f.json'), inventoryPath, plugins);
    assert.equal(result.code, NOTHING_TO_PUBLISH);
  });

  it('אין רשימת קבצים "לפני" — הקטלוג לבדו מכריע', async () => {
    // הרשימה נכתבת בג'וב אחרי פרישת החבילה הקודמת; אם היא חסרה, אין
    // ממה להסיק שהקבצים השתנו — ובוודאי לא להסיק שכן.
    await writeJson(at('g.json'), catalog());
    await writeJson(at('h.json'), catalog());
    const result =
        await run(at('g.json'), at('h.json'), at('אין-רשימה.txt'), plugins);
    assert.equal(result.code, NOTHING_TO_PUBLISH);
  });
});

describe('mirror_changed — מה שכן נחשב שינוי', () => {
  let plugins;
  let inventoryPath;

  before(async () => {
    plugins = await makePlugins(at('plugins2'));
    inventoryPath = at('before2.txt');
    await writeFile(inventoryPath,
                    (await run('--inventory', plugins)).stdout, 'utf8');
  });

  it('גרסת תוסף שהשתנתה — מפרסמים', async () => {
    await writeJson(at('i.json'), catalog({version: '1.0.0'}));
    await writeJson(at('j.json'), catalog({version: '1.1.0'}));
    const result = await run(at('i.json'), at('j.json'), inventoryPath, plugins);
    assert.equal(result.code, PUBLISH);
  });

  it('שם תוסף שהשתנה — מפרסמים', async () => {
    // ההשוואה היא על הקטלוג כולו ולא על רשימת קבצים: תיאור או שם
    // שהתעדכנו הם מה שהמשתמש המנותק רואה, וזו סיבה מספקת לחבילה חדשה.
    await writeJson(at('k.json'), catalog({name: 'תוסף לדוגמה'}));
    await writeJson(at('l.json'), catalog({name: 'תוסף בשם חדש'}));
    const result = await run(at('k.json'), at('l.json'), inventoryPath, plugins);
    assert.equal(result.code, PUBLISH);
  });

  it('אין קטלוג קודם כלל — פרסום ראשון', async () => {
    // ⚠️ ברירת המחדל היא לפרסם ולא להימנע: "אין מול מה להשוות" חייב
    // להסתיים בחבילה, אחרת הפרסום הראשון לעולם אינו קורה.
    await writeJson(at('m.json'), catalog());
    const result =
        await run(at('אין-קטלוג.json'), at('m.json'), inventoryPath, plugins);
    assert.equal(result.code, PUBLISH);
  });

  it('קטלוג קודם פגום — מפרסמים', async () => {
    // JSON שבור אינו ניתן להשוואה, וההנחה הבטוחה היא שהמראה שונה.
    await writeFile(at('שבור.json'), '{לא JSON', 'utf8');
    await writeJson(at('n.json'), catalog());
    const result =
        await run(at('שבור.json'), at('n.json'), inventoryPath, plugins);
    assert.equal(result.code, PUBLISH);
  });

  it('הקטלוג זהה אבל קובץ במראה גדל — מפרסמים', async () => {
    // ⚠️ הקטלוג לבדו אינו מספיק: הורדה שנכשלה בריצה קודמת יכולה להשאיר
    // קובץ חסר או חלקי בלי שהקטלוג ישקף זאת, והמנותק הוא זה שמגלה.
    await writeJson(at('o.json'), catalog());
    await writeJson(at('p.json'), catalog());
    await writeFile(join(plugins, 'com.example.plugin', 'plugin-1.0.otzplugin'),
                    Buffer.alloc(999, 1));
    const result = await run(at('o.json'), at('p.json'), inventoryPath, plugins);
    assert.equal(result.code, PUBLISH);
  });

  it('הקטלוג זהה אבל קובץ נעלם מהמראה — מפרסמים', async () => {
    await writeJson(at('q.json'), catalog());
    await writeJson(at('r.json'), catalog());
    await rm(join(plugins, 'index.json'));
    const result = await run(at('q.json'), at('r.json'), inventoryPath, plugins);
    assert.equal(result.code, PUBLISH);
  });
});

describe('mirror_changed — שימוש שגוי', () => {
  it('בלי ארגומנטים — יציאה 2', async () => {
    // 2 מובחן משניהם בכוונה: ה-workflow אינו אמור לפרש הפעלה שגויה
    // כ"אין מה לפרסם" ולהמשיך בשקט.
    const result = await run();
    assert.equal(result.code, MISUSE);
    assert.match(result.stderr, /usage/);
  });

  it('ארגומנטים חלקיים — יציאה 2', async () => {
    const result = await run(at('a.json'), at('b.json'));
    assert.equal(result.code, MISUSE);
  });

  it('הקטלוג שנבנה אינו קריא — יציאה 2 ולא "אין שינוי"', async () => {
    // ⚠️ קטלוג שלא נבנה הוא כשל של הריצה, לא "המראה לא השתנתה". יציאה 1
    // כאן הייתה מסתירה סנכרון שנפל.
    await writeJson(at('s.json'), catalog());
    const result =
        await run(at('s.json'), at('אין.json'), at('before.txt'), at('plugins'));
    assert.equal(result.code, MISUSE);
  });

  it('--inventory בלי תיקייה — יציאה 2', async () => {
    const result = await run('--inventory');
    assert.equal(result.code, MISUSE);
    assert.match(result.stderr, /usage/);
  });
});

describe('mirror_changed --inventory', () => {
  // הרשימה נוצרת פעמיים באותה ריצה של הג'וב — פעם אחרי פרישת החבילה
  // הקודמת ופעם אחרי הסנכרון. שני מימושים שונים לא היו ניתנים להשוואה,
  // ולכן זהו אותו קוד בדיוק ולכן הוא נבדק בנפרד.

  it('שם יחסי, מפריד "/", גודל אחרי טאב, וממוין', async () => {
    const dir = await makePlugins(at('inv'), {size: 40});
    const result = await run('--inventory', dir);
    assert.equal(result.code, PUBLISH);
    assert.deepEqual(result.stdout.split('\n'), [
      'com.example.plugin/plugin-1.0.otzplugin\t40',
      'index.json\t2',
    ]);
  });

  it('תיקייה שאינה קיימת — פלט ריק ולא כשל', async () => {
    // הרשימה "לפני" מיוצרת גם בפרסום הראשון, שבו אין עדיין תיקייה.
    const result = await run('--inventory', at('אין-תיקייה'));
    assert.equal(result.code, PUBLISH);
    assert.equal(result.stdout, '');
  });

  it('שתי הרצות על אותה תיקייה נותנות אותו פלט', async () => {
    // אם הפלט אינו יציב, ההשוואה בין "לפני" ל"אחרי" מכריזה על שינוי
    // בכל ריצה — בדיוק הכשל שהכלי נועד למנוע.
    const dir = at('inv');
    const first = await run('--inventory', dir);
    const second = await run('--inventory', dir);
    assert.equal(first.stdout, second.stdout);
  });
});
