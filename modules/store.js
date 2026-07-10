// store.js — local-first data layer: IndexedDB + optional Gist sync.
// All reads/writes go through here. If no Gist token is configured the app
// runs fully local; sync is a transparent mirror on top.

const DB_NAME = 'deep-learning-os';
const DB_VERSION = 4; // v2: 'highlights'; v3: 'habits'+'tasks'; v4: 'tombstones'
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
  'tombstones',
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
  // Record a tombstone so this deletion survives sync — without it, the
  // next pull merges the still-present remote copy right back in (newest-
  // updatedAt-wins has no concept of "gone").
  if (store !== 'tombstones') {
    await put('tombstones', { id: `${store}:${id}`, store, recordId: id, deletedAt: now() });
  }
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
    // Epoch, NOT now(): a freshly-materialized empty profile must always LOSE
    // the newest-updatedAt-wins merge to a real synced profile. Stamping it
    // with now() (as this used to) made the empty default outrank the real
    // remote one whenever local storage had been cleared — the app came back
    // "at zero", and the next debounced push then overwrote the Gist with the
    // zeros, propagating the reset to every device. The first real activity
    // (touchActivity → saveProfile) bumps this to now().
    updatedAt: new Date(0).toISOString(),
  };
}

export async function getProfile() {
  let p = await get('profile', PROFILE_ID);
  if (!p) {
    p = defaultProfile();
    // touch:false preserves the epoch updatedAt above — do NOT restamp to now().
    await put('profile', p, { touch: false });
  }
  return p;
}

export async function saveProfile(profile) {
  return put('profile', { ...profile, id: PROFILE_ID });
}

// Serialized read-modify-write for the profile singleton. Streak bumps,
// reading-time flushes, and day-close checks all mutate the same record from
// independent async flows; each doing its own get→mutate→save meant whichever
// landed last silently reverted the others' fields (a lost streak increment,
// vanished learningMinutes). All profile mutations go through here instead.
let profileChain = Promise.resolve();
export function updateProfile(mutate) {
  const run = profileChain.then(async () => {
    const p = await getProfile();
    const result = await mutate(p);
    if (result === false) return p; // mutation declined — nothing to save
    return saveProfile(result || p);
  });
  profileChain = run.catch(() => {}); // a failed mutation must not wedge the chain
  return run;
}

// A profile that has never recorded any activity — i.e. the default that
// getProfile() mints into an empty store. Used by mergeSnapshot to make sure
// a freshly-wiped device's zeroed profile never outranks a real one.
function pristineProfile(p) {
  return (
    !p.lastActiveDate &&
    !(p.xp > 0) &&
    !(p.streak > 0) &&
    !(p.learningMinutes > 0) &&
    !(p.achievements || []).length &&
    !(p.goals || []).length
  );
}

// ---------- snapshot (versioned, migration-ready) ----------

export async function exportSnapshot() {
  const data = {};
  for (const name of STORES) data[name] = await getAll(name);
  return { schemaVersion: SCHEMA_VERSION, updatedAt: now(), data };
}

// Restore from an Export JSON file. Merges (never wipes) using the same
// tombstone-aware, newest-wins rules as sync, so importing a backup into a
// blank app brings everything back, and importing into a populated app can
// only add/refresh — it can't destroy newer local edits. Returns a small
// summary for the toast; throws on a malformed file.
export async function importSnapshot(snapshot) {
  if (!snapshot || typeof snapshot !== 'object' || !snapshot.data) {
    throw new Error('Not a Deep Learning OS backup file');
  }
  await mergeSnapshot(snapshot);
  return { total: countRecords(await exportSnapshot()) };
}

