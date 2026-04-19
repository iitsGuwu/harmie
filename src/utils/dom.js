// Shared DOM and string utilities

const ESCAPE_MAP = {
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&#39;',
  '/': '&#x2F;',
  '`': '&#x60;',
  '=': '&#x3D;',
};

export function escapeHtml(value) {
  if (value === null || value === undefined) return '';
  const str = typeof value === 'string' ? value : String(value);
  return str.replace(/[&<>"'`=/]/g, (ch) => ESCAPE_MAP[ch] || ch);
}

export function escapeAttr(value) {
  return escapeHtml(value);
}

const SAFE_URL_RE = /^(https?:|\/|#|mailto:)/i;

export function safeUrl(value, fallback = '#') {
  if (typeof value !== 'string' || !value) return fallback;
  if (SAFE_URL_RE.test(value)) return value;
  return fallback;
}

const FALLBACK_IMAGE_DATA_URL = (() => {
  const svg =
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 200 200">' +
    '<rect width="200" height="200" fill="#1c2240"/>' +
    '<text x="100" y="115" text-anchor="middle" font-family="Inter, sans-serif" font-size="46" fill="#bcc6e5">?</text>' +
    '</svg>';
  return `data:image/svg+xml;utf8,${encodeURIComponent(svg)}`;
})();

export const FALLBACK_IMAGE = FALLBACK_IMAGE_DATA_URL;

export function attachImageFallback(img) {
  if (!img) return;
  let triedFallback = false;
  img.addEventListener('error', () => {
    if (triedFallback) return;
    triedFallback = true;
    img.src = FALLBACK_IMAGE_DATA_URL;
  });
}

export function applyImageFallbacks(scope = document) {
  if (!scope) return;
  const root = scope.querySelectorAll ? scope : document;
  root.querySelectorAll('img[data-fallback]').forEach((img) => attachImageFallback(img));
}

export function debounce(fn, wait = 200) {
  let timer;
  return function debounced(...args) {
    clearTimeout(timer);
    timer = setTimeout(() => fn.apply(this, args), wait);
  };
}

const DEV = (() => {
  try {
    return Boolean(import.meta?.env?.DEV);
  } catch {
    return false;
  }
})();

export function devLog(...args) {
  if (DEV) console.log(...args);
}

export function devWarn(...args) {
  if (DEV) console.warn(...args);
}
