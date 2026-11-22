// Persistenz: alles bleibt lokal im Browser (IndexedDB), nichts geht an einen Server.

const DB_NAME = 'lernpfad'; // alter interner Name, bleibt, damit gespeicherte Daten erhalten bleiben
const STORE = 'kv';
let dbPromise = null;
const memory = new Map(); // Fallback, falls IndexedDB blockiert ist (z. B. privater Modus)

function openDB() {
  if (!dbPromise) {
    dbPromise = new Promise((resolve, reject) => {
      try {
        const req = indexedDB.open(DB_NAME, 1);
        req.onupgradeneeded = () => req.result.createObjectStore(STORE);
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
      } catch (e) {
        reject(e);
      }
    }).catch(() => null);
  }
  return dbPromise;
}

async function idb(mode, fn) {
  const db = await openDB();
  if (!db) return null;
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, mode);
    const req = fn(tx.objectStore(STORE));
    tx.oncomplete = () => resolve(req ? req.result : undefined);
    tx.onerror = () => reject(tx.error);
  });
}

export async function kvGet(key) {
  try {
    const db = await openDB();
    if (!db) return memory.get(key);
    return await idb('readonly', (s) => s.get(key));
  } catch {
    return memory.get(key);
  }
}

export async function kvSet(key, value) {
  try {
    const db = await openDB();
    if (!db) return void memory.set(key, value);
    await idb('readwrite', (s) => s.put(value, key));
  } catch {
    memory.set(key, value);
  }
}

export async function kvDel(key) {
  try {
    const db = await openDB();
    if (!db) return void memory.delete(key);
    await idb('readwrite', (s) => s.delete(key));
  } catch {
    memory.delete(key);
  }
}

// ---------- App-Zustand ----------

export const MODELS = [
  { id: 'claude-opus-5-5', label: 'Claude Opus 5.5 (beste Qualität)' },
  { id: 'claude-sonnet-5-5', label: 'Claude Sonnet 5.5 (schneller, günstiger)' },
  { id: 'claude-haiku-5-5', label: 'Claude Haiku 5.5 (am günstigsten)' },
];

function defaultState() {
  return {
    version: 1,
    courses: [], // {id, name, color, createdAt}
    units: [], // {id, courseId, title, sourceName, createdAt}
    lessons: [], // {id, unitId, courseId, title, summary, exercises:[], completedAt, bestAccuracy, plays}
    srs: {}, // exerciseId -> {ease, interval, reps, lapses, due, last}
    sources: {}, // unitId -> gelesener Text des hochgeladenen Materials (für "Mehr Lektionen")
    stats: {
      xp: 0,
      xpByDay: {}, // 'YYYY-MM-DD' -> xp
      streak: 0,
      longestStreak: 0,
      lastActiveDay: null,
      freezes: 0,
      lessonsCompleted: 0,
      perfectLessons: 0,
      reviewsDone: 0,
      answersCorrect: 0,
      answersTotal: 0,
      uploads: 0,
    },
    achievements: {}, // id -> unlockedAt
    settings: {
      name: '',
      apiKey: '',
      model: 'claude-opus-5-5',
      dailyGoal: 30,
      unlockAll: false,
      freeGrading: 'ai', // 'ai' = KI bewertet freie Antworten, 'self' = Selbstkontrolle
    },
  };
}

export let state = defaultState();

function withDefaults(saved) {
  const base = defaultState();
  return {
    ...base,
    ...saved,
    stats: { ...base.stats, ...(saved.stats || {}) },
    settings: { ...base.settings, ...(saved.settings || {}) },
    sources: { ...(saved.sources || {}) },
  };
}

// ---------- Cloud-Speicher, wenn die App auf claude.ai läuft ----------
// Dann liegen die Daten in deinem privaten Bereich (data/users/<deine-id>),
// den niemand sonst lesen kann. Sonst: nur lokal im Browser.

