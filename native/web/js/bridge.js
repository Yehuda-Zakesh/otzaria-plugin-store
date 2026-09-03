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

/** בקשות שממתינות לתשובה: reqId → {resolve, reject}. */
const pending = new Map();

/** מאזינים לאירועים מה-host: שם → קבוצת פונקציות. */
const listeners = new Map();

let nextRequestId = 1;

/** `true` כשאנחנו רצים בתוך ה-host ולא בדפדפן רגיל. */
export const hasHost = typeof chrome !== 'undefined' &&
    chrome.webview !== undefined && chrome.webview !== null;

if (hasHost) {
  chrome.webview.addEventListener('message', (raw) => {
    let message;
    try {
      // ה-host מוסר מחרוזת (`PostWebMessageAsString`), ולכן `data` היא
      // המחרוזת עצמה ולא אובייקט.
      message = JSON.parse(raw.data);
    } catch (error) {
      console.error('הודעה פגומה מה-host:', raw.data, error);
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

    const request = pending.get(message.id);
    if (request === undefined) return;
    pending.delete(message.id);
    if (message.ok) {
      request.resolve(message.result);
    } else {
      request.reject(new HostError(message.error));
    }
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
  const promise = new Promise((resolve, reject) => {
    pending.set(id, {resolve, reject});
  });

  const fields = [String(id), command];
  for (const arg of args) {
    fields.push(arg === null || arg === undefined ? '' : String(arg));
  }
  chrome.webview.postMessage(fields.join(FIELD_SEP));
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
