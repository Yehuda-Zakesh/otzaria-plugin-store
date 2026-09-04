// הסנכרון עצמו, ומסלול ההתקנה שכותב את הקטלוג מחדש.
//
// שתי השאלות שהקובץ הזה שומר עליהן:
//
//   1. **מה נשמר בקטלוג כשכותבים אותו מחדש.** כתיבה שהעתיקה שדה-שדה
//      מחקה בשקט את מה ששכחה, ו-`targetAppVersions` הוא השדה שנפל —
//      ואיתו כל ההסתרה של תוספים שאין להם בילד במחשב הזה.
//   2. **מה קורה לסנכרון כשתוסף אחד נכשל.** החוזה בראש `mirror_sync.js`
//      אומר "כשל בנכס בודד מדווח כ-warning והסנכרון ממשיך", ופעולות
//      הדיסק שסביב ההורדות זרקו החוצה ולקחו איתן את הסנכרון כולו.

import assert from 'node:assert/strict';
import {describe, it} from 'node:test';

import {PluginMirrorStore} from '../web/js/store/mirror_store.js';
import {PluginMirrorSync, SyncPhase} from '../web/js/store/mirror_sync.js';
import {PluginsManager} from '../web/js/store/plugins_manager.js';
import {PluginCatalog} from '../web/js/store/models.js';

const PATHS = Object.freeze({
  dataDir: 'C:\\Data',
  pluginsDir: 'C:\\Data\\plugins',
  catalogPath: 'C:\\Data\\catalog.json',
});

const trim = (path) => path.replace(/[\\/]+$/, '');
const key = (path) => trim(path).toLowerCase();

/** fs בזיכרון בחוזה שהגשר חושף. תיקיות נגזרות מהקבצים שבתוכן. */
function memoryFs(seed = {}) {
  const files = new Map();
  for (const [path, text] of Object.entries(seed)) {
    files.set(key(path), {path: trim(path), text});
  }

  return {
    files,
    /** נתיבים ש-`mkdirs` ייכשל עליהם — תיקייה נעולה או נתיב ארוך מדי. */
    mkdirsFails: new Set(),

    async readText(path) {
      const entry = files.get(key(path));
      if (entry === undefined) throw new Error(`אין קובץ ${path}`);
      return entry.text;
    },
    async writeText(path, text) {
      files.set(key(path), {path: trim(path), text});
      return true;
    },
    async kind(path) {
      const k = key(path);
      if (files.has(k)) return 'file';
      for (const existing of files.keys()) {
        if (existing.startsWith(`${k}\\`)) return 'dir';
      }
      return 'none';
    },
    async fileExists(path) {
      return (await this.kind(path)) === 'file';
    },
    async dirExists(path) {
      return (await this.kind(path)) === 'dir';
    },
    async stat(path) {
      const entry = files.get(key(path));
      if (entry === undefined) throw new Error(`אין קובץ ${path}`);
      return {size: entry.text.length, modified: 0};
    },
    async list(path) {
      const prefix = `${key(path)}\\`;
      const out = new Map();
      for (const [k, entry] of files) {
        if (!k.startsWith(prefix)) continue;
        const rest = entry.path.slice(prefix.length);
        const cut = rest.indexOf('\\');
        const name = cut < 0 ? rest : rest.slice(0, cut);
        out.set(name.toLowerCase(), {name, dir: cut >= 0, size: 1,
                                     modified: 0});
      }
      return [...out.values()];
    },
    async mkdirs(path) {
      if (this.mkdirsFails.has(key(path))) {
        throw new Error(`יצירת התיקייה ${path} נכשלה`);
      }
      return true;
    },
    async remove(path) {
      files.delete(key(path));
      return true;
    },
    async rename(from, to) {
      const entry = files.get(key(from));
      if (entry === undefined) throw new Error(`אין קובץ ${from}`);
      files.delete(key(from));
      files.set(key(to), {path: trim(to), text: entry.text});
      return true;
    },
    async copy() {
      return true;
    },
    async readBase64() {
      throw new Error('אין צורך בקריאת ZIP בבדיקה הזאת');
    },
  };
}

