// app.js — boot, hash router, view switching, settings view.

import {
  initStore,
  getSettings,
  saveSettings,
  syncConfigured,
  pullFromGist,
  pushToGist,
  onSyncStatus,
  importSnapshot,
  getLastSyncError,
} from './modules/store.js';
import { downloadBackup, startBackupClock } from './modules/backup.js';
import { renderDashboard, renderContinue, renderCompletedLessons, renderDailyActivity } from './modules/dashboard.js';
import { renderTopics, renderTopic, renderLesson } from './modules/lessons.js';
import { renderQuiz } from './modules/quiz.js';
import { renderCoach } from './modules/coach.js';
import { renderSaved } from './modules/saved.js';
import { renderReview } from './modules/review.js';
import { seedPrebuiltCourses } from './modules/prebuiltContent.js';
import { hasApiKey } from './modules/ai.js';
import { el, clear, toast, navigate } from './modules/ui.js';

const view = document.getElementById('view');

// Keep in sync with the CACHE suffix in sw.js — bumped on every deploy.
const APP_VERSION = 'v39';

// ---------- theme ----------

const darkQuery = window.matchMedia('(prefers-color-scheme: dark)');

export const ACCENTS = ['blue', 'teal', 'indigo', 'plum', 'amber'];

// Resolve the Auto/Light/Dark setting + accent to attributes on <html>.
function applyTheme() {
  const s = getSettings();
  const pref = s.theme || 'auto';
  const dark = pref === 'dark' || (pref === 'auto' && darkQuery.matches);
  document.documentElement.dataset.theme = dark ? 'dark' : 'light';
  document.documentElement.dataset.accent = ACCENTS.includes(s.accent) ? s.accent : 'blue';
  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta) meta.setAttribute('content', dark ? '#0f1513' : '#f7f9f8');
}

darkQuery.addEventListener('change', () => {
  if ((getSettings().theme || 'auto') === 'auto') applyTheme();
});