let remote = null; // { coll }
const written = new Map(); // Dokument-ID -> zuletzt gespeicherter JSON-Text
let errorHandler = () => {};
const DOC_LIMIT = 180000; // Zeichen pro Dokument (Plattform-Grenze: 256 KiB)
const SOURCE_CHUNK = 90000; // Zeichen Quelltext pro Dokument (Umlaute brauchen mehr Bytes)

export function onStorageError(fn) {
  errorHandler = fn;
}

export function storageMode() {
  return remote ? 'cloud' : 'local';
}

function withTimeout(promise, ms) {
  return Promise.race([promise, new Promise((_, reject) => setTimeout(() => reject(new Error('timeout')), ms))]);
}

async function connectRemote() {
  if (!window.claude || typeof window.claude.use !== 'function') return null;
  try {
    const [db, user] = await Promise.all([window.claude.use('db'), window.claude.use('user')]);
    if (!db || !user) return null;
    const id = await user.id();
    if (!id) return null;
    return { coll: db.collection('data/users/' + id) };
  } catch {
    return null;
  }
}

// Lektionen werden pro Abschnitt gespeichert, große Abschnitte in mehreren Teilen
function docsFromState() {
  const { lessons, sources, ...rest } = state;
  const docs = { state: rest };
  // Quelltexte getrennt und in Stücken speichern
  for (const [unitId, text] of Object.entries(sources || {})) {
    if (!text || !state.units.some((u) => u.id === unitId)) continue;
    for (let i = 0, n = 0; i < text.length; i += SOURCE_CHUNK, n++) {
      docs[`s_${unitId}_${n}`] = { unitId, n, text: text.slice(i, i + SOURCE_CHUNK) };
    }
  }
  for (const u of state.units) {
    const list = lessons.filter((l) => l.unitId === u.id);
    let part = [];
    let size = 0;
    let n = 0;
    const flush = () => {
      docs[`u_${u.id}_${n++}`] = { unitId: u.id, lessons: part };
      part = [];
      size = 0;
    };
    for (const l of list) {
      const len = JSON.stringify(l).length;
      if (part.length && size + len > DOC_LIMIT) flush();
      part.push(l);
      size += len;
    }
    if (part.length || n === 0) flush();
  }
  return docs;
}

let chain = Promise.resolve();
function pushRemote() {
  const docs = docsFromState();
  const jobs = [];
  for (const [id, value] of Object.entries(docs)) {
    const json = JSON.stringify(value);
    if (written.get(id) !== json) jobs.push({ id, json });
  }
  for (const id of written.keys()) if (!(id in docs)) jobs.push({ id, del: true });
  if (!jobs.length) return chain;
  chain = chain.then(async () => {
    for (const job of jobs) {
      try {
        if (job.del) {
          await remote.coll.doc(job.id).delete();
          written.delete(job.id);
        } else {
          await remote.coll.doc(job.id).set(JSON.parse(job.json));
          written.set(job.id, job.json);
        }
      } catch (e) {
        errorHandler(
          e && e.code === 'quota_exceeded'
            ? 'Der Cloud-Speicher ist voll. Lösche alte Kurse, um Platz zu schaffen.'
            : 'Speichern in der Cloud hat nicht geklappt. Deine Daten bleiben vorerst auf diesem Gerät.',
        );
      }
    }
  });
  return chain;
}

