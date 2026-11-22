import { state, loadState, save, saveNow, replaceState, resetState, uid, dayKey, courseLessons, COURSE_COLORS, MODELS, onStorageError, storageMode } from './store.js';
import { recordAnswer, dueExercises, dueCount, weakestExercises } from './srs.js';
import { XP, addXP, levelInfo, xpToday, currentStreak, streakAtRisk, weekXP, ACHIEVEMENTS, checkAchievements } from './gamification.js';
import { extractFiles, fileKind } from './extract.js';
import { initAI, aiMode, extractOptions, generateLessons, generateMoreLessons, gradeFreeAnswer, testKey } from './ai.js';
import { addDemoCourse } from './demo.js';
import { startMath } from './math.js';

const app = document.getElementById('app');

// ---------- Hilfen ----------

function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
}

function toast(msg, kind = '') {
  const el = document.createElement('div');
  el.className = `toast ${kind}`;
  el.textContent = msg;
  document.body.appendChild(el);
  requestAnimationFrame(() => el.classList.add('show'));
  setTimeout(() => {
    el.classList.remove('show');
    setTimeout(() => el.remove(), 300);
  }, 3200);
}

function sheet(html) {
  closeSheet();
  const wrap = document.createElement('div');
  wrap.className = 'sheet-backdrop';
  wrap.innerHTML = `<div class="sheet" role="dialog">${html}</div>`;
  wrap.addEventListener('click', (e) => {
    if (e.target === wrap) closeSheet();
  });
  document.body.appendChild(wrap);
  requestAnimationFrame(() => wrap.classList.add('show'));
  return wrap.querySelector('.sheet');
}

function closeSheet() {
  document.querySelectorAll('.sheet-backdrop').forEach((el) => el.remove());
}

// Eigene Dialoge statt Browser-Popups: schöner am Handy und funktionieren überall
function askConfirm(message, okLabel = 'Ja', danger = true) {
  return new Promise((resolve) => {
    const el = sheet(`<h2>${esc(message)}</h2>
      <div class="two">
        <button class="btn secondary" data-answer="0">Abbrechen</button>
        <button class="btn ${danger ? 'warn' : 'primary'}" data-answer="1">${esc(okLabel)}</button>
      </div>`);
    const backdrop = el.parentElement;
    el.addEventListener('click', (e) => {
      const b = e.target.closest('[data-answer]');
      if (!b) return;
      closeSheet();
      resolve(b.dataset.answer === '1');
    });
    backdrop.addEventListener('click', (e) => {
      if (e.target === backdrop) resolve(false);
    });
  });
}

function askText(title, value = '') {
  return new Promise((resolve) => {
    const el = sheet(`<h2>${esc(title)}</h2>
      <form class="form" id="ask-form"><input id="ask-input" value="${esc(value)}" autocomplete="off">
      <div class="two"><button type="button" class="btn secondary" data-cancel>Abbrechen</button><button class="btn primary" type="submit">Speichern</button></div></form>`);
    const input = el.querySelector('#ask-input');
    input.focus();
    input.select();
    el.querySelector('[data-cancel]').addEventListener('click', () => {
      closeSheet();
      resolve(null);
    });
    el.querySelector('#ask-form').addEventListener('submit', (e) => {
      e.preventDefault();
      closeSheet();
      resolve(input.value);
    });
  });
}

