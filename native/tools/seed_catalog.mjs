// כלי פיתוח: מביא את הקטלוג האמיתי מ-otzaria.org וכותב אותו כ-
// `catalog.json` בפורמט של המראה, **עם התמונות ובלי קובצי ההתקנה**.
//
//   node native/tools/seed_catalog.mjs <תיקיית Data>
//
// למה זה קיים: סנכרון אמיתי מוריד מאות MB (קובץ `.otzplugin` לכל תוסף),
// וכדי לאמת שהמסכים מרנדרים נתונים אמיתיים די במטא-דאטה ובתמונות.
//
// התמונות **כן** יורדות: בלעדיהן כל כרטיס מציג את ה-placeholder של
// הפאזל, ומסלול הגשת הנכסים מ-`Data\` דרך ה-host (`/data/…`, כולל
// פענוח האחוזים של שמות בעברית) נשאר לא-נבדק.
//
// הוא גם מריץ את המסלול `fromApi → toJSON → fromJson` על התוכן האמיתי
// של האתר, וזו בדיקת אינטגרציה שקשה להשיג אחרת.

import {writeFileSync, mkdirSync} from 'node:fs';
import {join} from 'node:path';

import {PluginCatalog, PluginStoreCategory, PluginStoreHome, StorePlugin}
    from '../web/js/store/models.js';

const BASE = 'https://otzaria.org';
const dataDir = process.argv[2];
if (!dataDir) {
  console.error('usage: node seed_catalog.mjs <Data dir>');
  process.exit(1);
}

const getJson = async (path) => {
  const response = await fetch(`${BASE}${path}`);
  if (!response.ok) throw new Error(`${path} → ${response.status}`);
  return await response.json();
};

const raw = await getJson('/api/plugins');
console.log(`התקבלו ${raw.length} תוספים מהאתר`);

let plugins = raw.map((entry) => StorePlugin.fromApi(entry, BASE));

// ── התמונות ─────────────────────────────────────────────────────────────────
// אותה מפת סיומות ואותה מבנה תיקיות שהסנכרון האמיתי מייצר
// (`plugins\<id>\image.<ext>`, `screenshot-N.<ext>`), כדי שהקטלוג שיוצא
// מכאן ייראה לתוכנה בדיוק כמו קטלוג שסונכרן.
const EXT_BY_TYPE = {
  'image/png': '.png',
  'image/jpeg': '.jpg',
  'image/webp': '.webp',
  'image/gif': '.gif',
  'image/svg+xml': '.svg',
};

const pluginsDir = join(dataDir, 'plugins');

async function download(url, destNoExt) {
  const absolute = url.startsWith('http') ? url : `${BASE}${url}`;
  const response = await fetch(absolute);
  if (!response.ok) throw new Error(`${absolute} → ${response.status}`);
  const type = (response.headers.get('content-type') ?? '')
      .split(';')[0].trim().toLowerCase();
  const ext = EXT_BY_TYPE[type] ?? '.png';
  const bytes = Buffer.from(await response.arrayBuffer());
  writeFileSync(destNoExt + ext, bytes);
  return {ext, size: bytes.length};
}

let images = 0;
let shots = 0;
let failed = 0;
const updated = [];
for (const plugin of plugins) {
  const dir = join(pluginsDir, plugin.id);
  mkdirSync(dir, {recursive: true});
  let imagePath = null;
  const screenshotPaths = [];

  if (plugin.remoteImageUrl) {
    try {
      const {ext} = await download(plugin.remoteImageUrl, join(dir, 'image'));
      // הנתיב בקטלוג הוא **יחסי ל-`plugins\`** ובסגנון POSIX.
      imagePath = `${plugin.id}/image${ext}`;
      images++;
    } catch {
      failed++;
    }
  }
  for (let i = 0; i < plugin.remoteScreenshotUrls.length; i++) {
    try {
      const {ext} = await download(plugin.remoteScreenshotUrls[i],
                                   join(dir, `screenshot-${i}`));
      screenshotPaths.push(`${plugin.id}/screenshot-${i}${ext}`);
      shots++;
    } catch {
      failed++;
    }
  }
  updated.push(plugin.copyWith({imagePath, screenshotPaths}));
}
plugins = updated;
console.log(`ירדו ${images} תמונות ו-${shots} צילומי מסך ` +
            `(${failed} נכשלו)`);

let home = PluginStoreHome.empty;
let categories = [];
try {
  const storeHome = await getJson('/api/plugins/store-home');
  home = PluginStoreHome.fromApi(storeHome.settings ?? {});
  const ids = new Set(plugins.map((p) => p.id));
  for (const rawCategory of storeHome.categories ?? []) {
    const summary = PluginStoreCategory.fromApi(rawCategory);
    if (!summary.slug) continue;
    const page = await getJson(
        `/api/plugins/categories/${encodeURIComponent(summary.slug)}`);
    const members = PluginStoreCategory.fromApi(page).pluginIds
        .filter((id) => ids.has(id));
    categories.push(summary.copyWith({pluginIds: members}));
  }
  console.log(`התקבלו ${categories.length} קטגוריות`);
} catch (error) {
  console.warn(`מבנה החנות לא נטען: ${error.message}`);
}

// שיוך הפוך: תוסף → ה-slugs שהוא משובץ בהם, כמו בסנכרון האמיתי.
const slugsByPlugin = new Map();
for (const category of categories) {
  for (const id of category.pluginIds) {
    const list = slugsByPlugin.get(id) ?? [];
    list.push(category.slug);
    slugsByPlugin.set(id, list);
  }
}

const catalog = new PluginCatalog({
  lastSync: new Date(),
  home,
  categories,
  plugins: plugins.map(
      (p) => p.copyWith({categorySlugs: slugsByPlugin.get(p.id) ?? []})),
});

mkdirSync(dataDir, {recursive: true});
const out = join(dataDir, 'catalog.json');
const json = JSON.stringify(catalog.toJSON(), null, 2);
writeFileSync(out, json, 'utf8');

// המסלול המלא: מה שנכתב נקרא מיד חזרה, כמו שהתוכנה תקרא אותו.
const reread = PluginCatalog.fromJson(JSON.parse(json));
console.log(`\nנכתב ${out} (${(json.length / 1024).toFixed(0)} KB)`);
console.log(`קריאה חזרה: ${reread.plugins.length} תוספים, ` +
            `${reread.categories.length} קטגוריות`);
console.log(`נבחרים: ${reread.plugins.filter((p) => p.isFeatured).length}`);
console.log(`עם דירוג: ${reread.plugins.filter((p) => p.ratingCount > 0).length}`);
console.log(`עם תגיות: ${reread.plugins.filter((p) => p.tags.length > 0).length}`);
const withVersions = reread.plugins.filter((p) => p.versions.length > 1);
console.log(`עם יותר מבילד אחד: ${withVersions.length}`);
if (reread.plugins.length !== plugins.length) {
  console.error('!! אבדו תוספים במסלול הכתיבה/קריאה');
  process.exit(1);
}
