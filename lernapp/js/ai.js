// KI-Anbindung (Claude API) direkt aus dem Browser mit deinem eigenen API-Schlüssel.
// Der Schlüssel bleibt auf deinem Gerät und wird nur an api.anthropic.com geschickt.
import { state, uid } from './store.js';

const SDK_URL = 'https://cdn.jsdelivr.net/npm/@anthropic-ai/sdk@1.6.0/+esm';
let sdkPromise = null;

async function getClient() {
  const apiKey = state.settings.apiKey.trim();
  if (!apiKey) {
    const err = new Error('Kein API-Schlüssel hinterlegt. Trage ihn unter Einstellungen ein.');
    err.code = 'NO_KEY';
    throw err;
  }
  sdkPromise ||= import(SDK_URL);
  const mod = await sdkPromise;
  const Anthropic = mod.default || mod.Anthropic;
  return { client: new Anthropic({ apiKey, dangerouslyAllowBrowser: true }), mod };
}

function friendlyError(e, mod) {
  const A = mod && (mod.default || mod.Anthropic);
  if (A && e instanceof A.AuthenticationError) return 'Der API-Schlüssel ist ungültig. Bitte in den Einstellungen prüfen.';
  if (A && e instanceof A.PermissionDeniedError) return 'Der API-Schlüssel hat keine Berechtigung für dieses Modell.';
  if (A && e instanceof A.RateLimitError) return 'Zu viele Anfragen gerade. Bitte in einer Minute nochmal versuchen.';
  if (A && e instanceof A.BadRequestError) {
    const msg = String(e.message || '');
    if (/credit balance/i.test(msg)) return 'Dein API-Guthaben ist aufgebraucht. Lade es in der Claude Console auf.';
    return 'Die Anfrage wurde abgelehnt: ' + msg;
  }
  if (A && e instanceof A.APIConnectionError) return 'Keine Verbindung zur KI. Bist du online?';
  return e.message || String(e);
}

// Ein Aufruf mit strukturierter JSON-Ausgabe
async function askJSON({ system, content, schema, effort = 'medium', maxTokens = 32000 }) {
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
    throw new Error(friendlyError(e, mod));
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

const GENERATE_SYSTEM = `Du bist Hochschuldidaktiker und erstellst aus Vorlesungsmaterial kurze Lerneinheiten im Stil einer Sprachlern-App: kleine Lektionen mit aktivem Üben.

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
- "source": Fundstelle, z. B. "Folie 12" oder "Seite 4", aus den [Markierungen] im Material. Bei Bildern "Bild 2".

Regeln:
- Verwende nur Inhalte aus dem Material. Erfinde keine Fakten.
- Ignoriere Organisatorisches (Termine, Raumangaben, Namen von Dozierenden, Literaturlisten, Gliederungsfolien).
- Schreibe in der Sprache des Materials (meist Deutsch). Fachbegriffe wie im Material.
- Formeln als einfacher Text (z. B. a^2 + b^2 = c^2).`;

function normalizeExercise(raw) {
  const ex = { id: uid(), type: raw.type, prompt: (raw.prompt || '').trim(), explanation: (raw.explanation || '').trim(), source: (raw.source || '').trim() };
  if (raw.type === 'mc') {
    const opts = (raw.options || []).map((o) => String(o).trim()).filter(Boolean);
    if (opts.length < 2 || raw.correctIndex < 0 || raw.correctIndex >= opts.length) return null;
    ex.options = opts;
    ex.correctIndex = raw.correctIndex;
  } else if (raw.type === 'cloze') {
    if (!ex.prompt.includes('___') || !raw.answer) return null;
    ex.answer = raw.answer.trim();
    ex.alternatives = (raw.alternatives || []).map((a) => String(a).trim()).filter(Boolean);
  } else {
    if (!raw.answer) return null;
    ex.answer = raw.answer.trim();
  }
  return ex.prompt ? ex : null;
}

export async function generateLessons(part, courseName) {
  const content = [
    ...part.content,
    {
      type: 'text',
      text: `Kurs: ${courseName}\nAbschnitt: ${part.label}\n\nErstelle aus diesem Material die Lektionen.${part.scanned ? ' Das Material ist gescannt oder fotografiert; lies auch Handschrift und Tafelbilder sorgfältig.' : ''}`,
    },
  ];
  const data = await askJSON({ system: GENERATE_SYSTEM, content, schema: GENERATE_SCHEMA, effort: 'medium' });
  const lessons = (data.lessons || [])
    .map((l) => ({ title: l.title.trim(), summary: l.summary.trim(), exercises: l.exercises.map(normalizeExercise).filter(Boolean) }))
    .filter((l) => l.exercises.length >= 3);
  return { unitTitle: data.unitTitle, lessons };
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

const GRADE_SYSTEM = `Du bewertest die freie Antwort eines Studierenden auf eine Verständnisfrage, wie ein freundlicher Tutor.
- Bewerte den Inhalt, nicht Rechtschreibung oder Stil. Eigene Formulierungen sind ausdrücklich erwünscht.
- "score": 0–100. "verdict": "richtig" (Kern verstanden, ab ca. 70), "teilweise" (40–69), "falsch" (darunter).
- "feedback": 1–3 Sätze, direkt an den Studierenden ("du"). Nenne zuerst, was gut war, dann was fehlt oder falsch ist.
- "missing": fehlende Kernpunkte als kurze Stichworte (leer, wenn nichts fehlt).`;

export async function gradeFreeAnswer(ex, userAnswer) {
  const content = `Frage: ${ex.prompt}\n\nMusterlösung: ${ex.answer}\n\nAntwort des Studierenden: ${userAnswer}`;
  return askJSON({ system: GRADE_SYSTEM, content, schema: GRADE_SCHEMA, effort: 'low', maxTokens: 4000 });
}

export async function testKey() {
  const { client, mod } = await getClient();
  try {
    await client.messages.create({ model: state.settings.model, max_tokens: 1024, output_config: { effort: 'low' }, messages: [{ role: 'user', content: 'Antworte nur mit: OK' }] });
    return true;
  } catch (e) {
    throw new Error(friendlyError(e, mod));
  }
}
