// Netlify serverless function to proxy Magic Eden API requests.
// Only forwards safe GET requests to allow-listed paths.

import {
  collectAllowedOrigins,
  originOrRefererAllowed,
  rateLimitMagicEden,
} from './proxy-utils.mjs';

const ALLOWED_PATH_PATTERNS = [
  /^\/v2\/collections\/[a-z0-9_-]+\/listings$/i,
  /^\/v2\/collections\/[a-z0-9_-]+\/activities$/i,
  /^\/v2\/collections\/[a-z0-9_-]+\/tokens$/i,
  /^\/v2\/tokens\/[A-Za-z0-9]+$/,
];

function corsHeaders(request) {
  const origin = (request.headers.get('origin') || '').trim().replace(/\/+$/, '');
  const allowed = collectAllowedOrigins();
  let allowOrigin = '';
  if (allowed.length === 0) {
    allowOrigin = origin || '*';
  } else if (origin && allowed.includes(origin)) {
    allowOrigin = origin;
  } else {
    allowOrigin = allowed[0] || '*';
  }
  return {
    'Access-Control-Allow-Origin': allowOrigin,
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
    if (!originOrRefererAllowed(request)) {
      return new Response(null, { status: 403 });
    }
    return new Response(null, { status: 204, headers: corsHeaders(request) });
  }

  if (request.method !== 'GET') {
    return new Response(JSON.stringify({ error: 'Method not allowed' }), {
      status: 405,
      headers: baseHeaders,
    });
  }

  const limited = rateLimitMagicEden(request);
  if (limited) return limited;

  if (!originOrRefererAllowed(request)) {
    return new Response(JSON.stringify({ error: 'Forbidden origin' }), {
      status: 403,
      headers: { 'Content-Type': 'application/json' },
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
