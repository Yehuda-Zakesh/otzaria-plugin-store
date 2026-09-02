import 'dart:io';

import 'package:flutter_test/flutter_test.dart';
import 'package:otzaria_plugin_store/src/app_version.dart';

/// הגרסה יושבת בשני קבצים — `pubspec.yaml` ו-`app_version.dart` — כי אף אחד
/// מהם אינו יכול לקרוא את השני: ה-Dart אינו קורא YAML בזמן ריצה, ו-`rc.exe`
/// (דרך `build_stub.ps1`) אינו קורא Dart.
///
/// השומר הזה הוא מה שמונע מהם להיפרד. פירוד כזה שקט לחלוטין: ה-exe נבנה,
/// רץ, ומדווח על עצמו מספר אחר מזה שבתג של ה-release — ואז העדכון של
/// המשתמש הבא נשען על מספר שגוי.
///
/// שני הקבצים מוצבים יחד ע"י `tool/set_version.sh`, שה-CI מריץ לפני כל
/// בנייה.
void main() {
  test('appVersion הוא מספר שלם אחד', () {
    // המספור הוא 1, 2, 3… בכוונה — ראו את ההסבר ב-`set_version.sh`.
    expect(appVersion, matches(RegExp(r'^\d+$')),
        reason: 'appVersion צריך להיות מספר שלם, וקיבלנו «$appVersion»');
  });

  test('pubspec.yaml מסכים עם appVersion', () {
    final pubspec = File('pubspec.yaml');
    expect(pubspec.existsSync(), isTrue,
        reason: 'הבדיקה מריצה מתיקיית שורש הפרויקט');

    final line = pubspec
        .readAsLinesSync()
        .firstWhere((l) => l.startsWith('version:'), orElse: () => '');
    expect(line, isNotEmpty, reason: 'אין שורת version: ב-pubspec.yaml');

    // `1.0.0` — pub דורש שלושה חלקים, ולכן מותר לו להיות `$appVersion.0.0`
    // ולא `$appVersion` לבדו.
    expect(line.trim(), equals('version: $appVersion.0.0'),
        reason: 'pubspec.yaml ו-app_version.dart נפרדו — '
            'הריצו tool/set_version.sh <N>');
  });
}
