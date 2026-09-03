// מסכי החנות. פורט של `lib/src/screens/plugins/`.
//
// שלושת המסכים הם אלה של האתר: דף בית אצור (`/plugins`), "כל התוספים"
// (`/plugins/all`) ודף קטגוריה (`/plugins/category/<slug>`), ומעליהם דף
// פרטי התוסף.
//
// ── מה נעשה פשוט יותר, ולמה ──────────────────────────────────────────────────
// בגרסת ה-Flutter רשת הכרטיסים הייתה `SliverGrid` בגובה **קבוע**
// (`mainAxisExtent`), וזה גרר שרשרת שלמה של פשרות שמתועדות שם: תקציב
// גובה של 352px שנמדד ביד, `_badgesHeight`/`_tagsHeight` קבועים,
// ו-`clipBehavior: Clip.hardEdge` כדי שגלולה שגלשה תיחתך ולא תשפוך.
//
// ל-CSS Grid יש `auto-fill` + `minmax`, והשורה מקבלת את גובה הכרטיס
// הגבוה בה מעצמה. לכן כל התקציבים האלה **אינם נחוצים כאן**, ואיתם נעלמת
// גם החתיכה: שורת הגלולות פשוט נשברת, ושורת הכפתורים נדחקת לתחתית
// הכרטיס ב-flex. זה אותו מראה, בלי המלכודת.

import {S} from '../strings.js';
import {InstallStatus} from '../store/models.js';
import {Page, Status, StatusFilter} from '../controller.js';
import {formatBytes} from '../util/bytes.js';
import {formatHebrewDate} from '../util/hebrew_date.js';
import {formatTimestamp} from '../util/timestamps.js';
import {assetUrl, h, icon, replace} from './dom.js';
import {
  actionButton,
  appCard,
  emptyState,
  eyebrow,
  fieldLabel,
  formatRating,
  iconButton,
  infoCell,
  installChip,
  panel,
  pluginBadge,
  pluginStatusLabel,
  ratingBadge,
  ratingStars,
  statusChip,
  tagPill,
  thumbnail,
} from './components.js';
import {
  showScreenshots,
  showSnack,
  showUpdatesDialog,
  syncOverlay,
  confirmDialog,
  showError,
  showSuccess,
} from './overlays.js';

/** כמה נבחרים מוצגים לפני "הצג עוד נבחרים" — כמו באתר. */
const FEATURED_PREVIEW_COUNT = 6;

/** כמה תגיות מוצגות לפני "הצג עוד" — שתי שורות בקירוב. */
const COLLAPSED_TAG_COUNT = 14;

/**
 * מצב תצוגה שאינו שייך לבקר — הוא מקומי למסך ומתאפס בניווט, בדיוק כמו
 * ה-`State` של ה-widget במקור.
 */
const local = {
  allFeaturedShown: false,
  allTagsShown: false,
  busyPluginId: null,
};

/**
 * מרנדר את מסך החנות כולו לתוך [host].
 *
 * הרינדור הוא מלא ולא מדורג: הבקר הוא מקור האמת היחיד, והמסך הוא כמה
 * עשרות אלמנטים. זה מה שמאפשר לוותר על framework.
 */
export function renderStore(host, controller, {readOnly = false} = {}) {
  const hasNav = controller.categories.length > 0;
  const wide = host.clientWidth >= 1080;
  const showSidebar = hasNav && wide;

  const detail = controller.openPlugin_;

  const layout = h('div.store');
  if (detail !== null) {
    layout.append(detailHeader(controller, detail));
  } else {
    layout.append(syncHeader(controller, {readOnly}));
    if (hasNav && !showSidebar) layout.append(categoryBar(controller));
  }

  const scroll = h('div.store__scroll');
  const columns = h('div.store__columns');
  if (detail === null && showSidebar) columns.append(sidebar(controller));
  columns.append(scroll);
  layout.append(columns);

  if (detail !== null) {
    scroll.append(detailBody(controller, detail));
  } else if (controller.errorMessage !== null) {
    scroll.append(h('div.store__pad',
        appCard({
          className: 'error-row',
          children: [
            icon('error-circle', 22),
            h('span.error-row__text', {text: controller.errorMessage}),
            actionButton({text: S.common.retry, variant: 'neutral',
                          onPressed: () => void controller.load()}),
          ],
        })));
  } else if (controller.status === Status.loading) {
    scroll.append(h('div.store__pad',
        appCard({
          className: 'progress-row',
          children: [h('span.spinner'),
                     h('span', {text: S.plugins.loadingCatalog})],
        })));
  } else if (controller.plugins.length === 0) {
    scroll.append(h('div.store__pad', neverSyncedState(controller, readOnly)));
  } else {
    switch (controller.view) {
      case Page.home: scroll.append(...homeSections(controller)); break;
      case Page.all: scroll.append(...allSections(controller)); break;
      case Page.category: scroll.append(...categorySections(controller)); break;
    }
  }

  replace(host, layout);
  if (controller.status === Status.syncing) {
    host.append(syncOverlay(controller));
  }
}

