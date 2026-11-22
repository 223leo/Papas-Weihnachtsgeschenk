// Ein kleiner Beispielkurs, damit man die App auch ohne API-Schlüssel ausprobieren kann.
import { state, uid, COURSE_COLORS } from './store.js';

const LESSONS = [
  {
    title: 'Warum wir vergessen',
    summary: 'Die Vergessenskurve und was sie fürs Lernen bedeutet.',
    exercises: [
      { type: 'flashcard', prompt: 'Vergessenskurve', answer: 'Beschreibt, wie schnell neu Gelerntes ohne Wiederholung aus dem Gedächtnis verschwindet: anfangs sehr schnell, später langsamer.', explanation: 'Hermann Ebbinghaus hat sie 1885 mit sinnlosen Silben gemessen.', source: 'Folie 2' },
      { type: 'mc', prompt: 'Wann vergessen wir laut Ebbinghaus am meisten?', options: ['In den ersten Stunden nach dem Lernen', 'Nach etwa einer Woche', 'Gleichmäßig über einen Monat verteilt', 'Erst nach mehreren Monaten'], correctIndex: 0, explanation: 'Die Kurve fällt direkt nach dem Lernen am steilsten ab. Deshalb lohnt sich eine erste Wiederholung schon am nächsten Tag.', source: 'Folie 3' },
      { type: 'cloze', prompt: 'Wer den Stoff in wachsenden Abständen wiederholt, nutzt den ___-Effekt.', answer: 'Spacing', alternatives: ['Verteilungs', 'Spacing Effekt', 'Spaced'], explanation: 'Verteiltes Lernen (Spacing) führt zu besserem Behalten als Pauken am Stück (Massed Practice).', source: 'Folie 4' },
      { type: 'mc', prompt: 'Welche Lernstrategie führt langfristig zum besten Behalten?', options: ['Alles am Abend vor der Klausur lernen', 'Den Stoff über mehrere Tage verteilt wiederholen', 'Das Skript fünfmal hintereinander lesen', 'Nur die Zusammenfassung markieren'], correctIndex: 1, explanation: 'Verteilte Wiederholungen bremsen das Vergessen. Mehrfaches Lesen am Stück fühlt sich gut an, bringt aber wenig.', source: 'Folie 4' },
      { type: 'flashcard', prompt: 'Massed Practice', answer: 'Lernen in einem großen Block ohne Pausen („Pauken“). Kurzfristig wirksam, langfristig schlechter als verteiltes Lernen.', explanation: 'Gegenbegriff zu Spaced Practice.', source: 'Folie 5' },
      { type: 'free', prompt: 'Erkläre in eigenen Worten, warum diese App dir Aufgaben an späteren Tagen erneut zeigt.', answer: 'Weil wir ohne Wiederholung schnell vergessen (Vergessenskurve). Wiederholungen in wachsenden Abständen (Spacing) festigen das Wissen, und schwierige Aufgaben kommen häufiger dran.', explanation: 'Das ist das Prinzip der Spaced Repetition.', source: 'Folie 6' },
    ],
  },
  {
    title: 'Aktives Abrufen',
    summary: 'Warum Testen besser wirkt als nochmal Lesen.',
    exercises: [
      { type: 'flashcard', prompt: 'Testing-Effekt (Retrieval Practice)', answer: 'Sich aktiv an Wissen zu erinnern (z. B. durch Fragen) festigt es stärker als erneutes Lesen.', explanation: 'Jeder Abruf stärkt die Gedächtnisspur.', source: 'Folie 8' },
      { type: 'mc', prompt: 'Zwei Gruppen lernen einen Text. Gruppe A liest ihn viermal, Gruppe B liest ihn einmal und beantwortet dann dreimal Fragen dazu. Wer erinnert sich nach einer Woche besser?', options: ['Gruppe A', 'Gruppe B', 'Beide gleich gut', 'Hängt nur von der Textlänge ab'], correctIndex: 1, explanation: 'Das klassische Ergebnis von Roediger & Karpicke (2006): Abrufen schlägt Wiederlesen, besonders langfristig.', source: 'Folie 9' },
      { type: 'cloze', prompt: 'Das Gefühl, etwas zu können, nur weil es beim Lesen bekannt vorkommt, nennt man ___-Illusion.', answer: 'Kompetenz', alternatives: ['Wissens', 'Vertrautheits', 'Kompetenzillusion'], explanation: 'Wiedererkennen ist leichter als Abrufen. Darum täuscht reines Lesen Wissen vor.', source: 'Folie 10' },
      { type: 'mc', prompt: 'Warum sind Fehler beim Üben in dieser App kein Problem?', options: ['Weil sie nicht gezählt werden', 'Weil der Versuch des Abrufens plus Feedback das Lernen sogar verstärkt', 'Weil man dafür extra XP bekommt', 'Weil die Frage danach gelöscht wird'], correctIndex: 1, explanation: 'Ein Abrufversuch mit anschließendem Feedback ist wirksamer als gar kein Versuch, auch wenn er scheitert.', source: 'Folie 11' },
      { type: 'cloze', prompt: 'Verschiedene Themen beim Üben zu mischen, statt sie blockweise zu lernen, heißt ___.', answer: 'Interleaving', alternatives: ['verschachteltes Lernen', 'Interleaved Practice'], explanation: 'Durch das Mischen lernt man, Aufgabentypen zu unterscheiden und die passende Lösung zu wählen.', source: 'Folie 12' },
      { type: 'free', prompt: 'Wie würdest du dich mit Hilfe des Testing-Effekts auf eine Klausur vorbereiten?', answer: 'Statt nur das Skript zu lesen, beantworte ich regelmäßig Fragen zum Stoff, erkläre Inhalte frei aus dem Gedächtnis und prüfe danach, was fehlte. Das verteile ich über mehrere Tage.', explanation: 'Abrufen + Feedback + Verteilung ist die wirksamste Kombination.', source: 'Folie 13' },
    ],
  },
];

export function addDemoCourse() {
  const courseId = uid();
  const unitId = uid();
  state.courses.push({ id: courseId, name: 'Demo: Wie Lernen funktioniert', color: COURSE_COLORS[1], createdAt: Date.now(), demo: true });
  state.units.push({ id: unitId, courseId, title: 'Lernpsychologie kompakt', sourceName: 'Beispielmaterial', createdAt: Date.now() });
  LESSONS.forEach((l, i) => {
    state.lessons.push({
      id: uid(),
      unitId,
      courseId,
      order: i,
      title: l.title,
      summary: l.summary,
      exercises: l.exercises.map((e) => ({ ...e, id: uid() })),
      completedAt: null,
      bestAccuracy: null,
      plays: 0,
    });
  });
  return courseId;
}
