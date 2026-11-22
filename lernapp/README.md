# Lernpfad: Vorlesungen lernen wie mit einer Sprach-App

Lade deine Vorlesungsunterlagen hoch, und eine KI macht daraus kurze Lektionen in einem Lernpfad. Es gibt keine Herzen und keine Leben: Fehler gehören zum Lernen dazu.

## Was Version 1 kann

**Lernpfad mit kurzen Lektionen**
- Pro Kurs ein Lernpfad. Jede hochgeladene Datei wird ein Abschnitt mit mehreren Lektionen (je 6–8 Aufgaben, 3–5 Minuten).
- Lektionen werden nacheinander freigeschaltet. In den Einstellungen kannst du alle Lektionen auf einmal freischalten.

**Aktives Üben**
- Multiple Choice, Lückentext (verzeiht kleine Tippfehler), Karteikarten und freie Antworten.
- Freie Antworten bewertet die KI und sagt dir, welche Punkte fehlen.
- Bei einem Fehler siehst du die richtige Antwort, eine Erklärung und die Fundstelle (z. B. „Folie 12“). Die Aufgabe kommt am Ende der Lektion nochmal.
- Spaced Repetition: Abgeschlossene Aufgaben kommen nach 1, 3, 7, 16 … Tagen wieder, falsch beantwortete schon am nächsten Tag. Dazu gibt es „Stolpersteine üben“.

**Motivation**
- XP, Level, ein Tagesziel (einstellbar) und eine Lernserie (Streak).
- Serienschutz: Alle 7 Tage am Stück bekommst du einen (höchstens 2). Er rettet deine Serie, wenn du einen Tag verpasst.
- Wochenübersicht, Erfolge und eine „Wochenliga“ gegen deine eigenen XP der Vorwoche.

**Dateien:** PDF, PowerPoint (.pptx), Word (.docx), Text und Fotos/Scans (die KI liest auch Handschrift). Eingescannte PDFs werden automatisch erkannt.

## Starten

### Variante A: direkt auf claude.ai (am einfachsten)

Die App läuft als Seite auf claude.ai. Dort nutzt sie **dein Claude-Konto**: Du brauchst keinen API-Schlüssel, und jede erstellte Lektion zählt zu deinem normalen Nutzungslimit. Beim ersten Hochladen fragt claude.ai, ob die App Claude nutzen darf.

Deine Kurse und Fortschritte liegen dort in deinem privaten Speicher. Nur du kannst sie sehen, auch wenn du den Link teilst, und du hast sie auf jedem Gerät, auf dem du bei claude.ai angemeldet bist.

### Variante B: als eigene Web-App (mit API-Schlüssel)

1. Lokal starten:
   ```bash
   cd lernapp
   python3 -m http.server 8000
   ```
   Dann http://localhost:8000 öffnen. (Ein Doppelklick auf `index.html` reicht nicht.)
2. Oder kostenlos online mit **GitHub Pages**: Im Repository unter *Settings → Pages* den Branch auswählen. Die App liegt dann unter `…github.io/<repo>/lernapp/`.
3. Am Handy: Seite öffnen und *„Zum Home-Bildschirm hinzufügen“* wählen.
4. KI einrichten: Auf https://platform.claude.com ein Konto anlegen, Guthaben aufladen, einen API-Schlüssel erstellen und ihn in der App unter **Einstellungen → KI** eintragen. Der Schlüssel bleibt auf deinem Gerät.

Ohne KI kannst du den **Demo-Kurs** ausprobieren. Freie Antworten bewertest du dann selbst. Das geht auf Wunsch auch mit KI: *Einstellungen → Freie Antworten bewerten*.

## Daten

In Variante A liegen die Daten in deinem privaten Speicher auf claude.ai, in Variante B lokal im Browser (IndexedDB). Unter *Einstellungen → Daten* kannst du eine Sicherung herunterladen und wieder laden, zum Beispiel für einen Gerätewechsel.

## Aufbau

| Datei | Inhalt |
|---|---|
| `js/app.js` | Oberfläche: Lernpfad, Lektions-Player, Upload, Profil, Einstellungen |
| `js/ai.js` | KI: über dein Claude-Konto oder die Claude API; Lektionen erzeugen, freie Antworten bewerten |
| `js/extract.js` | Text aus PDF/PPTX/DOCX lesen, Bilder vorbereiten, in Abschnitte teilen |
| `js/srs.js` | Spaced Repetition (vereinfachtes SM-2) |
| `js/gamification.js` | XP, Level, Streak, Serienschutz, Erfolge |
| `js/store.js` | Speicher (claude.ai-Cloud oder IndexedDB) und Datenmodell |
| `js/demo.js` | Demo-Kurs |
| `sw.js` | Offline-Unterstützung |

## Ideen für später

- KI-Anpassung: Schwierigkeit und Aufgabenauswahl passen sich deinen Schwächen an, und die KI erstellt Extra-Übungen zu Stolpersteinen.
- Klausurmodus mit Prüfungsdatum und Lernplan.
- Konten und Sync zwischen Geräten (z. B. Supabase), Ligen und Freundesmissionen.
