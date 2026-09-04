// שכבת האחסון של המראה: הסינון של שמות שמגיעים מהרשת, וניקוי הקבצים
// שכבר אינם בקטלוג.
//
// ⚠️ שתי הבדיקות המסוכנות כאן הן דווקא ה**שליליות** — מה ש-
// `pruneUnusedFiles` אינו מוחק. כלי שמוחק יותר מדי אינו נראה שבור: הוא
// פשוט מוריד הכול שוב בסנכרון הבא, וזה מתגלה רק במחשב הלא-מקוון.

import assert from 'node:assert/strict';
import {describe, it} from 'node:test';

import {PluginMirrorStore} from '../web/js/store/mirror_store.js';
import {PluginLocalFile, StorePlugin} from '../web/js/store/models.js';

const PATHS = Object.freeze({
  dataDir: 'C:\\Data',
  pluginsDir: 'C:\\Data\\plugins',
  catalogPath: 'C:\\Data\\catalog.json',
});

const trim = (path) => path.replace(/[\\/]+$/, '');
const key = (path) => trim(path).toLowerCase();

/**
 * fs בזיכרון בחוזה שהגשר חושף (`native/src/fsapi.h`) — נתיבי ווינדוס,
 * והשוואה בלי תלות באותיות גדולות/קטנות, כמו מערכת הקבצים עצמה.
 *
 * תיקיות אינן נשמרות בנפרד: קיומן נגזר מהקבצים שבתוכן, וזו בדיוק הסיבה
 * שתיקייה ריקה אינה שורדת אריזה — מה שהבדיקות כאן שומרות עליו.
 */
function memoryFs(paths = []) {
  const files = new Map();
  for (const path of paths) files.set(key(path), trim(path));

  return {
    files,
    removedDirs: [],
    /** נתיבים ש-`remove` ייכשל עליהם — קובץ נעול ע"י אנטי-וירוס. */
    locked: new Set(),
    /** `true` כשה-host אינו חושף מחיקת תיקייה (גשר ותיק). */
    withoutRemoveDir: false,

    async kind(path) {
      const k = key(path);
      if (files.has(k)) return 'file';
      for (const existing of files.keys()) {
        if (existing.startsWith(`${k}\\`)) return 'dir';
      }
      return 'none';
    },
    async fileExists(path) {
      return (await this.kind(path)) === 'file';
    },
    async dirExists(path) {
      return (await this.kind(path)) === 'dir';
    },

    async list(path) {
      const prefix = `${key(path)}\\`;
      const out = new Map();
      for (const [k, original] of files) {
        if (!k.startsWith(prefix)) continue;
        const rest = original.slice(prefix.length);
        const cut = rest.indexOf('\\');
        const name = cut < 0 ? rest : rest.slice(0, cut);
        out.set(name.toLowerCase(), {name, dir: cut >= 0, size: 1,
                                     modified: 0});
      }
      return [...out.values()];
    },

    async remove(path) {
      if (this.locked.has(key(path))) throw new Error('הקובץ נעול');
      files.delete(key(path));
      return true;
    },
    async mkdirs() {
      return true;
    },
    get removeDir() {
      if (this.withoutRemoveDir) return undefined;
      return async (path) => {
        this.removedDirs.push(path);
        return true;
      };
    },
  };
}

const localFile = (version) => new PluginLocalFile({
  relativePath: `p/plugin-${version}.otzplugin`,
  fileName: `plugin-${version}.otzplugin`,
  ext: '.otzplugin',
  size: 1,
});

/** תוסף שהקטלוג מחזיק עבורו את הבילדים [versions] ואת הנכסים שנמסרו. */
const plugin = (versions, {imagePath = null, screenshotPaths = []} = {}) =>
    new StorePlugin({
      id: 'p',
      name: 'תוסף',
      imagePath,
      screenshotPaths,
      localFiles: new Map(versions.map((v) => [v, localFile(v)])),
    });

const DIR = 'C:\\Data\\plugins\\p';
const buildAt = (version) => `${DIR}\\plugin-${version}.otzplugin`;

