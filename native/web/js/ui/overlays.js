// שכבות שמעל המסך: הודעות רגעיות, שכבת הסנכרון, דיאלוג העדכונים
// וגלריית צילומי המסך.

import {h, icon, assetUrl, replace} from './dom.js';
import {actionButton, appCard, iconButton, statusChip} from './components.js';
import {S} from '../strings.js';
import {InstallStatus} from '../store/models.js';

// ── הודעות רגעיות ────────────────────────────────────────────────────────────

let snackHost = null;

function ensureSnackHost() {
  if (snackHost === null) {
    snackHost = h('div.snacks', {'aria-live': 'polite'});
    document.body.append(snackHost);
  }
  return snackHost;
}

/** פורט של `UiSnack`. `kind`: `info` / `success` / `error`. */
export function showSnack(message, kind = 'info') {
  const host = ensureSnackHost();
  const snack = h('div', {class: `snack snack--${kind}`},
                  h('span', {text: message}));
  host.append(snack);

  // הודעת שגיאה נשארת ארוך יותר: היא נושאת מלל שצריך לקרוא.
  const timeout = kind === 'error' ? 8000 : 4000;
  const remove = () => {
    snack.classList.add('snack--leaving');
    snack.addEventListener('animationend', () => snack.remove(),
                           {once: true});
  };
  const timer = setTimeout(remove, timeout);
  snack.addEventListener('click', () => {
    clearTimeout(timer);
    remove();
  });
}

export const showSuccess = (message) => showSnack(message, 'success');
export const showError = (message) => showSnack(message, 'error');

// ── דיאלוג כללי ──────────────────────────────────────────────────────────────

/**
 * דיאלוג מודאלי. סגירה ב-Esc ובלחיצה על המחסום.
 *
 * @returns {{close: () => void, content: HTMLElement}}
 */
export function showDialog({title, content, actions = [], onClose = null,
                            className = ''}) {
  const barrier = h('div.barrier');
  const dialog = h('div', {class: `dialog ${className}`, role: 'dialog',
                           'aria-modal': 'true'});

  const close = () => {
    document.removeEventListener('keydown', onKey, true);
    barrier.remove();
    onClose?.();
  };

  function onKey(event) {
    if (event.key === 'Escape') {
      event.stopPropagation();
      close();
    }
  }

  if (title !== null && title !== undefined) {
    dialog.append(h('h2.dialog__title', {text: title}));
  }
  const body = h('div.dialog__body');
  if (content !== null && content !== undefined) body.append(content);
  dialog.append(body);
  if (actions.length > 0) {
    dialog.append(h('div.dialog__actions', actions));
  }

  // לחיצה על המחסום סוגרת; לחיצה על הדיאלוג עצמו לא.
  barrier.addEventListener('click', (event) => {
    if (event.target === barrier) close();
  });
  document.addEventListener('keydown', onKey, true);

  barrier.append(dialog);
  document.body.append(barrier);
  return {close, content: body};
}

/** דיאלוג אישור — פורט של `showConfirmDialog`. */
export function confirmDialog({title, message, confirmText, onConfirm}) {
  const {close} = showDialog({
    title,
    content: h('p.dialog__text', {text: message}),
    actions: [
      actionButton({
        text: S.common.cancel,
        variant: 'ghost',
        onPressed: () => close(),
      }),
      actionButton({
        text: confirmText,
        variant: 'recommended',
        onPressed: () => {
          close();
          onConfirm();
        },
      }),
    ],
  });
}

// ── שכבת הסנכרון ─────────────────────────────────────────────────────────────

/**
 * שכבת חסימה בזמן סנכרון — הודעת שלב, מד התקדמות ורשימת אזהרות.
 * פורט של `PluginSyncOverlay`.
 *
 * כשל בקובץ בודד אינו עוצר את הסנכרון, ולכן האזהרות נאספות לרשימה
 * במקום להפיל את הפעולה.
 */