// ── שורת הסנכרון ─────────────────────────────────────────────────────────────

function syncHeader(controller, {readOnly}) {
  const t = S.plugins;
  const lastSync = controller.lastSync;

  const updates = controller.updatablePlugins;
  const updatesChip = updates.length === 0 ? null : h('button.pill.pill--active', {
    type: 'button',
    title: t.updatesChipTooltip,
    onclick: () => showUpdatesDialog({
      controller,
      updatable: updates,
      onOpenDetail: (id) => controller.openPlugin(id),
    }),
  }, icon('arrow-download', 14),
     h('span', {text: t.updatesAvailableChip(updates.length)}));

  return h('div.toolbar',
      h('div.toolbar__main',
        // ⚠️ הסנכרון הוא הפעולה היחידה שדורשת אינטרנט, והיא תמיד יזומה
        // בלחיצה. על כונן מוגן מפני כתיבה אין לאן להוריד, ולכן היא כבויה.
        actionButton({
          text: t.syncButton,
          variant: 'recommended',
          iconName: 'arrow-sync',
          onPressed: readOnly ? null : () => confirmDialog({
            title: t.syncDialogTitle,
            message: t.syncDialogContent,
            confirmText: t.syncDialogConfirm,
            onConfirm: () => void runSync(controller),
          }),
        }),
        iconButton({
          iconName: 'arrow-sync',
          tooltip: t.reloadTooltip,
          className: 'toolbar__reload',
          onPressed: () => void controller.load(),
        }),
        h('span.toolbar__stamp', {
          text: lastSync === null ? t.syncNeverRan
                                  : t.syncedAt(formatTimestamp(lastSync)),
        })),
      h('div.toolbar__side',
        updatesChip,
        hideInstalledToggle(controller)));
}

/**
 * מתג "רק מה שלא מותקן". תוספת של הלאנצ'ר (אין לו מקבילה באתר) והוא חל
 * על **כל** מסכי החנות, ולכן הוא בשורה העליונה ולא בשורת הסינון.
 */
function hideInstalledToggle(controller) {
  const t = S.plugins;
  const isOn = controller.hideInstalled;
  return h('label.switch', {
    title: isOn ? t.hideInstalledOnTooltip(controller.installedCount)
                : t.hideInstalledOffTooltip(controller.installedCount),
  },
      h('input', {
        type: 'checkbox',
        checked: isOn,
        onchange: (event) => controller.setHideInstalled(event.target.checked),
      }),
      h('span.switch__track', h('span.switch__thumb')),
      h('span.switch__label', {text: t.hideInstalledLabel}));
}

async function runSync(controller) {
  const before = controller.plugins.length;
  await controller.sync();
  const outcome = controller.lastSyncOutcome;
  if (controller.status === Status.error) {
    showError(controller.errorMessage ?? S.plugins.syncFailedSnack);
    return;
  }
  if (outcome === null) return;
  if (controller.syncWarnings.length > 0) {
    showSnack(S.plugins.syncDoneWithWarningsSnack(
        controller.syncWarnings.length), 'error');
  } else {
    showSuccess(S.plugins.syncDoneSnack(
        outcome.fetched, controller.plugins.length || before));
  }
}

// ── ניווט הקטגוריות ──────────────────────────────────────────────────────────

/**
 * סרגל הצד. יושב **מחוץ** לאזור הגלילה כדי שגלילת התוכן לא תזיז אותו,
 * כמו ה-`sticky` שבאתר.
 */
