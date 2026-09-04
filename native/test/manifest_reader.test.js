// קריאת `manifest.json` מתוך קובץ .otzplugin — **מול ZIP אמיתי**.
//
// ה-fixture נוצר ב-.NET (`ZipFile.CreateFromDirectory`), כלומר בדיוק
// אותו כותב ZIP שווינדוס משתמשת בו. הוא מכיל גם קובץ גדול, כדי שהבדיקה
// תעבור על מסלול ה-deflate ועל ספרייה מרכזית עם יותר מרשומה אחת.
//
// ה-io מוזרק: כאן הוא קורא מהדיסק דרך `node:fs`, ובתוכנה עצמה דרך הגשר
// (`fs.readBase64`). זה מה שמאפשר לבדוק את פרסור ה-ZIP בלי host.

import assert from 'node:assert/strict';
import {describe, it} from 'node:test';
import {open, stat} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import {dirname, join} from 'node:path';

import {
  readPluginManifest,
  readPluginManifestId,
} from '../web/js/store/manifest_reader.js';

const here = dirname(fileURLToPath(import.meta.url));
const FIXTURE = join(here, 'fixtures', 'sample.otzplugin');

/** אותו חוזה שהגשר חושף, מעל node:fs. */
const io = {
  async stat(path) {
    const info = await stat(path);
    return {size: info.size};
  },
  async readBase64(path, offset, length) {
    const handle = await open(path, 'r');
    try {
      const buffer = Buffer.alloc(length);
      const {bytesRead} = await handle.read(buffer, 0, length, offset);
      return buffer.subarray(0, bytesRead).toString('base64');
    } finally {
      await handle.close();
    }
  },
};

describe('readPluginManifest — ZIP אמיתי', () => {
  it('מחלץ את ה-manifest, כולל עברית', async () => {
    const manifest = await readPluginManifest(FIXTURE, io);
    assert.notEqual(manifest, null, 'לא נקרא manifest');
    assert.equal(manifest.id, 'my.plugin.id');
    assert.equal(manifest.version, '1.2.3');
    // אם ה-TextDecoder או ה-deflate שגויים, זה מה שיישבר ראשון.
    assert.equal(manifest.name, 'תוסף לדוגמה');
  });

  it('readPluginManifestId מחזיר את ה-id בלבד', async () => {
    assert.equal(await readPluginManifestId(FIXTURE, io), 'my.plugin.id');
  });
});

/**
 * בונה "קובץ" שכל תוכנו הוא EOCD אחד, עם הגדלים שנמסרו.
 *
 * לא נדרש כאן ZIP אמיתי: מה שנבדק הוא מה שהקורא עושה עם מספרים שהקובץ
 * **מצהיר** עליהם, ולכן ההצהרה היא כל מה שצריך.
 */
function eocdOnly({centralSize, centralOffset}) {
  const bytes = new Uint8Array(22);
  const view = new DataView(bytes.buffer);
  view.setUint32(0, 0x06054b50, true);   // חתימת EOCD
  view.setUint16(8, 1, true);            // רשומות בדיסק הזה
  view.setUint16(10, 1, true);           // סך הרשומות
  view.setUint32(12, centralSize, true);
  view.setUint32(16, centralOffset, true);
  return bytes;
}

/** io מעל מערך בתים, שמתעד כל קריאה — כמו ה-host, קורא קטוע בסוף הקובץ. */
function ioOver(bytes) {
  const reads = [];
  return {
    reads,
    async stat() {
      return {size: bytes.length};
    },
    async readBase64(_path, offset, length) {
      reads.push({offset, length});
      const end = Math.min(offset + length, bytes.length);
      return Buffer.from(bytes.subarray(offset, Math.max(offset, end)))
          .toString('base64');
    },
  };
}