// Route table: hash pattern → handler. `:param` captured positionally.
const routes = [
  { re: /^#\/dashboard$/, tab: 'dashboard', fn: () => renderDashboard(view) },
  { re: /^#\/topics$/, tab: 'topics', fn: () => renderTopics(view) },
  { re: /^#\/topic\/(.+)$/, tab: 'topics', fn: (m) => renderTopic(view, { id: m[1] }) },
  { re: /^#\/lesson\/(.+)$/, tab: 'topics', fn: (m) => renderLesson(view, { id: m[1] }) },
  { re: /^#\/quiz\/(.+)$/, tab: 'topics', fn: (m) => renderQuiz(view, { id: m[1] }) },
  { re: /^#\/coach$/, tab: 'coach', fn: () => renderCoach(view) },
  { re: /^#\/saved$/, tab: 'dashboard', fn: () => renderSaved(view) },
  { re: /^#\/reading$/, tab: 'dashboard', fn: () => renderContinue(view) },
  { re: /^#\/completed$/, tab: 'dashboard', fn: () => renderCompletedLessons(view) },
  { re: /^#\/activity$/, tab: 'dashboard', fn: () => renderDailyActivity(view) },
  { re: /^#\/review$/, tab: 'review', fn: () => renderReview(view) },
  { re: /^#\/settings$/, tab: 'settings', fn: () => renderSettings(view) },
];

function setActiveTab(tab) {
  document.querySelectorAll('.tab').forEach((t) => {
    t.classList.toggle('active', t.dataset.tab === tab);
  });
}

async function router() {
  const hash = location.hash || '#/dashboard';
  const match = routes.find((r) => r.re.test(hash));
  if (!match) return navigate('#/dashboard');
  setActiveTab(match.tab);
  window.scrollTo(0, 0);
  try {
    await match.fn(hash.match(match.re));
  } catch (err) {
    console.error(err);
    clear(view).append(el('p', { class: 'empty' }, `Something broke: ${err.message}`));
  }
}

// ---------- Settings view ----------

function renderSettings(root) {
  clear(root);
  const s = getSettings();

  const apiKey = el('input', { class: 'input', type: 'password', placeholder: 'sk-ant-...', value: s.apiKey || '' });
  const gistToken = el('input', { class: 'input', type: 'password', placeholder: 'GitHub token (gist scope)', value: s.gistToken || '' });
  const gistId = el('input', { class: 'input', placeholder: 'Gist ID', value: s.gistId || '' });

  const status = el('span', { class: 'sync-dot ' + (syncConfigured() ? 'on' : 'off') });
  const statusText = el('span', { class: 'muted' }, syncConfigured() ? 'Sync configured' : 'Local-only (no sync)');

  const importFile = el('input', { type: 'file', accept: 'application/json,.json', style: 'display:none', onchange: onImport });
  const restoreFile = el('input', { type: 'file', accept: 'application/json,.json', style: 'display:none', onchange: onRestore });

  const themePref = s.theme || 'auto';
  const themeBtn = (value, label) =>
    el('button', {
      class: 'btn seg-btn' + (themePref === value ? ' active' : ''),
      onclick: () => {
        saveSettings({ theme: value });
        applyTheme();
        renderSettings(root);
      },
    }, label);

  root.append(
    el('header', { class: 'view-head' }, [el('h1', {}, 'Settings')]),

    el('section', { class: 'panel' }, [
      el('h4', {}, 'Appearance'),
      el('div', { class: 'seg' }, [
        themeBtn('auto', 'Auto'),
        themeBtn('light', 'Light'),
        themeBtn('dark', 'Dark'),
      ]),
      el('label', { class: 'field-label' }, 'Accent color'),
      el('div', { class: 'accent-row' }, ACCENTS.map((a) =>
        el('button', {
          class: 'accent-dot accent-' + a + ((s.accent || 'blue') === a ? ' active' : ''),
          title: a,
          onclick: () => {
            saveSettings({ accent: a });
            applyTheme();
            renderSettings(root);
          },
        })
      )),
      el('p', { class: 'muted small' }, 'Auto follows your device\'s light/dark setting. Accent recolors the whole app.'),
    ]),

    el('section', { class: 'panel' }, [
      el('h4', {}, 'Claude API'),
      el('label', { class: 'field-label' }, 'API key (stored only on this device)'),
      apiKey,
      el('p', { class: 'muted small' }, 'Used for direct browser calls to api.anthropic.com. Never leaves your device except to Anthropic.'),
    ]),

    el('section', { class: 'panel' }, [
      el('h4', {}, 'Gist sync (optional)'),
      el('div', { class: 'sync-status' }, [status, statusText]),
      ...(getLastSyncError()
        ? [
            el('p', { class: 'small sync-error' }, `⚠ Last sync failed: ${getLastSyncError()}`),
            ...(/40[13]/.test(getLastSyncError())
              ? [el('p', { class: 'muted small' }, 'A 401/403 usually means the GitHub token expired or was revoked. Generate a new token with the gist scope and save it here, then tap Sync now.')]
              : []),
          ]
        : []),
      el('label', { class: 'field-label' }, 'GitHub token (gist scope)'),
      gistToken,
      el('label', { class: 'field-label' }, 'Gist ID'),
      gistId,
      el('p', { class: 'muted small' }, 'Leave blank to run fully local. When set, your data mirrors to a private Gist and merges across devices.'),
    ]),

    el('section', { class: 'panel' }, [
      el('h4', {}, 'Backup'),
      el('p', { class: 'muted small' }, 'Export a full copy of your data to a file. Import merges a backup back in (only adds/refreshes, never deletes). Restore makes a backup authoritative — it overwrites current data with the file, for recovering after data loss.'),
      el('div', { class: 'settings-actions' }, [
        el('button', { class: 'btn', onclick: onExport }, 'Export JSON'),
        el('button', { class: 'btn', onclick: () => importFile.click() }, 'Import JSON'),
        el('button', { class: 'btn', onclick: onRestoreClick }, 'Restore…'),
        importFile,
        restoreFile,
      ]),
    ]),

    el('div', { class: 'settings-actions' }, [
      el('button', { class: 'btn btn-primary', onclick: onSave }, 'Save'),
      el('button', { class: 'btn', onclick: onSyncNow, disabled: syncConfigured() ? null : 'disabled' }, 'Sync now'),
    ]),

    el('p', { class: 'muted small app-version' }, APP_VERSION)
  );

  async function onSave() {
    saveSettings({
      apiKey: apiKey.value.trim(),
      gistToken: gistToken.value.trim(),
      gistId: gistId.value.trim(),
    });
    toast('Settings saved', 'success');
    // If sync is configured, verify the credentials right now instead of
    // letting a dead token fail silently in the background for days — a live
    // pull flips the header dot and surfaces any error inline immediately.
    if (syncConfigured()) await pullFromGist();
    renderSettings(root);
  }

  async function onImport() {
    const file = importFile.files?.[0];
    if (!file) return;
    importFile.value = ''; // allow re-importing the same file later
    try {
      const snapshot = JSON.parse(await file.text());
      const { total } = await importSnapshot(snapshot);
      toast(`Imported — ${total} records now in the app`, 'success');
      // Push the restored data up so the cloud copy matches (guarded).
      if (syncConfigured()) await pushToGist();
      navigate('#/dashboard');
    } catch (err) {
      toast(`Import failed — ${err.message}`, 'error');
    }
  }

  async function onRestoreClick() {
    // Restore overwrites current data — take a safety copy of the present state
    // first (so a wrong file is undoable), then let them pick the backup.
    if (!confirm('Restore overwrites your current data with the file you pick, and makes it the source of truth for sync.\n\nA copy of your CURRENT data will download first as a safety net. Continue?')) return;
    await onExport();
    restoreFile.click();
  }

  async function onRestore() {
    const file = restoreFile.files?.[0];
    if (!file) return;
    restoreFile.value = '';
    try {
      const snapshot = JSON.parse(await file.text());
      const { total } = await importSnapshot(snapshot, { restore: true });
      toast(`Restored — ${total} records now in the app`, 'success');
      if (syncConfigured()) await pushToGist();
      navigate('#/dashboard');
    } catch (err) {
      toast(`Restore failed — ${err.message}`, 'error');
    }
  }

  async function onSyncNow() {
    if (!syncConfigured()) return;
    toast('Syncing…');
    // pushToGist pulls (and merges) first, then pushes — one call is the
    // full round trip. It aborts rather than pushing if the pull fails.
    const ok = await pushToGist();
    if (ok) toast('Synced', 'success');
    else toast(`Sync failed — ${getLastSyncError() || 'see console'}`, 'error');
    renderSettings(root);
  }

  async function onExport() {
    await downloadBackup(); // full snapshot + stamps the backup-reminder clock
  }
}

// ---------- boot ----------

async function boot() {
  applyTheme();

  // Register the service worker FIRST: even if the rest of boot crashes,
  // the browser can still pick up a fixed version on the next load.
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('./sw.js').catch((e) => console.warn('SW failed', e));
  }

  // Ask the browser to mark our storage persistent. Without this, the OS may
  // silently evict IndexedDB under storage pressure — even for an installed
  // PWA in daily use — which presents as "the app reset to zero".
  if (navigator.storage?.persist) {
    navigator.storage.persist().then((granted) => {
      if (!granted) console.warn('Persistent storage not granted; data may be evicted under storage pressure');
    }).catch(() => {});
  }

  // Reflect sync status in the header dot.
  onSyncStatus((st) => {
    const dot = document.getElementById('header-sync');
    if (!dot) return;
    dot.className = 'header-sync ' + st;
    dot.title = st === 'error'
      ? `Sync failing — ${getLastSyncError() || 'unknown error'}. Check Settings.`
      : `Sync: ${st}`;
  });

  // A storage failure must degrade, never blank the app.
  try {
    await initStore();
    // Preloaded courses: real lessons authored ahead of time, seeded straight
    // into the store so these topics need no Claude API call to read.
    await seedPrebuiltCourses();
  } catch (err) {
    console.error('initStore failed', err);
    toast(`Storage error — some data may be unavailable (${err?.message || err})`, 'error');
  }

  // Start the weekly backup-reminder clock (no-op if already running).
  startBackupClock();

  // First-run nudge toward settings if nothing is configured.
  if (!hasApiKey() && !location.hash) {
    navigate('#/settings');
  }

  window.addEventListener('hashchange', router);
  await router();
}

boot();