/** לקוח חנות מזויף: מחזיר רשימה נתונה, ו"מוריד" ע"י כתיבה ל-fs. */
function fakeClient(fs, plugins) {
  return {
    baseUrl: 'https://otzaria.org',
    async fetchCatalog() {
      return plugins;
    },
    async fetchStoreHome() {
      return {settings: {homeTitle: 'החנות'}, categories: []};
    },
    async fetchCategory() {
      return {slug: '', name: '', plugins: []};
    },
    async downloadAsset(url, destPathNoExt, preferredExt = '') {
      const path = `${destPathNoExt}${preferredExt}`;
      await fs.writeText(path, 'בייטים');
      return {path, ext: preferredExt, size: 6, originalName: null};
    },
  };
}

/** רשומת תוסף בצורת התשובה של `/api/plugins`. */
const apiPlugin = ({id, name = 'תוסף', version = '3.0.0'} = {}) => ({
  id,
  name,
  version,
  manifestId: 'ignored',
  versions: [{
    version,
    compatibleWith: '0.9.96',
    downloadUrl: `/plugins/${version}.otzplugin`,
    isLatest: true,
  }],
});

/** ה-manifestId אינו נקרא בבדיקות האלה — אין ZIP אמיתי מאחורי הקבצים. */
const io = {
  stat: async () => {
    throw new Error('אין ZIP');
  },
  readBase64: async () => {
    throw new Error('אין ZIP');
  },
};

describe('PluginMirrorSync — כשל בתוסף אחד', () => {
  // ⚠️ `mkdirs` על תיקיית התוסף זרק החוצה, `runPooled` גלגל את החריג
  // הלאה, ו-`sync` נפל **לפני** `store.save` — כלומר גם התוסף השני, שירד
  // בהצלחה, נשאר על הדיסק בלי רישום בקטלוג.
  it('מדווח אזהרה, ממשיך, ושומר את הקטלוג', async () => {
    const fs = memoryFs();
    fs.mkdirsFails.add(key('C:\\Data\\plugins\\bad'));
    const store = new PluginMirrorStore(PATHS, fs);
    const client = fakeClient(fs, [
      apiPlugin({id: 'bad', name: 'תוסף שנכשל'}),
      apiPlugin({id: 'good', name: 'תוסף שהצליח'}),
    ]);

    const progress = [];
    const result = await new PluginMirrorSync({client, store, io})
        .sync({appVersions: ['0.9.96'], onProgress: (p) => progress.push(p)});

    assert.deepEqual(result.failed, ['תוסף שנכשל']);
    assert.ok(progress.some((p) => p.phase === SyncPhase.warning),
              'הכשל חייב להגיע כאזהרה');

    // הקטלוג נשמר, והתוסף שהצליח נושא את הקובץ שירד.
    const saved = await store.load();
    assert.deepEqual(saved.targetAppVersions, ['0.9.96']);
    const good = saved.plugins.find((p) => p.id === 'good');
    assert.equal(good.localFiles.size, 1, 'הקובץ שירד חייב להיות רשום');
    assert.equal(await store.hasFileFor(good, '3.0.0'), true);

    // והתוסף שנכשל נשאר בקטלוג בלי קובץ, כדי שהסנכרון הבא ינסה שוב.
    const bad = saved.plugins.find((p) => p.id === 'bad');
    assert.equal(bad.localFiles.size, 0);
  });
});

describe('PluginMirrorSync — רשומה בלי id', () => {
  // ⚠️ `pluginDir('')` הוא שורש `plugins\` עצמו: ההורדות היו נוחתות שם
  // לצד הקטלוג, ו-`pruneUnusedFiles` היה סורק את השורש ומוחק שם כל קובץ
  // ששמו מתחיל ב-`plugin`.
  it('מדולגת ואינה נוחתת בשורש plugins', async () => {
    const fs = memoryFs();
    const store = new PluginMirrorStore(PATHS, fs);
    const client = fakeClient(fs, [
      apiPlugin({id: '', name: 'בלי מזהה'}),
      apiPlugin({id: 'good', name: 'תוסף'}),
    ]);

    const result = await new PluginMirrorSync({client, store, io})
        .sync({appVersions: ['0.9.96']});

    assert.equal(result.catalog.plugins.length, 1);
    assert.equal(result.catalog.plugins[0].id, 'good');

    // בשורש `plugins\` יש רק את תיקיית התוסף — שום קובץ שנשפך לתוכה.
    const root = await fs.list(PATHS.pluginsDir);
    assert.deepEqual(root.map((e) => e.name).sort(), ['good']);
    assert.ok(root.every((e) => e.dir), 'בשורש plugins אין קבצים');
  });
});

