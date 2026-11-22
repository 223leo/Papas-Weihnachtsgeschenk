// Liest Vorlesungsdateien im Browser aus und teilt sie in Häppchen für die KI.
// PDF -> pdf.js, PPTX/DOCX -> JSZip, Bilder -> direkt an die KI (sie liest Handschrift/Scans).
//
// Ergebnis pro Häppchen ("part"): { label, text?, images?: Blob[], pdfFile?: File, scanned? }

const PDFJS = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.min.js';
const PDFJS_WORKER = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';
const JSZIP = 'https://cdnjs.cloudflare.com/ajax/libs/jszip/3.10.1/jszip.min.js';

const CHUNK_CHARS = 9000; // ca. 2–3 Lektionen pro KI-Aufruf
const MAX_PAGES = 200;

const loaded = {};
function loadScript(src) {
  if (!loaded[src]) {
    loaded[src] = new Promise((resolve, reject) => {
      const s = document.createElement('script');
      s.src = src;
      s.onload = resolve;
      s.onerror = () => {
        delete loaded[src];
        reject(new Error('Eine benötigte Bibliothek konnte nicht geladen werden. Bist du online?'));
      };
      document.head.appendChild(s);
    });
  }
  return loaded[src];
}

function canvasToBlob(canvas) {
  return new Promise((resolve, reject) =>
    canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('Bild konnte nicht erzeugt werden'))), 'image/jpeg', 0.85),
  );
}

