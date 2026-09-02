/// השוואת גרסאות של חנות התוספים.
///
/// המספור הוא **מספר שלם אחד** — 1, 2, 3… — והתג ב-GitHub הוא `v1`, `v2`
/// (ראו `tool/set_version.sh`). זה שונה מהלאנצ'ר, ששם הגרסה בת שני חלקים
/// והתג בן שלושה, ולכן אין כאן פורט של `LauncherVersion` אלא קוד קצר משלו.
library;

/// תג של release שה-CI מפרסם: `v1`, `v2`, … עם `v` אופציונלי.
///
/// ⚠️ תג שאינו בצורה הזאת **נפסל**, ולא מנוסה "בערך": בריפו יכול לשבת תג
/// ידני (`V1`), תג שיובא מריפו אחר (`v0.11.0`), או תג שאינו גרסה בכלל —
/// וכל השוואה מספרית סובלנית הייתה מוצאת בהם גרסה חדשה לנצח.
final RegExp _releaseTag = RegExp(r'^v?\d+$');

/// `true` אם [tag] הוא תג גרסה בצורה שה-CI מפרסם.
bool isStoreReleaseTag(String tag) => _releaseTag.hasMatch(tag.trim());

/// המספר שבתוך התג, או `null` כשאינו תג גרסה.
int? storeVersionOf(String tag) {
  final trimmed = tag.trim();
  if (!isStoreReleaseTag(trimmed)) return null;
  return int.tryParse(trimmed.startsWith('v') || trimmed.startsWith('V')
      ? trimmed.substring(1)
      : trimmed);
}

/// `true` כש-[candidate] חדשה מ-[current]. שתיהן תגים או מספרים.
///
/// "חדש יותר" ולא "שונה" (בניגוד ל-`OtzariaUpdateCheckResult`): את החנות
/// אנחנו מפרסמים בעצמנו, ו-release שנמשך חזרה אינו סיבה להציע למשתמש
/// לרדת גרסה. תג לא-תקין אינו חדש מכלום.
bool isStoreVersionNewer(String candidate, String current) {
  final left = storeVersionOf(candidate);
  final right = storeVersionOf(current);
  if (left == null) return false;
  // גרסה מקומית שאינה מספר (לא אמור לקרות — יש בדיקה) נחשבת 0, כדי
  // שההתראה תעבוד ולא תיעלם בשקט.
  return left > (right ?? 0);
}
