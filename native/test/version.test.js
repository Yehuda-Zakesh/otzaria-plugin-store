// השוואת גרסאות תוסף. פורט של המקרים מ-`test/plugin_store_test.dart`,
// ובראשם הבאג שהתיעוד במקור מזהיר עליו במפורש.

import assert from 'node:assert/strict';
import {describe, it} from 'node:test';

import {comparePluginVersions} from '../web/js/util/version.js';

describe('comparePluginVersions', () => {
  it('משווה מקטע-מקטע', () => {
    assert.equal(comparePluginVersions('1.0.0', '1.0.0'), 0);
    assert.equal(comparePluginVersions('1.0.1', '1.0.0'), 1);
    assert.equal(comparePluginVersions('1.0.0', '1.0.1'), -1);
    assert.equal(comparePluginVersions('2.0.0', '1.9.9'), 1);
    assert.equal(comparePluginVersions('1.10.0', '1.9.0'), 1);
  });

  it('אורך שונה מרופד באפסים — 1.2 שקול ל-1.2.0', () => {
    assert.equal(comparePluginVersions('1.2', '1.2.0'), 0);
    assert.equal(comparePluginVersions('1.2.0.0', '1.2'), 0);
    assert.equal(comparePluginVersions('1.2.1', '1.2'), 1);
  });

  it('קידומת v מוסרת', () => {
    assert.equal(comparePluginVersions('v1.0.0', '1.0.0'), 0);
    assert.equal(comparePluginVersions('V2.0.0', 'v1.0.0'), 1);
  });

  // ⚠️ זהו הבאג שהתיעוד במקור מזהיר עליו: כשקראו את המקטע כמו שהוא,
  // `'1-beta'` לא נפרסר, הנפילה ל-0 בלעה את הספרה, ו-`v2.0.0` יצא שווה
  // ל-`v1.0.0` — כלומר תוסף עם קידומת `v` לא סומן כ"עדכון זמין" לעולם.
  it('סיומת prerelease אינה מדרגת, אבל המספר שלפניה כן', () => {
    assert.equal(comparePluginVersions('2.0.0-beta', '1.0.0'), 1);
    assert.equal(comparePluginVersions('1.0.0-beta', '1.0.0'), 0);
    assert.equal(comparePluginVersions('1.2.3+7', '1.2.3'), 0);
    assert.equal(comparePluginVersions('v2.0.0-rc1', 'v1.9.9'), 1);
  });

  // ⚠️ הסיומת ירדה קודם ברמת המקטע ולא ברמת המחרוזת, ולכן `-beta.1`
  // פוצל ל-`'0-beta'` ועוד מקטע `'1'` — והזנב דירג. `1.0.0-beta.1` יצא
  // גבוה מ-`1.0.0`: הביתא עלתה לראש `sortedDescending`, נבחרה כבילד
  // להתקנה, והכריזה "עדכון זמין" על יציבה שכבר מותקנת.
  it('סיומת prerelease מנוקדת אינה מדרגת גם היא', () => {
    assert.equal(comparePluginVersions('1.0.0-beta.1', '1.0.0'), 0);
    assert.equal(comparePluginVersions('1.2.3+7.1', '1.2.3'), 0);
    assert.equal(comparePluginVersions('1.0.0-rc.2', '1.0.0-rc.10'), 0);
    assert.equal(comparePluginVersions('2.0.0-beta.1', '1.0.0'), 1);
    assert.equal(comparePluginVersions('1.0.0-alpha.9', '1.0.1'), -1);
  });

  it('יציבה אינה נמוכה מה-prerelease שלה במיון', () => {
    const sorted = ['1.0.0-beta.1', '1.0.0', '0.9.0']
        .sort((a, b) => comparePluginVersions(b, a));
    // שוויון שומר על סדר המקור, ולכן היציבה אינה **מעל** הביתא — אבל
    // היא בוודאי אינה מתחתיה, וזה מה שנשבר.
    assert.equal(sorted[2], '0.9.0');
    assert.equal(comparePluginVersions(sorted[0], sorted[1]), 0);
  });

  it('קלט חסר או זבל אינו מפיל', () => {
    assert.equal(comparePluginVersions(null, null), 0);
    assert.equal(comparePluginVersions(undefined, '0'), 0);
    assert.equal(comparePluginVersions('1.0.0', null), 1);
    assert.equal(comparePluginVersions('', ''), 0);
    assert.equal(comparePluginVersions('abc', 'def'), 0);
    assert.equal(comparePluginVersions('1.abc', '1.0'), 0);
  });

  it('רווחים מסביב אינם משנים', () => {
    assert.equal(comparePluginVersions(' 1.2.3 ', '1.2.3'), 0);
    assert.equal(comparePluginVersions('1. 2 .3', '1.2.3'), 0);
  });

  it('מיון יורד נותן את הגבוה ראשון', () => {
    const sorted = ['1.0.0', '2.1.0', '0.9.0', '2.0.0', 'v2.10.0']
        .sort((a, b) => comparePluginVersions(b, a));
    assert.deepEqual(sorted, ['v2.10.0', '2.1.0', '2.0.0', '1.0.0', '0.9.0']);
  });
});
