// פירוק כותרות התשובה של הורדת נכס.
//
// ⚠️ הלוגיקה הזאת **לא הייתה ניתנת לבדיקה** בגרסת ה-Flutter: היא ישבה
// בתוך `PluginStoreClient.downloadAsset`, ולכן דרשה רשת אמיתית. אחת
// מהסיבות שהיא הועברה לצד ה-JS היא בדיוק כדי שהקובץ הזה יוכל להתקיים.

import assert from 'node:assert/strict';
import {describe, it} from 'node:test';

import {
  absoluteUrl,
  extensionOf,
  parseContentDisposition,
  resolveAssetNaming,
} from '../web/js/store/net_headers.js';

describe('extensionOf', () => {
  it('הסיומת כולל הנקודה', () => {
    assert.equal(extensionOf('plugin.otzplugin'), '.otzplugin');
    assert.equal(extensionOf('image.PNG'), '.PNG');
    assert.equal(extensionOf('a.b.c'), '.c');
  });

  it('בלי סיומת — ריק', () => {
    assert.equal(extensionOf('plugin'), '');
    assert.equal(extensionOf(''), '');
  });

  it('נקודה בתחילת השם היא קובץ מוסתר ולא סיומת', () => {
    assert.equal(extensionOf('.gitignore'), '');
  });
});

describe('parseContentDisposition', () => {
  it('null כשאין כותרת', () => {
    assert.equal(parseContentDisposition(null), null);
    assert.equal(parseContentDisposition(''), null);
    assert.equal(parseContentDisposition(undefined), null);
  });

  it('filename="..." פשוט', () => {
    const result = parseContentDisposition(
        'attachment; filename="my-plugin.otzplugin"');
    assert.deepEqual(result, {name: 'my-plugin.otzplugin',
                              ext: '.otzplugin'});
  });

  it('filename בלי מירכאות', () => {
    const result = parseContentDisposition('attachment; filename=x.png');
    assert.deepEqual(result, {name: 'x.png', ext: '.png'});
  });

  // שמות עבריים מגיעים מהאתר דווקא בצורה הזאת.
  it('filename*=UTF-8\'\' מפוענח — כך מגיעים שמות עבריים', () => {
    const encoded = encodeURIComponent('תוסף שלי.otzplugin');
    const result = parseContentDisposition(
        `attachment; filename*=UTF-8''${encoded}`);
    assert.deepEqual(result, {name: 'תוסף שלי.otzplugin',
                              ext: '.otzplugin'});
  });

  it('הצורה המקודדת קודמת לפשוטה כששתיהן קיימות', () => {
    const encoded = encodeURIComponent('עברית.png');
    const result = parseContentDisposition(
        `attachment; filename="fallback.png"; filename*=UTF-8''${encoded}`);
    assert.equal(result.name, 'עברית.png');
  });

  it('קידוד פגום נופל לצורה הפשוטה ולא זורק', () => {
    const result = parseContentDisposition(
        `attachment; filename="ok.png"; filename*=UTF-8''%E0%A4%A`);
    assert.equal(result.name, 'ok.png');
  });

  it('אינו תלוי באותיות גדולות/קטנות', () => {
    const result = parseContentDisposition('ATTACHMENT; FileName="a.gif"');
    assert.equal(result.name, 'a.gif');
  });
});

describe('resolveAssetNaming', () => {
  it('Content-Disposition מנצח את Content-Type', () => {
    const result = resolveAssetNaming({
      contentType: 'image/png',
      contentDisposition: 'attachment; filename="real.webp"',
    });
    assert.equal(result.ext, '.webp');
    assert.equal(result.originalName, 'real.webp');
  });

  it('בלי Disposition — הסיומת מ-Content-Type', () => {
    const result = resolveAssetNaming({contentType: 'image/jpeg'});
    assert.equal(result.ext, '.jpg');
    assert.equal(result.originalName, null);
  });

  it('Content-Type עם charset מנוקה', () => {
    const result = resolveAssetNaming({contentType: 'image/png; charset=binary'});
    assert.equal(result.ext, '.png');
  });

  it('Content-Type שאינו מוכר — נשארת הסיומת המועדפת', () => {
    const result = resolveAssetNaming(
        {contentType: 'application/octet-stream'}, '.otzplugin');
    assert.equal(result.ext, '.otzplugin');
  });

  it('בלי שום כותרת — הסיומת המועדפת', () => {
    assert.equal(resolveAssetNaming({}, '.otzplugin').ext, '.otzplugin');
    assert.equal(resolveAssetNaming({}).ext, '');
  });

  it('Disposition בלי סיומת אינו מוחק את המועדפת', () => {
    // שם בלי נקודה: השם נשמר, אבל הסיומת נשארת מה שביקשנו.
    const result = resolveAssetNaming(
        {contentDisposition: 'attachment; filename="noext"'}, '.otzplugin');
    assert.equal(result.ext, '.otzplugin');
    assert.equal(result.originalName, 'noext');
  });
});

describe('absoluteUrl', () => {
  it('כתובת יחסית מושלמת מול הבסיס', () => {
    assert.equal(absoluteUrl('/api/x', 'https://otzaria.org'),
                 'https://otzaria.org/api/x');
  });

  it('כתובת מוחלטת נשארת כמו שהיא', () => {
    assert.equal(absoluteUrl('https://cdn.example/x.png', 'https://otzaria.org'),
                 'https://cdn.example/x.png');
    assert.equal(absoluteUrl('http://plain/x', 'https://otzaria.org'),
                 'http://plain/x');
  });

  it('כתובת ריקה נשארת ריקה', () => {
    assert.equal(absoluteUrl('', 'https://otzaria.org'), '');
  });

  // כך `PluginVersionEntry.fromJson` קורא מקטלוג שמור: הכתובת שם כבר
  // מוחלטת, ולכן הבסיס ריק ואין להשלים כלום.
  it('בסיס ריק אינו משנה את הכתובת', () => {
    assert.equal(absoluteUrl('/api/x', ''), '/api/x');
    assert.equal(absoluteUrl('uploads/x.png', ''), 'uploads/x.png');
  });

  // ⚠️ השרשור היה נאיבי, ושתי הצורות האלה יצאו ממנו שבורות.
  it('כתובת יחסית בלי לוכסן מוביל מקבלת אותו', () => {
    // `https://otzaria.orguploads/x.png` הוא שם מארח אחר לגמרי.
    assert.equal(absoluteUrl('uploads/x.png', 'https://otzaria.org'),
                 'https://otzaria.org/uploads/x.png');
  });

  it('כתובת חסרת סכימה מקבלת https ולא את הבסיס', () => {
    // `https://otzaria.org//cdn.example/x.png` הוא נתיב באתר, לא ה-CDN.
    assert.equal(absoluteUrl('//cdn.example/x.png', 'https://otzaria.org'),
                 'https://cdn.example/x.png');
  });
});
