// המרת תאריך לועזי לתאריך עברי בגימטריה — למשל `ט"ו בשבט ה'תשפ"ו`.
// פורט של `lib/src/services/hebrew_date.dart`.
//
// ── הערה על המסלול שהקוד הזה עבר ─────────────────────────────────────────────
// חנות התוספים המקורית (Electron) קיבלה את זה חינם מ-`Intl` בדפדפן
// (`he-u-ca-hebrew`). בגרסת ה-Flutter זה חושב ביד, כי ל-`package:intl`
// ב-Dart אין לוח שנה עברי. עכשיו, כשאנחנו חזרה בתוך מנוע דפדפן, `Intl`
// שוב זמין — **ובכל זאת החישוב נשאר**.
//
// למה: `Intl.DateTimeFormat('he-u-ca-hebrew')` מחזיר ספרות עבריות אבל לא
// את מה שהמקור מציג — הוא מנקד אחרת, כותב `ט״ו` בצורת סימני פיסוק אחרים,
// ואינו מבטיח `טו`/`טז` (במקום `יה`/`יו`). כאן נדרש שחזור **נאמן** של מה
// שהמשתמש רואה היום, והאלגוריתם המפורש הוא מה שמבטיח אותו.
//
// האלגוריתם הוא המולד הסטנדרטי (Dershowitz & Reingold), והגימטריה היא
// פורט ישיר של `toHebrewNumeral` מהחנות המקורית.

/** חודשים ממוספרים ניסן=1 … אדר=12, אדר ב'=13 — המספור של האלגוריתם. */
const MONTH_NAMES = Object.freeze({
  1: 'ניסן',
  2: 'אייר',
  3: 'סיון',
  4: 'תמוז',
  5: 'אב',
  6: 'אלול',
  7: 'תשרי',
  8: 'חשון',
  9: 'כסלו',
  10: 'טבת',
  11: 'שבט',
  12: 'אדר',
  13: 'אדר ב׳',
});

/** היום המוחלט (Rata Die) של א' בתשרי ה'א' — עוגן החישוב. */
const EPOCH = -1373429;

export function isHebrewLeapYear(year) {
  return ((7 * year + 1) % 19) < 7;
}

const lastMonthOfYear = (year) => isHebrewLeapYear(year) ? 13 : 12;

/** חלוקה שלמה כלפי מטה — המקבילה ל-`~/` של Dart על מספרים חיוביים. */
const div = (a, b) => Math.floor(a / b);

/**
 * מספר הימים שחלפו מהעוגן עד ראש השנה של [year], כולל שלוש הדחיות
 * (לא אד"ו ראש, גטר"ד ובט"ו תקפ"ט).
 */
function elapsedDays(year) {
  const monthsElapsed = 235 * div(year - 1, 19) +
      12 * ((year - 1) % 19) +
      div(7 * ((year - 1) % 19) + 1, 19);
  const partsElapsed = 204 + 793 * (monthsElapsed % 1080);
  const hoursElapsed = 11 +
      12 * monthsElapsed +
      793 * div(monthsElapsed, 1080) +
      div(partsElapsed, 1080);
  // ה-+1 מיישר את יום המולד לעוגן EPOCH. בלעדיו יום השבוע של המולד יוצא
  // מוסט, ולכן הדחיות למטה מופעלות על היום הלא נכון — וראש השנה נופל
  // בטעות יום או שניים מוקדם מדי בחלק מהשנים.
  const day = 29 * monthsElapsed + div(hoursElapsed, 24) + 1;
  const parts = (hoursElapsed % 24) * 1080 + partsElapsed % 1080;

  let adjusted;
  if (parts >= 19440) {
    adjusted = day + 1;
  } else if (day % 7 === 2 && parts >= 9924 && !isHebrewLeapYear(year)) {
    adjusted = day + 1;
  } else if (day % 7 === 1 && parts >= 16789 && isHebrewLeapYear(year - 1)) {
    adjusted = day + 1;
  } else {
    adjusted = day;
  }

  // ראש השנה לא יכול לצאת ביום א', ד' או ו'.
  const notAllowed = new Set([0, 3, 5]);
  return notAllowed.has(adjusted % 7) ? adjusted + 1 : adjusted;
}

const daysInYear = (year) => elapsedDays(year + 1) - elapsedDays(year);
const longHeshvan = (year) => daysInYear(year) % 10 === 5;
const shortKislev = (year) => daysInYear(year) % 10 === 3;

function daysInMonth(year, month) {
  if (month === 2 || month === 4 || month === 6 || month === 10 ||
      month === 13) {
    return 29;
  }
  if (month === 12 && !isHebrewLeapYear(year)) return 29;
  if (month === 8 && !longHeshvan(year)) return 29;
  if (month === 9 && shortKislev(year)) return 29;
  return 30;
}

function absoluteFromHebrew(year, month, day) {
  let total = day + elapsedDays(year) + EPOCH;
  if (month < 7) {
    // ניסן..אדר נופלים אחרי תשרי של אותה שנה עברית.
    for (let m = 7; m <= lastMonthOfYear(year); m++) {
      total += daysInMonth(year, m);
    }
    for (let m = 1; m < month; m++) total += daysInMonth(year, m);
  } else {
    for (let m = 7; m < month; m++) total += daysInMonth(year, m);
  }
  return total;
}

