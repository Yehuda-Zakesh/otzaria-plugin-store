// התאריך העברי. פורט של `test/hebrew_date_test.dart` — כולל העוגנים
// ההיסטוריים, שכל אחד מהם תפס באג אמיתי בחישוב ההדחיות.

import assert from 'node:assert/strict';
import {describe, it} from 'node:test';
import {execFile} from 'node:child_process';
import {dirname, join} from 'node:path';
import {fileURLToPath, pathToFileURL} from 'node:url';

import {
  HebrewDate,
  formatHebrewDate,
  isHebrewLeapYear,
  toHebrewNumeral,
} from '../web/js/util/hebrew_date.js';

const here = dirname(fileURLToPath(import.meta.url));
const MODULE_URL =
    pathToFileURL(join(here, '..', 'web', 'js', 'util', 'hebrew_date.js')).href;

/**
 * מריץ `formatHebrewDate` בתהליך נפרד עם אזור זמן נתון.
 *
 * ⚠️ אזור הזמן נקרא ע"י node **בעלייה**, ולכן אי אפשר לבדוק את זה בתוך
 * התהליך הזה: `process.env.TZ` באמצע ריצה משפיע גם על שאר הבדיקות. תהליך
 * בן עם `env` משלו הוא הדרך היחידה לבדוק את זה באמת.
 */
function formatUnderTz(timeZone, raw) {
  const code = `import {formatHebrewDate} from ${JSON.stringify(MODULE_URL)};` +
      `process.stdout.write(formatHebrewDate(${JSON.stringify(raw)}));`;
  return new Promise((resolve, reject) => {
    execFile(process.execPath, ['--input-type=module', '-e', code],
             {encoding: 'utf8', env: {...process.env, TZ: timeZone}},
             (error, stdout) => error ? reject(error) : resolve(stdout));
  });
}

/** בונה תאריך **מקומי** — `HebrewDate.fromDate` קורא getFullYear וכו'. */
const local = (y, m, d) => new Date(y, m - 1, d);

/**
 * יום אחד קדימה, **דרך רכיבי התאריך** ולא בהוספת 86400000 מילישניות.
 *
 * ⚠️ זה לא קוסמטי: במעבר שעון קיץ יום מקומי אינו 24 שעות, והוספת
 * מילישניות דילגה על יום או חזרה עליו. הבדיקה של אורך השנה העברית נפלה
 * בגלל זה עם "אורך שנת 5798 יצא 386" — אורך שאינו קיים בלוח העברי.
 * (בגרסת ה-Dart הבדיקה בנתה `DateTime.utc` ולכן לא נגעה בזה.)
 */
const nextDay = (date) =>
    new Date(date.getFullYear(), date.getMonth(), date.getDate() + 1);

describe('HebrewDate.fromDate — עוגנים היסטוריים', () => {
  const anchors = {
    '1948-05-14': "ה' באייר ה'תש\"ח",         // הכרזת העצמאות
    '2023-10-07': 'כ"ב בתשרי ה\'תשפ"ד',       // שמיני עצרת תשפ"ד
    '2024-03-24': 'י"ד באדר ב׳ ה\'תשפ"ד',     // פורים בשנה מעוברת
    '2025-09-23': 'א\' בתשרי ה\'תשפ"ו',       // ראש השנה תשפ"ו
    '2026-04-02': 'ט"ו בניסן ה\'תשפ"ו',       // פסח תשפ"ו
    '2000-01-01': 'כ"ג בטבת ה\'תש"ס',
  };

  for (const [iso, expected] of Object.entries(anchors)) {
    it(`${iso} = ${expected}`, () => {
      const [y, m, d] = iso.split('-').map(Number);
      assert.equal(String(HebrewDate.fromDate(local(y, m, d))), expected);
    });
  }
});