describe('sanitizeId', () => {
  // ⚠️ הגרסה עברה סינון והמזהה לא, למרות ששניהם מגיעים מאותה תשובה של
  // האתר — והמזהה הוא זה שנכנס לשם **תיקייה**.
  it('מזהה רגיל אינו משתנה', () => {
    assert.equal(PluginMirrorStore.sanitizeId('com.example.plugin'),
                 'com.example.plugin');
    assert.equal(PluginMirrorStore.sanitizeId('abc-123_x+1'), 'abc-123_x+1');
  });

  it('מפרידי נתיב ותווים אסורים מוחלפים', () => {
    assert.equal(PluginMirrorStore.sanitizeId('a\\b'), 'a_b');
    assert.equal(PluginMirrorStore.sanitizeId('a/b'), 'a_b');
    assert.equal(PluginMirrorStore.sanitizeId('C:evil'), 'C_evil');
    assert.equal(PluginMirrorStore.sanitizeId('a*b?c'), 'a_b_c');
  });

  it('נקודה ונקודתיים אינם תיקיית אב', () => {
    // אלה אינם תווים אסורים ולכן הם שורדים את ההחלפה — והיו מוציאים את
    // ההורדה מ-`plugins\` החוצה.
    assert.equal(PluginMirrorStore.sanitizeId('.'), '_');
    assert.equal(PluginMirrorStore.sanitizeId('..'), '__');
    assert.equal(PluginMirrorStore.sanitizeId('...'), '___');
  });

  it('מזהה ריק אינו הופך לשורש plugins עצמו', () => {
    assert.equal(PluginMirrorStore.sanitizeId(''), '_');
  });

  it('pluginDir אינו יוצא מתיקיית התוספים', () => {
    const store = new PluginMirrorStore(PATHS, memoryFs());
    assert.equal(store.pluginDir('..\\..\\Windows\\Temp'),
                 'C:\\Data\\plugins\\.._.._Windows_Temp');
    assert.equal(store.pluginDir('..'), 'C:\\Data\\plugins\\__');
    assert.equal(store.pluginDir(''), 'C:\\Data\\plugins\\_');
    // הבילד יורד לתוך התיקייה המסוננת, לא לצדה.
    assert.equal(store.pluginFilePathNoExt('..', '1.0.0'),
                 'C:\\Data\\plugins\\__\\plugin-1.0.0');
  });
});

describe('resolveAgainst', () => {
  const ROOT = 'C:\\Data\\plugins';

  it('נתיב יחסי תקין נפתר לתוך השורש', () => {
    assert.equal(
        PluginMirrorStore.resolveAgainst(ROOT, 'p/plugin-1.0.0.otzplugin'),
        'C:\\Data\\plugins\\p\\plugin-1.0.0.otzplugin');
    assert.equal(PluginMirrorStore.resolveAgainst(ROOT, 'p/image.png'),
                 'C:\\Data\\plugins\\p\\image.png');
    // שורש עם לוכסן בסוף אינו מכפיל אותו.
    assert.equal(PluginMirrorStore.resolveAgainst('C:\\Data\\plugins\\', 'a/b'),
                 'C:\\Data\\plugins\\a\\b');
  });

  // ⚠️ `saveCopy` ו-`install` שניהם צורכים את התוצאה, וקטלוג פגום או
  // שנערך ביד יכול היה להצביע מכאן על קובץ כלשהו בכונן.
  it('נתיב שיוצא מהשורש נפסל', () => {
    for (const bad of ['../../outside/x.otzplugin', 'p/../../x',
                       '..', 'p/..', './../x']) {
      assert.throws(() => PluginMirrorStore.resolveAgainst(ROOT, bad),
                    /יוצא מתיקיית התוספים/, `הנתיב ${bad}`);
    }
  });

  it('נתיב עם לוכסן הפוך מפוצל ולא נבלע כמקטע אחד', () => {
    // הפיצול היה על `/` בלבד, ולכן `..\..\x` שרד כמקטע **אחד** שמכיל
    // מפרידים — ועבר את הסינון של המקטעים הריקים בשלמותו.
    assert.throws(
        () => PluginMirrorStore.resolveAgainst(ROOT, '..\\..\\outside\\x'),
        /יוצא מתיקיית התוספים/);
    assert.equal(PluginMirrorStore.resolveAgainst(ROOT, 'p\\image.png'),
                 'C:\\Data\\plugins\\p\\image.png');
  });

  it('נתיב מוחלט נפסל', () => {
    for (const bad of ['C:\\Windows\\System32\\x.dll', '/etc/passwd',
                       '\\\\server\\share\\x', '\\Windows\\x']) {
      assert.throws(() => PluginMirrorStore.resolveAgainst(ROOT, bad),
                    /נתיב מוחלט/, `הנתיב ${bad}`);
    }
  });

  it('נתיב ריק נפסל', () => {
    assert.throws(() => PluginMirrorStore.resolveAgainst(ROOT, ''),
                  /נתיב ריק/);
  });

  // מראה שנכתבה לפני `sanitizeId` עשויה לשאת תיקייה בשם שאינו ASCII,
  // והיא חייבת להמשיך להיקרא: מה שנפסל הוא יציאה מהמראה, לא תו חריג.
  it('שם תיקייה בעברית ממראה ותיקה עדיין נקרא', () => {
    assert.equal(PluginMirrorStore.resolveAgainst(ROOT, 'תוסף/plugin.otzplugin'),
                 'C:\\Data\\plugins\\תוסף\\plugin.otzplugin');
  });
});

