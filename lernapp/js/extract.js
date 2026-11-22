// Liest Vorlesungsdateien im Browser aus und teilt sie in Häppchen für die KI.
// PDF -> pdf.js, PPTX/DOCX -> JSZip, Bilder -> direkt an die KI (sie liest Handschrift/Scans).

const PDFJS = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.min.js';
const PDFJS_WORKER = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';
const JSZIP = 'https://cdnjs.cloudflare.com/ajax/libs/jszip/3.10.1/jszip.min.js';

const CHUNK_CHARS = 9000; // ca. 2–3 Lektionen pro KI-Aufruf
const MAX_IMAGES_PER_PART = 4;

const loaded = {};
function loadScript(src) {
  if (!loaded[src]) {
    loaded[src] = new Promise((resolve, reject) => {
      const s = document.createElement('script');
      s.src = src;
      s.onload = resolve;
      s.onerror = () => reject(new Error('Bibliothek konnte nicht geladen werden (offline?): ' + src));
      document.head.appendChild(s);
    });
  }
  return loaded[src];
}

function fileToBase64(file) {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result).split(',')[1]);
    r.onerror = () => reject(r.error);
    r.readAsDataURL(file);
  });
}

// Fotos verkleinern: spart Kosten und bleibt unter den API-Limits
async function imageToJpegBase64(file, maxSide = 1600) {
  const url = URL.createObjectURL(file);
  try {
    const img = await new Promise((resolve, reject) => {
      const i = new Image();
      i.onload = () => resolve(i);
      i.onerror = () => reject(new Error('Bild konnte nicht gelesen werden: ' + file.name));
      i.src = url;
    });
    const scale = Math.min(1, maxSide / Math.max(img.width, img.height));
    const canvas = document.createElement('canvas');
    canvas.width = Math.round(img.width * scale);
    canvas.height = Math.round(img.height * scale);
    canvas.getContext('2d').drawImage(img, 0, 0, canvas.width, canvas.height);
    return canvas.toDataURL('image/jpeg', 0.85).split(',')[1];
  } finally {
    URL.revokeObjectURL(url);
  }
}

function decodeXml(s) {
  return s
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)))
    .replace(/&amp;/g, '&');
}

// Seiten/Folien zu Häppchen zusammenfassen, Quelle ("Folie 3") bleibt im Text markiert
function chunkSections(sections) {
  const parts = [];
  let buf = '';
  let first = null;
  let last = null;
  const flush = () => {
    if (buf.trim()) parts.push({ label: first === last ? first : `${first} – ${last}`, text: buf });
    buf = '';
    first = null;
  };
  for (const sec of sections) {
    const t = sec.text.replace(/[ \t]+/g, ' ').replace(/\n{3,}/g, '\n\n').trim();
    if (!t) continue;
    if (buf.length + t.length > CHUNK_CHARS && buf) flush();
    if (!first) first = sec.label;
    last = sec.label;
    buf += `\n\n[${sec.label}]\n${t.slice(0, CHUNK_CHARS * 2)}`;
  }
  flush();
  return parts.map((p) => ({ label: p.label, content: [{ type: 'text', text: p.text.trim() }] }));
}

async function extractPdf(file) {
  await loadScript(PDFJS);
  const pdfjs = window.pdfjsLib;
  pdfjs.GlobalWorkerOptions.workerSrc = PDFJS_WORKER;
  const buf = await file.arrayBuffer();
  const doc = await pdfjs.getDocument({ data: buf }).promise;
  const sections = [];
  let chars = 0;
  for (let p = 1; p <= doc.numPages; p++) {
    const page = await doc.getPage(p);
    const tc = await page.getTextContent();
    let text = '';
    for (const item of tc.items) {
      text += item.str + (item.hasEOL ? '\n' : ' ');
    }
    chars += text.trim().length;
    sections.push({ label: `Seite ${p}`, text });
  }
  // Kaum Text gefunden -> eingescannt. Dann geht das PDF als Dokument direkt an die KI.
  if (chars < 80 * doc.numPages) {
    if (file.size > 25 * 1024 * 1024) {
      throw new Error(`${file.name}: Eingescanntes PDF ist zu groß (max. 25 MB). Bitte aufteilen.`);
    }
    const data = await fileToBase64(file);
    return [
      {
        label: `${doc.numPages} Seiten (Scan)`,
        content: [{ type: 'document', source: { type: 'base64', media_type: 'application/pdf', data } }],
        scanned: true,
      },
    ];
  }
  return chunkSections(sections);
}