function sidebar(controller) {
  const t = S.plugins;
  const item = ({label, iconName, active, onTap, count = null,
                 tooltip = null, muted = false}) =>
      h('button', {
        type: 'button',
        class: 'nav-item' + (active ? ' nav-item--active' : '') +
            (muted ? ' nav-item--muted' : ''),
        title: tooltip,
        onclick: onTap,
      }, icon(iconName, 18),
         h('span.nav-item__label', {text: label}),
         count === null ? null : h('span.nav-item__count', {text: count}));

  return h('nav.sidebar',
      h('div.sidebar__title', {text: t.categoriesTitle}),
      item({
        label: t.storeHomeItem,
        iconName: 'home',
        active: controller.view === Page.home,
        onTap: () => controller.showHome(),
      }),
      controller.categories.map((category) => item({
        label: category.name,
        tooltip: category.description,
        count: category.pluginCount,
        iconName: 'puzzle-piece',
        active: controller.openCategorySlug === category.slug,
        onTap: () => controller.showCategory(category.slug),
      })),
      h('hr.sidebar__divider'),
      // "כל התוספים" — מוצא אחרון, מוצנע בתחתית הסרגל, כמו באתר.
      item({
        label: t.allPluginsPage,
        count: controller.plugins.length,
        iconName: 'apps-list',
        active: controller.view === Page.all,
        muted: true,
        onTap: () => controller.showAllPlugins(),
      }));
}

/** שורת הקטגוריות למסך צר — המקבילה ל-`nav` האופקי שבאתר. */
function categoryBar(controller) {
  const t = S.plugins;
  return h('div.category-bar',
      tagPill({
        label: t.storeHomeChip,
        active: controller.view === Page.home,
        onTap: () => controller.showHome(),
      }),
      controller.categories.map((category) => tagPill({
        label: `${category.name} (${category.pluginCount})`,
        active: controller.openCategorySlug === category.slug,
        onTap: () => controller.showCategory(category.slug),
      })),
      tagPill({
        label: t.allPluginsWithCount(controller.plugins.length),
        active: controller.view === Page.all,
        onTap: () => controller.showAllPlugins(),
      }));
}

// ── דף הבית האצור ────────────────────────────────────────────────────────────

function homeSections(controller) {
  const t = S.plugins;
  const featured = controller.featured;
  const visibleFeatured = local.allFeaturedShown
      ? featured
      : featured.slice(0, FEATURED_PREVIEW_COUNT);
  const sections = [h('div.store__pad', hero(controller))];

  // אין אצירה להציג — שער אל כל התוספים, כמו המצב הריק של דף הבית באתר.
  if (!controller.hasCuratedHome) {
    sections.push(h('div.store__pad', emptyState({
      title: t.emptyStoreTitle,
      body: t.emptyStoreBody,
      action: actionButton({
        text: t.allPluginsWithCount(controller.plugins.length),
        variant: 'recommended',
        iconName: 'apps-list',
        onPressed: () => controller.showAllPlugins(),
      }),
    })));
  }

  // יש אצירה, אבל המתג "רק מה שלא מותקן" הסתיר את כולה.
  if (controller.hasCuratedHome && featured.length === 0 &&
      controller.homeCategories.length === 0) {
    sections.push(h('div.store__pad', allInstalledState(controller)));
  }

  if (featured.length > 0) {
    sections.push(h('div.store__pad.store__pad--section',
        sectionHeader({eyebrowText: t.featuredEyebrow,
                       title: t.featuredTitle})));
    sections.push(h('div.store__pad', grid(controller, visibleFeatured)));
    if (featured.length > FEATURED_PREVIEW_COUNT && !local.allFeaturedShown) {
      sections.push(h('div.store__pad.store__pad--center', actionButton({
        text: t.showMoreFeatured,
        variant: 'neutral',
        onPressed: () => {
          local.allFeaturedShown = true;
          controller.notifyRerender();
        },
      })));
    }
  }

  for (const category of controller.homeCategories) {
    sections.push(h('div.store__pad.store__pad--section', sectionHeader({
      title: category.name,
      description: category.description,
      action: actionButton({
        text: t.categoryLinkButton(category.pluginCount),
        variant: 'ghost',
        iconName: 'arrow-left',
        onPressed: () => controller.showCategory(category.slug),
      }),
    })));
    sections.push(h('div.store__pad',
        grid(controller, controller.pluginsIn(category, category.homeLimit))));
  }

  if (controller.hasCuratedHome) {
    sections.push(h('div.store__pad.store__pad--section',
        discoveryStrip(controller)));
  }
  return sections;
}

