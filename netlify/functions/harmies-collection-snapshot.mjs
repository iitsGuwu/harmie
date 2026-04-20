/**
 * Server-side full Harmies list from Helius DAS (getAssetsByGroup + searchAssets).
 * Paginates with retries and inter-page delays, merges both indexers, runs multiple
 * passes when short. Response is CDN-cacheable so one successful aggregation serves
 * many browsers — avoids flaky partial reads from many parallel client calls.
 */

import {
  corsHeadersForAllowedRequest,
  originOrRefererAllowed,
  rateLimitCollectionSnapshot,
} from './proxy-utils.mjs';

const ELO_DEFAULT = 1200;
const MAX_PAGES = 35;
const LIMIT = 1000;
const RPC_PAGE_RETRIES = 5;

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

function collectionMint() {
  return (Netlify.env.get('COLLECTION_MINT') || '').trim() || '5yKCYuZCcJU3aXwppGK87Gi59T6ceNKrTzyXYvJfsp3q';
}

function parseAttributes(attrs) {
  const map = {};
  if (!Array.isArray(attrs)) return map;
  for (const attr of attrs) {
    if (attr?.trait_type && attr.value !== undefined) {
      map[attr.trait_type] = attr.value;
    }
  }
  return map;
}

function toNft(item) {
  try {
    const id = item.id;
    if (!id) return null;
    const content = item.content || {};
    const metadata = content.metadata || {};
    const files = content.files || [];
    const links = content.links || {};

    let imageUrl =
      links.image ||
      links.thumbnail ||
      metadata.image ||
      '';
    if (!imageUrl && files.length > 0) {
      const primary = files.find((f) => f?.mime?.startsWith?.('image/')) || files[0];
      imageUrl = primary?.cdn_uri || primary?.uri || '';
    }
    const attributes = metadata.attributes || [];
    const attributeMap = parseAttributes(attributes);
    const bgColor = attributeMap.Background || attributeMap.background || null;

    return {
      id,
      name: metadata.name || `Harmies #${id.slice(0, 6)}`,
      image: imageUrl,
      description: metadata.description || '',
      attributes: attributeMap,
      bgColor,
      owner: item.ownership?.owner || null,
      listPrice: null,
      highestSale: null,
      eloScore: ELO_DEFAULT,
      rank: null,
      totalMatches: 0,
      wins: 0,
      losses: 0,
    };
  } catch {
    return null;
  }
}

