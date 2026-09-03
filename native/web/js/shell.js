// מסגרת החלון: שורת הכותרת, כפתורי החלון ואזורי שינוי הגודל.
//
// זה המודול שמדבר עם ה-host על **החלון עצמו**. כל השאר (החנות) אינו
// יודע שיש חלון בכלל.

import {on, win} from './bridge.js';

/** סמלי כפתורי החלון, במידות של ווינדוס 11 (10×10). */
const ICONS = {
  minimize: '<svg viewBox="0 0 10 10"><rect x="0" y="4.5" width="10" height="1" fill="currentColor"/></svg>',
  maximize: '<svg viewBox="0 0 10 10"><rect x="0.5" y="0.5" width="9" height="9" fill="none" stroke="currentColor" stroke-width="1"/></svg>',
  // שני מלבנים חופפים — הסמל של "שחזר" בווינדוס.
  restore: '<svg viewBox="0 0 10 10"><rect x="2.5" y="0.5" width="7" height="7" fill="none" stroke="currentColor" stroke-width="1"/><rect x="0.5" y="2.5" width="7" height="7" fill="var(--panel-bg)" stroke="currentColor" stroke-width="1"/></svg>',
  close: '<svg viewBox="0 0 10 10"><path d="M0.5 0.5 L9.5 9.5 M9.5 0.5 L0.5 9.5" stroke="currentColor" stroke-width="1.1" fill="none"/></svg>',
};

const EDGES = [
  'top', 'bottom', 'left', 'right',
  'topleft', 'topright', 'bottomleft', 'bottomright',
];

/**
 * בונה את שורת הכותרת.
 *
 * @param {{appTitle: string, screenTitle?: string}} options
 * @returns {{element: HTMLElement, setScreenTitle: (title: string) => void}}
 */
export function createTitleBar({appTitle, screenTitle = ''}) {
  const bar = document.createElement('div');
  bar.className = 'title-bar';

  // הסמל והשם. אותו אייקון של קובץ ההרצה — מי שרואה את החלון צריך לזהות
  // בו את אותה תוכנה שהוא לחץ עליה בשורת המשימות.
  const identity = document.createElement('div');
  identity.className = 'title-bar__drag title-bar__identity';
  identity.innerHTML =
      `<img class="title-bar__icon" src="img/app_icon.png" alt="">` +
      `<span class="title-bar__app"></span>`;
  identity.querySelector('.title-bar__app').textContent = appTitle;
  identity.querySelector('img').alt = appTitle;

  // שם המסך הפתוח, באמצע.
  const screen = document.createElement('div');
  screen.className = 'title-bar__drag title-bar__screen';
  const screenLabel = document.createElement('span');
  screenLabel.textContent = screenTitle;
  screen.appendChild(screenLabel);

  // גרירה: כל מה שאינו כפתור. הלחיצה נמסרת לווינדוס, שמבצעת את הגרירה
  // בעצמה — ראו native/src/main.cpp.
  for (const area of [identity, screen]) {
    area.addEventListener('mousedown', (event) => {
      if (event.button !== 0) return;
      event.preventDefault();
      win.dragMove();
    });
    // לחיצה כפולה על שורת הכותרת מגדילה/משחזרת, כמו בכל חלון.
    area.addEventListener('dblclick', (event) => {
      if (event.button !== 0) return;
      win.maximizeToggle();
    });
  }

  const buttons = document.createElement('div');
  buttons.className = 'caption-buttons';

  const minimize = captionButton('minimize', 'מזער', () => win.minimize());
  const maximize = captionButton('maximize', 'הגדל', () => win.maximizeToggle());
  const close = captionButton('close', 'סגור', () => win.close());
  close.classList.add('caption-button--close');
  buttons.append(minimize, maximize, close);

  bar.append(identity, screen, buttons);

  // כפתור ההגדלה מתחלף לפי מצב החלון, וה-host מודיע על כל שינוי.
  const applyState = (maximized) => {
    document.body.dataset.maximized = maximized ? 'true' : 'false';
    maximize.innerHTML = maximized ? ICONS.restore : ICONS.maximize;
    maximize.title = maximized ? 'שחזר' : 'הגדל';
  };
  on('windowState', (message) => applyState(message.maximized));
  win.state().then((state) => applyState(state.maximized)).catch(() => {
    // מצב לא ידוע — נשארים על "הגדל", וההודעה הבאה תתקן.
  });

  return {
    element: bar,
    setScreenTitle(title) {
      screenLabel.textContent = title;
    },
  };
}

function captionButton(icon, tooltip, onClick) {
  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'caption-button';
  button.title = tooltip;
  button.setAttribute('aria-label', tooltip);
  button.innerHTML = ICONS[icon];
  button.addEventListener('click', onClick);
  return button;
}

/**
 * מוסיף את שמונת אזורי שינוי הגודל בשולי החלון.
 *
 * הם שקופים, ברוחב שש נקודות — מה שווינדוס עצמה נותנת, וזה מה שהיד
 * מצפה לו.
 */
export function installResizeEdges() {
  const container = document.createElement('div');
  container.className = 'resize-edges';

  for (const edge of EDGES) {
    const zone = document.createElement('div');
    zone.className = 'resize-edge';
    zone.dataset.edge = edge;
    zone.addEventListener('mousedown', (event) => {
      if (event.button !== 0) return;
      event.preventDefault();
      win.resizeStart(edge);
    });
    container.appendChild(zone);
  }

  document.body.appendChild(container);
}

/**
 * מחיל את ערכת המערכת, ומאזין לשינוי שלה בזמן ריצה.
 *
 * אין בורר ערכה בתוכנה — היא הולכת אחרי ווינדוס, כמו בגרסת ה-Flutter.
 */
export function installTheme(initialDark) {
  const apply = (dark) => {
    document.documentElement.dataset.theme = dark ? 'dark' : 'light';
  };
  apply(initialDark);
  on('themeChanged', (message) => apply(message.dark));
}
