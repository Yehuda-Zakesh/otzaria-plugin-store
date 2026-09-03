// רכיבי הממשק. פורט של `lib/src/widgets/` ושל
// `lib/src/screens/plugins/plugin_visuals.dart`.
//
// שמות ה-class ב-CSS תואמים לשמות כאן, וכל המידות והצבעים מגיעים
// מהטוקנים (`css/tokens.css`) — אין כאן ערך שנבחר מחדש.

import {assetUrl, h, icon} from './dom.js';
import {S} from '../strings.js';
import {InstallStatus} from '../store/models.js';

// ── כרטיס ────────────────────────────────────────────────────────────────────

/**
 * כרטיס תוכן. פורט של `AppCard`.
 *
 * `onTap` הופך אותו ללחיץ, ואז הוא גם מקבל מיקוד מקלדת — הכרטיס בחנות
 * הוא הדרך העיקרית להיכנס לתוסף.
 */
export function appCard({onTap = null, className = '', children = []}) {
  if (onTap === null) {
    return h('div', {class: `card ${className}`}, children);
  }
  return h('div', {
    class: `card card--tappable ${className}`,
    role: 'button',
    tabindex: '0',
    onclick: onTap,
    onkeydown: (event) => {
      if (event.key === 'Enter' || event.key === ' ') {
        event.preventDefault();
        onTap();
      }
    },
  }, children);
}

// ── כפתורים ──────────────────────────────────────────────────────────────────

/**
 * כפתור פעולה. פורט של `ActionButton`, עם אותם שלושה סוגים:
 *
 *   recommended  FilledButton — הפעולה המומלצת
 *   neutral      FilledButton.tonal — פעולה ניטרלית
 *   ghost        TextButton — שקוף
 *
 * `onPressed: null` = כבוי, בדיוק כמו במקור.
 */
export function actionButton({text, onPressed, variant = 'neutral',
                              iconName = null, loading = false,
                              className = ''}) {
  const button = h('button', {
    type: 'button',
    class: `btn btn--${variant} ${className}`,
    disabled: onPressed === null || loading,
  });
  if (loading) {
    button.append(h('span.spinner'));
  } else if (iconName !== null) {
    button.append(icon(iconName, 18));
  }
  button.append(h('span', {text}));
  if (onPressed !== null && !loading) {
    button.addEventListener('click', onPressed);
  }
  return button;
}

/** כפתור אייקון בלבד, עם tooltip. */
export function iconButton({iconName, tooltip, onPressed, className = ''}) {
  return h('button', {
    type: 'button',
    class: `icon-btn ${className}`,
    title: tooltip,
    'aria-label': tooltip,
    onclick: onPressed,
  }, icon(iconName, 20));
}

// ── שבב חיווי מצב ────────────────────────────────────────────────────────────

/**
 * פורט של `StatusChip`. לכל סוג סמל **וגם** טקסט — התכנון אוסר להסתמך
 * על צבע בלבד.
 */
const STATUS_ICONS = Object.freeze({
  ok: 'checkmark-circle',
  updateAvailable: 'arrow-download',
  working: 'arrow-sync',
  needsAction: 'info',
  error: 'error-circle',
  unknown: 'question-circle',
});

export function statusChip({kind, label}) {
  return h('span', {class: `status-chip status-chip--${kind}`},
           kind === 'working' ? h('span.spinner')
                              : icon(STATUS_ICONS[kind] ?? 'info', 16),
           h('span', {text: label}));
}

/**
 * חיווי המצב מול ההתקנה בפועל. פורט של `PluginInstallChip`.
 *
 * "לא מותקן" ו"טרם נבדק" **אינם** מקבלים שבב — היעדר השבב הוא המצב
 * הרגיל בחנות, וכל תוסף שהיה מקבל אותו רק היה מוסיף רעש.
 */
export function installChip({status, installedVersion = null,
                             compact = false}) {
  const t = S.plugins;
  switch (status) {
    case InstallStatus.upToDate:
      return statusChip({kind: 'ok', label: t.installChipInstalled});
    case InstallStatus.updateAvailable:
      return statusChip({
        kind: 'updateAvailable',
        // בכרטיס שברשת אין לשבב מקום להתארך; הפירוט המלא בדף התוסף.
        label: installedVersion === null || compact
            ? t.installChipUpdateAvailable
            : t.installChipUpdateFrom(installedVersion),
      });
    case InstallStatus.incompatible:
      // זה כן צריך שבב: בלעדיו התוסף נראה זמין, וההתקנה הייתה נכשלת
      // בלי הסבר — או גרוע מכך, מתקינה משהו שלא עולה.
      return statusChip({kind: 'needsAction',
                         label: t.installChipIncompatible});
    default:
      return null;
  }
}

// ── גלולות ───────────────────────────────────────────────────────────────────

/** גלולת מטא-דאטה (גרסה, מספר הורדות, סטטוס). פורט של `PluginBadge`. */
export function pluginBadge({label, iconName = null, leading = null,
                             emphasized = false, tooltip = null}) {
  const badge = h('span', {
    class: `badge${emphasized ? ' badge--emphasized' : ''}`,
    title: tooltip,
  });
  if (leading !== null) badge.append(leading);
  else if (iconName !== null) badge.append(icon(iconName, 13));
  badge.append(h('span.badge__label', {text: label}));
  return badge;
}

