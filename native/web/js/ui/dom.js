// עזרי DOM זעירים. אין framework כאן בכוונה: הממשק הוא כמה עשרות
// רכיבים, והבקר (`controller.js`) הוא כבר מקור האמת היחיד למצב — מה
// שהופך רינדור מלא של המסך לזול ופשוט.

/**
 * יוצר אלמנט.
 *
 * @param {string} tag שם התג, עם `.class` ו-`#id` אופציונליים
 *     (`'div.card.wide'`)
 * @param {object|null} props תכונות. `class`/`text`/`html`/`title`
 *     מטופלות במיוחד; `on*` הם מאזינים; `data*` הופכים ל-`data-*`.
 * @param {...(Node|string|null|undefined|false)} children
 */
export function h(tag, propsOrChild = null, ...rest) {
  // ⚠️ **הארגומנט השני הוא תכונות או ילד — לפי הטיפוס.**
  //
  // בלי הזיהוי הזה כל קריאה בסגנון `h('div.row', childA, childB)` הייתה
  // מפרשת את `childA` כתכונות, מריצה עליו `Object.entries` (שאינו מחזיר
  // כלום עבור צומת DOM) — **ומשליכה אותו בשקט**. זה בדיוק מה שקרה כאן:
  // שורת הכלים איבדה את כפתור הסנכרון, וכל כרטיס בחנות נעלם, בלי שום
  // שגיאה. השתיקה היא מה שהופך את זה למלכודת, ולכן ההתנהגות מפורשת.
  const isProps = propsOrChild !== null &&
      typeof propsOrChild === 'object' &&
      !(propsOrChild instanceof Node) &&
      !Array.isArray(propsOrChild);
  const props = isProps ? propsOrChild : null;
  const children = isProps ? rest : [propsOrChild, ...rest];

  const [name, ...classes] = tag.split('.');
  const element = document.createElement(name);
  if (classes.length > 0) element.classList.add(...classes);

  if (props !== null) {
    for (const [key, value] of Object.entries(props)) {
      if (value === null || value === undefined || value === false) continue;
      if (key === 'class') {
        element.classList.add(...String(value).split(/\s+/).filter(Boolean));
      } else if (key === 'text') {
        element.textContent = String(value);
      } else if (key === 'html') {
        // ⚠️ **רק** למלל שאנחנו מחברים בעצמנו (sprite של אייקונים).
        // תוכן שמגיע מהרשת עובר תמיד ב-`text` או ב-`textContent`.
        element.innerHTML = String(value);
      } else if (key.startsWith('on') && typeof value === 'function') {
        element.addEventListener(key.slice(2).toLowerCase(), value);
      } else if (key === 'dataset') {
        for (const [dataKey, dataValue] of Object.entries(value)) {
          element.dataset[dataKey] = dataValue;
        }
      } else if (key === 'style' && typeof value === 'object') {
        applyStyle(element, value);
      } else {
        element.setAttribute(key, String(value));
      }
    }
  }

  append(element, children);
  return element;
}

/**
 * מחיל את `style`.
 *
 * ⚠️ **משתנה CSS (`--x`) חייב `setProperty`.** `CSSStyleDeclaration` חושף
 * תכונה לכל מאפיין CSS מוכר, אבל למשתנים אין תכונה כזאת — ולכן השמה
 * ישירה (`style['--x'] = …`, וגם `Object.assign` שעושה בדיוק את זה)
 * יוצרת שדה JS רגיל על האובייקט ו**אינה נוגעת בעיצוב בכלל**, בשקט. זה
 * מה שקרה ל-`--stars-fill`: שכבת הכוכבים המלאים נשארה ברוחב ברירת
 * המחדל (0%), וכל דירוג בחנות נראה כאילו התוסף מעולם לא דורג.
 */
function applyStyle(element, style) {
  for (const [key, value] of Object.entries(style)) {
    if (key.startsWith('--')) {
      element.style.setProperty(key, String(value));
    } else {
      element.style[key] = value;
    }
  }
}

/** מוסיף ילדים, מדלג על `null`/`false` כדי שתנאים יהיו inline. */
export function append(parent, children) {
  for (const child of children.flat(Infinity)) {
    if (child === null || child === undefined || child === false) continue;
    parent.append(child instanceof Node ? child : document.createTextNode(
        String(child)));
  }
  return parent;
}

/** מחליף את תוכן האלמנט. */
export function replace(parent, ...children) {
  parent.replaceChildren();
  return append(parent, children);
}

/**
 * אייקון מתוך ה-sprite — ראו `native/tools/extract_icons.mjs`.
 *
 * אלה הווקטורים המדויקים של Fluent UI System Icons שגרסת ה-Flutter
 * הציגה, ולא ציור מקורב.
 */
export function icon(name, size = 20) {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.classList.add('icon');
  svg.setAttribute('width', String(size));
  svg.setAttribute('height', String(size));
  svg.setAttribute('aria-hidden', 'true');
  svg.setAttribute('focusable', 'false');
  const use = document.createElementNS('http://www.w3.org/2000/svg', 'use');
  use.setAttribute('href', `#i-${name}`);
  svg.append(use);
  return svg;
}

/**
 * כתובת להצגת נכס מתוך `Data\` — ה-host מגיש אותו תחת `/data/`.
 *
 * הנתיב בקטלוג הוא **יחסי** ובסגנון POSIX, וזה בדיוק מה שנדרש כאן: כך
 * התמונה נמצאת גם כשהתוכנה נפתחת מאות כונן אחרת. `file://` אינו אפשרי
 * מדף https, ולהעביר תמונות שלמות דרך הגשר היה מבזבז זיכרון.
 */
export function assetUrl(relativePath) {
  if (!relativePath) return null;
  // כל מקטע מקודד בנפרד — שמות התוספים מכילים עברית, והלוכסנים חייבים
  // להישאר לוכסנים.
  return 'data/' + String(relativePath).split('/')
      .map(encodeURIComponent).join('/');
}
