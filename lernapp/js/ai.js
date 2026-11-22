// KI-Anbindung. Zwei Wege:
// 1. Auf claude.ai geöffnet: über dein Claude-Konto (kein API-Schlüssel nötig).
// 2. Als normale Web-App: Claude API mit deinem eigenen Schlüssel. Der Schlüssel
//    bleibt auf deinem Gerät und wird nur an api.anthropic.com geschickt.
import { state, uid } from './store.js';

const SDK_URL = 'https://cdn.jsdelivr.net/npm/@anthropic-ai/sdk@1.6.0/+esm';
let sdkPromise = null;

// ---------- Welcher Weg ist verfügbar? ----------

let sample = null; // Claude über claude.ai
let sampleLimits = null;

export async function initAI() {
  if (!window.claude || typeof window.claude.use !== 'function') return;
  try {
    sample = await window.claude.use('sample');
    if (sample) sampleLimits = await sample.limits().catch(() => null);
  } catch {
    sample = null;
  }
}

// 'claude' = über dein Claude-Konto, 'api' = eigener Schlüssel, null = keine KI
export function aiMode() {
  if (sample) return 'claude';
  if (state.settings.apiKey && state.settings.apiKey.trim()) return 'api';
  return null;
}

export function extractOptions() {
  if (aiMode() === 'claude') {
    const max = sampleLimits && sampleLimits.images ? sampleLimits.images.maxCount : 0;
    return { renderScans: true, maxImages: Math.max(1, Math.min(max || 1, 8)), imagesAllowed: !!max };
  }
  return { renderScans: false, maxImages: 4, imagesAllowed: true };
}

const SAMPLE_ERRORS = {
  not_granted: 'Du hast der App nicht erlaubt, Claude zu nutzen. Lade die Seite neu und erlaube es im Dialog.',
  sampling_disabled: 'Claude ist für dein Konto hier nicht verfügbar.',
  rate_limited: 'Dein Claude-Nutzungslimit ist gerade erreicht oder es waren zu viele Anfragen. Versuch es später nochmal.',
  session_expired: 'Bitte melde dich bei claude.ai neu an.',
  refused: 'Claude hat diesen Abschnitt nicht verarbeitet.',
  prompt_too_large: 'Der Abschnitt ist zu groß für eine Anfrage.',
  images_unavailable: 'Bilder können hier nicht an Claude geschickt werden.',
  image_rejected: 'Ein Bild wurde nicht angenommen (Format oder Größe).',
  invalid_json: 'Die Antwort von Claude war unvollständig. Bitte nochmal versuchen.',
  empty_completion: 'Claude hat keine Antwort geliefert. Bitte nochmal versuchen.',
  upstream_error: 'Verbindungsproblem mit Claude. Bitte nochmal versuchen.',
};

function sampleError(e) {
  const base = (e && SAMPLE_ERRORS[e.code]) || (e && e.message) || 'Unbekannter Fehler mit Claude.';
  const err = new Error(`${base} [Code: ${(e && e.code) || 'unbekannt'}${e && e.message && SAMPLE_ERRORS[e.code] ? ' – ' + String(e.message).slice(0, 160) : ''}]`);
  err.fatal = e && ['not_granted', 'sampling_disabled', 'rate_limited', 'session_expired'].includes(e.code);
  return err;
}

// ---------- Weg 2: Claude API mit eigenem Schlüssel ----------

async function getClient() {
  const apiKey = state.settings.apiKey.trim();
  if (!apiKey) throw new Error('Kein API-Schlüssel hinterlegt. Trage ihn unter Einstellungen ein.');
  sdkPromise ||= import(SDK_URL);
  const mod = await sdkPromise;
  const Anthropic = mod.default || mod.Anthropic;
  return { client: new Anthropic({ apiKey, dangerouslyAllowBrowser: true }), mod };
}

