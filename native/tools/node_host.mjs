// מימוש Node של שכבות ה-`fs` וה-`net` שהגשר מספק לצד ה-JS.
//
// ── למה זה קיים ──────────────────────────────────────────────────────────────
// כדי שהאריזה ב-CI תבנה את המראה ב-`PluginMirrorSync` **עצמו** ולא
// בהעתק שלו. כללי הבחירה — איזה בילד יורד לאיזו גרסת אוצריא, מה נחשב
// "לא השתנה", מה נגרע — הם ההחלטות היקרות בפרויקט הזה, ומימוש שני שלהם
// בסקריפט אריזה היה נסדק מול הקוד ביום שבו אחד מהם ישתנה.
//
// לכן מה שנכתב כאן הוא **רק** מה שה-host נותן: קבצים ורשת. אין כאן שום
// החלטה על תוספים.
//
// ⚠️ החוזה נקבע ב-`native/src/fsapi.cpp` וב-`native/src/netapi.cpp`, וכל
// סטייה ממנו מייצרת מראה ש-CI מייצר ושהתוכנה אינה מייצרת. הפרטים
// שנבדקו אחד-אחד מול המקור מסומנים ב-"כמו ב-host" מתחת.

import {createWriteStream} from 'node:fs';
import {mkdir, readFile, writeFile, rename, copyFile, stat, readdir, rm, rmdir,
        open} from 'node:fs/promises';
// ⚠️ `win32` במפורש ולא `path`: כל הנתיבים כאן הם נתיבי ווינדוס עם `\`,
// כי `mirror_store.js` בונה אותם כך והם נשמרים כך בקטלוג. מימוש שהיה
// מצרף ב-`/` על לינוקס היה מייצר שמות קבצים שמכילים `\`.
import {win32 as pathWin32, join as joinHere} from 'node:path';

// `dirname` של win32 מזהה גם `/` וגם `\`, ולכן הוא נכון לשני סוגי
// הנתיבים. `join` לעומתו **מייצר** מפריד, ולכן הוא נלקח מהפלטפורמה
// (`joinHere`) בכל מקום שבו התוצאה הולכת למערכת הקבצים ולא לקטלוג —
// ראו את ההערה ב-`list`.
const {dirname} = pathWin32;
import {pipeline} from 'node:stream/promises';
import {Readable} from 'node:stream';

// ── קבצים ────────────────────────────────────────────────────────────────────

async function ensureParent(path) {
  const parent = dirname(path);
  if (parent && parent !== path) await mkdir(parent, {recursive: true});
}

export const fs = {
  async readText(path) {
    return await readFile(path, 'utf8');
  },

  // כמו ב-host: יוצר את תיקיית האב, וכותב דרך קובץ זמני ושינוי שם — כדי
  // שקטלוג לא יישאר חצי-כתוב אם הריצה נקטעה.
  async writeText(path, text) {
    await ensureParent(path);
    const temp = `${path}.tmp`;
    await writeFile(temp, text, 'utf8');
    await rename(temp, path);
    return true;
  },

  async kind(path) {
    try {
      return (await stat(path)).isDirectory() ? 'dir' : 'file';
    } catch {
      // כמו ב-host: נתיב שאינו קיים אינו שגיאה.
      return 'none';
    }
  },

  async stat(path) {
    const info = await stat(path);
    return {size: info.size, modified: Math.trunc(info.mtimeMs)};
  },

  // כמו ב-host: תיקייה שאינה קיימת מחזירה רשימה ריקה ולא זורקת.
  async list(path) {
    let entries;
    try {
      entries = await readdir(path, {withFileTypes: true});
    } catch (error) {
      if (error.code === 'ENOENT' || error.code === 'ENOTDIR') return [];
      throw error;
    }
    const out = [];
    for (const entry of entries) {
      // ⚠️ צירוף של הפלטפורמה ולא של win32: הנתיב הזה **אינו יוצא החוצה**
      // (מוחזר `entry.name` בלבד) אלא משמש רק ל-stat כאן. צירוף ב-`\` על
      // לינוקס היה מייצר נתיב שאינו קיים, וכל קובץ היה מדווח `size: 0` —
      // כלומר מראה שנראית תקינה ושכל קבציה ריקים.
      const full = joinHere(path, entry.name);
      let size = 0;
      let modified = 0;
      try {
        const info = await stat(full);
        size = info.size;
        modified = Math.trunc(info.mtimeMs);
      } catch {
        // קובץ שנעלם בין הסריקה ל-stat — מדווח כמו שהוא, בלי להפיל.
      }
      out.push({name: entry.name, dir: entry.isDirectory(), size, modified});
    }
    return out;
  },

  async mkdirs(path) {
    await mkdir(path, {recursive: true});
    return true;
  },

  // כמו ב-host: **קבצים בלבד**, וקובץ שאינו קיים הוא הצלחה — המצב
  // המבוקש הושג.
  async remove(path) {
    await rm(path, {force: true});
    return true;
  },

  // כמו ב-host: **ריקה בלבד**, ולא רקורסיבית. תיקייה שנשאר בה תוכן
  // חוזרת `false`, כדי שגריעה לא תיקח איתה תמונה או בילד שבקטלוג.
  async removeDir(path) {
    try {
      await rmdir(path);
      return true;
    } catch (error) {
      if (error.code === 'ENOENT') return true;
      if (error.code === 'ENOTEMPTY' || error.code === 'EEXIST') return false;
      throw error;
    }
  },

  async copy(from, to) {
    await ensureParent(to);
    await copyFile(from, to);
    return true;
  },

  async rename(from, to) {
    await ensureParent(to);
    await rename(from, to);
    return true;
  },

  // קריאת קטע מתוך קובץ — זה מה ש-`manifest_reader.js` נשען עליו כדי
  // לקרוא את ה-manifest מתוך ה-ZIP בלי לפרוש אותו.
  async readBase64(path, offset, length) {
    const handle = await open(path, 'r');
    try {
      const buffer = Buffer.alloc(Number(length));
      const {bytesRead} =
          await handle.read(buffer, 0, Number(length), Number(offset));
      return buffer.subarray(0, bytesRead).toString('base64');
    } finally {
      await handle.close();
    }
  },

  async fileExists(path) {
    return (await this.kind(path)) === 'file';
  },

  async dirExists(path) {
    return (await this.kind(path)) === 'dir';
  },
};