/**
 * ה-hero של דף הבית: כותרת, תקציר ותיבת חיפוש בולטת. באתר החיפוש מוביל
 * לדף חיפוש צד-שרת; כאן — לסינון המקומי ב"כל התוספים".
 */
function hero(controller) {
  const t = S.plugins;
  const input = h('input.hero__input', {
    type: 'search',
    placeholder: t.heroSearchHint,
    'aria-label': t.filterSearchLabel,
  });
  const submit = () => controller.showAllPlugins(input.value);
  input.addEventListener('keydown', (event) => {
    if (event.key === 'Enter') submit();
  });

  return appCard({
    className: 'hero',
    children: [
      h('h1.hero__title', {text: controller.homeTitle}),
      h('p.hero__subtitle', {text: controller.homeSubtitle}),
      h('div.hero__search',
        icon('search', 20),
        input,
        actionButton({text: t.heroSearchButton, variant: 'recommended',
                      onPressed: submit})),
    ],
  });
}

/** "לא מצאתם את מה שחיפשתם?" בתחתית דף הבית. */
function discoveryStrip(controller) {
  const t = S.plugins;
  return appCard({
    className: 'discovery',
    children: [
      h('span.discovery__prompt', {text: t.browseAllPrompt}),
      actionButton({
        text: t.browseAllButton(controller.plugins.length),
        variant: 'neutral',
        iconName: 'apps-list',
        onPressed: () => controller.showAllPlugins(),
      }),
    ],
  });
}

function sectionHeader({eyebrowText = null, title, description = null,
                        action = null}) {
  return h('div.section-header',
      h('div.section-header__text',
        eyebrowText === null ? null : eyebrow(eyebrowText),
        h('h2.section-header__title', {text: title}),
        description ? h('p.section-header__desc', {text: description}) : null),
      action);
}

// ── "כל התוספים" ─────────────────────────────────────────────────────────────

function allSections(controller) {
  const t = S.plugins;
  const filtered = controller.filtered;
  const sections = [
    h('div.store__pad', filtersBar(controller)),
    h('div.store__pad.store__pad--section', sectionHeader({
      eyebrowText: t.listEyebrow,
      title: t.listTitle,
      description: summaryText(controller, filtered),
    })),
  ];

  if (filtered.length === 0) {
    sections.push(h('div.store__pad', noResultsState(controller)));
  } else {
    sections.push(h('div.store__pad', grid(controller, filtered)));
  }
  return sections;
}

function summaryText(controller, filtered) {
  const t = S.plugins;
  if (filtered.length === 0) return t.summaryNoResults;
  if (filtered.length === controller.plugins.length) return t.summaryAllShown;
  return t.summaryPartial(filtered.length, controller.plugins.length);
}

/**
 * שורת החיפוש והסינון. מוצגת **רק** במסך "כל התוספים", בדיוק כמו
 * `/plugins/all` באתר: דף הבית ודף הקטגוריה מציגים אצירה ואין בהם סינון.
 * הקטגוריות אינן כאן אלא בסרגל הצד — הן הניווט הראשי, והתגיות סינון
 * משני בתוך הרשימה השטוחה.
 */
