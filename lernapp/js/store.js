// Persistenz: alles bleibt lokal im Browser (IndexedDB), nichts geht an einen Server.

const DB_NAME = 'lernpfad';
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

export async function loadState() {
  const saved = await kvGet('state');
  if (saved && typeof saved === 'object') {
    const base = defaultState();
    state = {
      ...base,
      ...saved,
      stats: { ...base.stats, ...(saved.stats || {}) },
      settings: { ...base.settings, ...(saved.settings || {}) },
    };
  }
  return state;
}

let saveTimer = null;
export function save() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => kvSet('state', state), 150);
}

export function saveNow() {
  clearTimeout(saveTimer);
  return kvSet('state', state);
}

export function replaceState(next) {
  const base = defaultState();
  state = {
    ...base,
    ...next,
    stats: { ...base.stats, ...(next.stats || {}) },
    settings: { ...base.settings, ...(next.settings || {}) },
  };
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
