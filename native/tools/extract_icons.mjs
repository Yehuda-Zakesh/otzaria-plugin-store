// מחלץ את מתאר הגליפים של האייקונים שבשימוש מתוך גופני
// Fluent UI System Icons, ומייצר מהם קובץ SVG sprite קטן.
//
//   node native/tools/extract_icons.mjs
//
// ── למה לא פשוט לצייר אותם ביד ────────────────────────────────────────────────
// כי נדרש **שחזור נאמן** של הממשק, ואייקון שצויר "בערך" נראה בערך. אלה
// בדיוק אותם וקטורים שגרסת ה-Flutter הציגה.
//
// ── ולמה לא לצרף את הגופן ─────────────────────────────────────────────────────
// שני הגופנים שוקלים ‎2.4MB ו-‎2.1MB — יותר מפי ארבעה מכל ה-exe. מכאן
// יוצאים רק ~20 גליפים, ‎כמה KB בסך הכול.
//
// הסקריפט הוא פרסר TTF מינימלי: `head`, `maxp`, `cmap` (פורמט 4 ו-12),
// `loca`, `glyf` — כולל גליפים מורכבים. הוא רץ **בזמן פיתוח בלבד**
// ותוצרתו (native/web/img/icons.svg) מגורסאת.

import {readFileSync, writeFileSync} from 'node:fs';
import {dirname, join} from 'node:path';
import {fileURLToPath} from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const nativeRoot = dirname(here);

const FONT_DIR =
    'C:/pub-cache/hosted/pub.dev/fluentui_system_icons-1.1.273/lib/fonts';

/**
 * האייקונים שהממשק משתמש בהם, עם נקודות הקוד שנשלפו מ-
 * `fluent_icons.dart`. שם המפתח הוא מה שה-`<use>` בממשק מפנה אליו.
 */
const ICONS = [
  {name: 'star-filled', code: 63257, font: 'Filled'},
  {name: 'star-filled-16', code: 63255, font: 'Filled'},
  {name: 'star', code: 63248, font: 'Regular'},
  {name: 'puzzle-piece', code: 59882, font: 'Regular'},
  {name: 'arrow-download', code: 61777, font: 'Regular'},
  {name: 'save', code: 63104, font: 'Regular'},
  {name: 'open', code: 62851, font: 'Regular'},
  {name: 'search', code: 63120, font: 'Regular'},
  {name: 'home', code: 62593, font: 'Regular'},
  {name: 'apps-list', code: 61752, font: 'Regular'},
  {name: 'warning', code: 63594, font: 'Regular'},
  {name: 'dismiss', code: 62314, font: 'Regular'},
  {name: 'image-off', code: 62616, font: 'Regular'},
  {name: 'chevron-left', code: 62123, font: 'Regular'},
  {name: 'chevron-right', code: 62129, font: 'Regular'},
  {name: 'checkmark-circle', code: 62105, font: 'Regular'},
  {name: 'error-circle', code: 62450, font: 'Regular'},
  {name: 'info', code: 62628, font: 'Regular'},
  {name: 'question-circle', code: 63038, font: 'Regular'},
  {name: 'arrow-sync', code: 61841, font: 'Regular'},
  {name: 'arrow-left', code: 61788, font: 'Regular'},
  {name: 'arrow-right', code: 61826, font: 'Regular'},
];

// ── פרסר TTF ────────────────────────────────────────────────────────────────

class Reader {
  constructor(buffer, offset = 0) {
    this.view = new DataView(buffer.buffer, buffer.byteOffset, buffer.length);
    this.offset = offset;
  }
  u8() { return this.view.getUint8(this.offset++); }
  i8() { return this.view.getInt8(this.offset++); }
  u16() { const v = this.view.getUint16(this.offset); this.offset += 2; return v; }
  i16() { const v = this.view.getInt16(this.offset); this.offset += 2; return v; }
  u32() { const v = this.view.getUint32(this.offset); this.offset += 4; return v; }
  seek(offset) { this.offset = offset; return this; }
}