async function extractPptx(file) {
  await loadScript(JSZIP);
  const zip = await window.JSZip.loadAsync(file);
  const slideFiles = Object.keys(zip.files)
    .filter((n) => /^ppt\/slides\/slide\d+\.xml$/.test(n))
    .sort((a, b) => Number(a.match(/(\d+)\.xml$/)[1]) - Number(b.match(/(\d+)\.xml$/)[1]));
  const sections = [];
  for (const name of slideFiles) {
    const num = Number(name.match(/(\d+)\.xml$/)[1]);
    const xml = await zip.file(name).async('string');
    const paras = xml.split(/<\/a:p>/).map((p) => [...p.matchAll(/<a:t>([\s\S]*?)<\/a:t>/g)].map((m) => decodeXml(m[1])).join(''));
    let text = paras.filter(Boolean).join('\n');
    const notes = zip.file(`ppt/notesSlides/notesSlide${num}.xml`);
    if (notes) {
      const nx = await notes.async('string');
      const nt = [...nx.matchAll(/<a:t>([\s\S]*?)<\/a:t>/g)].map((m) => decodeXml(m[1])).join(' ').trim();
      if (nt && !/^\d+$/.test(nt)) text += `\n(Notizen: ${nt})`;
    }
    sections.push({ label: `Folie ${num}`, text });
  }
  if (!sections.some((s) => s.text.trim())) throw new Error(`${file.name}: Keine Texte in den Folien gefunden.`);
  return chunkSections(sections);
}

async function extractDocx(file) {
  await loadScript(JSZIP);
  const zip = await window.JSZip.loadAsync(file);
  const doc = zip.file('word/document.xml');
  if (!doc) throw new Error(`${file.name}: Keine gültige Word-Datei.`);
  const xml = await doc.async('string');
  const paras = xml
    .split(/<\/w:p>/)
    .map((p) => [...p.matchAll(/<w:t(?:\s[^>]*)?>([\s\S]*?)<\/w:t>/g)].map((m) => decodeXml(m[1])).join(''))
    .filter((t) => t.trim());
  return chunkByParagraphs(paras);
}

function chunkByParagraphs(paras) {
  // Abschnitte à ~1500 Zeichen, damit die Quellenangabe ("Abschnitt 4") brauchbar bleibt
  const sections = [];
  let buf = '';
  for (const p of paras) {
    buf += p + '\n';
    if (buf.length > 1500) {
      sections.push({ label: `Abschnitt ${sections.length + 1}`, text: buf });
      buf = '';
    }
  }
  if (buf.trim()) sections.push({ label: `Abschnitt ${sections.length + 1}`, text: buf });
  return chunkSections(sections);
}

async function extractText(file) {
  const text = await file.text();
  return chunkByParagraphs(text.split(/\n/));
}

async function extractImages(files) {
  const parts = [];
  for (let i = 0; i < files.length; i += MAX_IMAGES_PER_PART) {
    const group = files.slice(i, i + MAX_IMAGES_PER_PART);
    const content = [];
    for (const [j, f] of group.entries()) {
      content.push({ type: 'text', text: `[Bild ${i + j + 1}: ${f.name}]` });
      content.push({ type: 'image', source: { type: 'base64', media_type: 'image/jpeg', data: await imageToJpegBase64(f) } });
    }
    parts.push({ label: group.length === 1 ? group[0].name : `Bilder ${i + 1}–${i + group.length}`, content, scanned: true });
  }
  return parts;
}

export function fileKind(file) {
  const n = file.name.toLowerCase();
  if (n.endsWith('.pdf') || file.type === 'application/pdf') return 'pdf';
  if (n.endsWith('.pptx')) return 'pptx';
  if (n.endsWith('.docx')) return 'docx';
  if (n.endsWith('.txt') || n.endsWith('.md') || file.type.startsWith('text/')) return 'text';
  if (file.type.startsWith('image/') || /\.(jpe?g|png|webp|heic|gif)$/.test(n)) return 'image';
  if (n.endsWith('.ppt') || n.endsWith('.doc')) return 'legacy';
  return 'unknown';
}

// Gibt eine Liste von "Quellen" zurück: {title, parts:[{label, content}]}
// Bilder werden zu EINER Quelle zusammengefasst (z. B. alle Fotos einer Vorlesung).
export async function extractFiles(files, onStatus = () => {}) {
  const sources = [];
  const images = [];
  for (const file of files) {
    const kind = fileKind(file);
    onStatus(`Lese ${file.name} …`);
    if (kind === 'image') {
      images.push(file);
      continue;
    }
    let parts;
    if (kind === 'pdf') parts = await extractPdf(file);
    else if (kind === 'pptx') parts = await extractPptx(file);
    else if (kind === 'docx') parts = await extractDocx(file);
    else if (kind === 'text') parts = await extractText(file);
    else if (kind === 'legacy') throw new Error(`${file.name}: Alte .ppt/.doc-Dateien bitte als .pptx/.docx oder PDF speichern.`);
    else throw new Error(`${file.name}: Dateityp wird nicht unterstützt.`);
    sources.push({ title: file.name.replace(/\.[^.]+$/, ''), parts });
  }
  if (images.length) {
    onStatus(`Bereite ${images.length} Bild(er) vor …`);
    sources.push({ title: images.length === 1 ? images[0].name.replace(/\.[^.]+$/, '') : 'Fotos & Scans', parts: await extractImages(images) });
  }
  return sources;
}