function friendlyError(e, mod) {
  const A = mod && (mod.default || mod.Anthropic);
  const wrap = (msg, fatal) => Object.assign(new Error(msg), { fatal });
  if (A && e instanceof A.AuthenticationError) return wrap('Der API-Schlüssel ist ungültig. Bitte in den Einstellungen prüfen.', true);
  if (A && e instanceof A.PermissionDeniedError) return wrap('Der API-Schlüssel hat keine Berechtigung für dieses Modell.', true);
  if (A && e instanceof A.RateLimitError) return wrap('Zu viele Anfragen gerade. Bitte in einer Minute nochmal versuchen.', true);
  if (A && e instanceof A.BadRequestError) {
    const msg = String(e.message || '');
    if (/credit balance/i.test(msg)) return wrap('Dein API-Guthaben ist aufgebraucht. Lade es in der Claude Console auf.', true);
    return wrap('Die Anfrage wurde abgelehnt: ' + msg, false);
  }
  if (A && e instanceof A.APIConnectionError) return wrap('Keine Verbindung zur KI. Bist du online?', true);
  return wrap(e.message || String(e), false);
}

function blobToBase64(blob) {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result).split(',')[1]);
    r.onerror = () => reject(r.error);
    r.readAsDataURL(blob);
  });
}

async function apiJSON({ system, content, schema, effort, maxTokens }) {
  const { client, mod } = await getClient();
  const model = state.settings.model;
  const params = {
    model,
    max_tokens: maxTokens,
    system,
    messages: [{ role: 'user', content }],
    output_config: { effort, format: { type: 'json_schema', schema } },
  };
  // Falls die KI eine Anfrage fälschlich ablehnt, springt automatisch ein anderes Modell ein
  if (model === 'claude-opus-5-5' || model === 'claude-sonnet-5-5') {
    params.betas = ['server-side-fallback-2026-07-01'];
    params.fallbacks = 'default';
  }
  let msg;
  try {
    msg = await client.beta.messages.stream(params).finalMessage();
  } catch (e) {
    throw friendlyError(e, mod);
  }
  if (msg.stop_reason === 'refusal') throw new Error('Die KI hat diesen Inhalt nicht verarbeitet. Versuche einen anderen Abschnitt.');
  if (msg.stop_reason === 'max_tokens') throw new Error('Die Antwort der KI war zu lang. Versuche eine kleinere Datei.');
  const text = msg.content.filter((b) => b.type === 'text').map((b) => b.text).join('');
  try {
    return JSON.parse(text);
  } catch {
    throw new Error('Die KI-Antwort konnte nicht gelesen werden. Bitte nochmal versuchen.');
  }
}

export async function testKey() {
  const { client, mod } = await getClient();
  try {
    await client.messages.create({ model: state.settings.model, max_tokens: 1024, output_config: { effort: 'low' }, messages: [{ role: 'user', content: 'Antworte nur mit: OK' }] });
    return true;
  } catch (e) {
    throw friendlyError(e, mod);
  }
}

// ---------- Lektionen erzeugen ----------

const EXERCISE_SCHEMA = {
  type: 'object',
  properties: {
    type: { type: 'string', enum: ['mc', 'cloze', 'flashcard', 'free'] },
    prompt: { type: 'string' },
    options: { type: 'array', items: { type: 'string' } },
    correctIndex: { type: 'integer' },
    answer: { type: 'string' },
    alternatives: { type: 'array', items: { type: 'string' } },
    explanation: { type: 'string' },
    source: { type: 'string' },
  },
  required: ['type', 'prompt', 'options', 'correctIndex', 'answer', 'alternatives', 'explanation', 'source'],
  additionalProperties: false,
};

const GENERATE_SCHEMA = {
  type: 'object',
  properties: {
    unitTitle: { type: 'string' },
    lessons: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          title: { type: 'string' },
          summary: { type: 'string' },
          exercises: { type: 'array', items: EXERCISE_SCHEMA },
        },
        required: ['title', 'summary', 'exercises'],
        additionalProperties: false,
      },
    },
  },
  required: ['unitTitle', 'lessons'],
  additionalProperties: false,
};

