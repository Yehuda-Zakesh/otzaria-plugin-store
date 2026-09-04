// כל המלל של החנות, בעברית.
//
// ── למה קובץ אחד ולא חבילת l10n ──────────────────────────────────────────────
// בגרסת ה-Flutter המלל בא מ-`otzaria_l10n`, חבילה של ‎270KB שמשרתת את כל
// הלאנצ'ר בשתי שפות. החנות העצמאית משתמשת בשבריר ממנה, והוחלט על עברית
// בלבד — ולכן כאן יושב **בדיוק** מה שהחנות מציגה, מועתק מ-`strings_he.dart`
// כלשונו.
//
// המלל הוא תוכן, לא קוד: אין כאן היפוך כיווניות (`dir="rtl"` על ה-html
// עושה את זה), ואין מנגנון החלפת שפה.
//
// פונקציה = מלל עם פרמטרים, בדיוק כמו במקור.

export const S = Object.freeze({
  // ── כללי ──────────────────────────────────────────────────────────────────
  common: Object.freeze({
    confirm: 'אישור',
    cancel: 'ביטול',
    continueAction: 'המשך',
    close: 'סגירה',
    error: 'שגיאה',
    retry: 'נסה שוב',
    emptyValue: '—',
    copyPathButton: 'העתקת הנתיב',
    pathCopiedSnack: 'הנתיב הועתק',
  }),

  // ── יחידות גודל ───────────────────────────────────────────────────────────
  units: Object.freeze({
    bytes: (count) => `${count} בייט`,
    kilobytes: (amount) => `${amount} ק״ב`,
    megabytes: (amount) => `${amount} מ״ב`,
    gigabytes: (amount) => `${amount} ג״ב`,
    progressOf: (received, total) => `${received} מתוך ${total}`,
  }),

  // ── מסכי החנות ────────────────────────────────────────────────────────────
  plugins: Object.freeze({
    // סנכרון
    syncDialogTitle: 'סנכרון חנות התוספים',
    syncDialogContent:
        'הפעולה תוריד מ-otzaria.org את רשימת התוספים, הקטגוריות, התמונות ' +
        'וקובצי ההתקנה אל תיקיית ההעברה. יורדים רק תוספים חדשים ומעודכנים — ' +
        'מה שכבר בתיקייה נשאר כמו שהוא. דורשת אינטרנט, ומרגע שהסתיימה החנות ' +
        'עובדת גם במחשב שאין בו אינטרנט.',
    syncDialogConfirm: 'סנכרן',
    syncFailedSnack: 'הסנכרון נכשל',
    syncDoneSnack: (fetched, total) => fetched === 0
        ? `הכול כבר היה מעודכן — לא ירד דבר (${total} תוספים בחנות)`
        : `הסנכרון הושלם — ${fetched} תוספים ירדו, מתוך ${total} שבחנות`,
    syncDoneWithWarningsSnack: (count) =>
        `הסנכרון הסתיים, אך ${count} פריטים לא ירדו. הפרטים ביומן.`,
    syncButton: 'סנכרון מהאתר',
    reloadTooltip: 'טעינה מחדש מהתיקייה המקומית',
    syncingOverlayTitle: 'מסנכרן את חנות התוספים',
    syncingOverlaySubtitle:
        'יורדים רק תוספים חדשים ומעודכנים — מה שכבר בתיקייה מדולג.',
    syncingOverlayStarting: 'מתחיל...',
    syncNeverRan: 'טרם בוצע סנכרון',
    syncedAt: (time) => `סונכרן לאחרונה: ${time}`,
    syncDirUnknownTooltip: 'התיקייה תיקבע בסנכרון הראשון',
    updatesAvailableChip: (count) => `${count} עדכונים זמינים`,
    updatesChipTooltip: 'הצגת התוספים שממתינים לעדכון',

    // שמירה והתקנה
    saveDialogTitle: 'שמירת התוסף',
    saveDoneSnack: 'הקובץ נשמר',
    saveFailedSnack: 'שמירת הקובץ נכשלה',
    installOpenedSnack: (pluginName) =>
        `אוצריא נפתחה כדי להשלים את התקנת ${pluginName}`,
    installDoneSnack: (pluginName) => `התוסף ${pluginName} הותקן בהצלחה`,
    installFailedSnack: 'ההתקנה נכשלה',

    // דף הבית
    loadingCatalog: 'טוען את קטלוג התוספים...',
    catalogTitleFallback: 'חנות התוספים של אוצריא',
    catalogSubtitleFallback: 'תוספים שמרחיבים את חוויית הלימוד באוצריא',
    heroSearchHint: 'חפשו תוסף לפי שם, תיאור או נושא...',
    heroSearchButton: 'חיפוש',
    emptyStoreTitle: 'החנות בבנייה — אבל התוספים כבר כאן',
    emptyStoreBody:
        'בקרוב יופיעו כאן תוספים נבחרים וקטגוריות מסודרות. בינתיים אפשר לחפש ' +
        'למעלה או לעיין ברשימה המלאה של כל התוספים.',
    allPluginsWithCount: (count) => `לכל התוספים (${count})`,
    browseAllPrompt: 'לא מצאתם את מה שחיפשתם?',
    browseAllButton: (count) => `עיינו בכל התוספים (${count})`,
    featuredEyebrow: 'מומלצי החנות',
    featuredTitle: 'תוספים נבחרים',
    showMoreFeatured: 'הצג עוד נבחרים',
    categoryLinkButton: (count) => `לכל הקטגוריה (${count})`,

    // ניווט ורשימה
    breadcrumbRoot: 'חנות התוספים',
    allPluginsPage: 'כל התוספים',
    listEyebrow: 'רשימת תוספים',
    listTitle: 'בחרו את התוסף שמתאים לכם',
    summaryNoResults: 'לא נמצאו תוספים לפי הסינון שבחרתם',
    summaryAllShown: 'כל התוספים מוצגים',
    summaryPartial: (shown, total) => `מוצגים ${shown} מתוך ${total} תוספים`,
    categoryOnePlugin: 'תוסף אחד בקטגוריה',
    categoryPluginCount: (count) => `${count} תוספים בקטגוריה`,

    // מתג "רק מה שלא מותקן"
    hideInstalledLabel: 'רק מה שלא מותקן',
    hideInstalledOnTooltip: (installedCount) =>
        'מוצגים רק תוספים שאינם מותקנים או שיש להם עדכון.\n' +
        `זוהו ${installedCount} תוספים מותקנים באוצריא.`,
    hideInstalledOffTooltip: (installedCount) =>
        'מוצגים כל התוספים, כולל המותקנים והמעודכנים.\n' +
        `זוהו ${installedCount} תוספים מותקנים באוצריא.`,

    // מצבים ריקים
    neverSyncedTitle: 'עדיין לא סונכרנו תוספים',
    neverSyncedBody:
        'לחצו על "סנכרון מהאתר" במחשב שיש בו אינטרנט כדי לטעון את רשימת ' +
        'התוספים העדכנית מ-otzaria.org.',
    noResultsTitle: 'לא נמצאו תוספים לפי הסינון שבחרתם',
    noResultsBody:
        'נסו לחפש בשם אחר, להסיר תגית, לבחור סטטוס שונה, או לכבות את ' +
        '"הצג רק מה שלא מותקן".',
    // ── תוספים שהוסתרו בגלל תאימות ─────────────────────────────────────
    // המראה נבנית עבור מה שהריפו של אוצריא פרסם, ולא עבור המחשב הזה.
    // תוסף שאין בה בילד שירוץ כאן אינו מוצג — ובלי השורה הזאת חנות
    // שחסרים בה תוספים אינה ניתנת לאבחון מרחוק.
    hiddenByCompatibility: (count, appVersion, targetVersions) => {
      const what = count === 1
          ? 'תוסף אחד אינו מוצג — אין במראה גרסה שלו שתואמת'
          : `${count} תוספים אינם מוצגים — אין במראה גרסה שלהם שתואמת`;
      const here = appVersion
          ? `לאוצריא ${appVersion} שבמחשב הזה`
          : 'לגרסת אוצריא שבמחשב הזה';
      const built = targetVersions.length === 0 ? '' :
          ` המראה נבנתה עבור אוצריא ${targetVersions.join(' ו-')}.`;
      return `${what} ${here}.${built}`;
    },
    hiddenOnlyTitle: 'התוספים שבמראה אינם תואמים לאוצריא שבמחשב הזה',
    hiddenOnlyBody: (count, appVersion, targetVersions) => {
      const built = targetVersions.length === 0 ? '' :
          ` המראה נבנתה עבור אוצריא ${targetVersions.join(' ו-')}.`;
      const here = appVersion ? ` כאן מותקנת ${appVersion}.` : '';
      return `המראה נושאת ${count} תוספים, ולאף אחד מהם אין גרסה שתרוץ ` +
          `על אוצריא שבמחשב הזה.${built}${here} עדכון אוצריא יציג אותם.`;
    },

    allInstalledTitle: 'הכול מותקן ומעודכן',
    allInstalledBody:
        'המתג "רק מה שלא מותקן" מסתיר תוספים שכבר מותקנים אצלכם בגרסה ' +
        'העדכנית. כבו אותו כדי לראות גם אותם.',
    showInstalledButton: 'הצג גם את המותקנים',
    emptyCategoryTitle: 'בקרוב יתווספו תוספים לקטגוריה זו',
    emptyCategoryBody: 'בינתיים אפשר לעיין ברשימה המלאה של כל התוספים בחנות.',
    allPluginsButton: 'לכל התוספים',

    // סינון
    filterSearchLabel: 'חיפוש',
    filterSearchHint: 'שם, תיאור או תגית...',
    filterStatusLabel: 'סטטוס',
    filterTagsLabel: 'תגיות',
    filterAllTags: 'כל התגיות',
    filterStatusAll: 'הכול',
    showMoreTags: 'הצג עוד',
    showFewerTags: 'הצג פחות',

    // תגיות על הכרטיס
    badgeFeaturedShort: 'נבחר',
    badgeFeatured: 'תוסף נבחר',
    pluginVersionBadge: (version) => `גרסה ${version}`,
    downloadsBadge: (count) => `${count} הורדות`,

    // דירוג
    ratingBadge: (average, count) => `${average} (${count})`,
    ratingTooltip: (count) => `דירוג ממוצע מתוך ${count} מדרגים`,
    ratingPanelTitle: 'דירוג המשתמשים',
    ratingCountLabel: (count) => count === 1 ? `${count} מדרג`
                                             : `${count} מדרגים`,
    ratingVerifiedLabel: (count) => `${count} מאומתים`,
    ratingVerifiedTooltip: 'מדרגים שהתקנת התוסף אצלם נרשמה בפועל',
    ratingEmpty: 'התוסף עדיין לא דורג',
    ratingStarsLabel: (average) => `דירוג ${average} מתוך 5`,

    // כפתורים
    saveButton: 'שמירה',
    installButton: 'התקנה',
    directInstallButton: 'התקנה ישירה לאוצריא',
    sourcePageButton: 'עמוד המקור',
    cardDetailsLink: 'לפרטים מלאים',
    cardUpdatedOn: (date) => `עודכן ב־${date}`,
    backToStore: 'חזרה לחנות',

    // סטטוס בשלות
    statusStable: 'יציב',
    statusBeta: 'בטא',
    statusExperimental: 'ניסיוני',
    statusUnknown: 'לא ידוע',

    // שבב מצב ההתקנה
    installChipInstalled: 'מותקן',
    installChipUpdateAvailable: 'עדכון זמין',
    installChipUpdateFrom: (installedVersion) =>
        `עדכון זמין (מותקן ${installedVersion})`,
    installChipIncompatible: 'דורש אוצריא חדשה יותר',

    // דף התוסף
    infoPanelTitle: 'מידע כללי',
    tagsPanelTitle: 'תגיות',
    screenshotsPanelTitle: 'צילומי מסך',
    infoVersion: 'גרסה',
    infoStatus: 'סטטוס',
    infoAuthor: 'מפתח',
    infoUpdated: 'עודכן',
    infoNetwork: 'חיבור אינטרנט בזמן שימוש',
    infoNetworkRequired: 'נדרש',
    infoNetworkNotRequired: 'לא נדרש',
    infoCompatibility: 'תאימות',
    compatibilityRange: (from, to) => `${from} — עד ${to}`,
    infoLocalFile: 'קובץ התוסף במראה',
    infoLocalFileMissing: 'טרם ירד — יש לבצע סנכרון',
    localFileDescription: (fileName, size) => `${fileName} (${size})`,
    valueUnspecifiedFeminine: 'לא צוינה',
    valueUnspecifiedMasculine: 'לא צוין',
    sizeUnknown: 'גודל לא ידוע',

    // קטגוריות
    categoriesTitle: 'קטגוריות',
    storeHomeItem: 'דף הבית של החנות',
    storeHomeChip: 'דף הבית',

    // דיאלוג העדכונים
    updatesDialogTitle: (count) => `יש עדכונים זמינים (${count})`,
    updatesDialogIntro:
        'התוספים הבאים מותקנים אצלך באוצריא בגרסה ישנה מזו שבחנות:',
    updatesDialogRow: (installedVersion, storeVersion) =>
        `מותקן ${installedVersion} ← בחנות ${storeVersion}`,
    updatesDialogUpdateButton: 'עדכון',
    updatesDialogUpdateAllButton: (count) => `עדכון הכל (${count})`,
    updatesDialogDetailsButton: 'לפרטים',
    updatesDialogSentLabel: 'נשלח לאוצריא',
    updatesDialogDoneLabel: 'עודכן',
    updatesDialogManualOnly: 'התקנה מדף התוסף',
    updatesDialogPendingNote:
        'ההתקנה עצמה מתבצעת בחלון של אוצריא. הרשימה כאן מתעדכנת מאליה ' +
        'ברגע שהיא מסתיימת שם — אין מה ללחוץ.',

    // גלריית צילומי המסך
    screenshotPrevious: 'הקודם',
    screenshotNext: 'הבא',
  }),

  // ── הודעות שכבת הלוגיקה (pluginsDomain) ───────────────────────────────────
  domain: Object.freeze({
    fileNotAvailableSyncFirst:
        'הקובץ אינו זמין באופן מקומי. יש לבצע סנכרון קודם.',
    saveFailed: (error) => `שמירת הקובץ נכשלה: ${error}`,
    pluginFileNotAvailable: 'קובץ התוסף אינו זמין. יש לבצע סנכרון קודם.',
    noCompatibleBuild: 'אין לתוסף גרסה שמתאימה לגרסת אוצריא שבמחשב הזה.',
    localPluginFileMissing: 'קובץ התוסף המקומי חסר. יש לבצע סנכרון מחדש.',
    badPluginExtension: 'קובץ התוסף אינו בסיומת otzplugin תקינה.',
    otzariaOpenFailedHint:
        'פתיחת אוצריא נכשלה. ודא שאוצריא מותקנת במחשב זה. ',
    otzariaOpenFailed: (error) => `פתיחת אוצריא נכשלה: ${error}`,

    syncLoadingCatalog: 'טוען את רשימת התוספים מהאתר...',
    syncPlugin: (name, done, total) => `מסנכרן: ${name} (${done}/${total})`,
    syncDone: 'הסנכרון הושלם',
    syncDoneCounts: (fetched, skipped) =>
        `הסנכרון הושלם: ${fetched} תוספים עודכנו, ` +
        `${skipped} כבר היו מעודכנים`,
    syncCategories: 'מסנכרן את קטגוריות החנות...',
    syncStructureFailed: (error) =>
        `לא ניתן לטעון את מבנה החנות מהאתר (${error}) — נשמר המבנה הקודם`,
    syncStructureEmpty: 'האתר לא החזיר קטגוריות',
    syncEmptyCatalogRejected:
        'האתר החזיר רשימת תוספים ריקה — החנות שכבר ירדה נשמרה כמות שהיא. ' +
        'כדאי לנסות שוב מאוחר יותר.',
    syncCategoryFailed: (name, error) =>
        `לא ניתן לטעון את הקטגוריה ${name}: ${error}`,
    syncImageFailed: (name, error) =>
        `לא ניתן להוריד תמונה עבור ${name}: ${error}`,
    syncScreenshotFailed: (name, error) =>
        `לא ניתן להוריד צילום מסך עבור ${name}: ${error}`,
    syncPluginFileFailed: (name, error) =>
        `לא ניתן להוריד את קובץ התוסף ${name}: ${error}`,

    whatPluginList: 'רשימת התוספים',
    whatStoreStructure: 'מבנה החנות',
    whatCategory: (slug) => `הקטגוריה ${slug}`,
    responseNotPluginList: 'תשובת האתר אינה רשימת תוספים תקינה',
    networkTimedOut: 'האתר לא השיב בזמן',
    siteUnreachable: (error) => `לא ניתן להתחבר לאתר אוצריא: ${error}`,
    loadFailed: (what, statusCode) =>
        `לא ניתן לטעון את ${what} (HTTP ${statusCode})`,
    responseNotJson: (what) => `תשובת האתר עבור ${what} אינה JSON תקין`,
    responseUnexpectedShape: 'תשובת האתר אינה במבנה הצפוי',
    httpStatusFor: (statusCode, url) => `HTTP ${statusCode} עבור ${url}`,
  }),

  // ── התראת גרסה חדשה של החנות ──────────────────────────────────────────────
  storeUpdate: Object.freeze({
    bannerTitle: (version) =>
        `יצאה גרסה חדשה של חנות התוספים — גרסה ${version}`,
    bannerButton: 'לדף ההורדה',
    bannerDismissTooltip: 'הסתרת ההודעה',
    openFailed: (url) => `פתיחת הדפדפן נכשלה. הכתובת להורדה: ${url}`,
  }),

  // ── כונן מוגן מפני כתיבה ──────────────────────────────────────────────────
  readOnlyDrive: Object.freeze({
    bannerTitle: 'הכונן מוגן מפני כתיבה — מצב קריאה',
    bannerSubtitle:
        'התקנה של תוספים עובדת כרגיל: היא כותבת למחשב הזה ולא לכונן. ' +
        'הורדה מהרשת כבויה — אין לאן להוריד. היומן נשמר במחשב הזה.',
    downloadsDisabledSnack:
        'הכונן מוגן מפני כתיבה — אין לאן להוריד. אפשר להתקין ממה שכבר יש בו.',
  }),

  // ── מסך שגיאת הגדרה ───────────────────────────────────────────────────────
  setupError: Object.freeze({
    title: 'התוכנה נמצאת במקום שאינו מתאים',
    explanation:
        'החנות שומרת את כל הנתונים — הקטלוג וקובצי התוספים — בתיקייה ' +
        'שצמודה לה, כדי שהכול ייסע יחד על הכונן. התיקייה הנוכחית חסומה ' +
        'לכתיבה — הרשאות, או כונן שמוגן מפני כתיבה — ואין בה עדיין קטלוג ' +
        'שאפשר להתקין ממנו, ולכן אין לאן לשמור.',
    whatToDo:
        'מה לעשות: אם הכונן עצמו מוגן מפני כתיבה (מפתח נעילה על הכונן, ' +
        'כונן צריבה, או הרשאות לקריאה בלבד) — לשחרר את ההגנה, להוריד את ' +
        'התוספים, ואז אפשר לנעול אותו שוב ולהתקין ממנו בכל מחשב. אחרת — ' +
        'להעביר את תיקיית התוכנה כולה לכונן הנייד (או לכל תיקייה בדיסק ' +
        'שאינה תחת Program Files), ולהפעיל אותה משם.',
    attemptedDirTitle: 'התיקייה שנוסתה',
  }),
});
