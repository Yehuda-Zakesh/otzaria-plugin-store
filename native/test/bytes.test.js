// גדלים לתצוגה. פורט של `test/byte_size_test.dart` — בלי הענף האנגלי,
// שירד עם ההחלטה על עברית בלבד.
//
// `formatBytes` נראה טריוויאלי אבל הוא מוצג בכל מד התקדמות ובדף כל תוסף.

import assert from 'node:assert/strict';
import {describe, it} from 'node:test';

import {formatBytes, formatBytesProgress} from '../web/js/util/bytes.js';
import {S} from '../web/js/strings.js';

const u = S.units;

describe('formatBytes — גבולות', () => {
  it('מתחת ל-KB מוצג כבייטים', () => {
    assert.equal(formatBytes(0), u.bytes(0));
    assert.equal(formatBytes(1), u.bytes(1));
    assert.equal(formatBytes(1023), u.bytes(1023));
  });

  it('כפולות מדויקות של 1024', () => {
    assert.equal(formatBytes(1024), u.kilobytes('1'));
    assert.equal(formatBytes(1024 * 512), u.kilobytes('512'));
    assert.equal(formatBytes(1024 * 1024), u.megabytes('1.0'));
    assert.equal(formatBytes(1024 * 1024 * 1024), u.gigabytes('1.00'));
  });

  it('ספרה אחרי הנקודה רק מתחת ל-10MB', () => {
    assert.equal(formatBytes(1024 * 1024 * 5 + 512 * 1024), u.megabytes('5.5'));
    assert.equal(formatBytes(1024 * 1024 * 73), u.megabytes('73'));
  });

  it('ג׳יגה בשתי ספרות — כמו במסד של ~1GB', () => {
    assert.equal(formatBytes(Math.round(1.1 * 1024 * 1024 * 1024)),
                 u.gigabytes('1.10'));
    assert.equal(formatBytes(3 * 1024 * 1024 * 1024), u.gigabytes('3.00'));
  });

  it('ערך שלילי או אבסורדי אינו מפיל את המסך', () => {
    assert.equal(formatBytes(-1), u.bytes(-1));
    assert.equal(formatBytes(-1024 * 1024), u.bytes(-1048576));
    assert.equal(formatBytes(2 ** 50), u.gigabytes('1048576.00'));
  });

  it('היחידה בעברית, ובלי סימני האנגלית', () => {
    assert.equal(formatBytes(1024 * 1024), '1.0 מ״ב');
    assert.ok(!formatBytes(1024 * 1024).includes('MB'));
  });
});

describe('formatBytesProgress', () => {
  it('null כשעוד לא הגיע דיווח בייטים', () => {
    assert.equal(formatBytesProgress(null, 100), null);
    assert.equal(formatBytesProgress(null, null), null);
    assert.equal(formatBytesProgress(undefined, 100), null);
  });

  it('בלי יעד ידוע — רק כמה ירד עד כה', () => {
    const kb2 = u.kilobytes('2');
    assert.equal(formatBytesProgress(2048, null), kb2);
    assert.equal(formatBytesProgress(2048, 0), kb2);
    assert.equal(formatBytesProgress(2048, -1), kb2);
  });

  it('עם יעד — "X מתוך Y"', () => {
    assert.equal(
        formatBytesProgress(1024 * 1024 * 412, 1024 * 1024 * 1024),
        u.progressOf(u.megabytes('412'), u.gigabytes('1.00')));
    assert.equal(formatBytesProgress(1024, 2048),
                 u.progressOf(u.kilobytes('1'), u.kilobytes('2')));
  });
});
