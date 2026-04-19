// Netlify serverless function to proxy Helius API requests in production.
// API key comes from Netlify environment variables (set in dashboard).

const ALLOWED_ORIGINS = (Netlify.env.get('ALLOWED_ORIGINS') || '')
  .split(',')
  .map((s) => s.trim())
  .filter(Boolean);

function corsHeaders(request) {
  const origin = request.headers.get('origin') || '';
  const allow = ALLOWED_ORIGINS.length === 0
    ? origin || '*'
    : (ALLOWED_ORIGINS.includes(origin) ? origin : ALLOWED_ORIGINS[0]);
  return {
    'Access-Control-Allow-Origin': allow,
    'Vary': 'Origin',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
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

  if (request.method !== 'POST') {
    return new Response(JSON.stringify({ error: 'Method not allowed' }), {
      status: 405,
      headers: baseHeaders,
    });
  }

  const HELIUS_API_KEY = Netlify.env.get('HELIUS_API_KEY') || '';
  if (!HELIUS_API_KEY) {
    return new Response(JSON.stringify({ error: 'HELIUS_API_KEY not configured' }), {
      status: 500,
      headers: baseHeaders,
    });
  }

  let body;
  try {
    body = await request.text();
  } catch {
    return new Response(JSON.stringify({ error: 'Invalid request body' }), {
      status: 400,
      headers: baseHeaders,
    });
  }

  if (body && body.length > 64 * 1024) {
    return new Response(JSON.stringify({ error: 'Payload too large' }), {
      status: 413,
      headers: baseHeaders,
    });
  }

  const HELIUS_URL = `https://mainnet.helius-rpc.com/?api-key=${HELIUS_API_KEY}`;

  try {
    const upstream = await fetch(HELIUS_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body,
    });
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
  path: '/api/helius',
};