/** גלולת תגית — לחיצה עליה מסננת את הרשימה. פורט של `PluginTagPill`. */
export function tagPill({label, active = false, onTap = null,
                         iconName = null}) {
  const props = {
    class: `pill${active ? ' pill--active' : ''}` +
        (onTap === null ? ' pill--static' : ''),
  };
  if (onTap !== null) {
    props.type = 'button';
    props.onclick = onTap;
  }
  const element = h(onTap === null ? 'span' : 'button', props);
  if (iconName !== null) element.append(icon(iconName, 14));
  element.append(h('span', {text: label}));
  return element;
}

// ── דירוג ────────────────────────────────────────────────────────────────────

/** הממוצע כפי שהאתר מציג אותו — ספרה אחת אחרי הנקודה, תמיד. */
export function formatRating(value) {
  return Number(value).toFixed(1);
}

/**
 * חמישה כוכבים עם מילוי חלקי — הפורט של `StarRating` שבאתר: שכבת
 * כוכבים מעומעמת, ומעליה שכבה כתומה שנחתכת ל-`value/5` מהרוחב.
 *
 * **תצוגה בלבד.** את הדירוג נותנים באתר (דורש חשבון), ואין כאן שום דרך
 * לדרג — גם לא במחשב מקוון.
 *
 * ב-RTL החיתוך מתחיל מימין, ולכן אותו כוכב מתמלא ראשון כמו באתר. זה
 * מושג ב-`inset-inline-start` ולא ב-`left`.
 */
export function ratingStars({value, size = 13}) {
  const clamped = Math.min(5, Math.max(0, Number(value) || 0));
  const stars = (className) => {
    const row = h('span', {class: className});
    for (let i = 0; i < 5; i++) {
      row.append(icon(size < 20 ? 'star-filled-16' : 'star-filled', size));
    }
    return row;
  };

  return h('span', {
    class: 'stars',
    role: 'img',
    'aria-label': S.plugins.ratingStarsLabel(formatRating(clamped)),
    style: {'--stars-fill': `${(clamped / 5) * 100}%`},
  }, stars('stars__base'), stars('stars__fill'));
}

/** גלולת הדירוג — כוכבים, הממוצע ומספר המדרגים. */
export function ratingBadge(plugin) {
  return pluginBadge({
    label: S.plugins.ratingBadge(formatRating(plugin.ratingAvg),
                                plugin.ratingCount),
    leading: ratingStars({value: plugin.ratingAvg}),
    tooltip: S.plugins.ratingTooltip(plugin.ratingCount),
  });
}

// ── תמונות ───────────────────────────────────────────────────────────────────

/**
 * תמונת התוסף מהמראה המקומית. כשאין תמונה (או שהקובץ נמחק) מוצג אייקון
 * פאזל על רקע primaryContainer — כמו במקור.
 */
export function thumbnail({relativePath, aspect = '16 / 11',
                           iconSize = 44}) {
  const box = h('div.thumb', {style: {aspectRatio: aspect}});
  const url = assetUrl(relativePath);

  const placeholder = () => {
    box.replaceChildren(
        h('div.thumb__placeholder', icon('puzzle-piece', iconSize)));
  };

  if (url === null) {
    placeholder();
    return box;
  }

  const image = h('img.thumb__img', {src: url, alt: '', loading: 'lazy',
                                     decoding: 'async'});
  // קובץ שנמחק מתחת לקטלוג — אותה נפילה כמו `errorBuilder` במקור.
  image.addEventListener('error', placeholder);
  box.append(image);
  return box;
}

// ── כותרות ותוויות ───────────────────────────────────────────────────────────

/**
 * "עינית" מעל כותרת סעיף — קו קצר ואחריו טקסט קטן ומודגש. זה הפורמט של
 * כותרות הסעיפים בחנות שבאתר.
 */
export function eyebrow(text) {
  return h('div.eyebrow', h('span.eyebrow__line'), h('span', {text}));
}

/** תווית שדה קטנה מעל פקד. */
export function fieldLabel(text) {
  return h('div.field-label', {text});
}

/** תא מידע — תווית קטנה מעל ערך מודגש, על רקע ניטרלי. */
export function infoCell({label, value, wide = false}) {
  return h('div', {class: `info-cell${wide ? ' info-cell--wide' : ''}`},
           h('div.info-cell__label', {text: label}),
           h('div.info-cell__value', {text: value}));
}

/** כותרת סעיף בתוך כרטיס. */
export function panel({title, children = [], className = ''}) {
  return appCard({
    className: `panel ${className}`,
    children: [h('h2.panel__title', {text: title}), ...children],
  });
}

/** כרטיס מצב ריק — כותרת, הסבר ופעולה אופציונלית. */
export function emptyState({title, body, action = null}) {
  return appCard({
    className: 'empty-state',
    children: [
      h('h2.empty-state__title', {text: title}),
      h('p.empty-state__body', {text: body}),
      action,
    ],
  });
}

/** תווית סטטוס התוסף כפי שהאתר מדווח אותו. */
export function pluginStatusLabel(status) {
  const t = S.plugins;
  switch (status) {
    case 'stable': return t.statusStable;
    case 'beta': return t.statusBeta;
    case 'experimental': return t.statusExperimental;
    default: return t.statusUnknown;
  }
}