export function syncOverlay(controller) {
  const t = S.plugins;
  const percent = controller.syncProgress === null
      ? null
      : Math.round(Math.min(1, Math.max(0, controller.syncProgress)) * 100);

  const warnings = controller.syncWarnings.length === 0 ? null :
      h('div.sync__warnings',
        controller.syncWarnings.map((warning) =>
            h('div.sync__warning', icon('warning', 14),
              h('span', {text: warning}))));

  return h('div.barrier.barrier--sync',
      h('div.sync',
          h('h2.sync__title', {text: t.syncingOverlayTitle}),
          // בלי זה המונה שרץ נראה כאילו כל החנות יורדת מחדש.
          h('p.sync__subtitle', {text: t.syncingOverlaySubtitle}),
          h('p.sync__message',
            {text: controller.syncMessage ?? t.syncingOverlayStarting}),
          h('div.progress',
            h('div.progress__bar', {
              class: percent === null ? 'progress__bar--indeterminate' : '',
              style: percent === null ? {} : {width: `${percent}%`},
            })),
          percent === null ? null : h('div.sync__percent', {text: `${percent}%`}),
          warnings,
          actionButton({
            text: S.common.cancel,
            variant: 'ghost',
            className: 'sync__cancel',
            onPressed: controller.syncCancelled
                ? null
                : () => controller.cancelSync(),
          })));
}

// ── דיאלוג העדכונים ──────────────────────────────────────────────────────────

/**
 * המרווח בין שתי מסירות רצופות ב"עדכון הכל".
 *
 * ⚠️ כל מסירה היא `otzaria://plugin/install-local` אל אוצריא. כשהיא
 * סגורה, המסירה הראשונה מפעילה אותה — ומסירה שנייה שמגיעה לפני
 * שהמופע הראשון תפס את נעילת המופע היחיד הייתה פותחת מופע נוסף.
 */
export const UPDATE_DELIVERY_SPACING_MS = 1500;

/**
 * הודעת "יש עדכונים זמינים". פורט של `showPluginUpdatesDialog`.
 *
 * הרשימה עצמה היא תצלום המצב שנמסר בפתיחה, אבל מצב כל שורה נקרא **חי**
 * מהבקר: המסירה לאוצריא אינה ההתקנה, וסריקה מחדש היא הדבר היחיד שיודע
 * מה כבר עודכן שם.
 */
export function showUpdatesDialog({controller, updatable, onOpenDetail}) {
  const t = S.plugins;
  /** תוספים שהמסירה שלהם לאוצריא הצליחה בהרצה הזו. */
  const sent = new Set();
  let busyId = null;
  let updatingAll = false;

  const list = h('div.updates__list');
  const footer = h('div.updates__footer');
  const {close, content} = showDialog({
    title: t.updatesDialogTitle(updatable.length),
    content: h('div.updates',
               h('p.dialog__text', {text: t.updatesDialogIntro}),
               list, footer,
               h('p.updates__note', {text: t.updatesDialogPendingNote})),
    actions: [actionButton({text: S.common.close, variant: 'ghost',
                            onPressed: () => close()})],
    onClose: () => unsubscribe(),
  });

  /** האם אוצריא כבר מדווחת על הגרסה החדשה — כלומר העדכון הושלם שם. */
  const isDone = (plugin) =>
      controller.statusOf(plugin) === InstallStatus.upToDate;

  /** שורות שעדיין יש מה לעשות בהן דרך הכפתור. */
  const pending = () => updatable.filter(
      (plugin) => plugin.supportsDirectInstall && !sent.has(plugin.id) &&
          !isDone(plugin));

  async function install(plugin) {
    busyId = plugin.id;
    render();
    try {
      const result = await controller.install(plugin);
      if (result.success) sent.add(plugin.id);
      else showError(result.error ?? t.installFailedSnack);
    } catch (error) {
      showError(error?.message ?? t.installFailedSnack);
    } finally {
      busyId = null;
      render();
    }
  }

  async function updateAll() {
    updatingAll = true;
    render();
    try {
      let first = true;
      for (const plugin of pending()) {
        if (!first) {
          await new Promise((r) => setTimeout(r, UPDATE_DELIVERY_SPACING_MS));
        }
        first = false;
        await install(plugin);
      }
    } finally {
      // ⚠️ ב-`finally`: `updatingAll` מנטרל **כל** כפתור בדיאלוג, ולכן
      // מסירה שנפלה באמצע הייתה משאירה אותו כבוי לגמרי — "עדכון הכל"
      // בטעינה נצחית, וכל שורה בלי כפתור — עד שהמשתמש סוגר ופותח אותו.
      updatingAll = false;
      render();
    }
  }

  function rowAction(plugin) {
    if (isDone(plugin)) {
      return statusChip({kind: 'ok', label: t.updatesDialogDoneLabel});
    }
    if (controller.isAwaitingInstallOf(plugin) || sent.has(plugin.id)) {
      return statusChip({kind: 'working',
                         label: t.updatesDialogSentLabel});
    }
    if (!plugin.supportsDirectInstall) {
      return h('span.updates__manual', {text: t.updatesDialogManualOnly});
    }
    return actionButton({
      text: t.updatesDialogUpdateButton,
      variant: 'recommended',
      iconName: 'arrow-download',
      loading: busyId === plugin.id,
      onPressed: updatingAll ? null : () => void install(plugin),
    });
  }

  function render() {
    replace(list, updatable.map((plugin) => h('div.updates__row',
        h('div.updates__info',
          h('div.updates__name', {text: plugin.name}),
          h('div.updates__versions', {
            text: t.updatesDialogRow(
                controller.installedVersionOf(plugin) ?? S.common.emptyValue,
                controller.versionOf(plugin)),
          })),
        h('div.updates__actions',
          rowAction(plugin),
          actionButton({
            text: t.updatesDialogDetailsButton,
            variant: 'ghost',
            onPressed: () => {
              close();
              onOpenDetail(plugin.id);
            },
          })))));

    const remaining = pending();
    replace(footer, remaining.length <= 1 ? [] : [actionButton({
      text: t.updatesDialogUpdateAllButton(remaining.length),
      variant: 'neutral',
      iconName: 'arrow-download',
      loading: updatingAll,
      onPressed: () => void updateAll(),
    })]);
  }

  const unsubscribe = controller.subscribe(() => render());
  render();
  return {close};
}