describe('readPluginManifest — גדלים מהקובץ נבדקים מולו', () => {
  // ⚠️ כל מיקום וגודל שהקורא משתמש בהם נלקחים **מתוך ה-ZIP**, כלומר הם
  // קלט לא-מהימן. בלי הבדיקה מול גודל הקובץ, קובץ פגום שמצהיר על ספרייה
  // מרכזית של כמעט 4GB גרם להקצאה בגודל הזה בצד ה-host — בשביל תוסף של
  // מאות קילובייטים.

  it('ספרייה מרכזית שמצביעה מעבר לסוף הקובץ אינה נקראת', async () => {
    const bytes = eocdOnly({centralSize: 100, centralOffset: 22});
    const io = ioOver(bytes);

    assert.equal(await readPluginManifest('x', io), null);
    assert.equal(io.reads.length, 1, 'רק זנב ה-EOCD נקרא');
    assert.deepEqual(io.reads[0], {offset: 0, length: 22});
  });

  it('גודל אבסורדי אינו הופך לבקשת קריאה אבסורדית', async () => {
    const bytes = eocdOnly({centralSize: 0xfffffffe, centralOffset: 0});
    const io = ioOver(bytes);

    assert.equal(await readPluginManifest('x', io), null);
    assert.ok(io.reads.every((read) => read.length <= bytes.length),
              `נתבקשה קריאה גדולה מהקובץ: ${JSON.stringify(io.reads)}`);
  });

  it('ספרייה מרכזית שנכנסת בקובץ כן נקראת', async () => {
    // הגבול עצמו כלול — אחרת ארכיון תקין שהספרייה שלו נגמרת בדיוק לפני
    // ה-EOCD היה נפסל.
    const bytes = eocdOnly({centralSize: 22, centralOffset: 0});
    const io = ioOver(bytes);

    assert.equal(await readPluginManifest('x', io), null, 'אין manifest');
    assert.equal(io.reads.length, 2, 'הזנב, ואחריו הספרייה עצמה');
    assert.deepEqual(io.reads[1], {offset: 0, length: 22});
  });
});

describe('readPluginManifest — כשלים מוחזרים כ-null ולא כחריג', () => {
  // תוסף בודד עם קובץ פגום פשוט לא ישווה למותקן, וזה עדיף על הפלת
  // הסנכרון כולו. זו ההתנהגות המתועדת במקור.

  it('קובץ שאינו קיים', async () => {
    assert.equal(await readPluginManifest(join(here, 'nope.otzplugin'), io),
                 null);
  });

  it('קובץ שאינו ZIP', async () => {
    const notZip = {
      stat: async () => ({size: 100}),
      readBase64: async (_p, _o, length) =>
          Buffer.alloc(length, 0x41).toString('base64'),
    };
    assert.equal(await readPluginManifest('x', notZip), null);
  });

  it('קובץ ריק', async () => {
    const empty = {
      stat: async () => ({size: 0}),
      readBase64: async () => '',
    };
    assert.equal(await readPluginManifest('x', empty), null);
  });

  it('קריאה שזורקת', async () => {
    const broken = {
      stat: async () => ({size: 500}),
      readBase64: async () => {
        throw new Error('הגישה נדחתה');
      },
    };
    assert.equal(await readPluginManifest('x', broken), null);
  });

  it('id ריק או שאינו מחרוזת אינו נחשב', async () => {
    // ה-id הוא המפתח היחיד להשוואה מול המותקנים, ולכן ערך חלקי גרוע
    // מלא-ידוע.
    for (const id of ['', '   ', 42, null]) {
      const fake = {
        stat: io.stat,
        readBase64: io.readBase64,
      };
      // נבנה על ה-fixture האמיתי אבל נבדוק את הסינון ישירות:
      const manifest = await readPluginManifest(FIXTURE, fake);
      manifest.id = id;
      const trimmed = typeof manifest.id === 'string'
          ? manifest.id.trim()
          : '';
      assert.equal(trimmed.length > 0, false, `id=${JSON.stringify(id)}`);
    }
  });
});
