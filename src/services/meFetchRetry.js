// Shared Magic Eden fetch with backoff for 429/503 (shared Netlify egress IP).
import { devWarn } from '../utils/dom.js';

const DEFAULT_MAX_ATTEMPTS = 6;

function retryAfterMs(response) {
  const h = response.headers.get('Retry-After');
  if (!h) return 0;
  const n = parseInt(h, 10);
  if (!Number.isFinite(n) || n <= 0) return 0;
  if (n > 86400) return 0;
  return n * 1000;
}

/**
 * @param {string} url
 * @param {RequestInit} [init]
 * @param {{ maxAttempts?: number; baseMs?: number }} [options]
 */
export async function fetchMagicEdenWithRetry(url, init = {}, options = {}) {
  const maxAttempts = options.maxAttempts ?? DEFAULT_MAX_ATTEMPTS;
  const baseMs = options.baseMs ?? 700;
  let lastResponse = null;

  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    let res;
    try {
      res = await fetch(url, init);
    } catch (err) {
      // Network error (e.g. DNS failure, offline) — retry with backoff
      if (attempt >= maxAttempts - 1) throw err;
      const backoff = baseMs * 2 ** attempt + Math.random() * 500;
      const wait = Math.min(Math.max(backoff, 400), 90_000);
      devWarn(`Magic Eden network error on ${url.slice(0, 80)}… retry in ${Math.round(wait)}ms`);
      await new Promise((r) => setTimeout(r, wait));
      continue;
    }
    lastResponse = res;
    if (res.status !== 429 && res.status !== 503) return res;
    if (attempt >= maxAttempts - 1) return res;

    const fromHeader = retryAfterMs(res);
    const backoff = fromHeader || baseMs * 2 ** attempt + Math.random() * 500;
    const wait = Math.min(Math.max(backoff, 400), 90_000);
    devWarn(`Magic Eden ${res.status} on ${url.slice(0, 80)}… retry in ${Math.round(wait)}ms`);
    await new Promise((r) => setTimeout(r, wait));
  }

  return lastResponse;
}