function filtersBar(controller) {
  const t = S.plugins;

  const search = h('input.text-field', {
    type: 'search',
    value: controller.search,
    placeholder: t.filterSearchHint,
  });
  // `input` ולא `change`: הסינון מקומי ומיד, כמו במקור.
  search.addEventListener('input', () => controller.setSearch(search.value));

  const statusLabels = {
    [StatusFilter.all]: t.filterStatusAll,
    [StatusFilter.stable]: t.statusStable,
    [StatusFilter.beta]: t.statusBeta,
    [StatusFilter.experimental]: t.statusExperimental,
  };
  const select = h('select.select', {
    onchange: (event) => controller.setStatusFilter(event.target.value),
  }, Object.entries(statusLabels).map(([value, label]) => h('option', {
    value, text: label, selected: controller.statusFilter === value,
  })));

  const tags = controller.allTags;
  const hasMore = tags.length > COLLAPSED_TAG_COUNT;
  const shown = local.allTagsShown || !hasMore
      ? tags
      : tags.slice(0, COLLAPSED_TAG_COUNT);

  return appCard({
    className: 'filters',
    children: [
      h('div.filters__row',
        h('div.filters__field.filters__field--grow',
          fieldLabel(t.filterSearchLabel),
          h('div.text-field__wrap', icon('search', 18), search)),
        h('div.filters__field.filters__field--status',
          fieldLabel(t.filterStatusLabel), select)),
      tags.length === 0 ? null : h('div.filters__tags',
          fieldLabel(t.filterTagsLabel),
          h('div.pill-row',
            tagPill({
              label: t.filterAllTags,
              active: controller.tagFilter === null,
              onTap: () => controller.setTagFilter(null),
            }),
            shown.map((tag) => tagPill({
              label: tag,
              active: controller.tagFilter === tag,
              onTap: () => controller.setTagFilter(tag),
            }))),
          !hasMore ? null : actionButton({
            text: local.allTagsShown ? t.showFewerTags : t.showMoreTags,
            variant: 'ghost',
            onPressed: () => {
              local.allTagsShown = !local.allTagsShown;
              controller.notifyRerender();
            },
          })),
    ],
  });
}

// ── דף קטגוריה ───────────────────────────────────────────────────────────────

function categorySections(controller) {
  const t = S.plugins;
  const category = controller.openCategory;
  if (category === null) return [];

  const plugins = controller.pluginsIn(category);
  const sections = [h('div.store__pad.store__pad--section', sectionHeader({
    eyebrowText: t.categoriesTitle,
    title: category.name,
    description: category.description ||
        (category.pluginCount === 1 ? t.categoryOnePlugin
                                    : t.categoryPluginCount(
                                          category.pluginCount)),
  }))];

  if (plugins.length === 0) {
    sections.push(h('div.store__pad', emptyState({
      title: t.emptyCategoryTitle,
      body: t.emptyCategoryBody,
      action: actionButton({
        text: t.allPluginsButton,
        variant: 'neutral',
        iconName: 'apps-list',
        onPressed: () => controller.showAllPlugins(),
      }),
    })));
  } else {
    sections.push(h('div.store__pad', grid(controller, plugins)));
  }
  return sections;
}

// ── מצבים ריקים ──────────────────────────────────────────────────────────────

function neverSyncedState(controller, readOnly) {
  const t = S.plugins;
  return emptyState({
    title: t.neverSyncedTitle,
    body: readOnly ? S.readOnlyDrive.downloadsDisabledSnack : t.neverSyncedBody,
    action: readOnly ? null : actionButton({
      text: t.syncButton,
      variant: 'recommended',
      iconName: 'arrow-sync',
      onPressed: () => void runSync(controller),
    }),
  });
}

function allInstalledState(controller) {
  const t = S.plugins;
  return emptyState({
    title: t.allInstalledTitle,
    body: t.allInstalledBody,
    action: actionButton({
      text: t.showInstalledButton,
      variant: 'neutral',
      onPressed: () => controller.setHideInstalled(false),
    }),
  });
}

function noResultsState(controller) {
  const t = S.plugins;
  // כשהמתג הוא שהסתיר הכול, ההסבר הנכון הוא אחר.
  const hiddenByToggle = controller.hideInstalled &&
      controller.plugins.some(
          (p) => p.matchesQuery(controller.search) &&
              controller.statusOf(p) === InstallStatus.upToDate);
  if (hiddenByToggle) return allInstalledState(controller);

  return emptyState({
    title: t.noResultsTitle,
    body: t.noResultsBody,
    action: actionButton({
      text: t.showInstalledButton,
      variant: 'ghost',
      onPressed: () => controller.setHideInstalled(false),
    }),
  });
}

// ── רשת הכרטיסים ─────────────────────────────────────────────────────────────

function grid(controller, plugins) {
  return h('div.grid', plugins.map((plugin) => storeCard(controller, plugin)));
}

