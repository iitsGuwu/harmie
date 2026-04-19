// Shared helpers for Netlify API proxies (origin gate + light rate limiting).

const RL_HELIUS = Symbol.for('harmie.helius.rl');
const RL_ME = Symbol.for('harmie.me.rl');

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

export function originOrRefererAllowed(request) {
  const allowed = collectAllowedOrigins();
  if (allowed.length === 0) return true;

  const origin = normalizeOrigin(request.headers.get('origin'));
  const referer = request.headers.get('referer') || '';

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

export function rateLimitHelius(request) {
  return checkRateLimit(request, RL_HELIUS, 90, 60_000);
}

export function rateLimitMagicEden(request) {
  return checkRateLimit(request, RL_ME, 200, 60_000);
}
