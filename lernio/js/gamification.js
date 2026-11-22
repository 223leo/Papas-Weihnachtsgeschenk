// XP, Level, Streaks, Streak-Schutz und Erfolge. Bewusst OHNE Herzen/Leben.
import { state, dayKey, addDays, daysBetween } from './store.js';

export const XP = {
  lessonBase: 10,
  perCorrectFirstTry: 1,
  perfectBonus: 5,
  reviewBase: 5,
  perReview: 1,
};

// Level n -> n+1 braucht 100 + (n-1)*50 XP
export function levelInfo(xp = state.stats.xp) {
  let level = 1;
  let need = 100;
  let rest = xp;
  while (rest >= need) {
    rest -= need;
    level += 1;
    need = 100 + (level - 1) * 50;
  }
  return { level, into: rest, need, pct: Math.round((rest / need) * 100) };
}

export function xpToday() {
  return state.stats.xpByDay[dayKey()] || 0;
}

// Streak, wie sie gerade angezeigt wird (0, wenn sie gerissen ist und kein Schutz reicht)
export function currentStreak() {
  const s = state.stats;
  if (!s.lastActiveDay) return 0;
  const gap = daysBetween(s.lastActiveDay, dayKey());
  if (gap <= 1) return s.streak;
  if (gap - 1 <= s.freezes) return s.streak; // wird beim nächsten Lernen durch Schutz gerettet
  return 0;
}

export function streakAtRisk() {
  const s = state.stats;
  return !!s.lastActiveDay && s.lastActiveDay !== dayKey() && currentStreak() > 0;
}

// Wird nach jeder abgeschlossenen Lektion/Wiederholung aufgerufen
export function addXP(amount) {
  const events = [];
  const s = state.stats;
  const today = dayKey();
  const before = levelInfo().level;
  const goalBefore = xpToday() >= state.settings.dailyGoal;

  s.xp += amount;
  s.xpByDay[today] = (s.xpByDay[today] || 0) + amount;

  if (s.lastActiveDay !== today) {
    const gap = s.lastActiveDay ? daysBetween(s.lastActiveDay, today) : null;
    if (gap === 1) {
      s.streak += 1;
    } else if (gap !== null && gap > 1 && gap - 1 <= s.freezes) {
      s.freezes -= gap - 1;
      s.streak += 1;
      events.push({ type: 'freezeUsed', count: gap - 1 });
    } else {
      s.streak = 1;
    }
    s.lastActiveDay = today;
    events.push({ type: 'streak', value: s.streak });
    if (s.streak % 7 === 0 && s.freezes < 2) {
      s.freezes += 1;
      events.push({ type: 'freezeEarned' });
    }
    s.longestStreak = Math.max(s.longestStreak, s.streak);
  }

  const after = levelInfo().level;
  if (after > before) events.push({ type: 'levelUp', value: after });
  if (!goalBefore && xpToday() >= state.settings.dailyGoal) events.push({ type: 'dailyGoal' });
  return events;
}

export function weekXP(offsetWeeks = 0) {
  // Mo–So der aktuellen (oder vergangenen) Woche
  const now = new Date();
  const dow = (now.getDay() + 6) % 7; // Montag = 0
  const monday = addDays(dayKey(now), -dow - offsetWeeks * 7);
  const days = [];
  for (let i = 0; i < 7; i++) {
    const key = addDays(monday, i);
    days.push({ key, xp: state.stats.xpByDay[key] || 0 });
  }
  return days;
}

export const ACHIEVEMENTS = [
  { id: 'first_lesson', icon: '🎓', title: 'Erste Lektion', desc: 'Schließe deine erste Lektion ab.', test: (s) => s.lessonsCompleted >= 1 },
  { id: 'first_upload', icon: '📄', title: 'Eigenes Material', desc: 'Lade deine erste Vorlesung hoch.', test: (s) => s.uploads >= 1 },
  { id: 'perfect', icon: '💯', title: 'Fehlerfrei', desc: 'Eine Lektion ohne einen einzigen Fehler.', test: (s) => s.perfectLessons >= 1 },
  { id: 'streak3', icon: '🔥', title: 'Drei am Stück', desc: '3 Tage Lernserie.', test: (s) => s.longestStreak >= 3 },
  { id: 'streak7', icon: '📅', title: 'Eine Woche', desc: '7 Tage Lernserie.', test: (s) => s.longestStreak >= 7 },
  { id: 'streak30', icon: '🏆', title: 'Monatsmarathon', desc: '30 Tage Lernserie.', test: (s) => s.longestStreak >= 30 },
  { id: 'xp100', icon: '⭐', title: '100 XP', desc: 'Sammle 100 XP.', test: (s) => s.xp >= 100 },
  { id: 'xp1000', icon: '🌟', title: '1000 XP', desc: 'Sammle 1000 XP.', test: (s) => s.xp >= 1000 },
  { id: 'lessons10', icon: '📚', title: 'Fleißig', desc: 'Schließe 10 Lektionen ab.', test: (s) => s.lessonsCompleted >= 10 },
  { id: 'reviews50', icon: '🧠', title: 'Gedächtnisprofi', desc: 'Wiederhole 50 Aufgaben.', test: (s) => s.reviewsDone >= 50 },
];

export function checkAchievements() {
  const unlocked = [];
  for (const a of ACHIEVEMENTS) {
    if (!state.achievements[a.id] && a.test(state.stats)) {
      state.achievements[a.id] = dayKey();
      unlocked.push(a);
    }
  }
  return unlocked;
}