// ── רשת ──────────────────────────────────────────────────────────────────────

// ⚠️ GitHub מחזיר 403 לכל בקשה בלי User-Agent. ב-host זה נקבע ברמת
// הסשן (`kUserAgent` ב-netapi.cpp), ולכן שום קורא אינו מוסר אותו — ומכאן
// שהוא חייב להיקבע גם כאן, ובאותו מקום אחד.
const USER_AGENT = 'otzaria-plugin-store-bundler';

/**
 * שעון עצר שמתאפס בכל בייט שמגיע. `timeoutMs` הוא הגבול לכל ההורדה,
 * ו-`stallMs` הוא הגבול לשקט **בתוכה** — חיבור שנתקע באמצע קובץ של
 * ‎45MB לא ייתפס בלי זה עד תום הגבול הכולל.
 */
function abortOnStall(controller, stallMs) {
  if (!stallMs) return {touch() {}, stop() {}};
  let timer = null;
  const arm = () => {
    timer = setTimeout(() => controller.abort(new Error('ההורדה נתקעה')),
                       stallMs);
  };
  arm();
  return {
    touch() {
      clearTimeout(timer);
      arm();
    },
    stop() {
      clearTimeout(timer);
    },
  };
}

export const net = {
  async get(url, timeoutMs = 20000) {
    const response = await fetch(url, {
      headers: {'User-Agent': USER_AGENT},
      signal: AbortSignal.timeout(Number(timeoutMs)),
    });
    return {
      status: response.status,
      contentType: response.headers.get('content-type') ?? '',
      body: await response.text(),
    };
  },

  /**
   * מוריד לקובץ ומחזיר את הכותרות **גולמיות**. ההחלטה על שם וסיומת
   * אינה כאן אלא ב-`net_headers.js`, בדיוק כמו מול ה-host.
   */
  async download(url, destPath, timeoutMs = 20000, stallMs = 0) {
    const controller = new AbortController();
    const overall = setTimeout(
        () => controller.abort(new Error('פג הזמן הקצוב להורדה')),
        Number(timeoutMs));
    try {
      const response = await fetch(url, {
        headers: {'User-Agent': USER_AGENT},
        signal: controller.signal,
      });
      const headers = {
        status: response.status,
        contentType: response.headers.get('content-type') ?? '',
        contentDisposition: response.headers.get('content-disposition') ?? '',
      };

      // כמו ב-host: סטטוס שאינו 200 מוחזר בלי לכתוב קובץ — המתקשר הוא
      // שמחליט מה זה אומר.
      if (response.status !== 200 || response.body === null) {
        return {...headers, size: 0};
      }

      await ensureParent(destPath);
      const stall = abortOnStall(controller, Number(stallMs));
      let size = 0;
      const source = Readable.fromWeb(response.body);
      source.on('data', (chunk) => {
        size += chunk.length;
        stall.touch();
      });
      try {
        await pipeline(source, createWriteStream(destPath));
      } finally {
        stall.stop();
      }
      return {...headers, size};
    } finally {
      clearTimeout(overall);
    }
  },
};
