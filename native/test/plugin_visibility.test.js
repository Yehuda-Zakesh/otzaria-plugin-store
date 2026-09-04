// מה המראה נושאת, ומה מוצג במחשב הזה — שני דברים שונים, וההפרדה ביניהם
// היא כל התיקון: היעד נקבע לפי מה שהריפו של אוצריא פרסם, וגרסת המחשב
// קובעת רק אם יש מה להציע כאן.
//
// התרחיש שהבדיקות האלה שומרות עליו: מחשב מקוון ממלא כונן, והכונן עובר
// למחשב **אחר** שגרסת אוצריא בו שונה.

import assert from 'node:assert/strict';
import {describe, it} from 'node:test';

import {PluginCatalog, PluginLocalFile, PluginVersionEntry, StorePlugin}
    from '../web/js/store/models.js';

const entry = (version, compatibleWith = '', maxAppVersion = null) =>
    new PluginVersionEntry({
      version,
      compatibleWith,
      maxAppVersion,
      downloadUrl: `https://otzaria.org/${version}.otzplugin`,
    });

const localFile = (version) => new PluginLocalFile({
  relativePath: `p/plugin-${version}.otzplugin`,
  fileName: `plugin-${version}.otzplugin`,
  ext: '.otzplugin',
  size: 1024,
});

/**
 * תוסף עם שלושה בילדים: החדש דורש אוצריא 0.9.96, האמצעי מכסה 0.9.90 עד
 * 0.9.95, והישן הוא מלפני שנשמרו שדות תאימות.
 */
const plugin = (mirroredVersions) => new StorePlugin({
  id: 'p',
  name: 'תוסף',
  version: '3.0.0',
  versions: [
    entry('3.0.0', '0.9.96'),
    entry('2.0.0', '0.9.90', '0.9.95'),
    entry('1.0.0'),
  ],
  manifestId: 'com.example.p',
  localFiles: new Map(mirroredVersions.map((v) => [v, localFile(v)])),
});

describe('mirrorTargets', () => {
  it('בילד לכל גרסת יעד, ממוין יורד', () => {
    const targets = plugin([]).mirrorTargets(['0.9.96', '0.9.92']);
    assert.deepEqual(targets.map((t) => t.version), ['3.0.0', '2.0.0']);
  });

  it('שתי גרסאות יעד שנפתרות לאותו בילד — אחד', () => {
    const targets = plugin([]).mirrorTargets(['0.9.97', '0.9.96']);
    assert.deepEqual(targets.map((t) => t.version), ['3.0.0']);
  });

  it('בלי גרסאות יעד — כל הבילדים מועמדים', () => {
    // מראה שסונכרנה לפני שהיעד נשמר בקטלוג. אין דרך לדעת עבור מה היא
    // נבנתה, ופסילה הייתה מסתירה תוסף שקובץ עובד שלו יושב על הכונן.
    const targets = plugin([]).mirrorTargets([]);
    assert.equal(targets.length, 3);
  });
});

describe('runsOn — האם התוסף מוצג במחשב הזה', () => {
  const mirrored = plugin(['3.0.0']);
  const targets = ['0.9.96'];

  it('אוצריא ביעד — מוצג', () => {
    assert.equal(mirrored.runsOn('0.9.96', targets), true);
    assert.equal(mirrored.runsOn('0.9.99', targets), true);
  });

  it('אוצריא ישנה מהיעד — אינו מוצג', () => {
    // ⚠️ זה הלב: לתוסף **יש** בילד שירוץ על 0.9.92, אבל הוא אינו על
    // הכונן ולא יהיה שם. הצגתו הייתה נותנת כפתור התקנה שדורש אינטרנט
    // דווקא במחשב שאין בו.
    assert.equal(mirrored.runsOn('0.9.92', targets), false);
  });

  it('גרסה מקומית לא ידועה אינה מסתירה דבר', () => {
    // הזיהוי רץ במקביל לטעינה; עד שיסתיים מוצג הכול.
    assert.equal(mirrored.runsOn(null, targets), true);
  });

  it('יעד כפול מכסה גם את הישנה וגם את החדשה', () => {
    // האחרונה טרם יוצבה, ולכן ירדו שני בילדים.
    const both = plugin(['3.0.0', '2.0.0']);
    const two = ['0.9.96', '0.9.92'];
    assert.equal(both.runsOn('0.9.96', two), true);
    assert.equal(both.runsOn('0.9.92', two), true);
    assert.equal(both.runsOn('0.9.80', two), false, 'ישנה משתי היעדים');
  });
});

describe('installTarget', () => {
  it('הגבוה שירד ותואם למחשב הזה', () => {
    const both = plugin(['3.0.0', '2.0.0']);
    const two = ['0.9.96', '0.9.92'];
    assert.equal(both.installTarget('0.9.96', two).version, '3.0.0');
    assert.equal(both.installTarget('0.9.92', two).version, '2.0.0',
                 'הבילד החדש אינו עולה על 0.9.92');
  });

  it('בילד היסטורי שאינו יעד אינו מוצע', () => {
    // בילד 1.0.0 תואם לכל גרסה, אבל הוא לא יירד לעולם — והחזרתו הייתה
    // מייצרת "טרם ירד — יש לבצע סנכרון" שאין דרך לפתור.
    assert.equal(plugin(['3.0.0']).installTarget('0.9.92', ['0.9.96']), null);
  });

  it('היעד ירד חלקית — מוחזר הבילד שכן על הכונן', () => {
    // הורדת הבילד החדש נכשלה והישן נשאר. עדיף בילד ישן שרץ מכלום, וזה
    // מה ש-`#syncPluginFiles` דואג שיישאר בקטלוג.
    const partial = new StorePlugin({
      id: 'p',
      version: '3.0.0',
      versions: [entry('3.0.0', '0.9.96'), entry('2.0.0', '0.9.90')],
      localFiles: new Map([['2.0.0', localFile('2.0.0')]]),
    });
    assert.equal(partial.installTarget('0.9.96', ['0.9.96', '0.9.92']).version,
                 '2.0.0');
  });

  it('היעד תואם אך לא ירד — מוחזר בכל זאת', () => {
    // כדי שהממשק יאמר "הקובץ לא ירד" ולא "אין תוסף".
    assert.equal(plugin([]).installTarget('0.9.96', ['0.9.96']).version,
                 '3.0.0');
  });
});

describe('גרסאות היעד בקטלוג', () => {
  it('נשמרות ונקראות', () => {
    const json = new PluginCatalog({targetAppVersions: ['0.9.96', '0.9.92']})
        .toJSON();
    assert.deepEqual(PluginCatalog.fromJson(json).targetAppVersions,
                     ['0.9.96', '0.9.92']);
  });

  it('קטלוג ישן בלי השדה — רשימה ריקה', () => {
    assert.deepEqual(PluginCatalog.fromJson({}).targetAppVersions, []);
  });

  it('ערך פגום אינו מסתיר תוספים', () => {
    // רשימה שנפגמה הייתה נקראת כיעד אמיתי, ומסתירה תוספים בלי סיבה.
    assert.deepEqual(
        PluginCatalog.fromJson({targetAppVersions: '0.9.96'}).targetAppVersions,
        []);
    assert.deepEqual(
        PluginCatalog.fromJson({targetAppVersions: [null, '', '0.9.96']})
            .targetAppVersions,
        ['0.9.96']);
  });
});