function parseFont(path) {
  const buffer = readFileSync(path);
  const reader = new Reader(buffer);

  reader.u32(); // sfntVersion
  const numTables = reader.u16();
  reader.offset += 6;

  const tables = new Map();
  for (let i = 0; i < numTables; i++) {
    const tag = String.fromCharCode(reader.u8(), reader.u8(), reader.u8(),
                                    reader.u8());
    reader.u32(); // checksum
    const offset = reader.u32();
    const length = reader.u32();
    tables.set(tag, {offset, length});
  }

  const head = new Reader(buffer, tables.get('head').offset);
  head.offset += 18;
  const unitsPerEm = head.u16();
  head.offset += 30;  // dates, bbox, macStyle, lowestRec, fontDirectionHint
  const indexToLocFormat = head.i16();

  const hhea = new Reader(buffer, tables.get('hhea').offset);
  hhea.offset += 4;
  const ascender = hhea.i16();

  const maxp = new Reader(buffer, tables.get('maxp').offset);
  maxp.offset += 4;
  const numGlyphs = maxp.u16();

  // ── loca ──
  const locaTable = tables.get('loca');
  const loca = new Array(numGlyphs + 1);
  const locaReader = new Reader(buffer, locaTable.offset);
  for (let i = 0; i <= numGlyphs; i++) {
    loca[i] = indexToLocFormat === 0 ? locaReader.u16() * 2 : locaReader.u32();
  }

  return {
    buffer,
    unitsPerEm,
    ascender,
    loca,
    glyfOffset: tables.get('glyf').offset,
    cmap: parseCmap(buffer, tables.get('cmap').offset),
  };
}

/** קודי תו → מזהה גליף. פורמט 4 (BMP) ו-12 (מעל BMP). */
function parseCmap(buffer, cmapOffset) {
  const reader = new Reader(buffer, cmapOffset);
  reader.u16(); // version
  const numTables = reader.u16();

  let best = null;
  for (let i = 0; i < numTables; i++) {
    const platformId = reader.u16();
    const encodingId = reader.u16();
    const offset = reader.u32();
    // Unicode BMP או full — מעדיפים full כשקיים.
    const isUnicode = platformId === 3 &&
        (encodingId === 1 || encodingId === 10);
    if (isUnicode) {
      if (best === null || encodingId === 10) best = cmapOffset + offset;
    }
  }
  if (best === null) throw new Error('no unicode cmap subtable');

  const sub = new Reader(buffer, best);
  const format = sub.u16();
  const map = new Map();

  if (format === 4) {
    sub.u16(); // length
    sub.u16(); // language
    const segCountX2 = sub.u16();
    const segCount = segCountX2 / 2;
    sub.offset += 6; // searchRange, entrySelector, rangeShift

    const endCodes = [];
    for (let i = 0; i < segCount; i++) endCodes.push(sub.u16());
    sub.u16(); // reservedPad
    const startCodes = [];
    for (let i = 0; i < segCount; i++) startCodes.push(sub.u16());
    const idDeltas = [];
    for (let i = 0; i < segCount; i++) idDeltas.push(sub.i16());
    const rangeOffsetPos = sub.offset;
    const idRangeOffsets = [];
    for (let i = 0; i < segCount; i++) idRangeOffsets.push(sub.u16());

    for (let seg = 0; seg < segCount; seg++) {
      for (let code = startCodes[seg]; code <= endCodes[seg]; code++) {
        if (code === 0xffff) continue;
        let glyphId;
        if (idRangeOffsets[seg] === 0) {
          glyphId = (code + idDeltas[seg]) & 0xffff;
        } else {
          const at = rangeOffsetPos + seg * 2 + idRangeOffsets[seg] +
              (code - startCodes[seg]) * 2;
          glyphId = new Reader(buffer, at).u16();
          if (glyphId !== 0) glyphId = (glyphId + idDeltas[seg]) & 0xffff;
        }
        if (glyphId !== 0) map.set(code, glyphId);
      }
    }
  } else if (format === 12) {
    sub.u16(); // reserved
    sub.u32(); // length
    sub.u32(); // language
    const numGroups = sub.u32();
    for (let i = 0; i < numGroups; i++) {
      const start = sub.u32();
      const end = sub.u32();
      const startGlyph = sub.u32();
      for (let code = start; code <= end; code++) {
        map.set(code, startGlyph + (code - start));
      }
    }
  } else {
    throw new Error(`unsupported cmap format ${format}`);
  }

  return map;
}

