// בירור גרסאות אוצריא שהמראה נבנית עבורן. זו ההחלטה שקובעת מה יורד
// לכונן, ולכן היא נבדקת על תשובות בצורה שהריפו מחזיר בפועל.

import assert from 'node:assert/strict';
import {describe, it} from 'node:test';

import {otzariaVersionOf, pickTargetVersions}
    from '../web/js/store/otzaria_release_client.js';

/** רשומת release מינימלית בצורת התשובה של GitHub. */
const release = (tag, {prerelease = false, draft = false} = {}) =>
    ({tag_name: tag, prerelease, draft});

describe('otzariaVersionOf', () => {
  it('מספר הבילד נחתך', () => {
    // ⚠️ זה מה שהריפו מפרסם בפועל, ו-`compatibleWith` באתר הוא `0.9.96`
    // בלי הזנב. בלי החיתוך ההשוואה נעשית מול מספר שאינו קיים באתר.
    assert.equal(otzariaVersionOf('0.9.96+736'), '0.9.96');
  });

  it('קידומת v מוסרת', () => {
    assert.equal(otzariaVersionOf('v0.9.96'), '0.9.96');
    assert.equal(otzariaVersionOf('v0.2.7'), '0.2.7');
  });

  it('בילד PR או dev נפסל', () => {
    // הם אמורים לשאת גם את הדגל `prerelease`, אבל בריפו יש כאלה בלעדיו —
    // ולכן התג עצמו נבדק.
    assert.equal(otzariaVersionOf('0.9.53-pr-715-146'), null);
    assert.equal(otzariaVersionOf('v0.2.7-dev-110'), null);
  });

  it('תג שאינו גרסה נפסל', () => {
    assert.equal(otzariaVersionOf('latest'), null);
    assert.equal(otzariaVersionOf(''), null);
    assert.equal(otzariaVersionOf(null), null);
    assert.equal(otzariaVersionOf(undefined), null);
  });
});

describe('pickTargetVersions', () => {
  it('האחרונה יציבה — גרסת יעד אחת', () => {
    const result = pickTargetVersions([
      release('0.9.96+736'),
      release('0.9.95+699'),
    ]);
    assert.deepEqual(result.versions, ['0.9.96']);
    assert.equal(result.latestIsPrerelease, false);
  });

  it('האחרונה טרם יוצבה — גם היציבה האחרונה', () => {
    // זו כל הסיבה שיש כאן רשימה ולא ערך אחד: מי שעל הערוץ היציב אינו
    // מריץ את ה-prerelease, ובילד שנבחר לפיו לא בהכרח יעלה אצלו.
    const result = pickTargetVersions([
      release('0.9.97+740', {prerelease: true}),
      release('0.9.96+736'),
      release('0.9.95+699'),
    ]);
    assert.deepEqual(result.versions, ['0.9.97', '0.9.96']);
    assert.equal(result.latestIsPrerelease, true);
    assert.equal(result.latestStable, '0.9.96');
  });

  it('draft אינו קיים לציבור', () => {
    const result = pickTargetVersions([
      release('0.9.99+800', {draft: true}),
      release('0.9.96+736'),
    ]);
    assert.deepEqual(result.versions, ['0.9.96']);
  });

  it('הגבוהה, לא הראשונה ברשימה', () => {
    // סדר הפרסום אינו סדר הגרסאות: תיקון לגרסה ותיקה מתפרסם אחרי החדשה.
    const result = pickTargetVersions([
      release('0.9.90+600'),
      release('0.9.96+736'),
      release('0.9.91+610'),
    ]);
    assert.deepEqual(result.versions, ['0.9.96']);
  });

  it('רק prerelease-ים — יורדת אחת, ואין יציבה', () => {
    const result = pickTargetVersions([
      release('0.9.97+740', {prerelease: true}),
      release('0.9.96+736', {prerelease: true}),
    ]);
    assert.deepEqual(result.versions, ['0.9.97']);
    assert.equal(result.latestStable, null);
    assert.equal(result.latestIsPrerelease, true);
  });

  it('אין אף תג גרסה — רשימה ריקה', () => {
    // המתקשר מתייחס לזה כמו לכשל: יורד הבילד האחרון של כל תוסף.
    const result = pickTargetVersions([release('nightly'), null, 7]);
    assert.deepEqual(result.versions, []);
    assert.equal(result.latest, null);
  });
});
