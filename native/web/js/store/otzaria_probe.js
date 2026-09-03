// מגלה **פעם אחת** איפה אוצריא מותקנת במחשב הזה ובאיזו גרסה.
//
// פורט של `lib/src/services/otzaria_install_probe.dart` ושל תת-הקבוצה
// הרלוונטית מ-`otzaria_manager`: `OtzariaAppLocator`, `OtzariaStateStore`
// והזיהוי שב-`OtzariaManager.checkForUpdate`.
//
// ── מה החנות צריכה, ומה לא ───────────────────────────────────────────────────
// גרסת ה-Flutter קראה ל-`OtzariaManager.checkForUpdate()`, שנושא איתו גם
// בדיקת release ברשת, מראת תוכנה והתקנה של אוצריא עצמה. לחנות דרושים
// **שני נתונים בלבד**, ולכן רק הם עברו:
//
//   • **נתיב ההפעלה** — ממנו נגזרת תיקיית התוספים של התקנה **ניידת**,
//     ואליו נמסרת ההתקנה. התקנה ניידת אינה רושמת את הסכימה `otzaria://`
//     בכלל, ולכן בלי הנתיב ההתקנה שם נכשלת ב"ודא שאוצריא מותקנת".
//   • **הגרסה המותקנת** — לפיה נבחר איזה בילד של התוסף מוצג ומותקן.
//     בלעדיה נבחר תמיד הבילד החי, שעשוי לא לעלות על התקנה ישנה יותר.
//
// הכול מקומי — הזיהוי **אינו נוגע ברשת**.
//
// כשל בזיהוי אינו שגיאת הרצה: הוא נרשם, והחנות ממשיכה עם "לא ידוע".

/**
 * exe-ים שנשלחים **לצד** אפליקציית Flutter ואינם האפליקציה עצמה.
 *
 * בלי הרשימה הזו `crashpad_handler.exe` ניצח את `otzaria.exe` בתיקיית
 * ההתקנה האמיתית — הוא פשוט קודם לו באלף-בית.
 */
const WINDOWS_HELPER_EXE_NAMES = new Set([
  'crashpad_handler',
  'crashpad_wer',
  'elevation_service',
  'msedgewebview2',
]);

/**
 * ה-exe-ים של החנות **עצמה**.
 *
 * ⚠️ שם ה-exe שלנו מכיל "התוספים", ושם ה-release שלו מכיל "otzaria" —
 * ובלי הפסילה כאן חנות שהועתקה ל-`C:\אוצריא` הייתה מזהה את **עצמה**
 * כאוצריא, קוראת את הגרסה שלה, ומסננת את בילדי התוספים לפיה. זה קרה
 * בפועל בגרסה הקודמת, ולכן הרשימה הזאת עברה כמו שהיא.
 */
const OUR_OWN_EXE_NAMES = new Set([
  'launcher_app',
  'עדכוני אוצריא',
  'otzaria-updates',
  'otzaria_plugin_store',
  'otzaria-plugin-store',
  'חנות התוספים',
]);

/** עומק החיפוש בתיקיית התקנה.
 *
 * הגבול אינו קוסמטי: `C:\אוצריא` היא גם תיקיית התקנה אפשרית וגם מיקום
 * נפוץ של ספריית הספרים (~1GB), וסריקה עמוקה שלה חזרה בכל בדיקה.
 */
const DEFAULT_MAX_DEPTH = 3;

const baseNameNoExt = (path) => {
  const trimmed = path.replace(/[\\/]+$/, '');
  const cut = trimmed.lastIndexOf('\\');
  const name = cut < 0 ? trimmed : trimmed.slice(cut + 1);
  const dot = name.lastIndexOf('.');
  return dot > 0 ? name.slice(0, dot) : name;
};

const dirNameOf = (path) => {
  const cut = path.replace(/[\\/]+$/, '').lastIndexOf('\\');
  return cut < 0 ? path : path.slice(0, cut);
};

/**
 * מחבר מקטעי נתיב עם לוכסן **אחד**.
 *
 * ⚠️ `InstallLocation` שברג'יסטרי מגיע לעיתים עם לוכסן בסוף, ושרשור
 * נאיבי הפיק `…\Programs\Otzaria\\otzaria.exe`. ווינדוס פותחת נתיב כזה,
 * אבל הוא נכתב לקובץ המצב ומושווה מולו בהרצה הבאה — ואי-התאמה שם
 * פירושה זיהוי מחדש בכל עלייה.
 */
const joinPath = (left, right) =>
    `${String(left).replace(/[\\/]+$/, '')}\\${String(right).replace(/^[\\/]+/, '')}`;

/** האם הטקסט מזכיר את אוצריא — כך נבדק גם ה-`DisplayName` מהרג'יסטרי. */
export function mentionsOtzaria(text) {
  const lower = String(text).toLowerCase();
  return lower.includes('otzaria') || lower.includes('אוצריא');
}

