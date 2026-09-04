// הצד ה-JS של הגשר אל ה-host.
//
// ── המסגור ───────────────────────────────────────────────────────────────────
//   אלינו → host   `<reqId>\x1f<command>\x1f<arg0>\x1f<arg1>…`
//   host → אלינו   `{"id":…,"ok":true,"result":…}` / `{…,"ok":false,"error":…}`
//                  או `{"event":"<name>", …}` לאירוע שאינו תשובה
//
// מפריד השדות הוא U+001F, שאינו חוקי בנתיב ואינו מופיע בכתובת — ולכן
// אין כאן escaping ואין מה לפרסר בצד ה-C++. ראו ההסבר ב-native/src/bridge.h.

const FIELD_SEP = '\x1f';

/** בקשות שממתינות לתשובה: reqId → {resolve, reject, watchdog}. */
const pending = new Map();

/**
 * הפקודות שאין להן גבול זמן סביר, ולכן **אין עליהן שומר**.
 *
 * הורדה של תוסף היא עשרות MB בקו איטי, העתקה היא כתיבה לכונן נייד
 * שעלול להיות אטי, וחלון השמירה פתוח עד שהמשתמש בוחר. לכל אלה אין מספר
 * שאפשר להגיד עליו "מכאן זה תקוע" — ושומר שהיה יורה עליהן היה **גרוע
 * מהבאג**: הוא אינו עוצר את ה-host, שממשיך לעבוד, ולכן כל מה שהיה משיג
 * הוא ניתוק בין שני הצדדים (הממשק אומר "נכשל" בעוד הקובץ נכתב).
 */
const UNBOUNDED_COMMANDS = new Set([
  'net.get', 'net.download', 'fs.copy', 'sys.saveDialog',
]);

/**
 * שומר לשאר הפקודות. **אינו פסק זמן של הממשק אלא רשת ביטחון**: כל פקודה
 * שה-host מכיר משיבה בדיוק פעם אחת, וגם פקודה שאינה מוכרת מקבלת שגיאה —
 * ולכן אם עברו עשר דקות בלי תשובה משהו נבלע בדרך. בלי זה הבקשה נשארת
 * תלויה לנצח, והמסך נתקע ב"טוען" בלי שגיאה ובלי כפתור לנסות שוב.
 */
const WATCHDOG_MS = 10 * 60 * 1000;

/** מאזינים לאירועים מה-host: שם → קבוצת פונקציות. */
const listeners = new Map();

let nextRequestId = 1;

/** `true` כשאנחנו רצים בתוך ה-host ולא בדפדפן רגיל. */
export const hasHost = typeof chrome !== 'undefined' &&
    chrome.webview !== undefined && chrome.webview !== null;

/**
 * סוגר בקשה ממתינה: מוציא אותה מהמפה, מכבה את השומר, ומריץ עליה
 * [apply]. מחזיר `false` אם כבר נסגרה (תשובה שהגיעה פעמיים, או אחרי
 * שהשומר ירה).
 */
function settle(id, apply) {
  const request = pending.get(id);
  if (request === undefined) return false;
  pending.delete(id);
  if (request.watchdog !== null) clearTimeout(request.watchdog);
  apply(request);
  return true;
}

/**
 * מחלץ את מזהה הבקשה מתשובה שלא ניתן היה לפרסר.
 *
 * ה-host כותב את `id` **ראשון** (ראו `Bridge::ReplyOk`), ולכן הוא קריא
 * גם כשהמשך המחרוזת פגום — וזה מה שמאפשר לשחרר את מי שממתין לה במקום
 * להשאיר אותו תלוי.
 */
