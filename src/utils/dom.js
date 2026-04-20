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

/** Turn ipfs://… into https so <img> can load it. */
export function normalizeNftMediaUrl(url) {
  if (typeof url !== 'string') return '';
  const s = url.trim();
  if (!s) return '';
  if (s.startsWith('ipfs://')) {
    const rest = s.slice('ipfs://'.length).replace(/^ipfs\//, '');
    return `https://ipfs.io/ipfs/${rest}`;
  }
  return s;
}

/**
 * For https URLs that already contain /ipfs/<cid>/…, try public gateways if the first host 404s
 * (e.g. Pinata subdomain pin gone but CID still on the network).
 */
export function buildIpfsHttpGatewayCandidates(url) {
  const u = normalizeNftMediaUrl(typeof url === 'string' ? url.trim() : '');
  if (!u || !/^https?:\/\//i.test(u)) return [u].filter(Boolean);
  const lower = u.toLowerCase();
  if (!lower.includes('/ipfs/')) return [u];
  const i = u.indexOf('/ipfs/');
  if (i === -1) return [u];
  const path = u.slice(i);
  if (!/\/ipfs\/(Qm[1-9A-HJ-NP-Za-km-z]{44,}|bafy[a-z2-7]{50,})/i.test(path)) return [u];
  const hosts = [
    u,
    `https://ipfs.io${path}`,
    `https://nftstorage.link${path}`,
    `https://w3s.link${path}`,
    `https://dweb.link${path}`,
  ];
  return [...new Set(hosts)];
}

export function attachImageFallback(img) {
  if (!img) return;
  const raw = String(img.getAttribute('src') || img.src || '').trim();
  const normalized = normalizeNftMediaUrl(raw);
  if (normalized && normalized !== raw) {
    img.setAttribute('src', normalized);
    img.src = normalized;
  }
  const seed = String(img.getAttribute('src') || img.src || '').trim() || normalized;
  const candidates = buildIpfsHttpGatewayCandidates(seed);
  const list = candidates.length > 0 ? candidates : [FALLBACK_IMAGE_DATA_URL];
  let idx = 0;
  img.onerror = () => {
    idx += 1;
    if (idx < list.length) {
      img.src = list[idx];
      return;
    }
    img.onerror = null;
    img.src = FALLBACK_IMAGE_DATA_URL;
  };
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