/** כרטיס תוסף בודד ברשת. פורט של `PluginStoreCard`. */
function storeCard(controller, plugin) {
  const t = S.plugins;
  const status = controller.statusOf(plugin);
  const target = controller.targetOf(plugin);
  const busy = local.busyPluginId === plugin.id;
  const supportsInstall = target?.supportsDirectInstall ??
      plugin.supportsDirectInstall;

  const thumb = h('div.card__media',
      thumbnail({relativePath: plugin.imagePath}),
      plugin.isFeatured ? h('div.card__featured', pluginBadge({
        label: t.badgeFeaturedShort,
        iconName: 'star',
        emphasized: true,
      })) : null);

  return appCard({
    className: 'plugin-card',
    onTap: () => controller.openPlugin(plugin.id),
    children: [
      thumb,
      // ⚠️ הסדר כאן אינו שרירותי: שבב ההתקנה הוא מידע שאסור להיעלם,
      // וגלולת הדירוג היא קישוט — ולכן היא האחרונה.
      h('div.badge-row',
        pluginBadge({label: pluginStatusLabel(target?.status ?? plugin.status),
                     emphasized: true}),
        // הגרסה שתותקן כאן, לא בהכרח האחרונה שפורסמה.
        pluginBadge({label: t.pluginVersionBadge(controller.versionOf(plugin))}),
        pluginBadge({label: String(plugin.downloadCount),
                     iconName: 'arrow-download'}),
        installChip({status, compact: true}),
        // כמו באתר: תוסף שטרם דורג אינו מציג גלולת דירוג ריקה.
        plugin.ratingCount > 0 ? ratingBadge(plugin) : null),
      h('h3.plugin-card__name', {text: plugin.name}),
      h('p.plugin-card__desc', {text: plugin.shortDescription}),
      plugin.tags.length === 0 ? null : h('div.pill-row.pill-row--clamped',
          plugin.tags.slice(0, 4).map((tag) => tagPill({label: tag}))),
      h('div.plugin-card__spacer'),
      h('div.plugin-card__actions',
        actionButton({
          text: t.saveButton,
          variant: 'neutral',
          iconName: 'save',
          loading: busy,
          className: 'grow',
          onPressed: controller.hasFileFor(plugin)
              ? (event) => {
                  event.stopPropagation();
                  void saveCopy(controller, plugin);
                }
              : null,
        }),
        // בלי בילד תואם אין מה להתקין — הכפתור כבוי, והשבב למעלה אומר למה.
        !supportsInstall ? null : actionButton({
          text: t.installButton,
          variant: 'recommended',
          iconName: 'arrow-download',
          loading: busy,
          className: 'grow',
          onPressed: target === null ? null : (event) => {
            event.stopPropagation();
            void install(controller, plugin);
          },
        })),
      h('hr.plugin-card__rule'),
      h('div.plugin-card__footer',
        h('span.plugin-card__link', {text: t.cardDetailsLink}),
        h('span.plugin-card__date', {
          text: t.cardUpdatedOn(formatHebrewDate(
              plugin.originalDate || plugin.updatedAt)),
        })),
    ],
  });
}

// ── דף פרטי התוסף ────────────────────────────────────────────────────────────

function detailHeader(controller, plugin) {
  return h('div.detail-header',
      actionButton({
        text: S.plugins.backToStore,
        variant: 'ghost',
        // בעברית "חזרה" היא ימינה.
        iconName: 'arrow-right',
        onPressed: () => controller.closePlugin(),
      }),
      h('span.detail-header__name', {text: plugin.name}));
}

function detailBody(controller, plugin) {
  const t = S.plugins;
  const panels = [heroPanel(controller, plugin)];

  const info = infoPanel(controller, plugin);
  const tags = plugin.tags.length === 0 ? null : panel({
    title: t.tagsPanelTitle,
    className: 'panel--tags',
    children: [h('div.pill-row', plugin.tags.map((tag) => tagPill({
      label: tag,
      onTap: () => {
        controller.setTagFilter(tag);
        controller.showAllPlugins();
      },
    })))],
  });
  panels.push(tags === null ? info
                            : h('div.detail__two-col', info, tags));

  // גם בלי דירוגים הסעיף מוצג ואומר זאת — כמו באתר.
  panels.push(panel({title: t.ratingPanelTitle,
                     children: [ratingSummary(plugin)]}));

  const shots = plugin.screenshotPaths;
  if (shots.length > 0) {
    panels.push(panel({
      title: t.screenshotsPanelTitle,
      children: [h('div.shots', shots.map((relative, index) => h(
          'button.shots__item',
          {type: 'button', onclick: () => showScreenshots({paths: shots,
                                                           initialIndex: index})},
          h('img', {src: assetUrl(relative), alt: '', loading: 'lazy'}))))],
    }));
  }

  return h('div.store__pad.detail', panels);
}

