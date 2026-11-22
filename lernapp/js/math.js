// Mathematische Formeln (LaTeX zwischen \( … \) und \[ … \]) schön darstellen.
// MathJax mit SVG-Ausgabe: braucht keine extra Schriftdateien und folgt der Textfarbe.

const MATHJAX = 'https://cdnjs.cloudflare.com/ajax/libs/mathjax/3.2.2/es5/tex-svg.js';
let loading = null;
let running = false;
let again = false;

function hasMath(root) {
  const t = root.textContent || '';
  return t.includes('\\(') || t.includes('\\[');
}

function loadMathJax() {
  if (!loading) {
    window.MathJax = {
      tex: {
        inlineMath: [['\\(', '\\)']],
        displayMath: [['\\[', '\\]']],
        processEscapes: false,
      },
      svg: { fontCache: 'global' },
      options: { skipHtmlTags: ['script', 'noscript', 'style', 'textarea', 'pre', 'code', 'input', 'select', 'option'] },
      startup: { typeset: false },
    };
    loading = new Promise((resolve, reject) => {
      const s = document.createElement('script');
      s.src = MATHJAX;
      s.async = true;
      s.onload = () => window.MathJax.startup.promise.then(resolve, reject);
      s.onerror = () => {
        loading = null;
        reject(new Error('Formel-Darstellung konnte nicht geladen werden'));
      };
      document.head.appendChild(s);
    });
  }
  return loading;
}

async function typeset() {
  if (running) {
    again = true;
    return;
  }
  running = true;
  try {
    do {
      again = false;
      if (!hasMath(document.body)) break;
      await loadMathJax();
      await window.MathJax.typesetPromise([document.body]);
    } while (again);
  } catch {
    // Ohne MathJax bleibt der LaTeX-Text lesbar stehen
  } finally {
    running = false;
  }
}

// Jede Änderung der Seite prüfen und neue Formeln setzen
export function startMath() {
  let timer = null;
  const obs = new MutationObserver(() => {
    clearTimeout(timer);
    timer = setTimeout(typeset, 20);
  });
  obs.observe(document.body, { childList: true, subtree: true });
  typeset();
}