describe('כללי לוח השנה', () => {
  /** מאתר את א׳ בתשרי של שנה עברית, בסריקת הסתיו הלועזי המקביל. */
  function roshHashana(hebrewYear) {
    const civil = hebrewYear - 3761;
    for (let day = local(civil, 8, 25);
         day < local(civil, 11, 5);
         day = nextDay(day)) {
      const hebrew = HebrewDate.fromDate(day);
      if (hebrew.year === hebrewYear && hebrew.month === 7 &&
          hebrew.day === 1) {
        return day;
      }
    }
    throw new Error(`לא נמצא א׳ בתשרי לשנת ${hebrewYear}`);
  }

  it('ראש השנה לא נופל בימים א׳, ד׳ או ו׳ (לא אד"ו ראש)', () => {
    for (let year = 5750; year <= 5820; year++) {
      const day = roshHashana(year);
      // 0 = ראשון, 3 = רביעי, 5 = שישי
      const weekday = day.getDay();
      assert.ok(weekday !== 0 && weekday !== 3 && weekday !== 5,
                `שנה ${year} נפלה ביום ${weekday}`);
    }
  });

  it('isHebrewLeapYear לפי מחזור ה-19', () => {
    // 7 שנים מעוברות בכל מחזור: ג, ו, ח, יא, יד, יז, יט.
    const leap = new Set([5784, 5787, 5790, 5793, 5795, 5798, 5801]);
    for (let year = 5784; year <= 5802; year++) {
      assert.equal(isHebrewLeapYear(year), leap.has(year), `שנת ${year}`);
    }
  });

  it('אורך השנה העברית הוא אחד מששת הערכים החוקיים', () => {
    let previous = roshHashana(5780);
    for (let year = 5781; year <= 5800; year++) {
      const current = roshHashana(year);
      const length = Math.round((current - previous) / 86400000);
      assert.ok([353, 354, 355, 383, 384, 385].includes(length),
                `אורך שנת ${year - 1} יצא ${length}`);
      // שנה מעוברת ארוכה תמיד — זו כל מטרתו של אדר ב׳.
      assert.equal(length >= 383, isHebrewLeapYear(year - 1),
                   `שנת ${year - 1}`);
      previous = current;
    }
  });

  it('ימים לועזיים רצופים = ימים עבריים רצופים', () => {
    let previous = HebrewDate.fromDate(local(2026, 1, 1));
    for (let day = local(2026, 1, 2);
         day < local(2027, 1, 1);
         day = nextDay(day)) {
      const current = HebrewDate.fromDate(day);
      const sameMonth = current.year === previous.year &&
          current.month === previous.month;
      if (sameMonth) {
        assert.equal(current.day, previous.day + 1,
                     `דילוג ביום ${day.toDateString()}`);
      } else {
        assert.equal(current.day, 1,
                     `חודש חדש שאינו מתחיל ב-1 (${day.toDateString()})`);
      }
      previous = current;
    }
  });

  it('כל שנים-עשר שמות החודשים מופיעים במחזור שנה', () => {
    const names = new Set();
    for (let day = local(2025, 9, 23);
         day < local(2026, 9, 12);
         day = nextDay(day)) {
      names.add(HebrewDate.fromDate(day).monthName);
    }
    assert.deepEqual([...names].sort(), [
      'אב', 'אדר', 'אייר', 'אלול', 'חשון', 'טבת',
      'כסלו', 'ניסן', 'סיון', 'שבט', 'תמוז', 'תשרי',
    ].sort());
  });

  it('אדר נקרא "אדר א׳" רק בשנה מעוברת', () => {
    assert.equal(new HebrewDate(5784, 12, 15).monthName, 'אדר א׳');
    assert.equal(new HebrewDate(5785, 12, 15).monthName, 'אדר');
    assert.equal(new HebrewDate(5784, 13, 14).monthName, 'אדר ב׳');
  });
});