/** מתאר גליף: רשימת קונטורים, כל אחד רשימת נקודות `{x, y, onCurve}`. */
function readGlyph(font, glyphId, depth = 0) {
  if (depth > 5) return [];
  const start = font.loca[glyphId];
  const end = font.loca[glyphId + 1];
  if (start === end) return []; // גליף ריק (רווח)

  const reader = new Reader(font.buffer, font.glyfOffset + start);
  const numberOfContours = reader.i16();
  reader.offset += 8; // xMin, yMin, xMax, yMax

  // גליף **מורכב**: הרכבה של גליפים אחרים עם הזזה. Fluent משתמש בזה.
  if (numberOfContours < 0) {
    const contours = [];
    while (true) {
      const flags = reader.u16();
      const componentIndex = reader.u16();
      let dx = 0;
      let dy = 0;
      const argsAreWords = (flags & 0x0001) !== 0;
      const argsAreXY = (flags & 0x0002) !== 0;
      if (argsAreWords) {
        dx = reader.i16();
        dy = reader.i16();
      } else {
        dx = reader.i8();
        dy = reader.i8();
      }
      // סקאלה מדולגת בכוונה: אין אייקון בסט הזה שמשתמש בה, ותמיכה חלקית
      // בה גרועה מהיעדרה — היא הייתה מזיזה גליף בשקט.
      if ((flags & 0x0008) !== 0) reader.offset += 2;
      else if ((flags & 0x0040) !== 0) reader.offset += 4;
      else if ((flags & 0x0080) !== 0) reader.offset += 8;

      const sub = readGlyph(font, componentIndex, depth + 1);
      if (argsAreXY) {
        for (const contour of sub) {
          contours.push(contour.map((p) => ({...p, x: p.x + dx, y: p.y + dy})));
        }
      } else {
        for (const contour of sub) contours.push(contour);
      }

      if ((flags & 0x0020) === 0) break; // MORE_COMPONENTS
    }
    return contours;
  }

  const endPts = [];
  for (let i = 0; i < numberOfContours; i++) endPts.push(reader.u16());
  const numPoints = numberOfContours === 0 ? 0 : endPts[endPts.length - 1] + 1;

  const instructionLength = reader.u16();
  reader.offset += instructionLength;

  // דגלים, עם דחיסת חזרות.
  const flags = [];
  while (flags.length < numPoints) {
    const flag = reader.u8();
    flags.push(flag);
    if ((flag & 0x08) !== 0) { // REPEAT
      const repeat = reader.u8();
      for (let i = 0; i < repeat; i++) flags.push(flag);
    }
  }

  // קואורדינטות, כהפרשים.
  const xs = [];
  let x = 0;
  for (let i = 0; i < numPoints; i++) {
    const flag = flags[i];
    if ((flag & 0x02) !== 0) {
      const delta = reader.u8();
      x += (flag & 0x10) !== 0 ? delta : -delta;
    } else if ((flag & 0x10) === 0) {
      x += reader.i16();
    }
    xs.push(x);
  }
  const ys = [];
  let y = 0;
  for (let i = 0; i < numPoints; i++) {
    const flag = flags[i];
    if ((flag & 0x04) !== 0) {
      const delta = reader.u8();
      y += (flag & 0x20) !== 0 ? delta : -delta;
    } else if ((flag & 0x20) === 0) {
      y += reader.i16();
    }
    ys.push(y);
  }

  const contours = [];
  let pointIndex = 0;
  for (const endPt of endPts) {
    const contour = [];
    for (; pointIndex <= endPt; pointIndex++) {
      contour.push({
        x: xs[pointIndex],
        y: ys[pointIndex],
        onCurve: (flags[pointIndex] & 0x01) !== 0,
      });
    }
    if (contour.length > 0) contours.push(contour);
  }
  return contours;
}

/**
 * ממיר קונטורים ל-path של SVG.
 *
 * גליפים ב-TrueType הם עקומות **ריבועיות** (`Q`), ונקודות off-curve
 * רצופות מרמזות על נקודת ביניים באמצע — זה חלק מהפורמט ולא קיצור דרך.
 * הציר האנכי הפוך ל-SVG, ולכן ההיפוך סביב ה-ascender.
 */