/** האם שם הקובץ מזהה את אוצריא. */
export function nameLooksLikeOtzaria(candidatePath) {
  return mentionsOtzaria(baseNameNoExt(candidatePath));
}

/** האם [fileName] הוא ה-exe של החנות עצמה. */
export function isOurOwnExe(fileName) {
  return OUR_OWN_EXE_NAMES.has(baseNameNoExt(fileName).toLowerCase());
}

/**
 * מאתר את ה-exe של אוצריא בתוך [directory].
 *
 * **סריקת רוחב** (BFS): שם תואם מנצח מיד, וכשאין כזה נבחר מועמד הגיבוי
 * ה**רדוד ביותר**. הרוחב-לפני-עומק אינו רק חסם עלות — הוא מה שהופך את
 * התשובה לוודאית, כי סדר ההחזרה של קריאת תיקייה אינו מובטח, ובלעדיו exe
 * מקונן היה יכול לנצח את זה שבשורש.
 *
 * @returns {Promise<string|null>}
 */
export async function findOtzariaExe(directory, fs, selfPath,
                                     maxDepth = DEFAULT_MAX_DEPTH) {
  if (!await fs.dirExists(directory)) return null;

  let level = [directory];
  let fallback = null;

  for (let depth = 0; depth < maxDepth && level.length > 0; depth++) {
    const next = [];
    const named = [];
    const others = [];

    for (const dir of level) {
      let entries;
      try {
        entries = await fs.list(dir);
      } catch {
        continue; // תיקייה בלי הרשאת קריאה — מדלגים
      }

      for (const entry of entries) {
        const full = joinPath(dir, entry.name);
        if (entry.dir) {
          next.push(full);
          continue;
        }

        const name = entry.name.toLowerCase();
        if (!name.endsWith('.exe')) continue;
        // unins*.exe הוא ה-uninstaller ש-Inno Setup יוצר בתיקייה.
        if (name.startsWith('unins')) continue;
        const base = baseNameNoExt(name);
        if (OUR_OWN_EXE_NAMES.has(base)) continue;
        if (selfPath && full.toLowerCase() === selfPath.toLowerCase()) continue;

        if (nameLooksLikeOtzaria(full)) named.push(full);
        else if (!WINDOWS_HELPER_EXE_NAMES.has(base)) others.push(full);
      }
    }

    // מיון בתוך הרמה: שתי תיקיות באותו עומק אינן מסודרות בין מכונות.
    if (named.length > 0) return named.sort()[0];
    if (fallback === null && others.length > 0) fallback = others.sort()[0];

    level = next;
  }

  return fallback;
}

export class OtzariaInstallProbe {
  /**
   * @param {{fs: object, sys: object, env: object, statePath: string,
   *          selfPath: string, log?: (message: string) => void}} options
   */
  constructor({fs, sys, env, statePath, selfPath, log = () => {}}) {
    this.fs = fs;
    this.sys = sys;
    this.env = env;
    this.statePath = statePath;
    this.selfPath = selfPath;
    this.log = log;

    /** נתיב ההפעלה של אוצריא, או null כשלא זוהתה התקנה. */
    this.launchPath = null;
    /** הגרסה שנקראת **מההתקנה עצמה**, או null. */
    this.version = null;

    this.#done = false;
    this.#inFlight = null;
  }

  #done;
  #inFlight;