// Fotos verkleinern und als JPEG speichern: spart Kosten und klappt mit allen Formaten, die der Browser lesen kann
async function imageToJpegBlob(file, maxSide = 1600) {
  const url = URL.createObjectURL(file);
  try {
    const img = await new Promise((resolve, reject) => {
      const i = new Image();
      i.onload = () => resolve(i);
      i.onerror = () => reject(new Error(`${file.name}: Bild konnte nicht gelesen werden (HEIC bitte als JPG speichern).`));
      i.src = url;
    });
    const scale = Math.min(1, maxSide / Math.max(img.width, img.height));
    const canvas = document.createElement('canvas');
    canvas.width = Math.round(img.width * scale);
    canvas.height = Math.round(img.height * scale);
    canvas.getContext('2d').drawImage(img, 0, 0, canvas.width, canvas.height);
    return await canvasToBlob(canvas);
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
    if (buf.trim()) parts.push({ label: first === last ? first : `${first} – ${last}`, text: buf.trim() });
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
  return parts;
}

function groupImages(images, labels, size) {
  const parts = [];
  for (let i = 0; i < images.length; i += size) {
    const imgs = images.slice(i, i + size);
    const names = labels.slice(i, i + size);
    parts.push({
      label: names.length === 1 ? names[0] : `${names[0]} – ${names[names.length - 1]}`,
      images: imgs,
      imageLabels: names,
      scanned: true,
    });
  }
  return parts;
}

async function extractPdf(file, opts) {
  await loadScript(PDFJS);
  const pdfjs = window.pdfjsLib;
  pdfjs.GlobalWorkerOptions.workerSrc = PDFJS_WORKER;
  const doc = await pdfjs.getDocument({ data: await file.arrayBuffer() }).promise;
  const sections = [];
  let chars = 0;
  for (let p = 1; p <= doc.numPages; p++) {
    const page = await doc.getPage(p);
    const tc = await page.getTextContent();
    let text = '';
    for (const item of tc.items) text += item.str + (item.hasEOL ? '\n' : ' ');
    chars += text.trim().length;
    sections.push({ label: `Seite ${p}`, text });
  }
  const scanned = chars < 80 * doc.numPages;
  if (!opts.pageImages) {
    if (!scanned) return chunkSections(sections);
    throw new Error(`${file.name}: Das PDF ist eingescannt und kann hier nicht als Bild an die KI gegeben werden.`);
  }

  // Seitenbilder mitschicken: Formeln, Diagramme und Notation bleiben so originalgetreu.
  // Der automatisch gelesene Text dient nur als Hilfe (er verstümmelt Formeln oft).
  const pages = Math.min(doc.numPages, MAX_PAGES);
  const parts = [];
  let group = [];
  let groupChars = 0;
  const flush = () => {
    if (!group.length) return;
    const first = group[0].label;
    const last = group[group.length - 1].label;
    const text = group.map((g) => (g.text.trim() ? `[${g.label}]\n${g.text.trim()}` : '')).filter(Boolean).join('\n\n');
    parts.push({ label: first === last ? first : `${first} – ${last}`, pdfPages: group.map((g) => g.page), imageLabels: group.map((g) => g.label), text, scanned, doc });
    group = [];
    groupChars = 0;
  };
  for (let p = 1; p <= pages; p++) {
    const sec = sections[p - 1];
    const len = sec.text.trim().length;
    if (group.length >= opts.maxImages || (group.length && groupChars + len > CHUNK_CHARS)) flush();
    group.push({ page: p, label: sec.label, text: sec.text });
    groupChars += len;
  }
  flush();
  // Bilder werden erst kurz vor dem KI-Aufruf erzeugt (spart Speicher)
  for (const part of parts) part.loadImages = () => renderPages(part.doc, part.pdfPages);
  return parts;
}

async function renderPages(doc, pageNumbers) {
  const images = [];
  for (const p of pageNumbers) {
    const page = await doc.getPage(p);
    const base = page.getViewport({ scale: 1 });
    const viewport = page.getViewport({ scale: Math.min(3, 1800 / Math.max(base.width, base.height)) });
    const canvas = document.createElement('canvas');
    canvas.width = Math.round(viewport.width);
    canvas.height = Math.round(viewport.height);
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#fff';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    await page.render({ canvasContext: ctx, viewport }).promise;
    images.push(await canvasToBlob(canvas));
    canvas.width = canvas.height = 0;
  }
  return images;
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
    const paras = xml.split(/<\/a:p>/).map((p) => [...p.matchAll(/<(?:a|m):t(?:\s[^>]*)?>([\s\S]*?)<\/(?:a|m):t>/g)].map((m) => decodeXml(m[1])).join(''));
    let text = paras.filter(Boolean).join('\n');
    const notes = zip.file(`ppt/notesSlides/notesSlide${num}.xml`);
    if (notes) {
      const nx = await notes.async('string');
      const nt = [...nx.matchAll(/<a:t>([\s\S]*?)<\/a:t>/g)].map((m) => decodeXml(m[1])).join(' ').trim();
      if (nt && !/^\d+$/.test(nt)) text += `\n(Notizen: ${nt})`;
    }
    sections.push({ label: `Folie ${num}`, text });
  }
  if (!sections.some((s) => s.text.trim())) throw new Error(`${file.name}: Keine Texte in den Folien gefunden. Exportiere die Folien als PDF und lade das hoch.`);
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
    .map((p) => [...p.matchAll(/<(?:w|m):t(?:\s[^>]*)?>([\s\S]*?)<\/(?:w|m):t>/g)].map((m) => decodeXml(m[1])).join(''))
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
  return chunkByParagraphs((await file.text()).split(/\n/));
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

// Gibt eine Liste von Quellen zurück: {title, parts}
// Bilder werden zu EINER Quelle zusammengefasst (z. B. alle Fotos einer Vorlesung).
// opts: { onStatus, pageImages (PDF-Seiten als Bilder mitschicken), maxImages (Bilder pro KI-Aufruf) }
export async function extractFiles(files, opts = {}) {
  const o = { onStatus: () => {}, pageImages: true, maxImages: 4, ...opts };
  const sources = [];
  const images = [];
  for (const file of files) {
    const kind = fileKind(file);
    o.onStatus(`Lese ${file.name} …`);
    if (kind === 'image') {
      images.push(file);
      continue;
    }
    let parts;
    if (kind === 'pdf') parts = await extractPdf(file, o);
    else if (kind === 'pptx') parts = await extractPptx(file);
    else if (kind === 'docx') parts = await extractDocx(file);
    else if (kind === 'text') parts = await extractText(file);
    else if (kind === 'legacy') throw new Error(`${file.name}: Alte .ppt/.doc-Dateien bitte als .pptx/.docx oder PDF speichern.`);
    else throw new Error(`${file.name}: Dieser Dateityp wird nicht unterstützt.`);
    if (!parts.length) throw new Error(`${file.name}: Keinen Inhalt gefunden.`);
    sources.push({ title: file.name.replace(/\.[^.]+$/, ''), parts });
  }
  if (images.length) {
    o.onStatus(`Bereite ${images.length} Bild(er) vor …`);
    const blobs = [];
    for (const f of images) blobs.push(await imageToJpegBlob(f));
    sources.push({
      title: images.length === 1 ? images[0].name.replace(/\.[^.]+$/, '') : 'Fotos & Scans',
      parts: groupImages(blobs, images.map((f, i) => `Bild ${i + 1}`), o.maxImages),
    });
  }
  return sources;
}
