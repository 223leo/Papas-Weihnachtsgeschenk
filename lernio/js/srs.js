// Spaced Repetition (vereinfachtes SM-2): Was du schwer fandest, kommt früher wieder.
import { state, dayKey, addDays, findExercise } from './store.js';

// examDay: Klausurtag des Kurses ('YYYY-MM-DD'). Dann kommt jede Aufgabe spätestens am Tag davor nochmal.
export function recordAnswer(exId, correct, examDay = null) {
  const today = dayKey();
  const card = state.srs[exId] || { ease: 2.5, interval: 0, reps: 0, lapses: 0, due: today, last: null };
  if (correct) {
    card.reps += 1;
    if (card.reps === 1) card.interval = 1;
    else if (card.reps === 2) card.interval = 3;
    else card.interval = Math.round(card.interval * card.ease);
    card.ease = Math.min(3.0, card.ease + 0.05);
  } else {
    card.lapses += 1;
    card.reps = 0;
    card.interval = 1; // morgen nochmal
    card.ease = Math.max(1.3, card.ease - 0.2);
  }
  card.interval = Math.min(card.interval, 180);
  card.due = addDays(today, card.interval);
  if (examDay && examDay > today) {
    const lastBefore = addDays(examDay, -1);
    if (card.due > lastBefore) card.due = lastBefore > today ? lastBefore : addDays(today, 1);
  }
  card.last = today;
  state.srs[exId] = card;
}

export function dueExercises(limit = Infinity) {
  const today = dayKey();
  const due = [];
  for (const [exId, card] of Object.entries(state.srs)) {
    if (card.due <= today) {
      const found = findExercise(exId);
      if (found) due.push({ ...found, card });
    }
  }
  // Am längsten überfällige und häufig vergessene zuerst
  due.sort((a, b) => (a.card.due < b.card.due ? -1 : a.card.due > b.card.due ? 1 : b.card.lapses - a.card.lapses));
  return due.slice(0, limit);
}

export function dueCount() {
  const today = dayKey();
  let n = 0;
  for (const [exId, card] of Object.entries(state.srs)) {
    if (card.due <= today && findExercise(exId)) n++;
  }
  return n;
}

export function weakestExercises(limit = 10) {
  return Object.entries(state.srs)
    .map(([exId, card]) => ({ ...findExercise(exId), card }))
    .filter((x) => x.ex)
    .sort((a, b) => b.card.lapses - a.card.lapses || a.card.ease - b.card.ease)
    .slice(0, limit);
}