describe('toHebrewNumeral', () => {
  it('גרשיים לפני האות האחרונה, גרש למספר חד-אותי', () => {
    assert.equal(toHebrewNumeral(1), "א'");
    assert.equal(toHebrewNumeral(2), "ב'");
    assert.equal(toHebrewNumeral(10), "י'");
    assert.equal(toHebrewNumeral(11), 'י"א');
    assert.equal(toHebrewNumeral(22), 'כ"ב');
  });

  it('טו וטז ולא יה/יו — מטעמי קדושת השם', () => {
    assert.equal(toHebrewNumeral(15), 'ט"ו');
    assert.equal(toHebrewNumeral(16), 'ט"ז');
    // ולהבדיל, 25 ו-26 כן נכתבים כרגיל.
    assert.equal(toHebrewNumeral(25), 'כ"ה');
    assert.equal(toHebrewNumeral(26), 'כ"ו');
  });

  it('מאות', () => {
    assert.equal(toHebrewNumeral(100), "ק'");
    assert.equal(toHebrewNumeral(400), "ת'");
    assert.equal(toHebrewNumeral(500), 'ת"ק');
    assert.equal(toHebrewNumeral(900), 'תת"ק');
  });

  it('אלפים עם גרש', () => {
    assert.equal(toHebrewNumeral(5786), 'ה\'תשפ"ו');
    assert.equal(toHebrewNumeral(5784), 'ה\'תשפ"ד');
  });

  it('גבולות — אפס, שלילי, וגדול מדי', () => {
    assert.equal(toHebrewNumeral(0), '');
    assert.equal(toHebrewNumeral(-5), '');
    assert.equal(toHebrewNumeral(10000), '10000');
  });
});

describe('formatHebrewDate', () => {
  it('מפרמט מחרוזת ISO', () => {
    assert.equal(formatHebrewDate('2026-04-02'), 'ט"ו בניסן ה\'תשפ"ו');
  });

  // ⚠️ `new Date('2026-04-02')` נקרא לפי התקן כחצות **UTC**, ואילו
  // `HebrewDate.fromDate` קורא getFullYear/getMonth/getDate — כלומר לפי
  // אזור הזמן המקומי. במחשב שמערבית לגריניץ' השניים נופלים על ימים שונים,
  // והתאריך העברי הוצג יום אחד מוקדם מדי: `2026-04-02` יצא `י"ד בניסן`.
  it('תאריך בלי שעה נקרא כיום מקומי ולא כחצות UTC', () => {
    // ההשוואה היא מול מסלול הבנייה המקומי עצמו, ולכן היא נכונה בכל אזור
    // זמן ולא רק באזור שהבדיקה הזאת רצה בו.
    assert.equal(formatHebrewDate('2026-04-02'),
                 String(HebrewDate.fromDate(local(2026, 4, 2))));
    assert.equal(formatHebrewDate('2000-01-01'),
                 String(HebrewDate.fromDate(local(2000, 1, 1))));
  });

  // הבדיקה שלמעלה מוכיחה את הכלל; זו מוכיחה שהוא באמת אינו תלוי בשעון
  // של המכונה שמריצה את הבדיקות. `TZ` נקרא ע"י node בעלייה, ולכן זה
  // נעשה בתהליכי בן.
  it('אותו יום בדיוק בקיזוז שלילי, חיובי וקיצוני', async () => {
    const expected = 'ט"ו בניסן ה\'תשפ"ו';
    for (const zone of ['America/New_York', 'UTC', 'Asia/Jerusalem',
                        'Pacific/Kiritimati']) {
      assert.equal(await formatUnderTz(zone, '2026-04-02'), expected,
                   `אזור הזמן ${zone}`);
    }
  });

  // חותמת עם שעה **כן** מתארת רגע בזמן, ולכן היא נקראת בשעון המקומי —
  // אותם getters של `fromDate`. קריאה ב-UTC הייתה מציגה תאריך אחד בעוד
  // שעון המערכת מראה אחר.
  it('חותמת עם שעה נקראת בשעון המקומי, בעקביות', () => {
    const raw = '2026-04-02T21:30:00Z';
    const instant = new Date(raw);
    assert.equal(formatHebrewDate(raw),
                 String(HebrewDate.fromDate(local(instant.getFullYear(),
                                                  instant.getMonth() + 1,
                                                  instant.getDate()))));
  });

  it('מחרוזת ריקה או חסרה מחזירה ריק', () => {
    assert.equal(formatHebrewDate(''), '');
    assert.equal(formatHebrewDate(null), '');
    assert.equal(formatHebrewDate(undefined), '');
  });

  it('מחרוזת שאינה תאריך חוזרת כמו שהיא — עדיף על שגיאה במסך', () => {
    assert.equal(formatHebrewDate('לא תאריך'), 'לא תאריך');
  });
});