// ── גלריית צילומי המסך ───────────────────────────────────────────────────────

/**
 * גלריה במסך מלא. ניווט בחצים, בלחיצה על הצדדים, וסגירה ב-Esc או
 * בלחיצה על הרקע — כמו ה-lightbox בחנות המקורית.
 *
 * הכיווניות: הממשק בעברית, ולכן ← מקדם ו-→ מחזיר.
 */
export function showScreenshots({paths, initialIndex = 0}) {
  let index = initialIndex;
  const hasMany = paths.length > 1;

  const image = h('img.lightbox__img', {alt: ''});
  /**
   * מוצג במקום התמונה כשהקובץ חסר.
   *
   * ⚠️ **הסתרה ולא החלפת הצומת.** `replaceWith` הוציא את ה-`img` מהעץ,
   * ומאותו רגע `render` הציב `src` על צומת מנותקת — צילום אחד שנמחק
   * מהמראה השאיר את כל הגלריה שאחריו ריקה.
   */
  const missing = h('div.lightbox__missing', icon('image-off', 64));
  const counter = h('div.lightbox__counter');

  const barrier = h('div.barrier.barrier--lightbox');
  const close = () => {
    document.removeEventListener('keydown', onKey, true);
    barrier.remove();
  };

  const step = (delta) => {
    index = (index + delta) % paths.length;
    if (index < 0) index += paths.length;
    render();
  };

  function onKey(event) {
    if (event.key === 'Escape') {
      event.stopPropagation();
      close();
      return;
    }
    // "קדימה" הוא לכיוון שאליו זורם הטקסט — שמאלה בעברית.
    if (event.key === 'ArrowLeft') step(1);
    else if (event.key === 'ArrowRight') step(-1);
  }

  function render() {
    const url = assetUrl(paths[index]);
    // נתיב ריק בקטלוג אינו נשלח כ-`src`: מחרוזת ריקה נפתרת אל הדף עצמו
    // ומייצרת ניסיון טעינה מיותר.
    image.hidden = url === null;
    missing.hidden = url !== null;
    if (url !== null) image.src = url;
    counter.textContent = `${index + 1} / ${paths.length}`;
  }

  image.addEventListener('error', () => {
    image.hidden = true;
    missing.hidden = false;
  });

  barrier.append(
      h('div.lightbox',
        h('div.lightbox__stage', image, missing),
        hasMany ? h('button.lightbox__nav.lightbox__nav--prev', {
          type: 'button', title: S.plugins.screenshotPrevious,
          onclick: () => step(-1),
        }, icon('chevron-right', 24)) : null,
        hasMany ? h('button.lightbox__nav.lightbox__nav--next', {
          type: 'button', title: S.plugins.screenshotNext,
          onclick: () => step(1),
        }, icon('chevron-left', 24)) : null,
        hasMany ? counter : null,
        h('div.lightbox__close',
          iconButton({iconName: 'dismiss', tooltip: S.common.close,
                      onPressed: close}))));

  barrier.addEventListener('click', (event) => {
    // לחיצה על הרקע סוגרת; לחיצה על התמונה עצמה לא.
    if (event.target === barrier ||
        event.target.classList.contains('lightbox') ||
        event.target.classList.contains('lightbox__stage')) {
      close();
    }
  });
  document.addEventListener('keydown', onKey, true);

  render();
  document.body.append(barrier);
  return {close};
}
