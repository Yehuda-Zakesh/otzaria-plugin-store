// השוואת גרסאות תוסף — פורט של
// `packages/plugins_manager/lib/src/services/plugin_version_compare.dart`.

/** מקטע ראשון של ספרות בלבד; מה שאחריו (`-beta`, `+7`) אינו משתתף בדירוג. */
const LEADING_DIGITS = /^\d+/;

/**
 * סיומת prerelease/build והכול אחריה — `-beta.1`, `+736`, `-rc.2`.
 *
 * ⚠️ **חייבת לרדת לפני הפיצול לנקודות.** כשהיא ירדה רק ברמת המקטע,
 * `1.0.0-beta.1` פוצל ל-`['1','0','0-beta','1']` והזנב `1` נכנס כמקטע
 * **רביעי** — כלומר ה-prerelease דווקא כן דירג, ו-`1.0.0-beta.1` יצא גבוה
 * מ-`1.0.0`. התוצאה: `sortedDescending` העלה את הביתא לראש הרשימה,
 * `resolveCompatibleVersion` בחר בה כבילד להתקנה, ו-`statusAgainst` הכריז
 * "עדכון זמין" על יציבה שכבר מותקנת.
 */
const SUFFIX = /[-+].*$/;

/**
 * semver בסיסי (`major.minor.patch`), מחזיר 1 / 0 / -1.
 *
 * אורך שונה מרופד באפסים, כך ש-`1.2` ו-`1.2.0` שקולים. קידומת `v` וסיומת
 * prerelease/build (`-beta`, `+7`) מוסרות לפני ההשוואה — הן אינן משתתפות
 * בדירוג, אבל **המספר שלפניהן כן**.
 *
 * ⚠️ **למה לא לקרוא את המקטע כמו שהוא:** `parseInt('1-beta')` היה עובד
 * כאן, אבל במקור (Dart) `int.tryParse` החזיר null והנפילה ל-0 בלעה את
 * הספרה — `v2.0.0` יצא שווה ל-`v1.0.0`, ותוסף שהאתר מתייג עם קידומת `v`
 * לא היה מסומן כ"עדכון זמין" לעולם. החילוץ המפורש של הספרות המובילות
 * הוא מה שמונע את זה, ולכן הוא נשמר כאן במדויק.
 *
 * @param {string|null|undefined} a
 * @param {string|null|undefined} b
 * @returns {number}
 */
export function comparePluginVersions(a, b) {
  const pa = parts(a);
  const pb = parts(b);
  const length = Math.max(pa.length, pb.length);

  for (let i = 0; i < length; i++) {
    const diff = (i < pa.length ? pa[i] : 0) - (i < pb.length ? pb[i] : 0);
    if (diff !== 0) return diff > 0 ? 1 : -1;
  }
  return 0;
}

/** @returns {number[]} */
function parts(version) {
  let text = String(version ?? '0').trim();
  if (text.startsWith('v') || text.startsWith('V')) text = text.slice(1);
  text = text.replace(SUFFIX, '');

  return text.split('.').map((segment) => {
    const digits = LEADING_DIGITS.exec(segment.trim());
    return digits === null ? 0 : Number.parseInt(digits[0], 10);
  });
}