async function heliusRpcOnce(apiKey, method, params) {
  const res = await fetch(`https://mainnet.helius-rpc.com/?api-key=${encodeURIComponent(apiKey)}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: `snap-${method}-${Date.now()}`, method, params }),
  });
  const text = await res.text();
  try {
    return { ok: res.ok, data: JSON.parse(text) };
  } catch {
    return { ok: false, data: { error: { message: 'invalid json' } } };
  }
}

async function heliusRpcWithRetry(apiKey, method, params) {
  for (let attempt = 0; attempt < RPC_PAGE_RETRIES; attempt++) {
    const { ok, data } = await heliusRpcOnce(apiKey, method, params);
    if (data?.error) {
      await sleep(500 * (attempt + 1));
      continue;
    }
    if (!ok) {
      await sleep(400 * (attempt + 1));
      continue;
    }
    return data;
  }
  return { error: { message: 'helius retries exhausted' } };
}

async function fetchByGroup(apiKey) {
  const byId = new Map();
  const mint = collectionMint();
  let page = 1;
  let reportedTotal = Number.POSITIVE_INFINITY;

  while (page <= MAX_PAGES) {
    const data = await heliusRpcWithRetry(apiKey, 'getAssetsByGroup', {
      groupKey: 'collection',
      groupValue: mint,
      page,
      limit: LIMIT,
      sortBy: { sortBy: 'created', sortDirection: 'asc' },
      options: { showGrandTotal: true },
    });
    if (data?.error) break;

    const result = data.result || {};
    if (typeof result.total === 'number' && Number.isFinite(result.total)) {
      reportedTotal = result.total;
    }

    const items = result.items || [];
    if (items.length === 0) break;

    const sizeBefore = byId.size;
    for (const item of items) {
      const nft = toNft(item);
      if (nft?.id) byId.set(nft.id, nft);
    }
    if (byId.size === sizeBefore) break;

    if (byId.size >= reportedTotal) break;

    if (items.length >= LIMIT) {
      page++;
      await sleep(150);
      continue;
    }
    if (reportedTotal !== Number.POSITIVE_INFINITY && byId.size < reportedTotal) {
      page++;
      await sleep(150);
      continue;
    }
    if (items.length > 0) {
      page++;
      await sleep(150);
      continue;
    }
    break;
  }
  return byId;
}

async function fetchBySearch(apiKey) {
  const byId = new Map();
  const mint = collectionMint();
  let page = 1;
  let reportedTotal = Number.POSITIVE_INFINITY;

  while (page <= MAX_PAGES) {
    const data = await heliusRpcWithRetry(apiKey, 'searchAssets', {
      grouping: ['collection', mint],
      tokenType: 'all',
      page,
      limit: LIMIT,
      sortBy: { sortBy: 'id', sortDirection: 'asc' },
      options: { showUnverifiedCollections: true, showGrandTotal: true },
    });
    if (data?.error) break;

    const result = data.result || {};
    if (typeof result.total === 'number' && Number.isFinite(result.total)) {
      reportedTotal = result.total;
    }

    const items = result.items || [];
    if (items.length === 0) break;

    const sizeBefore = byId.size;
    for (const item of items) {
      const nft = toNft(item);
      if (nft?.id) byId.set(nft.id, nft);
    }
    if (byId.size === sizeBefore) break;

    if (byId.size >= reportedTotal) break;

    if (items.length >= LIMIT) {
      page++;
      await sleep(150);
      continue;
    }
    if (reportedTotal !== Number.POSITIVE_INFINITY && byId.size < reportedTotal) {
      page++;
      await sleep(150);
      continue;
    }
    if (items.length > 0) {
      page++;
      await sleep(150);
      continue;
    }
    break;
  }
  return byId;
}

/** Prefer the record with a usable image when both exist. */
function mergeIdMapsPreferRicher(primary, secondary) {
  const out = new Map(primary);
  for (const [k, v] of secondary) {
    const x = out.get(k);
    if (!x) {
      out.set(k, v);
      continue;
    }
    const xImg = String(x.image || '').trim().length;
    const vImg = String(v.image || '').trim().length;
    if (vImg > xImg) {
      out.set(k, { ...x, ...v, image: v.image });
    }
  }
  return out;
}

export default async (request) => {
  const baseHeaders = {
    'Content-Type': 'application/json',
    ...corsHeadersForAllowedRequest(request, 'GET, OPTIONS'),
    'Cache-Control': 'public, max-age=120, s-maxage=300, stale-while-revalidate=900',
  };

  if (request.method === 'OPTIONS') {
    if (!originOrRefererAllowed(request)) {
      return new Response(null, { status: 403 });
    }
    return new Response(null, { status: 204, headers: corsHeadersForAllowedRequest(request, 'GET, OPTIONS') });
  }

  if (request.method !== 'GET') {
    return new Response(JSON.stringify({ error: 'Method not allowed' }), { status: 405, headers: baseHeaders });
  }

  const limited = rateLimitCollectionSnapshot(request);
  if (limited) return limited;

  if (!originOrRefererAllowed(request)) {
    return new Response(JSON.stringify({ error: 'Forbidden origin' }), {
      status: 403,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  const apiKey = (Netlify.env.get('HELIUS_API_KEY') || '').trim();
  if (!apiKey) {
    return new Response(JSON.stringify({ ok: false, error: 'HELIUS_API_KEY not set', nfts: [], count: 0 }), {
      status: 503,
      headers: baseHeaders,
    });
  }

  let merged = new Map();

  for (let round = 0; round < 3; round++) {
    const beforeRound = merged.size;
    const g = await fetchByGroup(apiKey);
    merged = mergeIdMapsPreferRicher(merged, g);
    await sleep(250 + round * 150);
    const s = await fetchBySearch(apiKey);
    merged = mergeIdMapsPreferRicher(merged, s);

    if (merged.size <= beforeRound) break;
    await sleep(1800 + round * 1200);
  }

  const nfts = [...merged.values()];

  return new Response(
    JSON.stringify({
      ok: nfts.length > 0,
      count: nfts.length,
      nfts,
    }),
    { status: 200, headers: baseHeaders },
  );
}

export const config = {
  path: '/api/harmies-collection-snapshot',
};