function heroPanel(controller, plugin) {
  const t = S.plugins;
  const target = controller.targetOf(plugin);
  const busy = local.busyPluginId === plugin.id;
  const supportsInstall = target?.supportsDirectInstall ??
      plugin.supportsDirectInstall;

  return appCard({
    className: 'detail-hero',
    children: [
      h('div.detail-hero__media',
        thumbnail({relativePath: plugin.imagePath, aspect: '4 / 3'})),
      h('div.detail-hero__text',
        h('h1.detail-hero__name', {text: plugin.name}),
        h('p.detail-hero__desc', {text: plugin.description}),
        h('div.badge-row',
          pluginBadge({label: pluginStatusLabel(target?.status ?? plugin.status),
                       emphasized: true}),
          pluginBadge({label: t.pluginVersionBadge(
              controller.versionOf(plugin))}),
          pluginBadge({label: t.downloadsBadge(plugin.downloadCount),
                       iconName: 'arrow-download'}),
          // באתר הדירוג מופיע פעמיים בעמוד: כגלולה כאן, וכסעיף מלא למטה.
          plugin.ratingCount > 0 ? ratingBadge(plugin) : null,
          plugin.isFeatured ? pluginBadge({label: t.badgeFeatured,
                                           iconName: 'star'}) : null,
          installChip({
            status: controller.statusOf(plugin),
            installedVersion: controller.installedVersionOf(plugin),
          })),
        plugin.categorySlugs.length === 0 ? null : h('div.pill-row',
            plugin.categorySlugs.map((slug) => tagPill({
              label: controller.categoryName(slug),
              onTap: () => controller.showCategory(slug),
            }))),
        h('div.detail-hero__actions',
          !supportsInstall ? null : actionButton({
            text: t.directInstallButton,
            variant: 'recommended',
            iconName: 'arrow-download',
            loading: busy,
            onPressed: target === null
                ? null : () => void install(controller, plugin),
          }),
          actionButton({
            text: t.saveButton,
            variant: 'neutral',
            iconName: 'save',
            loading: busy,
            onPressed: controller.hasFileFor(plugin)
                ? () => void saveCopy(controller, plugin) : null,
          }),
          !plugin.homepage ? null : actionButton({
            text: t.sourcePageButton,
            variant: 'ghost',
            iconName: 'open',
            onPressed: () => void controller.openHomepage(plugin.homepage),
          }))),
    ],
  });
}

function infoPanel(controller, plugin) {
  const t = S.plugins;
  // כל השדות התלויי-גרסה מתארים את הבילד שיותקן כאן, לא את החי באתר.
  const target = controller.targetOf(plugin);
  const localFile = plugin.localFileFor(target?.version);
  const version = controller.versionOf(plugin);

  const cells = [
    {label: t.infoVersion, value: version || t.valueUnspecifiedFeminine},
    {label: t.infoStatus,
     value: pluginStatusLabel(target?.status ?? plugin.status)},
    {label: t.infoAuthor,
     value: plugin.author || t.valueUnspecifiedMasculine},
    {label: t.infoUpdated,
     value: formatHebrewDate(plugin.originalDate || plugin.updatedAt)},
    {label: t.infoNetwork,
     value: (target?.requiresNetwork ?? plugin.requiresNetwork)
         ? t.infoNetworkRequired : t.infoNetworkNotRequired},
    {label: t.infoCompatibility, value: compatibilityValue(plugin, target),
     wide: true},
    {label: t.infoLocalFile,
     value: localFile === null
         ? t.infoLocalFileMissing
         : t.localFileDescription(localFile.fileName,
                                  formatSize(localFile.size)),
     wide: true},
  ];

  return panel({
    title: t.infoPanelTitle,
    className: 'panel--info',
    children: [h('div.info-grid', cells.map(infoCell))],
  });
}