function requestIdOf(text) {
  if (typeof text !== 'string') return null;
  const match = /^\s*\{\s*"id"\s*:\s*(\d+)/.exec(text);
  return match === null ? null : Number(match[1]);
}

if (hasHost) {
  chrome.webview.addEventListener('message', (raw) => {
    let message;
    try {
      // ה-host מוסר מחרוזת (`PostWebMessageAsString`), ולכן `data` היא
      // המחרוזת עצמה ולא אובייקט.
      message = JSON.parse(raw.data);
    } catch (error) {
      console.error('הודעה פגומה מה-host:', raw.data, error);
      // תשובה פגומה אינה מגיעה לאיש — ובלי לשחרר את הבקשה שהיא נועדה
      // לה, היא הייתה נשארת ממתינה עד סוף ההרצה.
      const id = requestIdOf(raw.data);
      if (id !== null) {
        settle(id, (request) => request.reject(
            new HostError('תשובה פגומה מה-host')));
      }
      return;
    }

    if (message.event !== undefined) {
      const handlers = listeners.get(message.event);
      if (handlers) {
        for (const handler of handlers) {
          // מאזין שנפל לא מונע מהשאר לרוץ.
          try {
            handler(message);
          } catch (error) {
            console.error(`מאזין ל-${message.event} נפל:`, error);
          }
        }
      }
      return;
    }

    settle(message.id, (request) => {
      if (message.ok) {
        request.resolve(message.result);
      } else {
        request.reject(new HostError(message.error));
      }
    });
  });
}

/**
 * שגיאה שהגיעה מה-host. טיפוס נפרד כדי שהממשק יוכל להבחין בין "מערכת
 * ההפעלה אמרה לא" לבין באג אצלנו — הראשון מוצג למשתמש כמו שהוא.
 */
export class HostError extends Error {
  constructor(message) {
    super(message);
    this.name = 'HostError';
  }
}

/**
 * שולח פקודה ל-host ומחזיר Promise לתשובה.
 *
 * הארגומנטים מומרים למחרוזות; `null`/`undefined` הופכים למחרוזת ריקה,
 * שהיא ארגומנט לגיטימי בצד ה-C++ (למשל סיומת מועדפת שלא נמסרה).
 */
export function call(command, ...args) {
  if (!hasHost) {
    return Promise.reject(
        new HostError(`אין host — הפקודה ${command} אינה זמינה`));
  }

  const id = nextRequestId++;
  let request;
  const promise = new Promise((resolve, reject) => {
    request = {resolve, reject, watchdog: null};
  });
  pending.set(id, request);
  if (!UNBOUNDED_COMMANDS.has(command)) {
    request.watchdog = setTimeout(() => {
      settle(id, (waiting) => waiting.reject(
          new HostError(`ה-host לא השיב על ${command}`)));
    }, WATCHDOG_MS);
  }

  const fields = [String(id), command];
  for (const arg of args) {
    fields.push(arg === null || arg === undefined ? '' : String(arg));
  }
  try {
    chrome.webview.postMessage(fields.join(FIELD_SEP));
  } catch (error) {
    // ההודעה לא יצאה, ולכן אין מי שישיב לה. סוגרים כאן ולא משאירים
    // בקשה שממתינה לתשובה שלא תגיע לעולם.
    settle(id, (waiting) => waiting.reject(new HostError(
        `שליחת הפקודה ${command} נכשלה: ${error?.message ?? error}`)));
  }
  return promise;
}

/** נרשם לאירוע מה-host. מחזיר פונקציה שמבטלת את ההרשמה. */
export function on(eventName, handler) {
  let handlers = listeners.get(eventName);
  if (handlers === undefined) {
    handlers = new Set();
    listeners.set(eventName, handlers);
  }
  handlers.add(handler);
  return () => handlers.delete(handler);
}

// ── עטיפות נוחות ─────────────────────────────────────────────────────────────
// שמות מפורשים במקום מחרוזות פקודה פזורות בכל הקוד. כל אחת מהן היא
// שורה אחת, וכולן יחד הן ה-API שהשאר משתמש בו.

export const fs = {
  readText: (path) => call('fs.readText', path),
  writeText: (path, text) => call('fs.writeText', path, text),
  kind: (path) => call('fs.kind', path),
  stat: (path) => call('fs.stat', path),
  list: (path) => call('fs.list', path),
  mkdirs: (path) => call('fs.mkdirs', path),
  remove: (path) => call('fs.delete', path),
  // ⚠️ **ריקה בלבד.** תיקייה שנשאר בה תוכן חוזרת `false` ואינה נמחקת —
  // ראו `RemoveEmptyDirAt` ב-fsapi.cpp.
  removeDir: (path) => call('fs.removeDir', path),
  copy: (from, to) => call('fs.copy', from, to),
  rename: (from, to) => call('fs.rename', from, to),
  readBase64: (path, offset, length) =>
      call('fs.readBase64', path, offset, length),

  /** `true` אם הנתיב הוא קובץ קיים. */
  async fileExists(path) {
    return (await this.kind(path)) === 'file';
  },

  /** `true` אם הנתיב הוא תיקייה קיימת. */
  async dirExists(path) {
    return (await this.kind(path)) === 'dir';
  },
};

export const net = {
  get: (url, timeoutMs) => call('net.get', url, timeoutMs),
  download: (url, destPath, timeoutMs, stallMs) =>
      call('net.download', url, destPath, timeoutMs, stallMs),
};

export const sys = {
  openUrl: (url) => call('sys.openUrl', url),
  launch: (exePath, argument) => call('sys.launch', exePath, argument),
  saveDialog: (suggestedName) => call('sys.saveDialog', suggestedName),
  exeVersion: (path) => call('sys.exeVersion', path),
  registryDirs: () => call('sys.registryDirs'),
  runningOtzaria: () => call('sys.runningOtzaria'),
};

export const win = {
  minimize: () => call('win.minimize'),
  maximizeToggle: () => call('win.maximizeToggle'),
  close: () => call('win.close'),
  state: () => call('win.state'),
  dragMove: () => call('win.dragMove'),
  resizeStart: (edge) => call('win.resizeStart', edge),
};

/** פרטי התוכנה והנתיבים. נקרא פעם אחת בעלייה. */
export const appInfo = () => call('app.info');

/**
 * כותב ליומן שה-host מחזיק.
 *
 * ⚠️ זה **הדרך היחידה** לדעת מה קרה אצל המשתמש: הממשק רץ בתוך
 * WebView2, ו-`console.log` נעלם עם החלון. `main.js` מפנה לכאן גם את
 * `window.onerror` ואת ה-promise שנדחו בלי מטפל.
 */
export function logToFile(level, message) {
  if (!hasHost) return Promise.resolve();
  // כשל בכתיבת יומן אינו סיבה להפיל את מה שקרה סביבו.
  return call('app.log', level, message).catch(() => {});
}
