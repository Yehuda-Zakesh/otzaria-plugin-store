// בחירת בילד התוסף לפי גרסת אוצריא. זו הלוגיקה שקובעת מה יורד למראה ומה
// מותקן בפועל, ולכן היא המכוסה ביותר כאן.

import assert from 'node:assert/strict';
import {describe, it} from 'node:test';

import {
  isCompatibleWithApp,
  lowestSupportedAppVersion,
  resolveCompatibleVersion,
  resolveTargets,
} from '../web/js/store/compatibility.js';

/** בילד מינימלי לבדיקה. */
const build = (version, compatibleWith = '', maxAppVersion = null) =>
    ({version, compatibleWith, maxAppVersion});

describe('isCompatibleWithApp', () => {
  it('שדה חסר = גבול פתוח', () => {
    // בילדים היסטוריים שאורכבו לפני שנשמרו שדות התאימות מגיעים עם
    // `compatibleWith` ריק, ואין לפסול אותם בגלל נתון חסר.
    assert.equal(isCompatibleWithApp(build('1.0.0'), '0.9.0'), true);
    assert.equal(isCompatibleWithApp(build('1.0.0'), '99.0.0'), true);
  });

  it('גרסת אוצריא לא ידועה אינה פוסלת דבר', () => {
    const entry = build('1.0.0', '0.9.50', '0.9.60');
    assert.equal(isCompatibleWithApp(entry, null), true);
    assert.equal(isCompatibleWithApp(entry, ''), true);
    assert.equal(isCompatibleWithApp(entry, undefined), true);
  });

  it('רצפה — אוצריא ישנה מדי נפסלת', () => {
    const entry = build('1.0.0', '0.9.50');
    assert.equal(isCompatibleWithApp(entry, '0.9.49'), false);
    assert.equal(isCompatibleWithApp(entry, '0.9.50'), true, 'הגבול עצמו כלול');
    assert.equal(isCompatibleWithApp(entry, '0.9.51'), true);
  });

  it('תקרה — אוצריא חדשה מדי נפסלת', () => {
    const entry = build('1.0.0', '', '0.9.60');
    assert.equal(isCompatibleWithApp(entry, '0.9.60'), true, 'הגבול עצמו כלול');
    assert.equal(isCompatibleWithApp(entry, '0.9.61'), false);
  });
});

describe('resolveCompatibleVersion', () => {
  // ממוין יורד — כך המודל תמיד מוסר אותו.
  const entries = [
    build('3.0.0', '0.9.60'),
    build('2.0.0', '0.9.50', '0.9.59'),
    build('1.0.0', '', '0.9.49'),
  ];

  it('בוחר את הגבוה ביותר שנופל בטווח', () => {
    assert.equal(resolveCompatibleVersion(entries, '0.9.70').version, '3.0.0');
    assert.equal(resolveCompatibleVersion(entries, '0.9.55').version, '2.0.0');
    assert.equal(resolveCompatibleVersion(entries, '0.9.40').version, '1.0.0');
  });

  it('null כשאין אף בילד תואם', () => {
    const narrow = [build('1.0.0', '5.0.0')];
    assert.equal(resolveCompatibleVersion(narrow, '1.0.0'), null);
  });

  it('רשימה ריקה מחזירה null', () => {
    assert.equal(resolveCompatibleVersion([], '1.0.0'), null);
  });
});

describe('resolveTargets', () => {
  const entries = [
    build('3.0.0', '0.9.60'),
    build('2.0.0', '0.9.50', '0.9.59'),
  ];

  it('רשימת גרסאות ריקה — יורד הבילד החי בלבד', () => {
    // אין מול מה לסנן; זו ההתנהגות שהייתה לפני שהתאימות נכנסה.
    const targets = resolveTargets(entries, []);
    assert.equal(targets.length, 1);
    assert.equal(targets[0].version, '3.0.0');
  });

  it('בילד לכל גרסת יעד של אוצריא', () => {
    const targets = resolveTargets(entries, ['0.9.55', '0.9.70']);
    assert.deepEqual(targets.map((t) => t.version).sort(),
                     ['2.0.0', '3.0.0']);
  });

  it('מוחזר ממוין יורד, ולא בסדר הגרסאות שנמסרו', () => {
    // הצרכנים בוחרים מהתוצאה את "הגבוה שמתאים למחשב הזה", ולכן הסדר הוא
    // חלק מהחוזה ולא פרט מימוש.
    const targets = resolveTargets(entries, ['0.9.55', '0.9.70']);
    assert.deepEqual(targets.map((t) => t.version), ['3.0.0', '2.0.0']);
  });

  it('בלי כפילות כששתי הגרסאות נפתרות לאותו בילד', () => {
    const targets = resolveTargets(entries, ['0.9.60', '0.9.70']);
    assert.equal(targets.length, 1);
    assert.equal(targets[0].version, '3.0.0');
  });

  it('גרסה בלי בילד תואם פשוט אינה תורמת יעד', () => {
    const targets = resolveTargets(entries, ['0.1.0', '0.9.70']);
    assert.equal(targets.length, 1);
    assert.equal(targets[0].version, '3.0.0');
  });

  it('רשימת בילדים ריקה מחזירה ריק', () => {
    assert.deepEqual(resolveTargets([], ['1.0.0']), []);
  });
});

describe('lowestSupportedAppVersion', () => {
  it('הרצפה הנמוכה מכל הבילדים, לא זו של החי', () => {
    // זה מה שמאפשר לומר למי שאין לו גרסה תואמת מה הוא באמת צריך, במקום
    // את דרישת הבילד האחרון שהיא לרוב גבוהה יותר.
    const entries = [build('3.0.0', '0.9.60'), build('1.0.0', '0.9.20')];
    assert.equal(lowestSupportedAppVersion(entries), '0.9.20');
  });

  it('null כשלבילד כלשהו אין רצפה בכלל', () => {
    // ואז "אוצריא ישנה מדי" אינו ההסבר.
    const entries = [build('3.0.0', '0.9.60'), build('1.0.0', '')];
    assert.equal(lowestSupportedAppVersion(entries), null);
  });

  it('רשימה ריקה מחזירה null', () => {
    assert.equal(lowestSupportedAppVersion([]), null);
  });
});