/** טווח התאימות של הבילד שנבחר; בלי בילד תואם — של התוסף בכללותו. */
function compatibilityValue(plugin, target) {
  const t = S.plugins;
  const from = target?.compatibleWith ?? plugin.compatibleWith;
  const to = target?.maxAppVersion ?? plugin.maxAppVersion;
  if (!from) return t.valueUnspecifiedFeminine;
  return to === null || to === undefined ? from : t.compatibilityRange(from, to);
}

/**
 * גודל ידוע מוצג דרך `formatBytes` המשותף — כפילות כאן החזירה יחידות
 * קבועות באנגלית בתוך משפט עברי.
 */
const formatSize = (bytes) =>
    bytes <= 0 ? S.plugins.sizeUnknown : formatBytes(bytes);

/**
 * סעיף "דירוג המשתמשים" — הממוצע, הכוכבים, מספר המדרגים והפילוח לפי
 * ציון. פורט של `PluginRatingSummary`.
 *
 * **תצוגה בלבד.** הדירוג נעשה באתר ודורש חשבון; המראה רק נושאת את
 * המספרים אל המחשב הלא-מקוון.
 */
function ratingSummary(plugin) {
  const t = S.plugins;
  const rated = plugin.ratingCount > 0;

  const average = h('div.rating__average',
      rated ? h('div.rating__value', {text: formatRating(plugin.ratingAvg)})
            : null,
      ratingStars({value: rated ? plugin.ratingAvg : 0, size: 22}),
      h('div.rating__count',
        {text: rated ? t.ratingCountLabel(plugin.ratingCount)
                     : t.ratingEmpty}),
      plugin.ratingVerifiedCount > 0
          ? h('div', {title: t.ratingVerifiedTooltip},
              statusChip({kind: 'ok',
                          label: t.ratingVerifiedLabel(
                              plugin.ratingVerifiedCount)}))
          : null);

  // בלי דירוגים אין מה לפלח — נשארת רק ההודעה "עדיין לא דורג".
  if (!rated) return average;

  const rows = [];
  for (let score = 5; score >= 1; score--) {
    // פילוח קצר (קטלוג פגום) נקרא כאפס ולא מפיל את השורה.
    const count = score <= plugin.ratingBreakdown.length
        ? plugin.ratingBreakdown[score - 1] : 0;
    const fraction = plugin.ratingCount <= 0 ? 0 : count / plugin.ratingCount;
    rows.push(h('div.rating__row',
        h('span.rating__score', h('span', {text: String(score)}),
          icon('star-filled-16', 13)),
        h('span.rating__meter',
          h('span.rating__meter-fill',
            {style: {width: `${fraction * 100}%`}})),
        h('span.rating__row-count', {text: String(count)})));
  }

  return h('div.rating', average, h('div.rating__breakdown', rows));
}

// ── פעולות ───────────────────────────────────────────────────────────────────

async function saveCopy(controller, plugin) {
  const destPath = await controller.manager.sys.saveDialog(
      controller.suggestedFileName(plugin));
  // ביטול אינו שגיאה.
  if (destPath === null) return;

  local.busyPluginId = plugin.id;
  controller.notifyRerender();
  const result = await controller.saveCopy(plugin, destPath);
  local.busyPluginId = null;
  controller.notifyRerender();

  if (result.success) showSuccess(S.plugins.saveDoneSnack);
  else showError(result.error ?? S.plugins.saveFailedSnack);
}

async function install(controller, plugin) {
  local.busyPluginId = plugin.id;
  controller.notifyRerender();
  const result = await controller.install(plugin);
  local.busyPluginId = null;
  controller.notifyRerender();

  // ההצלחה כאן היא של ה**מסירה** בלבד — ההתקנה נגמרת בחלון של אוצריא,
  // וההודעה על סיומה מגיעה מהסריקה שרצה ברקע.
  if (result.success) showSnack(S.plugins.installOpenedSnack(plugin.name));
  else showError(result.error ?? S.plugins.installFailedSnack);
}

/** מאפס את מצב התצוגה המקומי — נקרא בניווט. */
export function resetLocalViewState() {
  local.allFeaturedShown = false;
  local.allTagsShown = false;
}