  /**
   * מריץ את הזיהוי אם עוד לא רץ, וממתין לזה שכבר בדרך. כל הקוראים
   * מקבלים אותה תשובה בלי לשלם על סריקה שנייה.
   */
  ensureDetected() {
    if (this.#done) return Promise.resolve();
    if (this.#inFlight === null) {
      this.#inFlight = this.#detect().finally(() => {
        this.#inFlight = null;
      });
    }
    return this.#inFlight;
  }

  async #detect() {
    try {
      const state = await this.#resolve();
      this.launchPath = state?.launchPath ?? null;
      this.version = state?.version ?? null;
      if (this.launchPath === null) {
        this.log('לא זוהתה התקנה של אוצריא במחשב הזה');
      } else {
        this.log(`אוצריא זוהתה: ${this.launchPath} ` +
                 `(גרסה ${this.version ?? '?'})`);
      }
    } catch (error) {
      // אין כאן "מצב שגיאה" בממשק: החנות עובדת גם בלי לדעת מה מותקן.
      this.log(`זיהוי ההתקנה של אוצריא נכשל: ${error?.message ?? error}`);
    } finally {
      this.#done = true;
    }
  }

  /** שלושת המסלולים, בסדר של `OtzariaManager.checkForUpdate`. */
  async #resolve() {
    // 1. המצב השמור, **מאומת מול הדיסק של המחשב הזה**.
    const stored = await this.#verifiedStoredState();
    if (stored !== null) return stored;

    // 2. התהליך הרץ. הוא אינו ניחוש אלא העותק שהמשתמש מפעיל בפועל —
    //    כולל התקנה במיקום שאינו ברשימה. זו גם תצפית **חולפת**, ולכן
    //    נשמרת: אחרת המידע היה נעלם בדיוק כשמבקשים לסגור את אוצריא.
    const running = await this.sys.runningOtzaria();
    if (running.launchPath) {
      const state = await this.#stateAt(running.launchPath);
      if (state !== null) {
        await this.#save(state);
        return state;
      }
    }

    // 3. רק כשעדיין לא ידוע כלום: בניית הרשימה סורקת את הרג'יסטרי
    //    (~200ms), ואין סיבה לשלם על זה בכל בדיקה כשההתקנה כבר מוכרת.
    return await this.#detectInKnownDirs();
  }

  /**
   * מאמת מצב שמור מול הדיסק של המחשב **הזה**, ומחזיר null אם ההתקנה
   * שהוא מתאר אינה שם.
   *
   * ⚠️ קובץ המצב יושב לצד התוכנה ונוסע איתה בין מחשבים, ולכן "מותקנת
   * גרסה X" שנרשם במחשב אחד אינו עדות לכלום במחשב הבא. בלי האימות הזה
   * הלאנצ'ר הכריז "אוצריא מעודכנת" במחשב שאין בו אוצריא בכלל.
   *
   * הקובץ עצמו **אינו** נמחק: הוא עשוי להיות תקף לגמרי במחשב שהכונן
   * יחזור אליו.
   */
  async #verifiedStoredState() {
    let stored;
    try {
      if (!await this.fs.fileExists(this.statePath)) return null;
      stored = JSON.parse(await this.fs.readText(this.statePath));
    } catch {
      return null; // פגום — כמו "אין התקנה ידועה"
    }
    const launchPath = stored?.launchPath ?? stored?.exePath;
    if (typeof launchPath !== 'string' || launchPath.length === 0) return null;
    if (!await this.fs.fileExists(launchPath)) return null;

    // הגרסה נקראת תמיד מקובץ ההרצה עצמו, כדי שהתקנה שעודכנה מחוץ לחנות
    // לא תוצג בגרסה שאנחנו "זוכרים". כשל קריאה משאיר את התג השמור —
    // הקובץ קיים, ואין סיבה להתייחס אליו כאילו נעלם.
    let onDisk = null;
    try {
      onDisk = await this.sys.exeVersion(launchPath);
    } catch {
      onDisk = null;
    }
    const version = onDisk ?? stored.installedTagName ?? null;
    const state = {launchPath, version, installDir: dirNameOf(launchPath)};
    if (onDisk !== null && onDisk !== stored.installedTagName) {
      await this.#save(state);
    }
    return state;
  }

  /** ההתקנה הראשונה שנמצאת במיקומים המוכרים, או null. אינה נשמרת. */
  async #detectInKnownDirs() {
    for (const dir of await this.#autoDetectDirs()) {
      const launchPath = await findOtzariaExe(dir, this.fs, this.selfPath);
      if (launchPath === null) continue;
      const state = await this.#stateAt(launchPath);
      if (state !== null) return state;
    }
    return null;
  }

  /**
   * המיקומים שאוצריא **עשויה** לשבת בהם, לפי סדר עדיפות.
   *
   * הרג'יסטרי ראשון: הוא המקום היחיד שיודע על התקנה שאינה באחת מתיקיות
   * ברירת המחדל, גם כשאוצריא סגורה.
   */
  async #autoDetectDirs() {
    const dirs = [];
    try {
      for (const dir of await this.sys.registryDirs()) dirs.push(dir);
    } catch {
      // אין הרשאה או שהקריאה נכשלה — ממשיכים לתיקיות ברירת המחדל.
    }

    // `{autopf}\Otzaria` — כלומר `%LocalAppData%\Programs\Otzaria` למשתמש
    // הנוכחי, או `%ProgramFiles%\Otzaria` לכל המשתמשים.
    if (this.env.localAppData) {
      dirs.push(`${this.env.localAppData}\\Programs\\Otzaria`);
    }
    if (this.env.programFiles) {
      dirs.push(`${this.env.programFiles}\\Otzaria`);
      dirs.push(`${this.env.programFiles}\\אוצריא`);
    }
    // גיבוי משני — ה-iss של אוצריא אומר `DefaultDirName=C:\אוצריא`.
    dirs.push('C:\\אוצריא');
    return dirs;
  }

  /** מצב התקנה מנתיב הפעלה שכבר ידוע. */
  async #stateAt(launchPath) {
    let version = null;
    try {
      version = await this.sys.exeVersion(launchPath);
    } catch {
      return null;
    }
    // בלי גרסה אי אפשר לקבוע שזו התקנה של אוצריא בכלל.
    if (version === null) return null;
    return {launchPath, version, installDir: dirNameOf(launchPath)};
  }

  async #save(state) {
    try {
      await this.fs.writeText(this.statePath, JSON.stringify({
        installedTagName: state.version,
        installDir: state.installDir,
        launchPath: state.launchPath,
      }, null, 2));
    } catch {
      // כונן לקריאה בלבד, למשל. הזיהוי עצמו הצליח, וזה מה שחשוב.
    }
  }
}
