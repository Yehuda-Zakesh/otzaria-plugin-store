#!/usr/bin/env bash
# מציב את גרסת החנות בשני המקומות שחייבים להסכים:
#
#   pubspec.yaml            ← ממנו `build_stub.ps1` צורב את גרסת ה-payload
#                             (המרקר `.ready`) ואת משאב הגרסה של ה-exe
#   lib/src/app_version.dart ← הגרסה שהתוכנה מדווחת על עצמה, ונכתבת ללוג
#
# אי-התאמה ביניהם מפילה את `test/app_version_test.dart`.
#
# מריץ אותו ה-CI לפני כל בנייה — ראו `.github/workflows/ci.yml`.
# פועל מכל תיקייה (הנתיבים נגזרים ממקום הסקריפט) ובלי `sed -i`, שאינו נייד
# בין GNU ל-BSD.
#
# **הגרסה היא מספר שלם אחד**: 1, 2, 3… ב-pubspec נכתב `1.0.0` כי pub מסרב
# לגרסה שאינה MAJOR.MINOR.PATCH; השלישייה הזאת היא פרט טכני בלבד. מה
# שהתוכנה מדווחת, מה שמתויג ומה שהמשתמש רואה הוא המספר לבדו.
#
#   tool/set_version.sh 2
set -euo pipefail

version="${1:?usage: set_version.sh <N>}"
if ! printf '%s' "$version" | grep -Eq '^[0-9]+$'; then
  echo "set_version.sh: '$version' אינו מספר שלם" >&2
  exit 1
fi

root="$(cd "$(dirname "$0")/.." && pwd)"
pubspec="$root/pubspec.yaml"
dart="$root/lib/src/app_version.dart"

replace() { # <file> <regex> <replacement>
  local file="$1"
  sed -E "s|$2|$3|" "$file" > "$file.tmp"
  mv "$file.tmp" "$file"
}

# `^version:` בלי הזחה — התלויות שבהמשך הקובץ מוזחות, ולכן אין התנגשות.
replace "$pubspec" '^version:.*' "version: $version.0.0"
replace "$dart" "^const String appVersion = '.*';" \
  "const String appVersion = '$version';"

# מאמת שההצבה אכן נכנסה: sed שלא התאים לכלום אינו מחזיר שגיאה, וקובץ שנשאר
# עם הגרסה הקודמת היה מייצר release שמדווח על עצמו מספר אחר.
grep -qx "version: $version.0.0" "$pubspec"
grep -qx "const String appVersion = '$version';" "$dart"
echo "$version"
