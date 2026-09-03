// גדלים לתצוגה למשתמש — פורט של `lib/src/services/byte_size.dart`.

import {S} from '../strings.js';

/**
 * בסיס 1024, ספרה אחת אחרי הנקודה **רק כשזה מוסיף מידע** — "1.1 GB"
 * מדויק מספיק, ו-"1126 MB" רק מרעיש.
 */
export function formatBytes(bytes) {
  const units = S.units;
  if (bytes < 1024) return units.bytes(bytes);
  const kb = bytes / 1024;
  if (kb < 1024) return units.kilobytes(kb.toFixed(0));
  const mb = kb / 1024;
  if (mb < 1024) return units.megabytes(mb.toFixed(mb < 10 ? 1 : 0));
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
