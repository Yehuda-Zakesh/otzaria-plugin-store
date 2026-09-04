// גדלים לתצוגה למשתמש — פורט של `lib/src/services/byte_size.dart`.

import {S} from '../strings.js';

/**
 * בסיס 1024, ספרה אחת אחרי הנקודה **רק כשזה מוסיף מידע** — "1.1 GB"
 * מדויק מספיק, ו-"1126 MB" רק מרעיש.
 *
 * ⚠️ **המעבר ליחידה הבאה נבדק על המספר המעוגל, לא על הגולמי.** `1048575`
 * בייטים הם 1023.999 ק״ב — עוברים את התנאי `< 1024`, אבל מתעגלים לתצוגה
 * "1024 ק״ב", שהיא בדיוק מה שהמעבר ליחידה נועד למנוע. אותו דבר קרה
 * ב-"1024 מ״ב" ממש מתחת לג׳יגה.
 */
export function formatBytes(bytes) {
  const units = S.units;
  if (bytes < 1024) return units.bytes(bytes);

  const kb = bytes / 1024;
  const kbText = kb.toFixed(0);
  if (Number(kbText) < 1024) return units.kilobytes(kbText);

  const mb = kb / 1024;
  const mbText = mb.toFixed(mb < 10 ? 1 : 0);
  if (Number(mbText) < 1024) return units.megabytes(mbText);

  return units.gigabytes((mb / 1024).toFixed(2));
}

/**
 * "412 MB מתוך 1.1 GB" לשורת ההתקדמות. `null` כשעוד לא הגיע דיווח
 * בייטים, ובלי היעד — רק כמה ירד עד כה.
 */
export function formatBytesProgress(received, total) {
  if (received === null || received === undefined) return null;
  if (total === null || total === undefined || total <= 0) {
    return formatBytes(received);
  }
  return S.units.progressOf(formatBytes(received), formatBytes(total));
}
