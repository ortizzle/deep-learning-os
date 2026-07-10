// backup.js — manual backup helper + a gentle "time to back up" reminder.
// Sync is the primary safety net, but a local file is the one backup that
// survives an expired token, a dead Gist, or browser storage eviction — so we
// nudge the user to grab one every so often.

import { exportSnapshot, getSettings, saveSettings } from './store.js';
import { el } from './ui.js';

const DAY = 24 * 60 * 60 * 1000;
const REMIND_AFTER = 7 * DAY;  // nag once a week without a backup
const SNOOZE = 3 * DAY;        // dismissing quiets it for a few days

// Download a full (self-contained) snapshot and stamp the backup clock.
export async function downloadBackup() {
  const snapshot = await exportSnapshot();
  const blob = new Blob([JSON.stringify(snapshot, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const stamp = new Date().toISOString().slice(0, 10);
  const a = el('a', { href: url, download: `deep-learning-os-backup-${stamp}.json` });
  a.click();
  URL.revokeObjectURL(url);
  saveSettings({ lastBackupAt: new Date().toISOString(), backupSnoozeUntil: null });
}

// Start the weekly clock the first time we ever see this device, so a brand-new
// (or freshly recovered) app doesn't nag on day one — only after a real week
// with no export.
export function startBackupClock() {
  if (!getSettings().lastBackupAt) saveSettings({ lastBackupAt: new Date().toISOString() });
}

// Days since the last backup if a reminder is due (and not snoozed); else null.
export function backupDueDays() {
  const s = getSettings();
  if (!s.lastBackupAt) return null;
  const nowMs = Date.now();
  if (s.backupSnoozeUntil && nowMs < Date.parse(s.backupSnoozeUntil)) return null;
  const age = nowMs - Date.parse(s.lastBackupAt);
  return age >= REMIND_AFTER ? Math.floor(age / DAY) : null;
}

export function snoozeBackup() {
  saveSettings({ backupSnoozeUntil: new Date(Date.now() + SNOOZE).toISOString() });
}

// A dismissible reminder banner, or null when nothing is due. `onChange` is
// called after Back up now / dismiss so the caller can re-render.
export function backupBanner(onChange) {
  const days = backupDueDays();
  if (days == null) return null;
  return el('div', { class: 'backup-banner' }, [
    el('span', { class: 'backup-banner-text' }, `🗄️ Last backup was ${days} day${days === 1 ? '' : 's'} ago.`),
    el('div', { class: 'backup-banner-actions' }, [
      el('button', {
        class: 'btn btn-primary btn-sm',
        onclick: async () => { await downloadBackup(); onChange?.(); },
      }, 'Back up now'),
      el('button', {
        class: 'btn btn-sm',
        onclick: () => { snoozeBackup(); onChange?.(); },
        title: 'Remind me later',
      }, 'Later'),
    ]),
  ]);
}
