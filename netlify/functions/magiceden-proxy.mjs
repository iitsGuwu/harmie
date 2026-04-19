// Netlify serverless function to proxy Magic Eden API requests.
// Only forwards safe GET requests to allow-listed paths.

const ALLOWED_ORIGINS = (Netlify.env.get('ALLOWED_ORIGINS') || '')
  .split(',')
  .map((s) => s.trim())
  .filter(Boolean);

const ALLOWED_PATH_PATTERNS = [
  /^\/v2\/collections\/[a-z0-9_-]+\/listings$/i,
  /^\/v2\/collections\/[a-z0-9_-]+\/activities$/i,
  /^\/v2\/tokens\/[A-Za-z0-9]+$/,
];

function corsHeaders(request) {
  const origin = request.headers.get('origin') || '';
  const allow = ALLOWED_ORIGINS.length === 0
    ? origin || '*'
    : (ALLOWED_ORIGINS.includes(origin) ? origin : ALLOWED_ORIGINS[0]);
  return {
    'Access-Control-Allow-Origin': allow,
    'Vary': 'Origin',
    'Access-Control-Allow-Methods': 'GET, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
  };
}

export default async (request) => {
  const baseHeaders = {
    'Content-Type': 'application/json',
    ...corsHeaders(request),
  };

  if (request.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: corsHeaders(request) });
  }

  if (request.method !== 'GET') {
    return new Response(JSON.stringify({ error: 'Method not allowed' }), {
      status: 405,
      headers: baseHeaders,
    });
  }

  const url = new URL(request.url);
  const mePath = url.pathname.replace(/^\/api\/magiceden/, '');

  const isAllowed = ALLOWED_PATH_PATTERNS.some((re) => re.test(mePath));
  if (!isAllowed) {
    return new Response(JSON.stringify({ error: 'Forbidden path' }), {
      status: 403,
      headers: baseHeaders,
    });
  }

  const meUrl = `https://api-mainnet.magiceden.dev${mePath}${url.search}`;

  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 12_000);
    const upstream = await fetch(meUrl, {
      method: 'GET',
      headers: { 'Accept': 'application/json' },
      signal: controller.signal,
    });
    clearTimeout(timeout);
    const data = await upstream.text();
    return new Response(data, { status: upstream.status, headers: baseHeaders });
  } catch (error) {
    return new Response(JSON.stringify({ error: error.message || 'Upstream error' }), {
      status: 502,
      headers: baseHeaders,
    });
  }
};

export const config = {
  path: '/api/magiceden/*',
};
