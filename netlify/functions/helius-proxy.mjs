// Netlify serverless function to proxy Helius DAS requests in production.
// API key stays server-side. JSON-RPC methods are allow-listed; origins gated.

import {
  collectAllowedOrigins,
  originOrRefererAllowed,
  rateLimitHelius,
} from './proxy-utils.mjs';

const HELIUS_ALLOWED_METHODS = new Set(['getAssetsByGroup', 'searchAssets']);

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
    if (!originOrRefererAllowed(request)) {
      return new Response(null, { status: 403 });
    }
    return new Response(null, { status: 204, headers: corsHeaders(request) });
  }

  if (request.method !== 'POST') {
    return new Response(JSON.stringify({ error: 'Method not allowed' }), {
      status: 405,
      headers: baseHeaders,
    });
  }

  const limited = rateLimitHelius(request);
  if (limited) return limited;

  if (!originOrRefererAllowed(request)) {
    return new Response(JSON.stringify({ error: 'Forbidden origin' }), {
      status: 403,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  const HELIUS_API_KEY = Netlify.env.get('HELIUS_API_KEY') || '';
  if (!HELIUS_API_KEY) {
    return new Response(JSON.stringify({ jsonrpc: '2.0', id: 'helius-unconfigured', result: { items: [] } }), {
      status: 200,
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

  let parsed;
  try {
    parsed = JSON.parse(body);
  } catch {
    return new Response(JSON.stringify({ error: 'Invalid JSON' }), {
      status: 400,
      headers: baseHeaders,
    });
  }

  const method = parsed?.method;
  if (typeof method !== 'string' || !HELIUS_ALLOWED_METHODS.has(method)) {
    return new Response(JSON.stringify({ error: 'RPC method not allowed' }), {
      status: 403,
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
