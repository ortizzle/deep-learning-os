// store.js — local-first data layer: IndexedDB + optional Gist sync.
// All reads/writes go through here. If no Gist token is configured the app
// runs fully local; sync is a transparent mirror on top.

const DB_NAME = 'deep-learning-os';
const DB_VERSION = 3; // v2: adds 'highlights'; v3: adds 'habits' + 'tasks'
export const SCHEMA_VERSION = 1;

// Object stores that hold user records. `profile` is a singleton (id: 'me').
export const STORES = [
  'topics',
  'lessons',
  'quizzes',
  'concepts',
  'coachSessions',
  'highlights',
  'habits',
  'tasks',
  'profile',
];

let dbPromise = null;

// ---------- tiny helpers ----------

export function uid() {
  return (
    Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 10)
  );
}

export function now() {
  return new Date().toISOString();
}

// localStorage-backed settings (token/key live only on this device).
const SETTINGS_KEY = 'dlos.settings';

export function getSettings() {
  try {
    return JSON.parse(localStorage.getItem(SETTINGS_KEY)) || {};
  } catch {
    return {};
  }
}

export function saveSettings(patch) {
  const next = { ...getSettings(), ...patch };
  localStorage.setItem(SETTINGS_KEY, JSON.stringify(next));
  return next;
}

// ---------- IndexedDB core ----------

function openDb() {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = (e) => {
      const db = e.target.result;
      for (const name of STORES) {
        if (!db.objectStoreNames.contains(name)) {
          db.createObjectStore(name, { keyPath: 'id' });
        }
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => {
      // VersionError: the DB was already upgraded by newer app code while
      // this (stale-cached) code asks for an older version. Open at the
      // current version instead — our stores are append-only, so a newer
      // schema is always a superset this code can safely use.
      if (req.error?.name === 'VersionError') {
        const retry = indexedDB.open(DB_NAME);
        retry.onsuccess = () => resolve(retry.result);
        retry.onerror = () => reject(retry.error);
      } else {
        reject(req.error);
      }
    };
  });
  return dbPromise;
}

function tx(store, mode) {
  return openDb().then((db) => db.transaction(store, mode).objectStore(store));
}

function reqToPromise(request) {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

export async function get(store, id) {
  return reqToPromise((await tx(store, 'readonly')).get(id));
}

export async function getAll(store) {
  return reqToPromise((await tx(store, 'readonly')).getAll());
}

// put() stamps createdAt/updatedAt and returns the stored record.
export async function put(store, record, { touch = true } = {}) {
  const rec = { ...record };
  if (!rec.id) rec.id = uid();
  if (!rec.createdAt) rec.createdAt = now();
  if (touch) rec.updatedAt = now();
  await reqToPromise((await tx(store, 'readwrite')).put(rec));
  scheduleSync();
  return rec;
}

export async function remove(store, id) {
  await reqToPromise((await tx(store, 'readwrite')).delete(id));
  scheduleSync();
}

// ---------- profile singleton ----------

const PROFILE_ID = 'me';

export function defaultProfile() {
  return {
    id: PROFILE_ID,
    xp: 0,
    level: 1,
    streak: 0,
    lastActiveDate: null,
    achievements: [],
    learningMinutes: 0,
    goals: [],
    createdAt: now(),
    updatedAt: now(),
  };
}

export async function getProfile() {
  let p = await get('profile', PROFILE_ID);
  if (!p) {
    p = defaultProfile();
    await put('profile', p);
  }
  return p;
}

export async function saveProfile(profile) {
  return put('profile', { ...profile, id: PROFILE_ID });
}

// ---------- snapshot (versioned, migration-ready) ----------

export async function exportSnapshot() {
  const data = {};
  for (const name of STORES) data[name] = await getAll(name);
  return { schemaVersion: SCHEMA_VERSION, updatedAt: now(), data };
}

// Merge an incoming snapshot: newest updatedAt wins per record.
export async function mergeSnapshot(snapshot) {
  if (!snapshot || !snapshot.data) return;
  // Future: if snapshot.schemaVersion < SCHEMA_VERSION, migrate here.
  for (const name of STORES) {
    const incoming = snapshot.data[name] || [];
    for (const rec of incoming) {
      if (!rec || !rec.id) continue;
      const existing = await get(name, rec.id);
      if (!existing || (rec.updatedAt || '') > (existing.updatedAt || '')) {
        await put(name, rec, { touch: false });
      }
    }
  }
}

// ---------- Gist sync ----------

const GIST_FILENAME = 'deep-learning-os.json';
let syncTimer = null;
const syncListeners = new Set();

export function onSyncStatus(fn) {
  syncListeners.add(fn);
  return () => syncListeners.delete(fn);
}

function emitSync(status) {
  syncListeners.forEach((fn) => fn(status));
}

export function syncConfigured() {
  const s = getSettings();
  return Boolean(s.gistToken && s.gistId);
}

async function gistFetch(path, options = {}) {
  const { gistToken } = getSettings();
  const res = await fetch(`https://api.github.com${path}`, {
    ...options,
    headers: {
      Authorization: `Bearer ${gistToken}`,
      Accept: 'application/vnd.github+json',
      'Content-Type': 'application/json',
      ...(options.headers || {}),
    },
  });
  if (!res.ok) {
    throw new Error(`Gist ${res.status}: ${await res.text()}`);
  }
  return res.json();
}

export async function pullFromGist() {
  if (!syncConfigured()) return;
  const { gistId } = getSettings();
  emitSync('syncing');
  try {
    const gist = await gistFetch(`/gists/${gistId}`);
    const file = gist.files && gist.files[GIST_FILENAME];
    if (file && file.content) {
      await mergeSnapshot(JSON.parse(file.content));
    }
    emitSync('synced');
  } catch (err) {
    console.warn('pullFromGist failed', err);
    emitSync('error');
  }
}

export async function pushToGist() {
  if (!syncConfigured()) return;
  const { gistId } = getSettings();
  emitSync('syncing');
  try {
    // Merge remote first so a push can never clobber records this device
    // hasn't seen (e.g. content seeded from another machine).
    await pullFromGist();
    const snapshot = await exportSnapshot();
    await gistFetch(`/gists/${gistId}`, {
      method: 'PATCH',
      body: JSON.stringify({
        files: { [GIST_FILENAME]: { content: JSON.stringify(snapshot) } },
      }),
    });
    emitSync('synced');
  } catch (err) {
    console.warn('pushToGist failed', err);
    emitSync('error');
  }
}

// Debounced push (~5s) after writes.
function scheduleSync() {
  if (!syncConfigured()) return;
  clearTimeout(syncTimer);
  syncTimer = setTimeout(() => pushToGist(), 5000);
}

// Called once on boot: open db, then pull remote if configured.
export async function initStore() {
  await openDb();
  await getProfile(); // ensure singleton exists
  if (syncConfigured()) await pullFromGist();
}