function toPath(contours, ascender) {
  const parts = [];
  const fx = (v) => Math.round(v * 100) / 100;
  const fy = (v) => Math.round((ascender - v) * 100) / 100;

  for (const contour of contours) {
    if (contour.length === 0) continue;

    // נקודת ההתחלה חייבת להיות על העקומה. כשאין כזו, האמצע בין
    // הראשונה לאחרונה משמש כנקודת התחלה משוערת — כך הפורמט מוגדר.
    let startIndex = contour.findIndex((p) => p.onCurve);
    let start;
    if (startIndex < 0) {
      const first = contour[0];
      const last = contour[contour.length - 1];
      start = {x: (first.x + last.x) / 2, y: (first.y + last.y) / 2};
      startIndex = 0;
    } else {
      start = contour[startIndex];
    }

    parts.push(`M${fx(start.x)} ${fy(start.y)}`);

    let control = null;
    const count = contour.length;
    for (let i = 1; i <= count; i++) {
      const point = contour[(startIndex + i) % count];
      if (point.onCurve) {
        if (control === null) {
          parts.push(`L${fx(point.x)} ${fy(point.y)}`);
        } else {
          parts.push(`Q${fx(control.x)} ${fy(control.y)} ` +
                     `${fx(point.x)} ${fy(point.y)}`);
          control = null;
        }
      } else if (control === null) {
        control = point;
      } else {
        // שתי נקודות off-curve רצופות: ביניהן נקודה על העקומה.
        const mid = {x: (control.x + point.x) / 2, y: (control.y + point.y) / 2};
        parts.push(`Q${fx(control.x)} ${fy(control.y)} ` +
                   `${fx(mid.x)} ${fy(mid.y)}`);
        control = point;
      }
    }
    if (control !== null) {
      parts.push(`Q${fx(control.x)} ${fy(control.y)} ` +
                 `${fx(start.x)} ${fy(start.y)}`);
    }
    parts.push('Z');
  }
  return parts.join('');
}

// ── ייצור ה-sprite ──────────────────────────────────────────────────────────

const fonts = new Map();
const symbols = [];

for (const icon of ICONS) {
  if (!fonts.has(icon.font)) {
    fonts.set(icon.font,
              parseFont(join(FONT_DIR, `FluentSystemIcons-${icon.font}.ttf`)));
  }
  const font = fonts.get(icon.font);
  const glyphId = font.cmap.get(icon.code);
  if (glyphId === undefined) {
    console.error(`!! אין גליף לנקודת קוד ${icon.code} (${icon.name})`);
    continue;
  }
  const contours = readGlyph(font, glyphId);
  const path = toPath(contours, font.ascender);
  if (path.length === 0) {
    console.error(`!! גליף ריק: ${icon.name}`);
    continue;
  }
  const size = font.unitsPerEm;
  symbols.push(
      `  <symbol id="i-${icon.name}" viewBox="0 0 ${size} ${size}">` +
      `<path d="${path}"/></symbol>`);
  console.log(`${icon.name.padEnd(20)} glyph=${glyphId} ` +
              `path=${path.length} bytes`);
}

const svg =
    '<svg xmlns="http://www.w3.org/2000/svg" style="display:none" ' +
    'aria-hidden="true">\n' + symbols.join('\n') + '\n</svg>';

// ⚠️ מודול JS ולא קובץ .svg, וזה בגלל ה-CSP: הדף מוגש עם
// `default-src 'none'`, ותחתיו הפניית `<use href="icons.svg#...">`
// חיצונית נחסמת. הזרקה מתוך מודול עוברת תחת `script-src 'self'`, בלי
// בקשה נוספת ובלי להרפות את המדיניות.
const module = `// ⚠️ **קובץ מיוצר. אין לערוך ביד.**
//
// מיוצר ע"י \`native/tools/extract_icons.mjs\` מגופני Fluent UI System
// Icons (MIT) — אותם וקטורים בדיוק שגרסת ה-Flutter הציגה.
//
// ${symbols.length} אייקונים. להוספת אייקון: להוסיף אותו ל-\`ICONS\`
// שבסקריפט (עם נקודת הקוד מ-\`fluent_icons.dart\`) ולהריץ אותו מחדש.

const SPRITE = ${JSON.stringify(svg)};

/** מזריק את ה-sprite לדף. נקרא פעם אחת בעלייה. */
export function installIconSprite() {
  if (document.getElementById('icon-sprite') !== null) return;
  const host = document.createElement('div');
  host.id = 'icon-sprite';
  host.hidden = true;
  host.innerHTML = SPRITE;
  document.body.prepend(host);
}
`;

const out = join(nativeRoot, 'web', 'js', 'ui', 'icons.js');
writeFileSync(out, module, 'utf8');
console.log(`\nנכתב ${out} (${(module.length / 1024).toFixed(1)} KB, ` +
            `${symbols.length} אייקונים)`);