describe('PluginMirrorSync — נכס שהאתר הסיר', () => {
  /** מראה שכבר נושאת תמונה ושני צילומי מסך לתוסף `p`. */
  function mirrorWithAssets() {
    const stored = {
      lastSync: '2026-01-01T00:00:00.000Z',
      targetAppVersions: ['0.9.96'],
      home: {title: '', subtitle: ''},
      categories: [],
      plugins: [{
        id: 'p',
        name: 'תוסף',
        version: '3.0.0',
        updatedAt: '2026-01-01',
        image: 'p/image.png',
        screenshots: ['p/screenshot-0.png', 'p/screenshot-1.png'],
        remoteImageUrl: '/img/a.png',
        remoteScreenshotUrls: ['/s/0.png', '/s/1.png'],
        localFiles: {},
        versions: [],
      }],
    };
    return memoryFs({
      [PATHS.catalogPath]: JSON.stringify(stored),
      'C:\\Data\\plugins\\p\\image.png': 'תמונה',
      'C:\\Data\\plugins\\p\\screenshot-0.png': 'צילום',
      'C:\\Data\\plugins\\p\\screenshot-1.png': 'צילום',
    });
  }

  // ⚠️ הנתיבים המקומיים הועברו מהרשומה הקודמת בלי תנאי, ואילו
  // `needsImage` דורש `remoteImageUrl` לא-ריק — כלומר תמונה שהאתר הסיר
  // לא נחשבה "שינוי", לא ירדה, ולכן גם לא נדרסה. המראה המשיכה להציג
  // אותה לנצח, והקובץ נשאר על הכונן.
  it('תמונה שהוסרה נמחקת מהקטלוג ומהדיסק', async () => {
    const fs = mirrorWithAssets();
    const store = new PluginMirrorStore(PATHS, fs);
    // האתר מחזיר עכשיו את אותו תוסף בלי תמונה, ועם צילום מסך אחד פחות.
    const client = fakeClient(fs, [{
      id: 'p',
      name: 'תוסף',
      version: '3.0.0',
      updatedAt: '2026-01-01',
      screenshots: [],
      versions: [],
    }]);

    const result = await new PluginMirrorSync({client, store, io})
        .sync({appVersions: ['0.9.96']});

    const saved = result.catalog.plugins[0];
    assert.equal(saved.imagePath, null, 'הקטלוג אינו מפנה עוד לתמונה');
    assert.deepEqual(saved.screenshotPaths, []);

    assert.equal(fs.files.has(key('C:\\Data\\plugins\\p\\image.png')), false);
    assert.equal(
        fs.files.has(key('C:\\Data\\plugins\\p\\screenshot-0.png')), false);
    assert.equal(
        fs.files.has(key('C:\\Data\\plugins\\p\\screenshot-1.png')), false);
  });

  it('תמונה שלא הוסרה נשארת במקומה', async () => {
    // הצד השני של אותו כלל: `updatedAt` והכתובת לא זזו, ולכן אין הורדה
    // מחדש — וגם אין מחיקה.
    const fs = mirrorWithAssets();
    const store = new PluginMirrorStore(PATHS, fs);
    const client = fakeClient(fs, [{
      id: 'p',
      name: 'תוסף',
      version: '3.0.0',
      updatedAt: '2026-01-01',
      image: '/img/a.png',
      screenshots: ['/s/0.png', '/s/1.png'],
      versions: [],
    }]);

    const result = await new PluginMirrorSync({client, store, io})
        .sync({appVersions: ['0.9.96']});

    assert.equal(result.catalog.plugins[0].imagePath, 'p/image.png');
    assert.deepEqual(result.catalog.plugins[0].screenshotPaths,
                     ['p/screenshot-0.png', 'p/screenshot-1.png']);
    assert.equal(fs.files.has(key('C:\\Data\\plugins\\p\\image.png')), true);
  });
});