function shuffle(arr) {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

const PRAISE = ['Richtig! 🎉', 'Super! ✨', 'Genau so! 💪', 'Stark! 🚀', 'Perfekt! ⭐'];
const COMFORT = ['Noch nicht ganz', 'Fast!', 'Gut, dass du es jetzt übst'];
const pick = (a) => a[Math.floor(Math.random() * a.length)];

function course(id) {
  return state.courses.find((c) => c.id === id);
}
function lesson(id) {
  return state.lessons.find((l) => l.id === id);
}

function lessonStatus(courseId) {
  // Lektionen sind nacheinander freigeschaltet (wie ein Lernpfad)
  const list = courseLessons(courseId);
  const firstOpen = list.findIndex((l) => !l.completedAt && l.exercises.length);
  return list.map((l, i) => ({
    lesson: l,
    state: !l.exercises.length ? 'empty' : l.completedAt ? 'done' : i === firstOpen ? 'current' : state.settings.unlockAll || i < firstOpen ? 'open' : 'locked',
  }));
}

function courseProgress(courseId) {
  const list = courseLessons(courseId).filter((l) => l.exercises.length);
  const done = list.filter((l) => l.completedAt).length;
  return { done, total: list.length, pct: list.length ? Math.round((done / list.length) * 100) : 0 };
}

function nextLesson() {
  const order = [state.settings.lastCourseId, ...state.courses.map((c) => c.id)].filter(Boolean);
  for (const cid of order) {
    const st = lessonStatus(cid).find((s) => s.state === 'current');
    if (st) return st.lesson;
  }
  return null;
}

// ---------- Rahmen: Kopfzeile + Navigation ----------

function topbar() {
  const streak = currentStreak();
  const goal = state.settings.dailyGoal;
  const today = xpToday();
  const due = dueCount();
  return `
  <header class="topbar">
    <a href="#/profile" class="chip ${streakAtRisk() ? 'risk' : streak ? 'fire' : ''}" title="Lernserie">🔥 <b>${streak}</b></a>
    <a href="#/profile" class="chip" title="XP heute / Tagesziel">⚡ <b>${today}</b><span class="muted">/${goal}</span></a>
    <a href="#/review" class="chip ${due ? 'due' : ''}" title="Fällige Wiederholungen">🧠 <b>${due}</b></a>
    <a href="#/settings" class="chip icon" title="Einstellungen" aria-label="Einstellungen">⚙️</a>
  </header>`;
}

function nav(active) {
  const items = [
    ['learn', '#/', '🏠', 'Lernen'],
    ['review', '#/review', '🧠', 'Wiederholen'],
    ['upload', '#/upload', '➕', 'Hochladen'],
    ['profile', '#/profile', '👤', 'Profil'],
  ];
  return `<nav class="bottomnav">${items
    .map(([id, href, icon, label]) => `<a href="${href}" class="${active === id ? 'active' : ''}"><span>${icon}</span>${label}</a>`)
    .join('')}</nav>`;
}

function page(active, body) {
  app.innerHTML = `${topbar()}<main class="page">${body}</main>${nav(active)}`;
  window.scrollTo(0, 0);
}

function goalRing(pct) {
  const r = 26;
  const c = 2 * Math.PI * r;
  const off = c * (1 - Math.min(1, pct));
  return `<svg class="ring" viewBox="0 0 64 64" aria-hidden="true">
    <circle cx="32" cy="32" r="${r}" class="ring-bg"/>
    <circle cx="32" cy="32" r="${r}" class="ring-fg" stroke-dasharray="${c}" stroke-dashoffset="${off}"/>
  </svg>`;
}

// ---------- Startseite ----------

function renderHome() {
  const name = state.settings.name ? `, ${esc(state.settings.name)}` : '';
  const goal = state.settings.dailyGoal;
  const today = xpToday();
  const next = nextLesson();
  const due = dueCount();
  const hour = new Date().getHours();
  const hello = hour < 11 ? 'Guten Morgen' : hour < 18 ? 'Hallo' : 'Guten Abend';

  let body = `<h1 class="hello">${hello}${name}! 👋</h1>`;

  body += `<section class="card goal-card">
    ${goalRing(today / goal)}
    <div>
      <div class="goal-title">${today >= goal ? 'Tagesziel geschafft! 🎉' : 'Tagesziel'}</div>
      <div class="muted">${today} von ${goal} XP heute${streakAtRisk() ? ' · Lerne heute, um deine Serie zu halten!' : ''}</div>
    </div>
  </section>`;

  if (next) {
    const c = course(next.courseId);
    body += `<section class="card continue" style="--accent:${c.color}">
      <div class="muted small">Weiterlernen · ${esc(c.name)}</div>
      <div class="continue-title">${esc(next.title)}</div>
      <div class="muted">${esc(next.summary)}</div>
      <button class="btn primary big" data-action="start" data-id="${next.id}">Los geht's</button>
    </section>`;
  }

  if (due) {
    body += `<section class="card review-card">
      <div><b>🧠 ${due} Wiederholung${due === 1 ? '' : 'en'} fällig</b>
      <div class="muted">So vergisst du nichts, was du schon gelernt hast.</div></div>
      <a class="btn secondary" href="#/review">Wiederholen</a>
    </section>`;
  }

  body += `<h2>Deine Kurse</h2>`;
  if (!state.courses.length) {
    body += `<section class="card empty">
      <div class="empty-icon">📚</div>
      <p>Noch keine Kurse. Lade eine Vorlesung hoch, und die KI macht daraus kurze Lektionen.</p>
      <a class="btn primary" href="#/upload">Vorlesung hochladen</a>
      <button class="btn ghost" data-action="demo">Erst mal den Demo-Kurs ausprobieren</button>
    </section>`;
  } else {
    body += `<div class="course-list">${state.courses
      .map((c) => {
        const p = courseProgress(c.id);
        return `<a class="card course-item" href="#/course/${c.id}" style="--accent:${c.color}">
          <div class="course-badge">${esc(c.name.slice(0, 1).toUpperCase())}</div>
          <div class="grow">
            <div class="course-name">${esc(c.name)}</div>
            <div class="bar"><div style="width:${p.pct}%"></div></div>
            <div class="muted small">${p.done} von ${p.total} Lektionen</div>
          </div>
        </a>`;
      })
      .join('')}</div>
      <a class="btn ghost full" href="#/upload">➕ Neuen Kurs oder neue Vorlesung</a>`;
  }
  page('learn', body);
}

// ---------- Lernpfad eines Kurses ----------

function renderCourse(courseId) {
  const c = course(courseId);
  if (!c) return go('#/');
  state.settings.lastCourseId = c.id;
  save();
  const statuses = lessonStatus(c.id);
  const units = state.units.filter((u) => u.courseId === c.id);
  const p = courseProgress(c.id);
  const offsets = [0, 1, 2, 1, 0, -1, -2, -1];

  let body = `<div class="course-head" style="--accent:${c.color}">
    <a href="#/" class="back" aria-label="Zurück">←</a>
    <div class="grow"><h1>${esc(c.name)}</h1><div class="muted">${p.done} von ${p.total} Lektionen · ${p.pct}%</div></div>
    <button class="btn icon" data-action="course-menu" data-id="${c.id}" aria-label="Kursoptionen">⋯</button>
  </div>`;

  let idx = 0;
  for (const u of units) {
    const items = statuses.filter((s) => s.lesson.unitId === u.id);
    body += `<section class="unit" style="--accent:${c.color}">
      <div class="unit-banner">
        <div class="grow"><div class="small">Abschnitt</div><div class="unit-title">${esc(u.title)}</div><div class="small">${esc(u.sourceName || '')}</div></div>
        <button class="unit-more" data-action="unit-menu" data-id="${u.id}" aria-label="Abschnitt bearbeiten">⋯</button>
      </div>
      ${items.length ? '' : `<div class="card empty unit-empty"><p class="muted">Noch keine Lektionen in diesem Abschnitt.</p><button class="btn secondary" data-action="new-lesson" data-id="${u.id}">➕ Eigene Lektion anlegen</button></div>`}
      <div class="path">`;
    for (const s of items) {
      const off = offsets[idx % offsets.length] * 44;
      const icon = s.state === 'done' ? '✓' : s.state === 'locked' ? '🔒' : s.state === 'current' ? '★' : s.state === 'empty' ? '✎' : '▶';
      body += `<div class="node-wrap" style="transform:translateX(${off}px)">
        ${s.state === 'current' ? '<div class="start-bubble">START</div>' : ''}
        <button class="node ${s.state}" data-action="node" data-id="${s.lesson.id}" aria-label="${esc(s.lesson.title)}">${icon}</button>
        <div class="node-label">${esc(s.lesson.title)}</div>
      </div>`;
      idx++;
    }
    body += `</div></section>`;
  }
  if (!units.length) body += `<section class="card empty"><p>Dieser Kurs hat noch keine Abschnitte.</p></section>`;
  body += `<a class="btn ghost full" href="#/upload/${c.id}">➕ Weitere Vorlesung zu diesem Kurs hinzufügen</a>
  <button class="btn ghost full" data-action="new-unit" data-id="${c.id}">✎ Eigenen Abschnitt ohne Datei anlegen</button>`;
  page('learn', body);
}

function lessonSheet(lessonId) {
  const l = lesson(lessonId);
  const st = lessonStatus(l.courseId).find((s) => s.lesson.id === l.id);
  const locked = st.state === 'locked';
  const counts = l.exercises.reduce((m, e) => ((m[e.type] = (m[e.type] || 0) + 1), m), {});
  sheet(`
    <h2>${esc(l.title)}</h2>
    <p class="muted">${esc(l.summary)}</p>
    <p class="small muted">${l.exercises.length} Aufgaben · ca. ${Math.max(2, Math.round(l.exercises.length * 0.6))} Min.
      ${l.bestAccuracy != null ? ` · Bestwert ${l.bestAccuracy}%` : ''}</p>
    <p class="small muted">${Object.entries(counts).map(([t, n]) => `${n}× ${TYPE_LABEL[t]}`).join(' · ')}</p>
    ${locked ? `<p class="hint">🔒 Schließe zuerst die vorherigen Lektionen ab.</p>` : ''}
    ${l.exercises.length ? '' : `<p class="hint">✎ Diese Lektion hat noch keine Aufgaben. Füge unten welche hinzu.</p>`}
    <button class="btn primary big" data-action="start" data-id="${l.id}" ${locked || !l.exercises.length ? 'disabled' : ''}>${l.completedAt ? 'Nochmal üben (+XP)' : 'Lektion starten'}</button>
    <a class="btn ghost full" href="#/edit/${l.id}" data-action="close-sheet">Aufgaben ansehen & bearbeiten</a>
  `);
}

function courseMenu(courseId) {
  const c = course(courseId);
  sheet(`
    <h2>${esc(c.name)}</h2>
    <button class="btn secondary full" data-action="rename-course" data-id="${c.id}">Umbenennen</button>
    <a class="btn secondary full" href="#/upload/${c.id}" data-action="close-sheet">Vorlesung hinzufügen</a>
    <button class="btn secondary full" data-action="new-unit" data-id="${c.id}">Eigenen Abschnitt anlegen</button>
    <button class="btn danger full" data-action="delete-course" data-id="${c.id}">Kurs löschen</button>
  `);
}

function unit(id) {
  return state.units.find((u) => u.id === id);
}

function unitLessons(unitId) {
  return state.lessons.filter((l) => l.unitId === unitId).sort((a, b) => a.order - b.order);
}

function unitMenu(unitId) {
  const u = unit(unitId);
  const others = state.courses.filter((c) => c.id !== u.courseId);
  const n = unitLessons(u.id).length;
  sheet(`
    <h2>${esc(u.title)}</h2>
    <p class="small muted">${n} Lektion${n === 1 ? '' : 'en'}${u.sourceName ? ` · ${esc(u.sourceName)}` : ''}</p>
    <button class="btn primary full" data-action="more-lessons" data-id="${u.id}" ${aiMode() ? '' : 'disabled'}>✨ Mehr Lektionen von Claude erstellen</button>
    ${aiMode() ? '' : '<p class="small muted">Dafür wird die KI gebraucht (siehe Einstellungen).</p>'}
    <button class="btn secondary full" data-action="new-lesson" data-id="${u.id}">➕ Eigene Lektion anlegen</button>
    <button class="btn secondary full" data-action="rename-unit" data-id="${u.id}">Abschnitt umbenennen</button>
    ${others.length ? `<button class="btn secondary full" data-action="move-unit" data-id="${u.id}">In anderen Kurs verschieben</button>` : ''}
    <button class="btn danger full" data-action="delete-unit" data-id="${u.id}">Abschnitt löschen</button>
  `);
}

function moveUnitSheet(unitId) {
  const u = unit(unitId);
  sheet(`
    <h2>„${esc(u.title)}“ verschieben nach …</h2>
    ${state.courses
      .filter((c) => c.id !== u.courseId)
      .map((c) => `<button class="btn secondary full" data-action="move-unit-to" data-id="${u.id}" data-course="${c.id}">${esc(c.name)}</button>`)
      .join('')}
  `);
}

async function moreLessons(unitId) {
  const u = unit(unitId);
  const c = course(u.courseId);
  const el = sheet(`<h2>✨ Mehr Lektionen</h2><div class="spinner"></div>
    <p class="muted">Claude erstellt neue Lektionen zu „${esc(u.title)}“. Das dauert etwa 20–60 Sekunden.</p>`);
  try {
    const res = await generateMoreLessons(u, unitLessons(u.id), state.sources[u.id], c.name);
    let order = Math.max(-1, ...unitLessons(u.id).map((l) => l.order)) + 1;
    for (const l of res.lessons) {
      state.lessons.push({ id: uid(), unitId: u.id, courseId: u.courseId, order: order++, title: l.title, summary: l.summary, exercises: l.exercises, completedAt: null, bestAccuracy: null, plays: 0 });
    }
    await saveNow();
    closeSheet();
    toast(res.lessons.length ? `✨ ${res.lessons.length} neue Lektion${res.lessons.length === 1 ? '' : 'en'}` : 'Claude hat keine neuen Lektionen gefunden.', res.lessons.length ? 'good' : '');
    renderCourse(u.courseId);
  } catch (err) {
    if (el.isConnected) {
      el.innerHTML = `<h2>⚠️ Das hat nicht geklappt</h2><p>${esc(err.message)}</p><button class="btn secondary big" data-action="close-sheet">Schließen</button>`;
    } else {
      toast(err.message, 'bad');
    }
  }
}

// ---------- Lektion spielen ----------

const TYPE_LABEL = { mc: 'Auswahl', cloze: 'Lückentext', flashcard: 'Karteikarte', free: 'Freie Antwort' };
let P = null; // aktueller Lektionsdurchlauf

function makeItem(ex) {
  return { ex, attempts: 0, order: ex.type === 'mc' ? shuffle(ex.options.map((_, i) => i)) : null };
}

function startLesson(lessonId) {
  const l = lesson(lessonId);
  if (!l || !l.exercises.length) return toast('Diese Lektion hat keine Aufgaben.');
  closeSheet();
  P = {
    mode: 'lesson',
    lessonId,
    title: l.title,
    courseId: l.courseId,
    queue: l.exercises.map(makeItem),
    total: l.exercises.length,
    solved: 0,
    firstTry: {},
    startedAt: Date.now(),
    phase: 'answer',
  };
  go('#/play');
}

function startReview(items, title) {
  if (!items.length) return toast('Gerade gibt es nichts zu wiederholen.');
  P = {
    mode: 'review',
    title,
    queue: shuffle(items.map((x) => makeItem(x.ex))),
    total: items.length,
    solved: 0,
    firstTry: {},
    startedAt: Date.now(),
    phase: 'answer',
  };
  go('#/play');
}

function renderPlay() {
  if (!P) return go('#/');
  if (!P.queue.length) return finishLesson();
  const item = P.queue[0];
  const ex = item.ex;
  const pct = Math.round((P.solved / P.total) * 100);
  let inner = '';

  if (ex.type === 'mc') {
    inner = `<div class="q-type">${item.attempts && P.phase === 'answer' ? '🔁 Nochmal versuchen' : 'Wähle die richtige Antwort'}</div>
      <div class="prompt">${esc(ex.prompt)}</div>
      <div class="options">${item.order
        .map((i, k) => {
          let cls = '';
          if (P.phase === 'feedback') cls = i === ex.correctIndex ? 'right' : i === P.selected ? 'wrong' : 'dim';
          else if (P.selected === i) cls = 'selected';
          return `<button class="option ${cls}" data-action="pick" data-i="${i}" ${P.phase === 'feedback' ? 'disabled' : ''}><span class="key">${k + 1}</span><span class="opt-text">${esc(ex.options[i])}</span></button>`;
        })
        .join('')}</div>`;
  } else if (ex.type === 'cloze') {
    const [before, ...rest] = ex.prompt.split('___');
    inner = `<div class="q-type">${item.attempts && P.phase === 'answer' ? '🔁 Nochmal versuchen' : 'Fülle die Lücke'}</div>
      <div class="prompt cloze">${esc(before)}<input id="cloze-input" class="cloze-input" autocomplete="off" autocapitalize="off" spellcheck="false" value="${esc(P.typed || '')}" ${P.phase === 'feedback' ? 'disabled' : ''} aria-label="Lücke">${esc(rest.join('___'))}</div>`;
  } else if (ex.type === 'flashcard') {
    const flipped = P.phase !== 'answer';
    inner = `<div class="q-type">${item.attempts && P.phase === 'answer' ? '🔁 Nochmal' : 'Karteikarte: Weißt du es?'}</div>
      <div class="flashcard ${flipped ? 'flipped' : ''}" data-action="flip">
        <div class="fc-front">${esc(ex.prompt)}</div>
        ${flipped ? `<div class="fc-back">${esc(ex.answer)}${ex.source ? `<div class="source">📍 ${esc(ex.source)}</div>` : ''}</div>` : '<div class="muted small">Erst überlegen, dann antippen zum Umdrehen</div>'}
      </div>`;
  } else if (ex.type === 'free') {
    inner = `<div class="q-type">${item.attempts && P.phase === 'answer' ? '🔁 Nochmal versuchen' : 'Erkläre in eigenen Worten'}</div>
      <div class="prompt">${esc(ex.prompt)}</div>
      <textarea id="free-input" class="free-input" rows="5" placeholder="Deine Antwort …" ${P.phase !== 'answer' ? 'disabled' : ''}>${esc(P.typed || '')}</textarea>`;
  }

  app.innerHTML = `<div class="player">
    <div class="player-top">
      <button class="btn icon" data-action="quit" aria-label="Beenden">✕</button>
      <div class="bar big"><div style="width:${pct}%"></div></div>
      <div class="muted small">${P.solved}/${P.total}</div>
    </div>
    <div class="player-body">${inner}</div>
    ${playerFooter(ex)}
  </div>`;

  const input = document.getElementById('cloze-input') || document.getElementById('free-input');
  if (input && P.phase === 'answer') {
    input.focus();
    input.addEventListener('input', () => {
      P.typed = input.value;
      const btn = document.querySelector('[data-action="check"]');
      if (btn) btn.disabled = !input.value.trim();
    });
  }
}

function playerFooter(ex) {
  if (P.phase === 'grading') {
    return `<footer class="player-foot"><button class="btn primary big" disabled>⏳ KI prüft deine Antwort …</button></footer>`;
  }
  if (P.phase === 'feedback') {
    const r = P.result;
    return `<footer class="player-foot feedback ${r.correct ? 'ok' : 'bad'}">
      <div class="fb-title">${esc(r.title)}</div>
      ${r.answerLine ? `<div class="fb-answer">${r.answerLine}</div>` : ''}
      ${r.feedback ? `<div class="fb-text">${esc(r.feedback)}</div>` : ''}
      ${r.missing && r.missing.length ? `<ul class="fb-missing">${r.missing.map((m) => `<li>${esc(m)}</li>`).join('')}</ul>` : ''}
      ${ex.explanation ? `<div class="fb-expl">💡 ${esc(ex.explanation)}</div>` : ''}
      ${ex.source ? `<div class="source">📍 ${esc(ex.source)}</div>` : ''}
      ${!r.correct && r.willRepeat ? `<div class="small">Diese Aufgabe kommt am Ende der Lektion nochmal.</div>` : ''}
      <button class="btn ${r.correct ? 'primary' : 'warn'} big" data-action="next" autofocus>Weiter</button>
    </footer>`;
  }
  if (ex.type === 'flashcard') {
    if (P.phase === 'answer') return `<footer class="player-foot"><button class="btn secondary big" data-action="flip">Umdrehen</button></footer>`;
    return `<footer class="player-foot two">
      <button class="btn warn big" data-action="self" data-ok="0">Wusste ich nicht</button>
      <button class="btn primary big" data-action="self" data-ok="1">Wusste ich</button>
    </footer>`;
  }
  if (ex.type === 'free' && P.phase === 'selfgrade') {
    return `<footer class="player-foot feedback neutral">
      <div class="fb-title">Vergleiche mit der Musterlösung</div>
      <div class="fb-answer">${esc(ex.answer)}</div>
      ${P.gradeError ? `<div class="small">(${esc(P.gradeError)})</div>` : ''}
      <div class="two">
        <button class="btn warn big" data-action="self" data-ok="0">Hatte ich nicht</button>
        <button class="btn primary big" data-action="self" data-ok="1">Hatte ich im Kern</button>
      </div>
    </footer>`;
  }
  const disabled = ex.type === 'mc' ? P.selected == null : !(P.typed || '').trim();
  return `<footer class="player-foot">
    ${ex.type === 'free' ? `<button class="btn ghost" data-action="show-solution">Ich weiß es nicht – Lösung zeigen</button>` : ''}
    <button class="btn primary big" data-action="check" ${disabled ? 'disabled' : ''}>Prüfen</button>
  </footer>`;
}

function normalize(s) {
  return String(s).toLowerCase().normalize('NFKC').replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
}

function levenshtein(a, b) {
  const dp = Array.from({ length: a.length + 1 }, (_, i) => [i, ...Array(b.length).fill(0)]);
  for (let j = 1; j <= b.length; j++) dp[0][j] = j;
  for (let i = 1; i <= a.length; i++)
    for (let j = 1; j <= b.length; j++)
      dp[i][j] = Math.min(dp[i - 1][j] + 1, dp[i][j - 1] + 1, dp[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
  return dp[a.length][b.length];
}

function checkCloze(ex, typed) {
  const t = normalize(typed);
  const accepted = [ex.answer, ...(ex.alternatives || [])].map(normalize);
  if (accepted.includes(t)) return { correct: true };
  for (const a of accepted) {
    const tol = a.length >= 8 ? 2 : a.length >= 5 ? 1 : 0;
    if (tol && levenshtein(a, t) <= tol) return { correct: true, typo: true };
  }
  return { correct: false };
}

async function check() {
  const item = P.queue[0];
  const ex = item.ex;
  if (ex.type === 'mc') {
    if (P.selected == null) return;
    const ok = P.selected === ex.correctIndex;
    return showResult(ok, { answerLine: ok ? '' : `Richtig ist: <b>${esc(ex.options[ex.correctIndex])}</b>` });
  }
  if (ex.type === 'cloze') {
    const typed = (P.typed || '').trim();
    if (!typed) return;
    const r = checkCloze(ex, typed);
    return showResult(r.correct, {
      answerLine: r.correct ? (r.typo ? `Achte auf die Schreibweise: <b>${esc(ex.answer)}</b>` : '') : `Richtig ist: <b>${esc(ex.answer)}</b>`,
    });
  }
  if (ex.type === 'free') {
    const typed = (P.typed || '').trim();
    if (!typed) return;
    if (state.settings.freeGrading === 'self' || !aiMode()) {
      P.phase = 'selfgrade';
      P.gradeError = state.settings.freeGrading === 'self' ? null : 'Ohne KI bewertest du selbst';
      return renderPlay();
    }
    P.phase = 'grading';
    renderPlay();
    try {
      const g = await gradeFreeAnswer(ex, typed);
      if (!P || P.queue[0] !== item) return;
      const ok = g.verdict === 'richtig' || g.score >= 70;
      showResult(ok, {
        title: ok ? `${pick(PRAISE)} (${g.score}/100)` : g.verdict === 'teilweise' ? `Teilweise richtig (${g.score}/100)` : `${pick(COMFORT)} (${g.score}/100)`,
        feedback: g.feedback,
        missing: g.missing,
        answerLine: `<span class="small">Musterlösung:</span> ${esc(ex.answer)}`,
      });
    } catch (e) {
      if (!P || P.queue[0] !== item) return;
      P.phase = 'selfgrade';
      P.gradeError = e.message;
      renderPlay();
    }
  }
}

function showResult(correct, extra = {}) {
  const item = P.queue[0];
  if (!(item.ex.id in P.firstTry)) P.firstTry[item.ex.id] = correct;
  item.attempts += 1;
  P.result = {
    correct,
    title: extra.title || (correct ? pick(PRAISE) : pick(COMFORT)),
    willRepeat: !correct && item.attempts < 3,
    ...extra,
  };
  P.phase = 'feedback';
  state.stats.answersTotal += 1;
  if (correct) state.stats.answersCorrect += 1;
  renderPlay();
}

function advance() {
  const item = P.queue.shift();
  if (P.result.correct || item.attempts >= 3) {
    P.solved += 1;
  } else {
    // Falsch beantwortet: kommt später nochmal, mit neu gemischten Antworten
    if (item.order) item.order = shuffle(item.order);
    P.queue.push(item);
  }
  P.phase = 'answer';
  P.selected = null;
  P.typed = '';
  P.result = null;
  P.gradeError = null;
  renderPlay();
}

function selfGrade(ok) {
  const item = P.queue[0];
  if (item.ex.type === 'flashcard') {
    if (!(item.ex.id in P.firstTry)) P.firstTry[item.ex.id] = ok;
    item.attempts += 1;
    state.stats.answersTotal += 1;
    if (ok) state.stats.answersCorrect += 1;
    P.result = { correct: ok };
    advance();
  } else {
    showResult(ok, { answerLine: `<span class="small">Musterlösung:</span> ${esc(item.ex.answer)}` });
  }
}

function finishLesson() {
  const ids = Object.keys(P.firstTry);
  const firstOk = ids.filter((id) => P.firstTry[id]).length;
  const accuracy = ids.length ? Math.round((firstOk / ids.length) * 100) : 100;
  const perfect = firstOk === ids.length;
  const secs = Math.round((Date.now() - P.startedAt) / 1000);

  for (const id of ids) recordAnswer(id, P.firstTry[id]);

  let xp;
  if (P.mode === 'lesson') {
    xp = XP.lessonBase + firstOk * XP.perCorrectFirstTry + (perfect ? XP.perfectBonus : 0);
    const l = lesson(P.lessonId);
    if (l) {
      const firstTime = !l.completedAt;
      l.completedAt ||= Date.now();
      l.plays = (l.plays || 0) + 1;
      l.bestAccuracy = Math.max(l.bestAccuracy ?? 0, accuracy);
      if (firstTime) state.stats.lessonsCompleted += 1;
    }
  } else {
    xp = XP.reviewBase + ids.length * XP.perReview + (perfect ? XP.perfectBonus : 0);
    state.stats.reviewsDone += ids.length;
  }
  if (perfect) state.stats.perfectLessons += 1;

  const events = addXP(xp);
  const achievements = checkAchievements();
  saveNow();

  const lines = [];
  for (const e of events) {
    if (e.type === 'streak') lines.push(`🔥 Lernserie: <b>${e.value} Tag${e.value === 1 ? '' : 'e'}</b>`);
    if (e.type === 'freezeUsed') lines.push(`🧊 Dein Serienschutz hat ${e.count} verpasste${e.count === 1 ? 'n Tag' : ' Tage'} überbrückt.`);
    if (e.type === 'freezeEarned') lines.push(`🧊 Neuer Serienschutz verdient! Er rettet deine Serie, wenn du mal einen Tag verpasst.`);
    if (e.type === 'levelUp') lines.push(`🆙 Level <b>${e.value}</b> erreicht!`);
    if (e.type === 'dailyGoal') lines.push(`🎯 Tagesziel geschafft!`);
  }
  for (const a of achievements) lines.push(`${a.icon} Erfolg freigeschaltet: <b>${esc(a.title)}</b>`);

  const backHref = P.mode === 'lesson' ? `#/course/${P.courseId}` : '#/review';
  const mins = Math.floor(secs / 60);
  app.innerHTML = `<div class="finish">
    <div class="confetti" aria-hidden="true">${Array.from('🎉✨⭐🎊'.repeat(4)).map((c, i) => `<span style="--i:${i}">${c}</span>`).join('')}</div>
    <div class="trophy">${perfect ? '🏆' : '🎓'}</div>
    <h1>${P.mode === 'lesson' ? 'Lektion geschafft!' : 'Wiederholung geschafft!'}</h1>
    <p class="muted">${esc(P.title)}</p>
    <div class="tiles">
      <div class="tile xp"><div class="tile-label">XP</div><div class="tile-value">+${xp}</div></div>
      <div class="tile acc"><div class="tile-label">Auf Anhieb</div><div class="tile-value">${accuracy}%</div></div>
      <div class="tile time"><div class="tile-label">Zeit</div><div class="tile-value">${mins}:${String(secs % 60).padStart(2, '0')}</div></div>
    </div>
    ${lines.length ? `<div class="card events">${lines.map((l) => `<div>${l}</div>`).join('')}</div>` : ''}
    <a class="btn primary big" href="${backHref}">Weiter</a>
  </div>`;
  P = null;
}

// ---------- Wiederholen ----------

function renderReview() {
  const due = dueExercises();
  const weak = weakestExercises(10).filter((x) => x.card.lapses > 0);
  let body = `<h1>Wiederholen</h1>`;
  if (due.length) {
    body += `<section class="card center">
      <div class="big-emoji">🧠</div>
      <h2>${due.length} Aufgabe${due.length === 1 ? '' : 'n'} fällig</h2>
      <p class="muted">Aus Lektionen, die du schon gemacht hast. Je öfter du etwas richtig weißt, desto seltener kommt es wieder.</p>
      <button class="btn primary big" data-action="review-due">Wiederholung starten (${Math.min(due.length, 15)})</button>
    </section>`;
  } else {
    body += `<section class="card center">
      <div class="big-emoji">✅</div>
      <h2>Alles wiederholt!</h2>
      <p class="muted">${Object.keys(state.srs).length ? 'Morgen gibt es neue Wiederholungen. Mach gern eine neue Lektion.' : 'Sobald du Lektionen abschließt, plant die App hier deine Wiederholungen.'}</p>
    </section>`;
  }
  if (weak.length) {
    body += `<section class="card">
      <h2>Deine Stolpersteine</h2>
      <p class="muted small">Aufgaben, die du schon mal falsch hattest.</p>
      <ul class="weak-list">${weak.slice(0, 5).map((w) => `<li>${esc(w.ex.prompt)}</li>`).join('')}</ul>
      <button class="btn secondary full" data-action="review-weak">Stolpersteine üben</button>
    </section>`;
  }
  body += `<section class="card info">
    <b>Wie funktioniert das?</b>
    <p class="muted small">Die App nutzt <i>Spaced Repetition</i>: Richtig beantwortete Aufgaben kommen nach 1, 3, 7, 16 … Tagen wieder. Falsche kommen schon morgen wieder. So wiederholst du genau dann, kurz bevor du es vergessen würdest.</p>
  </section>`;
  page('review', body);
}

// ---------- Hochladen ----------

function renderUpload(preselect) {
  const hasKey = !!aiMode();
  const options = state.courses.map((c) => `<option value="${c.id}" ${c.id === preselect ? 'selected' : ''}>${esc(c.name)}</option>`).join('');
  let body = `<h1>Vorlesung hochladen</h1>`;
  if (!hasKey && window.claude) {
    body += `<section class="card hint-card"><b>⚠️ Claude ist gerade nicht verbunden</b>
      <p class="small">Die App konnte Claude über dein Konto nicht erreichen. Lade die Seite neu. Wenn es dann immer noch nicht geht, schick mir diese Meldung. [Code: no_sample]</p></section>`;
  } else if (!hasKey) {
    body += `<section class="card hint-card">
      <b>🔑 API-Schlüssel nötig</b>
      <p class="small">Damit die KI aus deinen Dateien Lektionen erstellen kann, brauchst du einen Claude-API-Schlüssel.</p>
      <a class="btn secondary" href="#/settings">Zu den Einstellungen</a>
    </section>`;
  }
  if (aiMode() === 'claude') {
    body += `<p class="small muted">✨ Claude erstellt die Lektionen über dein claude.ai-Konto. Beim ersten Mal fragt claude.ai, ob die App Claude nutzen darf. Das zählt zu deinem normalen Nutzungslimit.</p>`;
  }
  body += `<form class="card form" id="upload-form">
    <label>Kurs
      <select name="course" id="course-select">
        ${options}
        <option value="__new" ${!state.courses.length || !preselect ? (state.courses.length ? '' : 'selected') : ''}>➕ Neuer Kurs …</option>
      </select>
    </label>
    <label id="new-course-label" class="${state.courses.length && preselect !== '__new' ? 'hidden' : ''}">Name des neuen Kurses
      <input name="newCourse" placeholder="z. B. Makroökonomie" autocomplete="off">
    </label>
    <label class="drop" id="drop">
      <input type="file" id="file-input" multiple accept=".pdf,.pptx,.docx,.txt,.md,image/*">
      <div class="drop-icon">📄</div>
      <div><b>Dateien auswählen</b> oder hierher ziehen</div>
      <div class="muted small">PDF, PowerPoint (.pptx), Word (.docx), Text, Fotos & Scans</div>
    </label>
    <ul id="file-list" class="file-list"></ul>
    <button class="btn primary big" type="submit" id="upload-btn" disabled>✨ Lektionen erstellen</button>
    <div class="muted small">Tipp: Lade pro Vorlesungstermin eine Datei hoch. Jede Datei wird ein Abschnitt im Lernpfad. Mehrere Fotos werden zu einem Abschnitt zusammengefasst.</div>
  </form>
  <section id="progress" class="card hidden"></section>`;
  page('upload', body);

  const select = document.getElementById('course-select');
  const newLabel = document.getElementById('new-course-label');
  if (!state.courses.length) newLabel.classList.remove('hidden');
  select.addEventListener('change', () => newLabel.classList.toggle('hidden', select.value !== '__new'));

  let files = [];
  const input = document.getElementById('file-input');
  const list = document.getElementById('file-list');
  const btn = document.getElementById('upload-btn');
  const drop = document.getElementById('drop');
  const refresh = () => {
    list.innerHTML = files
      .map((f, i) => {
        const kind = fileKind(f);
        const bad = kind === 'unknown' || kind === 'legacy';
        return `<li class="${bad ? 'bad' : ''}"><span>${{ pdf: '📕', pptx: '📊', docx: '📝', text: '📃', image: '🖼️' }[kind] || '⚠️'} ${esc(f.name)}</span>
          <span class="muted small">${(f.size / 1024 / 1024).toFixed(1)} MB</span>
          <button type="button" class="btn icon small" data-remove="${i}" aria-label="Entfernen">✕</button></li>`;
      })
      .join('');
    btn.disabled = !files.length || !hasKey;
  };
  input.addEventListener('change', () => {
    files = [...files, ...input.files];
    input.value = '';
    refresh();
  });
  list.addEventListener('click', (e) => {
    const i = e.target.dataset.remove;
    if (i != null) {
      files.splice(Number(i), 1);
      refresh();
    }
  });
  ['dragenter', 'dragover'].forEach((ev) =>
    drop.addEventListener(ev, (e) => {
      e.preventDefault();
      drop.classList.add('over');
    }),
  );
  ['dragleave', 'drop'].forEach((ev) => drop.addEventListener(ev, () => drop.classList.remove('over')));
  drop.addEventListener('drop', (e) => {
    e.preventDefault();
    files = [...files, ...e.dataTransfer.files];
    refresh();
  });

  document.getElementById('upload-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const fd = new FormData(e.target);
    let courseId = fd.get('course');
    const newName = String(fd.get('newCourse') || '').trim();
    if (courseId === '__new' || !courseId) {
      if (!newName) return toast('Bitte gib dem Kurs einen Namen.');
      courseId = uid();
      state.courses.push({ id: courseId, name: newName, color: COURSE_COLORS[state.courses.length % COURSE_COLORS.length], createdAt: Date.now() });
    }
    e.target.classList.add('hidden');
    await processUpload(courseId, files);
  });
}

async function processUpload(courseId, files) {
  const box = document.getElementById('progress');
  box.classList.remove('hidden');
  const c = course(courseId);
  const log = [];
  let created = 0;
  const render = (status, done = false) => {
    const title = !done ? '✨ Lektionen werden erstellt …' : created ? '✅ Fertig!' : '⚠️ Das hat leider nicht geklappt';
    box.innerHTML = `<h2>${title}</h2>
      ${done ? '' : `<div class="spinner"></div><p class="muted">${esc(status)}</p><p class="small muted">Das dauert pro Abschnitt etwa 20–60 Sekunden. Lass die Seite offen.</p>`}
      <ul class="log">${log.map((l) => `<li class="${l.kind}">${l.text}</li>`).join('')}</ul>
      ${done && created ? `<a class="btn primary big" href="#/course/${courseId}">Zum Lernpfad</a>` : ''}
      ${done && !created ? `<button class="btn secondary big" data-action="retry-upload" data-id="${courseId}">Nochmal versuchen</button>` : ''}`;
  };
  render('Dateien werden gelesen …');

  let sources;
  try {
    sources = await extractFiles(files, { ...extractOptions(), onStatus: (s) => render(s) });
  } catch (err) {
    log.push({ kind: 'err', text: '⚠️ Datei lesen: ' + esc((err && err.message) || String(err)) + (err && err.name && err.name !== 'Error' ? ` [${esc(err.name)}]` : '') });
    render('', true);
    return;
  }

  outer: for (const src of sources) {
    const unit = { id: uid(), courseId, title: src.title, sourceName: src.title, createdAt: Date.now() };
    let order = 0;
    let unitAdded = false;
    for (const [i, part] of src.parts.entries()) {
      render(`${src.title}: Abschnitt ${i + 1} von ${src.parts.length} (${part.label})`);
      try {
        const res = await generateLessons(part, c.name);
        if (!unitAdded) {
          if (res.unitTitle) unit.title = res.unitTitle;
          state.units.push(unit);
          unitAdded = true;
        }
        for (const l of res.lessons) {
          state.lessons.push({ id: uid(), unitId: unit.id, courseId, order: order++, title: l.title, summary: l.summary, exercises: l.exercises, completedAt: null, bestAccuracy: null, plays: 0 });
          created++;
        }
        if (part.text) state.sources[unit.id] = ((state.sources[unit.id] || '') + '\n\n' + part.text).slice(0, 400000);
        log.push({ kind: 'ok', text: `✓ ${esc(src.title)} · ${esc(part.label)}: ${res.lessons.length} Lektion${res.lessons.length === 1 ? '' : 'en'}` });
        saveNow();
      } catch (err) {
        log.push({ kind: 'err', text: `⚠️ ${esc(src.title)} · ${esc(part.label)}: ${esc(err.message)}${err.name === 'TypeError' ? ' [Code: js]' : ''}` });
        if (err.fatal) break outer;
      }
    }
  }
  if (created) {
    state.stats.uploads += 1;
    const ach = checkAchievements();
    ach.forEach((a) => toast(`${a.icon} Erfolg: ${a.title}`, 'good'));
  }
  log.push({ kind: created ? 'ok' : 'err', text: `<b>${created} neue Lektion${created === 1 ? '' : 'en'} im Kurs „${esc(c.name)}“</b>` });
  saveNow();
  render('', true);
}

// ---------- Profil ----------

function renderProfile() {
  const s = state.stats;
  const lv = levelInfo();
  const week = weekXP(0);
  const lastWeek = weekXP(1);
  const weekSum = week.reduce((a, d) => a + d.xp, 0);
  const lastSum = lastWeek.reduce((a, d) => a + d.xp, 0);
  const max = Math.max(state.settings.dailyGoal, ...week.map((d) => d.xp));
  const labels = ['Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa', 'So'];
  const todayKey = dayKey();
  const acc = s.answersTotal ? Math.round((s.answersCorrect / s.answersTotal) * 100) : 0;

  const body = `<h1>${state.settings.name ? esc(state.settings.name) : 'Dein Profil'}</h1>
  <section class="card level-card">
    <div class="level-badge">${lv.level}</div>
    <div class="grow">
      <div><b>Level ${lv.level}</b></div>
      <div class="bar"><div style="width:${lv.pct}%"></div></div>
      <div class="muted small">${lv.into} / ${lv.need} XP bis Level ${lv.level + 1}</div>
    </div>
  </section>
  <div class="tiles">
    <div class="tile fire"><div class="tile-value">🔥 ${currentStreak()}</div><div class="tile-label">Tage Serie</div></div>
    <div class="tile"><div class="tile-value">⚡ ${s.xp}</div><div class="tile-label">XP gesamt</div></div>
    <div class="tile"><div class="tile-value">🧊 ${s.freezes}</div><div class="tile-label">Serienschutz</div></div>
    <div class="tile"><div class="tile-value">📚 ${s.lessonsCompleted}</div><div class="tile-label">Lektionen</div></div>
    <div class="tile"><div class="tile-value">🏅 ${s.longestStreak}</div><div class="tile-label">Längste Serie</div></div>
    <div class="tile"><div class="tile-value">🎯 ${acc}%</div><div class="tile-label">Trefferquote</div></div>
  </div>
  <section class="card">
    <h2>Diese Woche · ${weekSum} XP</h2>
    <div class="week">${week
      .map((d, i) => `<div class="day ${d.key === todayKey ? 'today' : ''}">
        <div class="col"><div class="fill ${d.xp >= state.settings.dailyGoal ? 'goal' : ''}" style="height:${Math.round((d.xp / max) * 100)}%"></div></div>
        <div class="small">${labels[i]}</div><div class="small muted">${d.xp || ''}</div></div>`)
      .join('')}</div>
  </section>
  <section class="card league">
    <h2>🏆 Deine Wochenliga</h2>
    <p class="muted small">Im Moment trittst du gegen dich selbst an: Schlage deine XP von letzter Woche.</p>
    <div class="vs">
      <div><div class="small muted">Letzte Woche</div><b>${lastSum} XP</b></div>
      <div class="vs-mid">${weekSum > lastSum ? '🥇' : weekSum === lastSum && weekSum ? '🤝' : '⚔️'}</div>
      <div><div class="small muted">Diese Woche</div><b>${weekSum} XP</b></div>
    </div>
    <p class="small muted">Ligen mit Freunden und Freundesmissionen kommen in einer späteren Version.</p>
  </section>
  <section class="card">
    <h2>Erfolge</h2>
    <div class="achievements">${ACHIEVEMENTS.map((a) => {
      const got = state.achievements[a.id];
      return `<div class="ach ${got ? 'got' : ''}" title="${esc(a.desc)}"><div class="ach-icon">${got ? a.icon : '🔒'}</div><div class="small"><b>${esc(a.title)}</b></div><div class="small muted">${esc(a.desc)}</div></div>`;
    }).join('')}</div>
  </section>
  <a class="btn ghost full" href="#/settings">⚙️ Einstellungen</a>`;
  page('profile', body);
}

// ---------- Einstellungen ----------

function renderSettings() {
  const st = state.settings;
  const body = `<h1>Einstellungen</h1>
  <form class="card form" id="settings-form">
    <label>Dein Name <input name="name" value="${esc(st.name)}" placeholder="optional" autocomplete="off"></label>
    <label>Tagesziel
      <select name="dailyGoal">
        ${[
          [10, 'Locker · 10 XP (~1 Lektion)'],
          [30, 'Normal · 30 XP (~2 Lektionen)'],
          [50, 'Ernsthaft · 50 XP (~3 Lektionen)'],
          [80, 'Intensiv · 80 XP (~5 Lektionen)'],
        ]
          .map(([v, l]) => `<option value="${v}" ${st.dailyGoal === v ? 'selected' : ''}>${l}</option>`)
          .join('')}
      </select>
    </label>
    <label class="row"><input type="checkbox" name="unlockAll" ${st.unlockAll ? 'checked' : ''}> Alle Lektionen freischalten (statt nacheinander)</label>
    <label>Freie Antworten bewerten
      <select name="freeGrading">
        <option value="ai" ${st.freeGrading !== 'self' ? 'selected' : ''}>KI bewertet und sagt, was fehlt</option>
        <option value="self" ${st.freeGrading === 'self' ? 'selected' : ''}>Selbst bewerten mit Musterlösung (kostenlos)</option>
      </select>
    </label>
  </form>
  ${
    aiMode() === 'claude'
      ? `<section class="card form"><h2>✨ KI</h2><p class="small muted">Die App nutzt Claude über dein claude.ai-Konto. Du brauchst keinen API-Schlüssel. Jede erstellte Lektion und jede KI-Bewertung zählt zu deinem normalen Nutzungslimit.</p></section>`
      : ''
  }
  <form class="card form ${aiMode() === 'claude' ? 'hidden' : ''}" id="key-form">
    <h2>🔑 KI (Claude API)</h2>
    <p class="small muted">Den Schlüssel bekommst du in der <a href="https://platform.claude.com/settings/keys" target="_blank" rel="noopener">Claude Console</a> (Konto anlegen, etwas Guthaben aufladen, „Create Key“). Er wird nur auf diesem Gerät gespeichert und nur an Anthropic gesendet.</p>
    <label>API-Schlüssel <input name="apiKey" type="password" value="${esc(st.apiKey)}" placeholder="sk-ant-…" autocomplete="off"></label>
    <label>Modell
      <select name="model">${MODELS.map((m) => `<option value="${m.id}" ${st.model === m.id ? 'selected' : ''}>${esc(m.label)}</option>`).join('')}</select>
    </label>
    <div class="two">
      <button class="btn primary" type="submit">Speichern</button>
      <button class="btn secondary" type="button" data-action="test-key">Verbindung testen</button>
    </div>
  </form>
  <section class="card form">
    <h2>💾 Daten</h2>
    <p class="small muted">${
      storageMode() === 'cloud'
        ? 'Deine Kurse und Fortschritte werden in deinem privaten Speicher auf claude.ai gesichert. Nur du kannst sie sehen, auch wenn du den Link teilst. So hast du sie auf jedem Gerät, auf dem du angemeldet bist.'
        : 'Alles wird lokal in diesem Browser gespeichert. Mach ab und zu eine Sicherung, besonders vor einem Gerätewechsel. (Der API-Schlüssel wird nicht mitgesichert.)'
    }</p>
    <div class="two">
      <button class="btn secondary" data-action="export">Sicherung herunterladen</button>
      <label class="btn secondary">Sicherung laden<input type="file" id="import-input" accept=".json,application/json" hidden></label>
    </div>
    ${state.courses.some((c) => c.demo) ? '' : `<button class="btn ghost" data-action="demo">Demo-Kurs hinzufügen</button>`}
    <button class="btn danger" data-action="reset">Alle Daten löschen</button>
  </section>
  <p class="center small muted">Lernio · Version 1.2</p>`;
  page('settings', body);

  document.getElementById('settings-form').addEventListener('change', (e) => {
    const fd = new FormData(e.currentTarget);
    st.name = String(fd.get('name') || '').trim();
    st.dailyGoal = Number(fd.get('dailyGoal'));
    st.unlockAll = fd.get('unlockAll') === 'on';
    st.freeGrading = fd.get('freeGrading') === 'self' ? 'self' : 'ai';
    save();
    toast('Gespeichert');
  });
  document.getElementById('key-form').addEventListener('submit', (e) => {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    st.apiKey = String(fd.get('apiKey') || '').trim();
    st.model = String(fd.get('model'));
    save();
    toast('Gespeichert', 'good');
  });
  document.getElementById('import-input').addEventListener('change', async (e) => {
    const f = e.target.files[0];
    if (!f) return;
    try {
      const data = JSON.parse(await f.text());
      if (!data || !Array.isArray(data.courses) || !Array.isArray(data.lessons)) throw new Error('Keine gültige Sicherung');
      if (!(await askConfirm('Die aktuellen Daten werden durch die Sicherung ersetzt. Fortfahren?', 'Ersetzen'))) return;
      const key = state.settings.apiKey;
      await replaceState(data);
      state.settings.apiKey = key;
      await saveNow();
      toast('Sicherung geladen', 'good');
      go('#/');
    } catch (err) {
      toast('Fehler: ' + err.message, 'bad');
    }
  });
}

async function exportData() {
  const data = JSON.parse(JSON.stringify(state));
  data.settings.apiKey = '';
  const json = JSON.stringify(data, null, 1);
  const filename = `lernio-sicherung-${dayKey()}.json`;
  const downloads = window.claude && window.claude.use ? await window.claude.use('downloads').catch(() => null) : null;
  if (downloads) {
    try {
      await downloads.save({ filename, data: json });
    } catch (e) {
      if (e && e.code !== 'cancelled' && e.code !== 'declined') toast('Sicherung konnte nicht gespeichert werden.', 'bad');
    }
    return;
  }
  const blob = new Blob([json], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

// ---------- Aufgaben ansehen & bearbeiten ----------

function renderEdit(lessonId) {
  const l = lesson(lessonId);
  if (!l) return go('#/');
  const body = `<div class="course-head">
    <a href="#/course/${l.courseId}" class="back" aria-label="Zurück">←</a>
    <div class="grow"><h1>${esc(l.title)}</h1><div class="muted small">${l.exercises.length} Aufgabe${l.exercises.length === 1 ? '' : 'n'} · Prüfe, ob alles stimmt, und ergänze eigene Aufgaben.</div></div>
  </div>
  <div class="two edit-tools">
    <button class="btn primary" data-action="add-ex" data-id="${l.id}">➕ Aufgabe hinzufügen</button>
    <button class="btn secondary" data-action="rename-lesson" data-id="${l.id}">Lektion umbenennen</button>
  </div>
  ${l.exercises.length ? '' : '<section class="card empty"><p class="muted">Noch keine Aufgaben. Füge mit „Aufgabe hinzufügen“ die erste hinzu.</p></section>'}
  ${l.exercises
    .map(
      (ex, i) => `<section class="card ex-card">
      <div class="small muted">${i + 1}. ${TYPE_LABEL[ex.type]}${ex.source ? ` · ${esc(ex.source)}` : ''}</div>
      <div class="ex-prompt">${esc(ex.prompt)}</div>
      ${
        ex.type === 'mc'
          ? `<ul class="ex-opts">${ex.options.map((o, k) => `<li class="${k === ex.correctIndex ? 'right' : ''}">${esc(o)}</li>`).join('')}</ul>`
          : `<div class="ex-answer">→ ${esc(ex.answer)}${ex.alternatives && ex.alternatives.length ? ` <span class="muted small">(auch: ${esc(ex.alternatives.join(', '))})</span>` : ''}</div>`
      }
      ${ex.explanation ? `<div class="small muted">💡 ${esc(ex.explanation)}</div>` : ''}
      <div class="ex-actions">
        <button class="btn secondary small" data-action="edit-ex" data-lesson="${l.id}" data-id="${ex.id}">Bearbeiten</button>
        <button class="btn ghost small" data-action="delete-ex" data-lesson="${l.id}" data-id="${ex.id}">Löschen</button>
      </div>
    </section>`,
    )
    .join('')}
  ${l.exercises.length > 2 ? `<button class="btn primary full" data-action="add-ex" data-id="${l.id}">➕ Aufgabe hinzufügen</button>` : ''}
  <button class="btn danger full" data-action="delete-lesson" data-id="${l.id}">Ganze Lektion löschen</button>`;
  page('learn', body);
}

function addExerciseSheet(lessonId) {
  sheet(`<h2>Welche Art von Aufgabe?</h2>
    <button class="btn secondary full" data-action="add-ex-type" data-id="${lessonId}" data-type="mc">Auswahl (Multiple Choice)</button>
    <button class="btn secondary full" data-action="add-ex-type" data-id="${lessonId}" data-type="cloze">Lückentext</button>
    <button class="btn secondary full" data-action="add-ex-type" data-id="${lessonId}" data-type="flashcard">Karteikarte</button>
    <button class="btn secondary full" data-action="add-ex-type" data-id="${lessonId}" data-type="free">Freie Antwort</button>
    <p class="small muted">Formeln schreibst du so: <code>\\( a_n \\)</code> im Satz oder <code>\\[ \\sum_{k=1}^{n} k \\]</code> als eigene Zeile.</p>`);
}

function editExerciseSheet(lessonId, exId, newType) {
  const l = lesson(lessonId);
  const isNew = !!newType;
  const ex = isNew
    ? { id: uid(), type: newType, prompt: '', options: [], correctIndex: 0, answer: '', alternatives: [], explanation: '', source: 'eigene Aufgabe' }
    : l.exercises.find((e) => e.id === exId);
  const el = sheet(`<h2>${isNew ? `Neue Aufgabe: ${TYPE_LABEL[ex.type]}` : 'Aufgabe bearbeiten'}</h2>
    <form class="form" id="ex-form">
      <label>${ex.type === 'flashcard' ? 'Vorderseite' : ex.type === 'cloze' ? 'Satz (Lücke als ___)' : 'Frage'}
        <textarea name="prompt" rows="3">${esc(ex.prompt)}</textarea></label>
      ${
        ex.type === 'mc'
          ? `<label>Antworten (eine pro Zeile)<textarea name="options" rows="4" placeholder="Richtige Antwort&#10;Falsche Antwort&#10;Falsche Antwort&#10;Falsche Antwort">${esc(ex.options.join('\n'))}</textarea></label>
             <label>Richtige Antwort ist Nr. <input name="correct" type="number" min="1" max="10" value="${ex.correctIndex + 1}"></label>`
          : `<label>${ex.type === 'flashcard' ? 'Rückseite' : ex.type === 'free' ? 'Musterlösung' : 'Lösung'}<textarea name="answer" rows="2">${esc(ex.answer)}</textarea></label>`
      }
      ${ex.type === 'cloze' ? `<label>Auch richtig (durch Komma getrennt)<input name="alternatives" value="${esc((ex.alternatives || []).join(', '))}"></label>` : ''}
      <label>Erklärung<textarea name="explanation" rows="2">${esc(ex.explanation)}</textarea></label>
      <label>Quelle<input name="source" value="${esc(ex.source)}"></label>
      <button class="btn primary big" type="submit">Speichern</button>
    </form>`);
  el.querySelector('#ex-form').addEventListener('submit', (e) => {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    const prompt = String(fd.get('prompt')).trim();
    if (!prompt) return toast('Bitte eine Frage eingeben.');
    if (ex.type === 'cloze' && !prompt.includes('___')) return toast('Der Satz braucht eine Lücke: ___');
    if (ex.type !== 'mc' && !String(fd.get('answer') || '').trim()) return toast('Bitte eine Lösung eingeben.');
    ex.prompt = prompt;
    ex.explanation = String(fd.get('explanation')).trim();
    ex.source = String(fd.get('source')).trim();
    if (ex.type === 'mc') {
      const opts = String(fd.get('options')).split('\n').map((s) => s.trim()).filter(Boolean);
      const ci = Number(fd.get('correct')) - 1;
      if (opts.length < 2 || ci < 0 || ci >= opts.length) return toast('Bitte mindestens 2 Antworten und eine gültige Nummer.');
      ex.options = opts;
      ex.correctIndex = ci;
    } else {
      ex.answer = String(fd.get('answer')).trim();
    }
    if (ex.type === 'cloze') ex.alternatives = String(fd.get('alternatives')).split(',').map((s) => s.trim()).filter(Boolean);
    if (isNew) l.exercises.push(ex);
    save();
    closeSheet();
    renderEdit(lessonId);
    toast('Gespeichert', 'good');
  });
}

// ---------- Aktionen (Event-Delegation) ----------

document.addEventListener('click', async (e) => {
  const el = e.target.closest('[data-action]');
  if (!el) return;
  const a = el.dataset.action;
  const id = el.dataset.id;
  switch (a) {
    case 'close-sheet':
      closeSheet();
      break;
    case 'start':
      startLesson(id);
      break;
    case 'node':
      lessonSheet(id);
      break;
    case 'course-menu':
      courseMenu(id);
      break;
    case 'rename-course': {
      const c = course(id);
      const name = await askText('Kurs umbenennen', c.name);
      if (name && name.trim()) {
        c.name = name.trim();
        save();
        closeSheet();
        route();
      }
      break;
    }
    case 'delete-course': {
      const c = course(id);
      if (!(await askConfirm(`Kurs „${c.name}“ mit allen Lektionen löschen? Deine XP bleiben erhalten.`, 'Löschen'))) return;
      const exIds = state.lessons.filter((l) => l.courseId === id).flatMap((l) => l.exercises.map((x) => x.id));
      exIds.forEach((x) => delete state.srs[x]);
      state.lessons = state.lessons.filter((l) => l.courseId !== id);
      state.units = state.units.filter((u) => u.courseId !== id);
      state.courses = state.courses.filter((x) => x.id !== id);
      saveNow();
      closeSheet();
      go('#/');
      break;
    }
    case 'delete-lesson': {
      const l = lesson(id);
      if (!(await askConfirm(`Lektion „${l.title}“ löschen?`, 'Löschen'))) return;
      l.exercises.forEach((x) => delete state.srs[x.id]);
      state.lessons = state.lessons.filter((x) => x.id !== id);
      saveNow();
      go(`#/course/${l.courseId}`);
      break;
    }
    case 'edit-ex':
      editExerciseSheet(el.dataset.lesson, id);
      break;
    case 'add-ex':
      addExerciseSheet(id);
      break;
    case 'add-ex-type':
      editExerciseSheet(id, null, el.dataset.type);
      break;
    case 'rename-lesson': {
      const l = lesson(id);
      const name = await askText('Lektion umbenennen', l.title);
      if (name && name.trim()) {
        l.title = name.trim();
        save();
        renderEdit(id);
      }
      break;
    }
    case 'unit-menu':
      unitMenu(id);
      break;
    case 'rename-unit': {
      const u = unit(id);
      const name = await askText('Abschnitt umbenennen', u.title);
      if (name && name.trim()) {
        u.title = name.trim();
        save();
        renderCourse(u.courseId);
      }
      break;
    }
    case 'delete-unit': {
      const u = unit(id);
      const n = unitLessons(id).length;
      if (!(await askConfirm(`Abschnitt „${u.title}“ mit ${n} Lektion${n === 1 ? '' : 'en'} löschen? Deine XP bleiben erhalten.`, 'Löschen'))) return;
      unitLessons(id).forEach((l) => l.exercises.forEach((x) => delete state.srs[x.id]));
      state.lessons = state.lessons.filter((l) => l.unitId !== id);
      state.units = state.units.filter((x) => x.id !== id);
      delete state.sources[id];
      await saveNow();
      toast('Abschnitt gelöscht');
      renderCourse(u.courseId);
      break;
    }
    case 'new-unit': {
      const name = await askText('Name des neuen Abschnitts', '');
      if (name && name.trim()) {
        state.units.push({ id: uid(), courseId: id, title: name.trim(), sourceName: 'Eigener Abschnitt', createdAt: Date.now() });
        save();
        renderCourse(id);
      }
      break;
    }
    case 'new-lesson': {
      const u = unit(id);
      const name = await askText('Name der neuen Lektion', '');
      if (name && name.trim()) {
        const order = Math.max(-1, ...unitLessons(id).map((l) => l.order)) + 1;
        const l = { id: uid(), unitId: id, courseId: u.courseId, order, title: name.trim(), summary: 'Eigene Lektion', exercises: [], completedAt: null, bestAccuracy: null, plays: 0 };
        state.lessons.push(l);
        save();
        go(`#/edit/${l.id}`);
      }
      break;
    }
    case 'move-unit':
      moveUnitSheet(id);
      break;
    case 'move-unit-to': {
      const u = unit(id);
      const target = el.dataset.course;
      u.courseId = target;
      state.lessons.filter((l) => l.unitId === id).forEach((l) => (l.courseId = target));
      // ans Ende des Zielkurses
      state.units = [...state.units.filter((x) => x.id !== id), u];
      await saveNow();
      closeSheet();
      toast(`Verschoben nach „${course(target).name}“`, 'good');
      go(`#/course/${target}`);
      break;
    }
    case 'more-lessons':
      moreLessons(id);
      break;
    case 'delete-ex': {
      const l = lesson(el.dataset.lesson);
      if (!(await askConfirm('Diese Aufgabe löschen?', 'Löschen'))) return;
      l.exercises = l.exercises.filter((x) => x.id !== id);
      delete state.srs[id];
      save();
      renderEdit(l.id);
      break;
    }
    case 'demo': {
      const cid = addDemoCourse();
      saveNow();
      go(`#/course/${cid}`);
      break;
    }
    case 'pick':
      if (P && P.phase === 'answer') {
        P.selected = Number(el.dataset.i);
        renderPlay();
      }
      break;
    case 'check':
      check();
      break;
    case 'next':
      advance();
      break;
    case 'flip':
      if (P && P.phase === 'answer' && P.queue[0].ex.type === 'flashcard') {
        P.phase = 'flipped';
        renderPlay();
      }
      break;
    case 'self':
      selfGrade(el.dataset.ok === '1');
      break;
    case 'show-solution':
      showResult(false, { answerLine: `<span class="small">Musterlösung:</span> ${esc(P.queue[0].ex.answer)}` });
      break;
    case 'quit':
      if (P && P.solved > 0 && !(await askConfirm('Lektion beenden? Der Fortschritt in dieser Lektion geht verloren, sonst passiert nichts.', 'Beenden'))) return;
      {
        const back = P && P.mode === 'lesson' ? `#/course/${P.courseId}` : P ? '#/review' : '#/';
        P = null;
        go(back);
      }
      break;
    case 'review-due':
      startReview(dueExercises(15), 'Tägliche Wiederholung');
      break;
    case 'review-weak':
      startReview(weakestExercises(10).filter((x) => x.card.lapses > 0), 'Stolpersteine');
      break;
    case 'test-key': {
      const form = document.getElementById('key-form');
      const fd = new FormData(form);
      state.settings.apiKey = String(fd.get('apiKey') || '').trim();
      state.settings.model = String(fd.get('model'));
      save();
      el.disabled = true;
      el.textContent = 'Teste …';
      try {
        await testKey();
        toast('✓ Verbindung klappt!', 'good');
      } catch (err) {
        toast(err.message, 'bad');
      }
      el.disabled = false;
      el.textContent = 'Verbindung testen';
      break;
    }
    case 'retry-upload':
      renderUpload(id);
      break;
    case 'export':
      exportData();
      break;
    case 'reset':
      if (!(await askConfirm('Wirklich ALLE Kurse, Lektionen und Fortschritte löschen?', 'Alles löschen'))) return;
      await resetState();
      go('#/');
      break;
  }
});

// Tastatur: 1–4 wählt Antwort, Enter prüft/weiter, Leertaste dreht Karteikarte
document.addEventListener('keydown', (e) => {
  if (!P || currentHash !== '#/play') return;
  const ex = P.queue[0] && P.queue[0].ex;
  if (!ex) return;
  const inText = e.target.tagName === 'TEXTAREA';
  if (e.key === 'Enter' && !(inText && !e.ctrlKey && !e.metaKey)) {
    e.preventDefault();
    if (P.phase === 'feedback') advance();
    else if (P.phase === 'answer' && ex.type !== 'flashcard') check();
    else if (P.phase === 'answer' && ex.type === 'flashcard') document.querySelector('[data-action="flip"]').click();
  } else if (ex.type === 'mc' && P.phase === 'answer' && /^[1-9]$/.test(e.key)) {
    const i = P.queue[0].order[Number(e.key) - 1];
    if (i != null) {
      P.selected = i;
      renderPlay();
    }
  } else if (ex.type === 'flashcard' && e.key === ' ' && P.phase === 'answer') {
    e.preventDefault();
    P.phase = 'flipped';
    renderPlay();
  }
});

// ---------- Router ----------

let currentHash = location.hash || '#/';

function go(hash, push = true) {
  currentHash = hash;
  if (push && location.hash !== hash) {
    try {
      history.pushState(null, '', hash);
    } catch {
      // eingebettet: Adresse bleibt gleich, die App navigiert trotzdem
    }
  }
  route();
}

// Interne Links abfangen, damit die Navigation auch eingebettet klappt
document.addEventListener('click', (e) => {
  const a = e.target.closest('a[href^="#/"]');
  if (!a) return;
  e.preventDefault();
  go(a.getAttribute('href'));
});

function route() {
  closeSheet();
  const h = currentHash.replace(/^#/, '') || '/';
  const parts = h.split('/').filter(Boolean);
  if (parts[0] !== 'play' && P) P = null;
  switch (parts[0]) {
    case undefined:
      return renderHome();
    case 'course':
      return renderCourse(parts[1]);
    case 'play':
      return renderPlay();
    case 'review':
      return renderReview();
    case 'upload':
      return renderUpload(parts[1]);
    case 'profile':
      return renderProfile();
    case 'settings':
      return renderSettings();
    case 'edit':
      return renderEdit(parts[1]);
    default:
      return renderHome();
  }
}

window.addEventListener('popstate', () => go(location.hash || '#/', false));
window.addEventListener('hashchange', () => {
  if (location.hash && location.hash !== currentHash) go(location.hash, false);
});

onStorageError((msg) => toast(msg, 'bad'));

(async function init() {
  await Promise.all([loadState(), initAI()]);
  route();
  startMath();
  if ('serviceWorker' in navigator && location.protocol !== 'file:') {
    navigator.serviceWorker.register('sw.js').catch(() => {});
  }
})();
