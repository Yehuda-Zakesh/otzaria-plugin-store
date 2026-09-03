// חותמות זמן של **המסגרת** — "סונכרן ב…", "נבדק לאחרונה ב…".
// פורט של `lib/src/services/timestamps.dart`.
//
// נפרד מ-`hebrew_date.js` בכוונה: שם מדובר בתאריכי **תוכן** שמגיעים
// מ-otzaria.org (מתי תוסף פורסם), ולכן הם מוצגים בלוח השנה העברי. כאן
// מדובר בזמן שהתוכנה עצמה עשתה משהו, ולוח שנה עברי לחותמת כזו רק מקשה
// על השוואה בין שתי הרצות.

const two = (n) => String(n).padStart(2, '0');

/** שעה:דקה, שעון 24 שעות. */
export function formatClock(value) {
  const date = value instanceof Date ? value : new Date(value);
  return `${two(date.getHours())}:${two(date.getMinutes())}`;
}

/**
 * תאריך ושעה מלאים, `dd.mm.yyyy, hh:mm:ss`.
 *
 * הסדר הוא זה של המקור בעברית. (במקור היה גם ענף ISO לאנגלית — הוא ירד
 * עם ההחלטה על עברית בלבד.)
 */
export function formatTimestamp(value) {
  const date = value instanceof Date ? value : new Date(value);
  const time = `${formatClock(date)}:${two(date.getSeconds())}`;
  return `${two(date.getDate())}.${two(date.getMonth() + 1)}.` +
      `${date.getFullYear()}, ${time}`;
}