describe('hasAsset', () => {
  it('נתיב שיוצא מהמראה נענה ב-false', async () => {
    const store = new PluginMirrorStore(PATHS, memoryFs());
    assert.equal(await store.hasAsset('../../outside/x.otzplugin'), false);
  });

  it('כשל בקריאת הדיסק נענה ב-false ולא בחריג', async () => {
    // הפונקציה נקראת בשלב התכנון, לפני שנשמר משהו — חריג ממנה הפיל את
    // הסנכרון כולו לפני שהקטלוג נכתב.
    const fs = memoryFs();
    fs.fileExists = async () => {
      throw new Error('הגישה נדחתה');
    };
    const store = new PluginMirrorStore(PATHS, fs);
    assert.equal(await store.hasAsset('p/plugin-1.0.0.otzplugin'), false);
  });
});

describe('pruneUnusedFiles', () => {
  it('מוחק בילד שאינו בקטלוג ומשאיר את זה שכן', async () => {
    const fs = memoryFs([buildAt('3.0.0'), buildAt('2.0.0')]);
    const store = new PluginMirrorStore(PATHS, fs);

    assert.equal(await store.pruneUnusedFiles(plugin(['3.0.0'])), 1);
    assert.equal(fs.files.has(key(buildAt('3.0.0'))), true);
    assert.equal(fs.files.has(key(buildAt('2.0.0'))), false);
  });

  it('אינו נוגע בתמונה ובצילומי המסך שהקטלוג מפנה אליהם', async () => {
    const fs = memoryFs([`${DIR}\\image.png`, `${DIR}\\screenshot-0.png`,
                         buildAt('2.0.0')]);
    const store = new PluginMirrorStore(PATHS, fs);

    assert.equal(await store.pruneUnusedFiles(plugin([], {
      imagePath: 'p/image.png',
      screenshotPaths: ['p/screenshot-0.png'],
    })), 1);
    assert.equal(fs.files.has(key(`${DIR}\\image.png`)), true);
    assert.equal(fs.files.has(key(`${DIR}\\screenshot-0.png`)), true);
  });

  // ⚠️ אלה נשארו על הכונן לנצח: הם נדרסו רק כשנכס **חדש** ירד, ותמונה
  // שהאתר הסיר אינה הורדה חדשה.
  it('מוחק תמונה שהאתר הסיר', async () => {
    const fs = memoryFs([`${DIR}\\image.png`]);
    const store = new PluginMirrorStore(PATHS, fs);

    assert.equal(await store.pruneUnusedFiles(plugin([])), 1);
    assert.equal(fs.files.has(key(`${DIR}\\image.png`)), false);
    assert.deepEqual(fs.removedDirs, [DIR], 'והתיקייה שנותרה ריקה');
  });

  it('מוחק צילום מסך שנשר מרשימה שהתכווצה', async () => {
    const fs = memoryFs([`${DIR}\\screenshot-0.png`,
                         `${DIR}\\screenshot-1.png`,
                         `${DIR}\\screenshot-2.png`]);
    const store = new PluginMirrorStore(PATHS, fs);

    assert.equal(await store.pruneUnusedFiles(plugin([], {
      screenshotPaths: ['p/screenshot-0.png', 'p/screenshot-1.png'],
    })), 1);
    assert.equal(fs.files.has(key(`${DIR}\\screenshot-1.png`)), true);
    assert.equal(fs.files.has(key(`${DIR}\\screenshot-2.png`)), false);
  });

  it('אינו נוגע בקובץ שאינו מהסנכרון', async () => {
    // קובץ שמישהו הניח בתיקייה אינו שלנו, ולכן אינו נוגע לנו.
    const fs = memoryFs([buildAt('2.0.0'), `${DIR}\\הערות.txt`]);
    const store = new PluginMirrorStore(PATHS, fs);

    assert.equal(await store.pruneUnusedFiles(plugin([])), 1);
    assert.equal(fs.files.has(key(`${DIR}\\הערות.txt`)), true);
    assert.deepEqual(fs.removedDirs, [], 'ולכן התיקייה אינה ריקה');
  });

  // ⚠️ תיקייה ריקה אינה שורדת את סבב האריזה-ופרישה של החבילה היומית,
  // ולכן `diff -r` שמאמת את הפרישה מול המקור נכשל — על תיקייה שאין בה
  // דבר.
  it('מוחק את התיקייה שנותרה ריקה', async () => {
    const fs = memoryFs([buildAt('2.0.0')]);
    const store = new PluginMirrorStore(PATHS, fs);

    assert.equal(await store.pruneUnusedFiles(plugin([])), 1);
    assert.deepEqual(fs.removedDirs, [DIR]);
  });

  it('אינו מוחק תיקייה שנשארה בה תמונה', async () => {
    const fs = memoryFs([buildAt('2.0.0'), `${DIR}\\image.png`]);
    const store = new PluginMirrorStore(PATHS, fs);

    await store.pruneUnusedFiles(plugin([], {imagePath: 'p/image.png'}));
    assert.deepEqual(fs.removedDirs, []);
  });

  it('אינו מוחק תיקייה שנשאר בה בילד שהקטלוג מחזיק', async () => {
    const fs = memoryFs([buildAt('3.0.0'), buildAt('2.0.0')]);
    const store = new PluginMirrorStore(PATHS, fs);

    await store.pruneUnusedFiles(plugin(['3.0.0']));
    assert.deepEqual(fs.removedDirs, []);
  });

  it('אינו מוחק תיקייה כשהמחיקה עצמה נכשלה', async () => {
    // קובץ נעול נשאר על הדיסק, ולכן התיקייה אינה ריקה — גם אם הספירה
    // שלנו חשבה אחרת.
    const fs = memoryFs([buildAt('2.0.0'), buildAt('1.0.0')]);
    fs.locked.add(key(buildAt('1.0.0')));
    const store = new PluginMirrorStore(PATHS, fs);

    assert.equal(await store.pruneUnusedFiles(plugin([])), 1);
    assert.equal(fs.files.has(key(buildAt('1.0.0'))), true);
    assert.deepEqual(fs.removedDirs, []);
  });

  it('אינו מוחק תיקייה שנשארה בה תת-תיקייה', async () => {
    const fs = memoryFs([buildAt('2.0.0'), `${DIR}\\extra\\file.txt`]);
    const store = new PluginMirrorStore(PATHS, fs);

    await store.pruneUnusedFiles(plugin([]));
    assert.deepEqual(fs.removedDirs, []);
  });

  it('אינו נוגע בתיקייה כשלא נמחק דבר', async () => {
    const fs = memoryFs([buildAt('3.0.0')]);
    const store = new PluginMirrorStore(PATHS, fs);

    assert.equal(await store.pruneUnusedFiles(plugin(['3.0.0'])), 0);
    assert.deepEqual(fs.removedDirs, []);
  });

  it('host בלי removeDir אינו מפיל את הסנכרון', async () => {
    // מראה שנפרסה ע"י גשר ותיק פשוט לא תנקה את השארית.
    const fs = memoryFs([buildAt('2.0.0')]);
    fs.withoutRemoveDir = true;
    const store = new PluginMirrorStore(PATHS, fs);

    assert.equal(await store.pruneUnusedFiles(plugin([])), 1);
  });
});