describe('PluginsManager.install — כתיבת הקטלוג מחדש', () => {
  /** מראה שסונכרנה עבור 0.9.96, עם קטגוריה, דף בית, ובלי הקובץ. */
  function mirrorWithoutFile() {
    const catalog = {
      lastSync: '2026-01-01T00:00:00.000Z',
      targetAppVersions: ['0.9.96'],
      home: {title: 'החנות', subtitle: 'תוספים'},
      categories: [{slug: 'לימוד', name: 'לימוד', plugins: ['p']}],
      plugins: [{
        id: 'p',
        name: 'תוסף',
        version: '3.0.0',
        manifestId: 'com.example.p',
        categories: ['לימוד'],
        versions: [{
          version: '3.0.0',
          compatibleWith: '0.9.96',
          downloadUrl: 'https://otzaria.org/plugins/3.0.0.otzplugin',
          isLatest: true,
        }],
      }],
    };

    const fs = memoryFs({[PATHS.catalogPath]: JSON.stringify(catalog)});
    const net = {
      async get() {
        throw new Error('אין רשת');
      },
      async download(url, destPath) {
        await fs.writeText(destPath, 'בייטים');
        return {status: 200, size: 6,
                contentType: 'application/octet-stream'};
      },
    };
    const opened = [];
    const manager = new PluginsManager({
      paths: PATHS,
      fs,
      net,
      sys: {
        openUrl: async (url) => opened.push(url),
        launch: async () => true,
      },
      env: {},
      otzariaLaunchPath: async () => null,
    });
    return {fs, manager, opened};
  }

  // ⚠️ זו הנפילה: `#fetchMissingFile` בנה `new PluginCatalog({...})`
  // והעתיק שדה-שדה. `targetAppVersions` לא היה ברשימה, ולכן כל התקנה
  // שהשלימה קובץ חסר מחקה אותו מהמראה — ואז `mirrorTargets([])` חזר להיות
  // **כל** הבילדים, המחשב הלא-מקוון התחיל להציג תוספים שאין לו בילד
  // עבורם, ו-`installTarget` הציע בילד היסטורי שמעולם לא ירד.
  it('שומר את targetAppVersions, הקטגוריות ודף הבית', async () => {
    const {fs, manager, opened} = mirrorWithoutFile();
    const {catalog} = await manager.load();
    const plugin = catalog.plugins[0];
    assert.equal(plugin.localFiles.size, 0, 'תנאי הפתיחה: הקובץ לא במראה');

    const result = await manager.install(plugin, '0.9.96',
                                         catalog.targetAppVersions);
    assert.equal(result.success, true, result.error);
    assert.equal(opened.length, 1);

    const written = JSON.parse(
        (await fs.readText(PATHS.catalogPath)));
    assert.deepEqual(written.targetAppVersions, ['0.9.96']);
    assert.deepEqual(written.home, {title: 'החנות', subtitle: 'תוספים'});
    assert.equal(written.categories.length, 1);
    assert.equal(written.lastSync, '2026-01-01T00:00:00.000Z');
    // והקובץ שירד אכן נרשם.
    assert.deepEqual(Object.keys(written.plugins[0].localFiles), ['3.0.0']);
  });

  it('ההסתרה עומדת בעינה גם אחרי ההתקנה', async () => {
    // המדידה האמיתית: אחרי ההתקנה, מחשב עם אוצריא ישנה מהיעד עדיין אינו
    // רואה את התוסף. בלי `targetAppVersions` הוא ראה אותו וקיבל כפתור
    // שדורש אינטרנט.
    const {fs, manager} = mirrorWithoutFile();
    const before = await manager.load();
    await manager.install(before.catalog.plugins[0], '0.9.96',
                          before.catalog.targetAppVersions);

    const after = PluginCatalog.fromJson(
        JSON.parse(await fs.readText(PATHS.catalogPath)));
    assert.deepEqual(after.targetAppVersions, ['0.9.96']);
    assert.equal(
        after.plugins[0].runsOn('0.9.92', after.targetAppVersions), false);
  });
});

describe('PluginCatalog.copyWith', () => {
  // התיקון המבני: כל שדה שיתווסף לקטלוג ייסע איתו מעצמו, בלי שהקוראים
  // יידעו עליו.
  it('שדה שלא נמסר נשאר כמו שהוא', () => {
    const original = new PluginCatalog({
      lastSync: new Date('2026-01-01T00:00:00.000Z'),
      targetAppVersions: ['0.9.96', '0.9.92'],
    });
    const copy = original.copyWith({plugins: []});

    assert.deepEqual(copy.targetAppVersions, ['0.9.96', '0.9.92']);
    assert.equal(copy.lastSync.toISOString(), '2026-01-01T00:00:00.000Z');
    assert.equal(copy.home, original.home);
  });

  it('כל שדות הקטלוג עוברים את המעבר הלוך-חזור', () => {
    // אם ייווסף שדה לבנאי ולא ל-`toJSON`, זו הבדיקה שתתפוס זאת.
    const json = new PluginCatalog({targetAppVersions: ['0.9.96']})
        .copyWith({}).toJSON();
    assert.deepEqual(json.targetAppVersions, ['0.9.96']);
  });
});
