// Shared helpers for Netlify API proxies (origin gate + light rate limiting).

const RL_HELIUS = Symbol.for('harmie.helius.rl');
const RL_ME = Symbol.for('harmie.me.rl');
const RL_SNAPSHOT = Symbol.for('harmie.collection-snapshot.rl');

function clientIp(request) {
  return (
    request.headers.get('cf-connecting-ip') ||
    request.headers.get('x-nf-client-connection-ip') ||
    request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ||
    ''
  ).trim() || 'unknown';
}

function normalizeOrigin(u) {
  return String(u || '')
    .trim()
    .replace(/\/+$/, '');
}

/**
 * Origins allowed to call browser-facing proxies. Prefer setting ALLOWED_ORIGINS
 * in Netlify (comma-separated). URL / DEPLOY_PRIME_URL are added automatically.
 */
export function collectAllowedOrigins() {
  const fromEnv = (Netlify.env.get('ALLOWED_ORIGINS') || '')
    .split(',')
    .map((s) => normalizeOrigin(s))
    .filter(Boolean);
  const url = normalizeOrigin(Netlify.env.get('URL'));
  const prime = normalizeOrigin(Netlify.env.get('DEPLOY_PRIME_URL'));
  const ctx = (Netlify.env.get('CONTEXT') || '').trim();
  const local = [];
  if (ctx === 'dev' || ctx === '') {
    local.push(
      'http://localhost:8888',
      'http://127.0.0.1:8888',
      'http://localhost:5173',
      'http://127.0.0.1:5173',
    );
  }
  return [...new Set([...fromEnv, url, prime, ...local].filter(Boolean))];
}

function hostnameMatchesRequest(request, urlStr) {
  const hostHdr = (request.headers.get('host') || '').split(':')[0].toLowerCase();
  if (!hostHdr || !urlStr) return false;
  try {
    return new URL(urlStr).hostname.toLowerCase() === hostHdr;
  } catch {
    return false;
  }
}

/**
 * Allows: (1) browser same-origin (Origin/Referer host matches request Host — fixes custom domains
 * without extra env), (2) explicit ALLOWED_ORIGINS / Netlify URL list.
 * Does not allow arbitrary cross-origin callers when the allowlist is empty.
 */
export function originOrRefererAllowed(request) {
  const origin = normalizeOrigin(request.headers.get('origin'));
  const referer = (request.headers.get('referer') || '').trim();

  if (origin && hostnameMatchesRequest(request, origin)) return true;
  if (referer && hostnameMatchesRequest(request, referer)) return true;

  const allowed = collectAllowedOrigins();
  if (allowed.length === 0) return false;

  for (const a of allowed) {
    if (origin && origin === a) return true;
    if (referer) {
      const r = referer.startsWith('http') ? referer : '';
      if (r && (r.startsWith(`${a}/`) || r === a)) return true;
    }
  }
  return false;
}

export function forbiddenOriginResponse() {
  return new Response(JSON.stringify({ error: 'Forbidden origin' }), {
    status: 403,
    headers: { 'Content-Type': 'application/json' },
  });
}

/** Reflect the caller's Origin when allowed (fixes custom domains vs Netlify URL list). */
export function corsHeadersForAllowedRequest(request, allowMethods) {
  const origin = normalizeOrigin(request.headers.get('origin'));
  const referer = (request.headers.get('referer') || '').trim();
  let allowOrigin = '';
  if (originOrRefererAllowed(request)) {
    if (origin) {
      allowOrigin = origin;
    } else if (referer) {
      try {
        allowOrigin = normalizeOrigin(new URL(referer).origin);
      } catch {
        allowOrigin = '';
      }
    }
    if (!allowOrigin) {
      const allowed = collectAllowedOrigins();
      allowOrigin = allowed[0] || '*';
    }
  } else {
    // Disallowed origin — return no CORS headers so browsers block the response.
    return { 'Vary': 'Origin' };
  }
  return {
    'Access-Control-Allow-Origin': allowOrigin,
    'Vary': 'Origin',
    'Access-Control-Allow-Methods': allowMethods,
    'Access-Control-Allow-Headers': 'Content-Type',
  };
}

export function checkRateLimit(request, bucketSym, max, windowMs) {
  const ip = clientIp(request);
  const g = (globalThis[bucketSym] ||= new Map());
  const now = Date.now();
  const row = g.get(ip);
  if (!row || now - row.t >= windowMs) {
    g.set(ip, { t: now, n: 1 });
    return null;
  }
  row.n += 1;
  if (row.n > max) {
    return new Response(JSON.stringify({ error: 'Too many requests' }), {
      status: 429,
      headers: { 'Content-Type': 'application/json' },
    });
  }
  return null;
}

/** Initial collection load can issue many parallel / sequential ME requests. */
export function rateLimitHelius(request) {
  return checkRateLimit(request, RL_HELIUS, 800, 60_000);
}

/** High ceiling: collection token pagination issues many sequential GETs from one browser IP. */
export function rateLimitMagicEden(request) {
  return checkRateLimit(request, RL_ME, 12_000, 60_000);
}

/** Expensive Helius aggregation — low per-IP limit; CDN cache reduces repeat hits. */
export function rateLimitCollectionSnapshot(request) {
  return checkRateLimit(request, RL_SNAPSHOT, 12, 60_000);
}