const GENERATE_RULES = `Du bist Hochschuldidaktiker und erstellst aus Vorlesungsmaterial kurze Lerneinheiten im Stil einer Sprachlern-App: kleine Lektionen mit aktivem Üben.

Ziel: Der Studierende soll den Stoff wirklich verstehen und für die Klausur behalten.

Aufbau:
- Teile den Inhalt in 1 bis 4 Lektionen, je nach Menge. Jede Lektion behandelt EIN zusammenhängendes Unterthema und dauert 3–5 Minuten.
- Jede Lektion hat 6–8 Aufgaben. Beginne leichter (Begriffe, Definitionen) und steigere zu Zusammenhängen und Anwendung.
- Mische die Aufgabentypen. Pro Lektion höchstens eine Aufgabe vom Typ "free".
- "title": kurz und konkret (max. 6 Wörter). "summary": 1–2 Sätze, was man in der Lektion lernt.
- "unitTitle": kurzer Titel für das gesamte Material.

Aufgabentypen und Felder (nicht benötigte Felder leer lassen: "" bzw. [] bzw. 0):
- "mc": "prompt" = Frage, "options" = genau 4 Antworten, "correctIndex" = Index der richtigen (0–3). Falsche Antworten müssen plausibel sein (typische Missverständnisse), nicht offensichtlich absurd. Verteile die Position der richtigen Antwort.
- "cloze": "prompt" = ein Satz mit genau einer Lücke, geschrieben als ___ (drei Unterstriche). "answer" = das fehlende Wort bzw. der Fachbegriff (1–3 Wörter). "alternatives" = weitere korrekte Schreibweisen oder Synonyme.
- "flashcard": "prompt" = Vorderseite (Begriff oder kurze Frage), "answer" = Rückseite (prägnante Definition/Antwort, max. 2 Sätze).
- "free": "prompt" = Verständnisfrage, die man in eigenen Worten beantwortet (z. B. "Erkläre, warum …"). "answer" = Musterlösung mit den Kernpunkten (2–4 Sätze).

Für jede Aufgabe:
- "explanation": 1–3 Sätze, WARUM die Antwort stimmt. Hilfreich für jemanden, der falsch lag.
- "source": Fundstelle, z. B. "Folie 12" oder "Seite 4", aus den [Markierungen] im Material. Bei Bildern "Bild 2" bzw. die genannte Seite.

Regeln:
- Verwende nur Inhalte aus dem Material. Erfinde keine Fakten.
- Ignoriere Organisatorisches (Termine, Raumangaben, Namen von Dozierenden, Literaturlisten, Gliederungsfolien).
- Schreibe in der Sprache des Materials (meist Deutsch). Fachbegriffe wie im Material.
- Formeln als einfacher Text (z. B. a^2 + b^2 = c^2).`;

const JSON_FORMAT = `Antworte ausschließlich mit einem JSON-Objekt in genau dieser Form, ohne weiteren Text:
{"unitTitle": "…", "lessons": [{"title": "…", "summary": "…", "exercises": [
  {"type": "mc", "prompt": "…", "options": ["…","…","…","…"], "correctIndex": 2, "answer": "", "alternatives": [], "explanation": "…", "source": "Folie 3"},
  {"type": "cloze", "prompt": "Satz mit ___ Lücke", "options": [], "correctIndex": 0, "answer": "Begriff", "alternatives": ["Synonym"], "explanation": "…", "source": "Folie 4"}
]}]}`;

function normalizeExercise(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const ex = { id: uid(), type: raw.type, prompt: String(raw.prompt || '').trim(), explanation: String(raw.explanation || '').trim(), source: String(raw.source || '').trim() };
  if (raw.type === 'mc') {
    const opts = (Array.isArray(raw.options) ? raw.options : []).map((o) => String(o).trim()).filter(Boolean);
    const ci = Number(raw.correctIndex);
    if (opts.length < 2 || !Number.isInteger(ci) || ci < 0 || ci >= opts.length) return null;
    ex.options = opts;
    ex.correctIndex = ci;
  } else if (raw.type === 'cloze') {
    if (!ex.prompt.includes('___') || !raw.answer) return null;
    ex.answer = String(raw.answer).trim();
    ex.alternatives = (Array.isArray(raw.alternatives) ? raw.alternatives : []).map((a) => String(a).trim()).filter(Boolean);
  } else if (raw.type === 'flashcard' || raw.type === 'free') {
    if (!raw.answer) return null;
    ex.answer = String(raw.answer).trim();
  } else {
    return null;
  }
  return ex.prompt ? ex : null;
}

function cleanResult(data) {
  const lessons = (data && Array.isArray(data.lessons) ? data.lessons : [])
    .map((l) => ({
      title: String(l.title || 'Lektion').trim(),
      summary: String(l.summary || '').trim(),
      exercises: (Array.isArray(l.exercises) ? l.exercises : []).map(normalizeExercise).filter(Boolean),
    }))
    .filter((l) => l.exercises.length >= 3);
  return { unitTitle: data && data.unitTitle ? String(data.unitTitle).trim() : '', lessons };
}

