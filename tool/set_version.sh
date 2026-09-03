#!/usr/bin/env bash
# מציב את גרסת החנות ב-`native/VERSION` — **המקום היחיד** שמחזיק אותה.
#
# משם `native/build.ps1` צורב אותה למשאב הגרסה של ה-exe (`APP_VERSION_*`),
# והתוכנה מדווחת אותה ביומן ומשווה אותה מול ה-releases שב-GitHub.
#
# בגרסת ה-Flutter היו לזה **שני** מקומות שהיו חייבים להסכים — `pubspec.yaml`
# ו-`lib/src/app_version.dart` — ובדיקה שלמה (`app_version_test.dart`)
# שקיימת רק כדי לאמת שהם לא נפרדו. עם קובץ אחד גם הבדיקה הזאת מתייתרת.
#
# מריץ אותו ה-CI לפני כל בנייה — ראו `.github/workflows/ci.yml`.
# פועל מכל תיקייה (הנתיב נגזר ממקום הסקריפט) ובלי `sed -i`, שאינו נייד
# בין GNU ל-BSD.
#
# **הגרסה היא מספר שלם אחד**: 1, 2, 3… מה שהתוכנה מדווחת, מה שמתויג ומה
# שהמשתמש רואה הוא המספר לבדו.
#
#   tool/set_version.sh 4
set -euo pipefail

version="${1:?usage: set_version.sh <N>}"
if ! printf '%s' "$version" | grep -Eq '^[0-9]+$'; then
  echo "set_version.sh: '$version' אינו מספר שלם" >&2
  exit 1
fi

root="$(cd "$(dirname "$0")/.." && pwd)"
file="$root/native/VERSION"

# ללא שורה חדשה מסתיימת? יש: `build.ps1` עושה `.Trim()`, אבל קובץ
# שמסתיים בשורה חדשה הוא מה שכלים אחרים מצפים לו.
printf '%s\n' "$version" > "$file"

# מאמת שההצבה אכן נכנסה — קובץ שנשאר עם הגרסה הקודמת היה מייצר release
# שמדווח על עצמו מספר אחר.
grep -qx "$version" "$file"
echo "$version"
