import 'package:fluentui_system_icons/fluentui_system_icons.dart';
import 'package:flutter/material.dart';

import '../controllers/store_update_controller.dart';
import '../l10n/app_strings_scope.dart';
import '../theme/theme_exports.dart';
import 'action_buttons.dart';
import 'rtl_icon.dart';
import 'ui_snack.dart';

/// שורת ההתראה על גרסה חדשה של החנות, מתחת לשורת הכותרת.
///
/// שורה ולא דיאלוג: הודעת עדכון שחוסמת את המסך היא בדיוק מה שמפריע למי
/// שפתח את התוכנה כדי להתקין תוסף. השורה נשארת עד שלוחצים עליה או סוגרים
/// אותה, ואפשר להתעלם ממנה לגמרי.
///
/// כשאין מה להציג היא מחזירה [SizedBox.shrink] ולא תופסת גובה — הקורא אינו
/// צריך לבדוק בעצמו.
class StoreUpdateBanner extends StatelessWidget {
  const StoreUpdateBanner({
    super.key,
    required this.controller,
    required this.onOpen,
  });

  final StoreUpdateController controller;

  /// פותח את דף ההורדה. מוחזר `false` כשהדפדפן לא נפתח, ואז מוצגת הכתובת
  /// עצמה כדי שאפשר יהיה להעתיק אותה ביד.
  final Future<bool> Function() onOpen;

  @override
  Widget build(BuildContext context) {
    if (!controller.hasUpdate) return const SizedBox.shrink();

    final cs = Theme.of(context).colorScheme;
    final t = context.strings.storeUpdate;
    final version = '${controller.available!.version}';

    return Container(
      width: double.infinity,
      padding: const EdgeInsets.symmetric(
        horizontal: AppTokens.spaceMD,
        vertical: AppTokens.spaceSM,
      ),
      decoration: BoxDecoration(
        color: cs.secondaryContainer,
        border: Border(
          bottom: BorderSide(color: AppSurfaces.shellDivider(context)),
        ),
      ),
      child: Row(
        children: [
          RtlIcon(
            FluentIcons.arrow_download_24_regular,
            size: 20,
            color: cs.onSecondaryContainer,
          ),
          const SizedBox(width: AppTokens.spaceSM),
          Expanded(
            child: Text(
              t.bannerTitle(version),
              style: TextStyle(
                color: cs.onSecondaryContainer,
                fontSize: AppTokens.fontMD,
                fontWeight: FontWeight.bold,
              ),
            ),
          ),
          const SizedBox(width: AppTokens.spaceSM),
          ActionButton.neutral(
            text: t.bannerButton,
            onPressed: () async {
              if (await onOpen()) return;
              UiSnack.show(t.openFailed(controller.pageUrl));
            },
          ),
          const SizedBox(width: AppTokens.spaceXS),
          SecondaryIconButton(
            icon: FluentIcons.dismiss_24_regular,
            tooltip: t.bannerDismissTooltip,
            onPressed: controller.dismiss,
          ),
        ],
      ),
    );
  }
}