function partIntro(part, courseName) {
  let t = `Kurs: ${courseName}\nAbschnitt: ${part.label}\n\n`;
  if (part.scanned) t += 'Das Material ist gescannt oder fotografiert; lies auch Handschrift und Tafelbilder sorgfältig.\n\n';
  if (part.imageLabels) t += `Die Bilder sind der Reihe nach: ${part.imageLabels.join(', ')}. Nutze diese Namen als Fundstelle.\n\n`;
  return t;
}

export async function generateLessons(part, courseName, signal) {
  const mode = aiMode();
  if (mode === 'claude') {
    const prompt = `${GENERATE_RULES}\n\n${JSON_FORMAT}\n\n${partIntro(part, courseName)}${part.text ? `MATERIAL:\n${part.text}\n\n` : ''}Erstelle jetzt aus diesem Material die Lektionen als JSON.`;
    const opts = { modelTier: 'default', signal };
    if (part.images && part.images.length) opts.images = part.images;
    try {
      return cleanResult(await sample.json(prompt, opts));
    } catch (e) {
      throw sampleError(e);
    }
  }
  if (mode === 'api') {
    const content = [];
    if (part.text) content.push({ type: 'text', text: part.text });
    if (part.pdfFile) content.push({ type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: await blobToBase64(part.pdfFile) } });
    if (part.images) {
      for (const [i, img] of part.images.entries()) {
        content.push({ type: 'text', text: `[${part.imageLabels ? part.imageLabels[i] : `Bild ${i + 1}`}]` });
        content.push({ type: 'image', source: { type: 'base64', media_type: 'image/jpeg', data: await blobToBase64(img) } });
      }
    }
    content.push({ type: 'text', text: `${partIntro(part, courseName)}Erstelle aus diesem Material die Lektionen.` });
    return cleanResult(await apiJSON({ system: GENERATE_RULES, content, schema: GENERATE_SCHEMA, effort: 'medium', maxTokens: 32000 }));
  }
  throw Object.assign(new Error('Keine KI verfügbar. Trage unter Einstellungen einen API-Schlüssel ein.'), { fatal: true });
}

// ---------- Freie Antworten bewerten ----------

const GRADE_SCHEMA = {
  type: 'object',
  properties: {
    score: { type: 'integer' },
    verdict: { type: 'string', enum: ['richtig', 'teilweise', 'falsch'] },
    feedback: { type: 'string' },
    missing: { type: 'array', items: { type: 'string' } },
  },
  required: ['score', 'verdict', 'feedback', 'missing'],
  additionalProperties: false,
};

const GRADE_RULES = `Du bewertest die freie Antwort eines Studierenden auf eine Verständnisfrage, wie ein freundlicher Tutor.
- Bewerte den Inhalt, nicht Rechtschreibung oder Stil. Eigene Formulierungen sind ausdrücklich erwünscht.
- "score": 0–100. "verdict": "richtig" (Kern verstanden, ab ca. 70), "teilweise" (40–69), "falsch" (darunter).
- "feedback": 1–3 Sätze, direkt an den Studierenden ("du"). Nenne zuerst, was gut war, dann was fehlt oder falsch ist.
- "missing": fehlende Kernpunkte als kurze Stichworte (leer, wenn nichts fehlt).`;

export async function gradeFreeAnswer(ex, userAnswer) {
  const task = `Frage: ${ex.prompt}\n\nMusterlösung: ${ex.answer}\n\nAntwort des Studierenden: ${userAnswer}`;
  let g;
  if (aiMode() === 'claude') {
    try {
      g = await sample.json(
        `${GRADE_RULES}\n\nAntworte nur mit JSON: {"score": 80, "verdict": "richtig", "feedback": "…", "missing": ["…"]}\n\n${task}`,
        { modelTier: 'quick' },
      );
    } catch (e) {
      throw sampleError(e);
    }
  } else {
    g = await apiJSON({ system: GRADE_RULES, content: task, schema: GRADE_SCHEMA, effort: 'low', maxTokens: 4000 });
  }
  const score = Math.max(0, Math.min(100, Math.round(Number(g && g.score) || 0)));
  const verdict = ['richtig', 'teilweise', 'falsch'].includes(g && g.verdict) ? g.verdict : score >= 70 ? 'richtig' : score >= 40 ? 'teilweise' : 'falsch';
  return { score, verdict, feedback: String((g && g.feedback) || ''), missing: Array.isArray(g && g.missing) ? g.missing.map(String) : [] };
}