// Merge an incoming snapshot: newest updatedAt wins per record, EXCEPT
// tombstoned records — a deletion (locally or on another device) is never
// resurrected by a later merge, unless a genuinely newer edit exists.
export async function mergeSnapshot(snapshot) {
  if (!snapshot || !snapshot.data) return;
  // Future: if snapshot.schemaVersion < SCHEMA_VERSION, migrate here.

  // Tombstones merge first, so we know what NOT to bring back.
  for (const t of snapshot.data.tombstones || []) {
    if (!t || !t.id) continue;
    const existing = await get('tombstones', t.id);
    if (!existing || (t.updatedAt || '') > (existing.updatedAt || '')) {
      await put('tombstones', t, { touch: false });
    }
  }
  const tombstones = await getAll('tombstones');
  const tombSet = new Set(tombstones.map((t) => t.id)); // `${store}:${recordId}`

  for (const name of STORES) {
    if (name === 'tombstones') continue;
    const incoming = snapshot.data[name] || [];
    for (const rec of incoming) {
      if (!rec || !rec.id || tombSet.has(`${name}:${rec.id}`)) continue;
      const existing = await get(name, rec.id);
      let wins = !existing || (rec.updatedAt || '') > (existing.updatedAt || '');
      // Profiles additionally merge on CONTENT: recorded activity always
      // beats an untouched default, regardless of timestamps. Pre-v34 code
      // stamped freshly-minted empty profiles with now(), so a wiped device
      // can carry a "newer" zeroed profile on either side of a merge — never
      // let it beat the real one.
      if (name === 'profile' && existing) {
        const inPristine = pristineProfile(rec);
        const exPristine = pristineProfile(existing);
        if (inPristine !== exPristine) wins = exPristine;
      }
      if (wins) await put(name, rec, { touch: false });
    }
  }

  // Purge any local record whose tombstone is newer than its last edit —
  // covers a device that was offline with a stale copy when the deletion
  // happened elsewhere.
  for (const t of tombstones) {
    if (!t.store || !t.recordId) continue;
    const existing = await get(t.store, t.recordId);
    if (existing && (existing.updatedAt || '') <= (t.deletedAt || '')) {
      await reqToPromise((await tx(t.store, 'readwrite')).delete(t.recordId));
    }
  }
}

// ---------- Gist sync ----------

const GIST_FILENAME = 'deep-learning-os.json';
let syncTimer = null;
const syncListeners = new Set();

// Last sync failure, surfaced in Settings and the header dot's tooltip —
// sync rot must be loud, not a console.warn nobody reads.
let lastSyncError = null;
export function getLastSyncError() {
  return lastSyncError;
}

// Total user records across every store — used by importSnapshot to report how
// much data the app holds after a restore.
function countRecords(snapshot) {
  if (!snapshot || !snapshot.data) return 0;
  return STORES.reduce((n, name) => n + (snapshot.data[name]?.length || 0), 0);
}

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

// Returns true only if the remote snapshot was fetched and merged.
export async function pullFromGist() {
  if (!syncConfigured()) return false;
  const { gistId } = getSettings();
  emitSync('syncing');
  try {
    const gist = await gistFetch(`/gists/${gistId}`);
    const file = gist.files && gist.files[GIST_FILENAME];
    if (file && file.content) {
      await mergeSnapshot(JSON.parse(file.content));
    }
    lastSyncError = null;
    emitSync('synced');
    return true;
  } catch (err) {
    console.warn('pullFromGist failed', err);
    lastSyncError = `Pull failed — ${err.message}`;
    emitSync('error');
    return false;
  }
}

export async function pushToGist() {
  if (!syncConfigured()) return false;
  const { gistId } = getSettings();
  // Merge remote first so a push can never clobber records this device
  // hasn't seen (e.g. content seeded from another machine). If the pull
  // FAILS we must abort, not push blind: a blind push replaces the Gist
  // with only what this device holds — on a freshly-wiped device that
  // overwrites the cloud backup with zeros and propagates the wipe.
  if (!(await pullFromGist())) return false;
  emitSync('syncing');
  try {
    const snapshot = await exportSnapshot();
    await gistFetch(`/gists/${gistId}`, {
      method: 'PATCH',
      body: JSON.stringify({
        files: { [GIST_FILENAME]: { content: JSON.stringify(snapshot) } },
      }),
    });
    lastSyncError = null;
    emitSync('synced');
    return true;
  } catch (err) {
    console.warn('pushToGist failed', err);
    lastSyncError = `Push failed — ${err.message}`;
    emitSync('error');
    return false;
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
  // Pull BEFORE ensuring the singleton: on a device whose local storage was
  // cleared (new device, cleared site data, or Safari's ~7-day PWA eviction),
  // this restores the real profile into the empty store first, so getProfile()
  // finds it instead of minting a fresh zeroed default. If the pull fails
  // (offline/error) we still fall back to the epoch-stamped default below,
  // which can never overwrite the good remote copy on a later sync.
  if (syncConfigured()) await pullFromGist();
  await getProfile(); // ensure singleton exists
}