export async function loadState() {
  const local = await kvGet('state');
  let saved = local;
  remote = await connectRemote();
  if (remote) {
    try {
      const snap = await withTimeout(remote.coll.limit(1000).get(), 12000);
      const docs = {};
      // Die Plattform liefert schreibgeschützte Objekte: tief kopieren, damit die App sie ändern kann
      for (const d of snap.docs) docs[d.id] = JSON.parse(JSON.stringify(d.data() || {}));
      if (docs.state) {
        const lessons = [];
        const pieces = {};
        for (const [id, v] of Object.entries(docs)) {
          if (id.startsWith('u_') && v && Array.isArray(v.lessons)) lessons.push(...v.lessons);
          if (id.startsWith('s_') && v && typeof v.text === 'string') (pieces[v.unitId] ||= []).push(v);
          written.set(id, JSON.stringify(v));
        }
        const sources = {};
        for (const [unitId, list] of Object.entries(pieces)) {
          sources[unitId] = list.sort((a, b) => a.n - b.n).map((x) => x.text).join('');
        }
        saved = { ...docs.state, lessons, sources };
      }
    } catch {
      remote = null;
      setTimeout(() => errorHandler('Der Cloud-Speicher ist gerade nicht erreichbar. Gespeichert wird vorerst nur auf diesem Gerät.'), 500);
    }
  }
  if (saved && typeof saved === 'object') state = withDefaults(saved);
  // Erster Start in der Cloud mit vorhandenen lokalen Daten: hochladen
  if (remote && !written.has('state') && local) pushRemote();
  return state;
}

let saveTimer = null;
export function save() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(saveNow, 600);
}

export async function saveNow() {
  clearTimeout(saveTimer);
  await kvSet('state', state);
  if (remote) await pushRemote();
}

document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'hidden') saveNow();
});

export function replaceState(next) {
  state = withDefaults(next);
  return saveNow();
}

export async function resetState() {
  state = defaultState();
  await saveNow();
}

// ---------- Hilfsfunktionen ----------

export function uid() {
  return Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-4);
}

export function dayKey(date = new Date()) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

export function addDays(key, n) {
  const [y, m, d] = key.split('-').map(Number);
  const date = new Date(y, m - 1, d);
  date.setDate(date.getDate() + n);
  return dayKey(date);
}

export function daysBetween(a, b) {
  const [y1, m1, d1] = a.split('-').map(Number);
  const [y2, m2, d2] = b.split('-').map(Number);
  return Math.round((new Date(y2, m2 - 1, d2) - new Date(y1, m1 - 1, d1)) / 86400000);
}

export const COURSE_COLORS = ['#58cc02', '#1cb0f6', '#ce82ff', '#ff9600', '#ff4b4b', '#2bd2c9', '#ffc800'];

export function courseLessons(courseId) {
  const unitOrder = state.units.filter((u) => u.courseId === courseId).map((u) => u.id);
  return state.lessons
    .filter((l) => l.courseId === courseId)
    .sort((a, b) => unitOrder.indexOf(a.unitId) - unitOrder.indexOf(b.unitId) || a.order - b.order);
}

export function findExercise(exId) {
  for (const l of state.lessons) {
    const ex = l.exercises.find((e) => e.id === exId);
    if (ex) return { lesson: l, ex };
  }
  return null;
}

// ---------- Seitenbilder (für „Originalseite anzeigen“) ----------
// Auf claude.ai im Dateispeicher der App (auf allen Geräten), sonst lokal im Browser.

let assetsNs = null;

export async function initAssets() {
  if (!window.claude || typeof window.claude.use !== 'function') return;
  try {
    assetsNs = await window.claude.use('assets');
  } catch {
    assetsNs = null;
  }
}

export async function savePageImage(unitId, label, blob) {
  if (assetsNs) {
    try {
      const r = await assetsNs.upload(blob);
      return { asset: r.id };
    } catch {
      // dann eben lokal
    }
  }
  const key = `page:${unitId}:${label}`;
  await kvSet(key, blob);
  return { idb: key };
}

export async function pageImageUrl(ref) {
  if (!ref) return null;
  if (ref.asset) return '/_blob/' + ref.asset;
  if (ref.idb) {
    const blob = await kvGet(ref.idb);
    return blob ? URL.createObjectURL(blob) : null;
  }
  return null;
}

export function deletePageImages(unit) {
  for (const ref of Object.values((unit && unit.pages) || {})) {
    if (ref.asset && assetsNs) assetsNs.delete(ref.asset).catch(() => {});
    if (ref.idb) kvDel(ref.idb);
  }
}