function absoluteFromGregorian(year, month, day) {
  const monthDays = [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  const isLeap = (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0;

  let total = day;
  for (let m = 1; m < month; m++) {
    total += monthDays[m - 1];
    if (m === 2 && isLeap) total += 1;
  }
  return total +
      365 * (year - 1) +
      div(year - 1, 4) -
      div(year - 1, 100) +
      div(year - 1, 400);
}

export class HebrewDate {
  constructor(year, month, day) {
    this.year = year;
    this.month = month;
    this.day = day;
  }

  get monthName() {
    if (this.month === 12 && isHebrewLeapYear(this.year)) return 'אדר א׳';
    if (this.month === 13) return 'אדר ב׳';
    return MONTH_NAMES[this.month];
  }

  /** "יום חודש שנה" בעברית, למשל `ט"ו בשבט ה'תשפ"ו`. */
  toString() {
    return `${toHebrewNumeral(this.day)} ב${this.monthName} ` +
        `${toHebrewNumeral(this.year)}`;
  }

  static fromDate(date) {
    return fromAbsolute(absoluteFromGregorian(
        date.getFullYear(), date.getMonth() + 1, date.getDate()));
  }
}

function fromAbsolute(absolute) {
  let year = div(absolute - EPOCH, 366);
  while (absoluteFromHebrew(year + 1, 7, 1) <= absolute) year++;

  let month = absolute < absoluteFromHebrew(year, 1, 1) ? 7 : 1;
  while (absolute > absoluteFromHebrew(year, month, daysInMonth(year, month))) {
    month++;
  }

  return new HebrewDate(
      year, month, absolute - absoluteFromHebrew(year, month, 1) + 1);
}

/** `YYYY-MM-DD` — יום בלי שעה, הצורה שבה האתר מפרסם תאריכי תוכן. */
const DATE_ONLY = /^(\d{4})-(\d{2})-(\d{2})$/;

/**
 * מפרמט מחרוזת תאריך מה-API (`YYYY-MM-DD` או ISO-8601 מלא).
 *
 * מחזיר את המחרוזת המקורית אם אי אפשר לפרסר אותה — עדיף על שגיאה במסך.
 */
export function formatHebrewDate(raw) {
  if (!raw) return '';
  const date = parseContentDate(raw);
  if (date === null) return raw;
  return HebrewDate.fromDate(date).toString();
}

/**
 * ⚠️ **`YYYY-MM-DD` נבנה במפורש כתאריך מקומי, ולא דרך `new Date(raw)`.**
 *
 * `new Date('2026-04-02')` נקרא לפי התקן כחצות **UTC**, בעוד
 * `HebrewDate.fromDate` קורא `getFullYear/getMonth/getDate` — כלומר לפי
 * אזור הזמן **המקומי**. במחשב שמערבית לגריניץ' השניים נופלים על ימים
 * שונים, והתאריך העברי הוצג יום אחד מוקדם מדי: `2026-04-02` יצא
 * `י"ד בניסן` במקום `ט"ו בניסן`.
 *
 * מה שהאתר מפרסם בשדות האלה הוא **יום, לא רגע בזמן** — "התוסף עודכן ב-2
 * באפריל" הוא אותו יום בכל מחשב שקורא את המראה, ולכן הוא נבנה כיום מקומי
 * ולא מומר מאזור זמן כלשהו.
 *
 * חותמת מלאה (עם שעה) **כן** מתארת רגע בזמן, ולכן היא נשארת `new Date`
 * ונקראת בשעון המקומי — אותם getters של `fromDate` בדיוק. כך היום המוצג
 * הוא היום שהשעון של המשתמש מראה באותו רגע, וזה העקבי היחיד: קריאה
 * ב-UTC הייתה מציגה תאריך אחד ושעון המערכת תאריך אחר.
 *
 * @returns {Date|null} `null` כשאי אפשר לפרסר
 */
function parseContentDate(raw) {
  const text = String(raw).trim();

  const dateOnly = DATE_ONLY.exec(text);
  if (dateOnly !== null) {
    return new Date(Number(dateOnly[1]), Number(dateOnly[2]) - 1,
                    Number(dateOnly[3]));
  }

  const date = new Date(text);
  return Number.isNaN(date.getTime()) ? null : date;
}

/**
 * המרת מספר לגימטריה — פורט ישיר של `toHebrewNumeral` מהחנות המקורית,
 * כולל טו/טז והצבת הגרש/גרשיים.
 */
export function toHebrewNumeral(number) {
  const ones = ['', 'א', 'ב', 'ג', 'ד', 'ה', 'ו', 'ז', 'ח', 'ט'];
  const tens = ['', 'י', 'כ', 'ל', 'מ', 'נ', 'ס', 'ע', 'פ', 'צ'];
  const hundreds = ['', 'ק', 'ר', 'ש', 'ת'];

  if (number <= 0) return '';
  if (number > 9999) return String(number);

  let remaining = number;
  let result = '';

  const thousands = div(remaining, 1000);
  if (thousands > 0) {
    result += `${ones[thousands]}'`;
    remaining %= 1000;
  }

  const hundredsDigit = div(remaining, 100);
  if (hundredsDigit > 0) {
    if (hundredsDigit <= 4) result += hundreds[hundredsDigit];
    else if (hundredsDigit === 5) result += 'תק';
    else if (hundredsDigit === 6) result += 'תר';
    else if (hundredsDigit === 7) result += 'תש';
    else if (hundredsDigit === 8) result += 'תת';
    else result += 'תתק';
    remaining %= 100;
  }

  // ט"ו וט"ז נכתבים כך ולא כי"ה/י"ו, מטעמי קדושת השם.
  if (remaining === 15) {
    result += 'טו';
  } else if (remaining === 16) {
    result += 'טז';
  } else {
    const tensDigit = div(remaining, 10);
    if (tensDigit > 0) {
      result += tens[tensDigit];
      remaining %= 10;
    }
    if (remaining > 0) result += ones[remaining];
  }

  if (result.length === 1) return `${result}'`;
  return `${result.slice(0, -1)}"${result.slice(-1)}`;
}
