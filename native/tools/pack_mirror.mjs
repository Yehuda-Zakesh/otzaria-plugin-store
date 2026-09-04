// בונה מראה מלאה (`Data\`) בשביל החבילה המלאה — בהרצת `PluginMirrorSync`
// **עצמו** מול שכבת ה-Node שב-`node_host.mjs`.
//
//   node native/tools/pack_mirror.mjs <תיקיית Data>
//
// ── מה זה כן ומה זה לא ───────────────────────────────────────────────────────
// הסקריפט הזה אינו יודע דבר על תוספים. הוא מחווט את אותם ארבעה חלקים
// שהתוכנה מחווטת (`main.js` → `PluginsManager`), מריץ `sync()`, ומדפיס.
// כל החלטה — איזה בילד לאיזו גרסת אוצריא, מה נחשב "לא השתנה", מה נגרע —
// נשארת בקוד שהתוכנה מריצה, ונבדקת ב-`node --test`.
//
// ⚠️ **התיקייה אינה נמחקת כאן.** הג'וב זורע אותה מהחבילה הקודמת לפני
// הריצה, ואז `#plan` מוריד רק את הדלתא: עדכון של תוסף אחד = קובץ אחד
// מ-otzaria.org ולא 35. זו גם הסיבה שהמסלול שנבדק ב-CI הוא המסלול
// האינקרמנטלי שכונן של משתמש עובר בעדכון, ולא "מראה ריקה" שאיש אינו חי בו.

import {readdir, rmdir} from 'node:fs/promises';
import {win32} from 'node:path';

import {fs, net} from './node_host.mjs';
import {OtzariaReleaseClient} from '../web/js/store/otzaria_release_client.js';
import {PluginMirrorStore} from '../web/js/store/mirror_store.js';
import {PluginMirrorSync, SyncPhase} from '../web/js/store/mirror_sync.js';
import {PluginStoreClient} from '../web/js/store/store_client.js';

const {join} = win32;

const dataDir = process.argv[2];
if (!dataDir) {
  console.error('usage: node pack_mirror.mjs <Data dir>');
  process.exit(2);
}

// ── גרסאות היעד ──────────────────────────────────────────────────────────────
// בתוכנה, כשל בבירור הגרסאות נבלע ומשמעותו "אין מול מה לסנן" — המשתמש
// מקבל את הבילד החי וממשיך. **כאן זה כשל מוחלט**: חבילה שנבנתה בלי
// היעד נושאת בילדים שלא נבחרו לפי שום כלל, ומופצת ככה לכונן של מישהו.
// עדיף לא לפרסם חבילה מאשר לפרסם כזאת.
const releases = new OtzariaReleaseClient({net});
const target = await releases.fetchTargetVersions();
if (target.versions.length === 0) {
  console.error('אין אף release של אוצריא עם תג גרסה — אין יעד לבנות עבורו');
  process.exit(1);
}
console.log(`גרסאות היעד: ${target.versions.join(', ')}` +
    (target.latestIsPrerelease ? '  (האחרונה היא prerelease)' : ''));

// ── החיווט, כמו ב-`PluginsManager` ───────────────────────────────────────────
// אותם שלושה נתיבים ש-`paths.h` מגדיר, ובאותה צורה — `\` של ווינדוס,
// כי כך `mirror_store.js` מרכיב את השאר וכך הם נשמרים בקטלוג.
const store = new PluginMirrorStore({
  dataDir,
  pluginsDir: join(dataDir, 'plugins'),
  catalogPath: join(dataDir, 'catalog.json'),
}, fs);

const sync = new PluginMirrorSync({
  client: new PluginStoreClient({net, fs}),
  store,
  // לקריאת ה-manifest מתוך ה-ZIP שירד, בלי לפרוש אותו.
  io: {
    stat: (path) => fs.stat(path),
    readBase64: (path, offset, length) => fs.readBase64(path, offset, length),
  },
});

// ── ההרצה ────────────────────────────────────────────────────────────────────
const warnings = [];
const result = await sync.sync({
  appVersions: target.versions,
  onProgress: ({phase, message}) => {
    if (phase === SyncPhase.warning) warnings.push(message);
    console.log(`  ${message}`);
  },
});

console.log('');
console.log(`ירדו: ${result.fetched} | דולגו (כבר מעודכנים): ${result.skipped}`);
if (result.incompatible.length > 0) {
  // ⚠️ זה **חייב** להופיע ביומן: "למה התוסף הזה לא בחבילה" הוא השאלה
  // שתישאל, ואין דרך אחרת לענות עליה בדיעבד.
  console.log(`אין בילד תואם ליעד (${result.incompatible.length}): ` +
      result.incompatible.join(' | '));
}
for (const warning of warnings) console.log(`אזהרה: ${warning}`);

// כשל בנכס בודד אינו מפיל את הסנכרון בתוכנה — המשתמש יסנכרן שוב. חבילה
// היא הזדמנות אחת, והמשתמש שלה מנותק: קובץ חסר בה אינו ניתן לתיקון אצלו.
if (result.hasFailures) {
  console.error(`כשלו: ${result.failed.join(' | ')}`);
  process.exit(1);
}

// ── ניקוי תיקיות ריקות ───────────────────────────────────────────────────────
// ⚠️ **חובה לפני האריזה.** לפורמט החבילה אין רשומת תיקייה — הוא רושם
// קבצים בלבד (`pack_overlay.mjs`), והמחלץ יוצר רק את תיקיות ההורה של
// קבצים. תיקייה ריקה ב-`Data\` לכן אינה שורדת את ההלוך-חזור, ואימות
// `diff -r Data verify` שב-bundle.yml נופל על `Only in Data: …` —
// כלומר **הג'וב היומי כולו נכשל ושום חבילה אינה מתפרסמת**.
//
// זה לא תיאורטי: הסנכרון יוצר את תיקיית התוסף לפני שהוא מוריד לתוכה
// משהו, וגריעת בילדים ישנים מוחקת קבצים בלי למחוק את התיקייה שהתרוקנה.
// הניקוי כאן הוא ברמת התוצאה ולכן חסין לכל סיבה שבגללה נוצרה תיקייה
// ריקה, גם כזאת שעוד לא נתקלנו בה.
async function pruneEmptyDirs(root) {
  const removed = [];
  // מחזיר true אם נשאר תוכן כלשהו תחת [dir] אחרי הניקוי.
  async function walk(dir) {
    let entries;
    try {
      entries = await readdir(dir, {withFileTypes: true});
    } catch (error) {
      if (error.code === 'ENOENT' || error.code === 'ENOTDIR') return true;
      throw error;
    }
    let survivors = 0;
    for (const entry of entries) {
      if (!entry.isDirectory()) {
        survivors++;
        continue;
      }
      const child = win32.join(dir, entry.name);
      if (await walk(child)) {
        survivors++;
        continue;
      }
      await rmdir(child);
      removed.push(child);
    }
    return survivors > 0;
  }
  // השורש עצמו נשאר גם כשהוא ריק — האריזה היא שמתלוננת על מראה ריקה.
  await walk(root);
  return removed;
}

const pruned = await pruneEmptyDirs(dataDir);
if (pruned.length > 0) {
  console.log(`נוקו ${pruned.length} תיקיות ריקות: ${pruned.join(' | ')}`);
}

console.log(`המראה מוכנה ב-${dataDir}`);
