// NFT Collection Data Service
// Primary: Helius DAS (getAssetsByGroup → searchAssets). Magic Eden is used only
// if Helius still returns an incomplete set, then listings/activities as last resort.
import { CONFIG } from '../config.js';
import { devWarn, devLog, normalizeNftMediaUrl } from '../utils/dom.js';
import { fetchMagicEdenWithRetry } from './meFetchRetry.js';

let cachedNFTs = null;
let cacheTimestamp = 0;

const HELIUS_MAX_PAGES = 30;
const ME_TOKEN_DETAIL_LIMIT = 600;
const ME_TOKEN_DETAIL_CONCURRENCY = 4;
const ME_COLLECTION_TOKEN_LIMIT = 100;
const ME_COLLECTION_TOKEN_MAX_PAGES = 60;

/**
 * Netlify-only: one server-side Helius aggregation (CDN-cached). Skips 404 in local Vite dev.
 */
async function tryNetlifyCollectionSnapshot(onProgress) {
  const path = CONFIG.HARMIES_COLLECTION_SNAPSHOT_URL;
  if (!path || typeof path !== 'string' || !path.startsWith('/')) return null;
  try {
    const res = await fetch(path, { method: 'GET', credentials: 'same-origin' });
    if (!res.ok) return null;
    const body = await res.json();
    if (!body?.nfts || !Array.isArray(body.nfts) || body.nfts.length === 0) {
      return null;
    }
    if (onProgress) {
      onProgress(`Loaded ${body.nfts.length} Harmies (server index)…`, 26);
    }
    return body.nfts;
  } catch {
    return null;
  }
}

export async function fetchAllHarmies(onProgress) {
  if (
    cachedNFTs &&
    Date.now() - cacheTimestamp < CONFIG.CACHE_TTL_MS &&
    cachedNFTs.length > 0
  ) {
    return cachedNFTs;
  }

  const snapshotNfts = await tryNetlifyCollectionSnapshot(onProgress);
  if (snapshotNfts) {
    let allNFTs = snapshotNfts;
    await enrichMissingFromMagicEden(allNFTs, onProgress);
    if (allNFTs.length === 0) {
      if (onProgress) onProgress('Helius empty — Magic Eden listings & activity…', 32);
      allNFTs = await fetchFromMagicEden(onProgress);
    }
    allNFTs.sort((a, b) => {
      const numA = extractNumber(a.name);
      const numB = extractNumber(b.name);
      if (numA !== null && numB !== null) return numA - numB;
      return a.name.localeCompare(b.name);
    });
    if (onProgress) onProgress(`Loaded ${allNFTs.length} Harmies!`, 100);
    cachedNFTs = allNFTs;
    cacheTimestamp = Date.now();
    return allNFTs;
  }

  if (onProgress) onProgress('Loading from Helius…', 10);

  let allNFTs = await fetchFromHelius(onProgress);

  // Always merge search index and a couple of retries; stop if no new NFTs are found.
  if (onProgress) onProgress('Merging Helius search index…', 18);
  allNFTs = mergeById(allNFTs, await fetchFromHeliusSearchAssets(onProgress));
  for (let attempt = 0; attempt < 2; attempt++) {
    const before = allNFTs.length;
    const waitMs = 1500 + attempt * 1500;
    if (onProgress) onProgress('Helius partial — retrying…', 20 + attempt * 2);
    await delay(waitMs);
    allNFTs = mergeById(allNFTs, await fetchFromHelius(onProgress));
    allNFTs = mergeById(allNFTs, await fetchFromHeliusSearchAssets(onProgress));
    if (allNFTs.length <= before) break;
  }

  // Always try collection tokens as an additive merge (not a threshold fallback).
  if (onProgress) onProgress('Merging Magic Eden collection index…', 28);
  const meCollection = await fetchFromMagicEdenCollectionTokens(onProgress);
  allNFTs = mergeById(allNFTs, meCollection);

  await enrichMissingFromMagicEden(allNFTs, onProgress);

  if (allNFTs.length === 0) {
    if (onProgress) onProgress('Helius empty — Magic Eden listings & activity…', 32);
    allNFTs = await fetchFromMagicEden(onProgress);
  }

  allNFTs.sort((a, b) => {
    const numA = extractNumber(a.name);
    const numB = extractNumber(b.name);
    if (numA !== null && numB !== null) return numA - numB;
    return a.name.localeCompare(b.name);
  });

  if (onProgress) onProgress(`Loaded ${allNFTs.length} Harmies!`, 100);

  cachedNFTs = allNFTs;
  cacheTimestamp = Date.now();
  return allNFTs;
}

export function primeNFTCache(nfts) {
  if (Array.isArray(nfts) && nfts.length > 0) {
    cachedNFTs = nfts;
    cacheTimestamp = Date.now();
  }
}

async function fetchFromHelius(onProgress) {
  const byId = new Map();
  let page = 1;
  const limit = 1000;
  let reportedTotal = Number.POSITIVE_INFINITY;

  while (page <= HELIUS_MAX_PAGES) {
    let response;
    try {
      response = await fetch(CONFIG.HELIUS_RPC_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          jsonrpc: '2.0',
          id: `harmies-page-${page}`,
          method: 'getAssetsByGroup',
          params: {
            groupKey: 'collection',
            groupValue: CONFIG.COLLECTION_MINT,
            page,
            limit,
            sortBy: { sortBy: 'created', sortDirection: 'asc' },
            options: { showGrandTotal: true },
          },
        }),
      });
    } catch (err) {
      devWarn('Helius fetch error:', err.message);
      return [...byId.values()];
    }

    if (!response.ok) return [...byId.values()];

    let data;
    try {
      data = await response.json();
    } catch {
      return [...byId.values()];
    }
    if (data.error) {
      devWarn('Helius error:', data.error.message);
      return [...byId.values()];
    }

    const result = data.result || {};
    if (typeof result.total === 'number' && Number.isFinite(result.total)) {
      reportedTotal = result.total;
    }

    const items = result.items || [];
    if (items.length === 0) break;

    const sizeBefore = byId.size;
    for (const item of items) {
      const nft = parseHeliusAsset(item);
      if (nft) byId.set(nft.id, nft);
    }
    if (byId.size === sizeBefore) break;

    if (onProgress) {
      onProgress(
        `Found ${byId.size} Harmies via RPC...`,
        Math.min(90, 20 + byId.size / 5),
      );
    }

    if (byId.size >= reportedTotal) break;

    if (items.length >= limit) {
      page++;
      continue;
    }

    if (reportedTotal !== Number.POSITIVE_INFINITY && byId.size < reportedTotal) {
      page++;
      continue;
    }

    // No grand total (or already satisfied): if this page had any rows, Helius may still have
    // more pages even when len < limit — do not stop here or we truncate the gallery.
    if (items.length > 0) {
      page++;
      continue;
    }
  }

  if (import.meta.env.DEV) {
    devLog(
      `[Helius getAssetsByGroup] unique mints=${byId.size} reportedTotal=${reportedTotal === Number.POSITIVE_INFINITY ? '?' : reportedTotal}`,
    );
  }

  return [...byId.values()];
}

/** Second Helius DAS path (same primary source as getAssetsByGroup). */
async function fetchFromHeliusSearchAssets(onProgress) {
  const byId = new Map();
  let page = 1;
  const limit = 1000;
  let reportedTotal = Number.POSITIVE_INFINITY;

  while (page <= HELIUS_MAX_PAGES) {
    let response;
    try {
      response = await fetch(CONFIG.HELIUS_RPC_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          jsonrpc: '2.0',
          id: `harmies-search-${page}`,
          method: 'searchAssets',
          params: {
            grouping: ['collection', CONFIG.COLLECTION_MINT],
            tokenType: 'all',
            page,
            limit,
            sortBy: { sortBy: 'id', sortDirection: 'asc' },
            options: { showUnverifiedCollections: true, showGrandTotal: true },
          },
        }),
      });
    } catch (err) {
      devWarn('Helius searchAssets error:', err.message);
      return [...byId.values()];
    }

    if (!response.ok) return [...byId.values()];

    let data;
    try {
      data = await response.json();
    } catch {
      return [...byId.values()];
    }
    if (data.error) {
      devWarn('Helius searchAssets RPC error:', data.error.message);
      return [...byId.values()];
    }

    const result = data.result || {};
    if (typeof result.total === 'number' && Number.isFinite(result.total)) {
      reportedTotal = result.total;
    }

    const items = result.items || [];
    if (items.length === 0) break;

    const sizeBefore = byId.size;
    for (const item of items) {
      const nft = parseHeliusAsset(item);
      if (nft) byId.set(nft.id, nft);
    }
    if (byId.size === sizeBefore) break;

    if (onProgress) {
      onProgress(
        `Indexed ${byId.size} Harmies (search)...`,
        Math.min(88, 22 + byId.size / 6),
      );
    }

    if (byId.size >= reportedTotal) break;

    if (items.length >= limit) {
      page++;
      continue;
    }

    if (reportedTotal !== Number.POSITIVE_INFINITY && byId.size < reportedTotal) {
      page++;
      continue;
    }

    if (items.length > 0) {
      page++;
      continue;
    }
  }

  if (import.meta.env.DEV) {
    devLog(
      `[Helius searchAssets] unique mints=${byId.size} reportedTotal=${reportedTotal === Number.POSITIVE_INFINITY ? '?' : reportedTotal}`,
    );
  }

  return [...byId.values()];
}

async function fetchFromMagicEden(onProgress) {
  const nftMap = new Map();
  let offset = 0;
  const limit = 20;
  let pages = 0;
  const maxPages = 30;
  let hasMore = true;

  while (hasMore && pages < maxPages) {
    try {
      const url = `${CONFIG.ME_API_BASE}/collections/${CONFIG.ME_COLLECTION_SYMBOL}/listings?offset=${offset}&limit=${limit}&listingAggMode=true`;
      const response = await fetchMagicEdenWithRetry(url);

      if (!response.ok) {
        break;
      }

      const data = await response.json();
      if (!Array.isArray(data) || data.length === 0) break;

      for (const listing of data) {
        const token = listing.token || {};
        const mint = listing.tokenMint || token.mintAddress;
        if (!mint) continue;

        nftMap.set(mint, {
          id: mint,
          name: token.name || `Harmies #${mint.slice(0, 6)}`,
          image: normalizeNftMediaUrl(token.image || listing.extra?.img || ''),
          description: '',
          attributes: parseAttributes(token.attributes || []),
          bgColor: (token.attributes || []).find((a) => a.trait_type === 'Background')?.value || null,
          owner: token.owner || listing.seller || null,
          listPrice: listing.price || null,
          highestSale: null,
          eloScore: CONFIG.ELO_DEFAULT,
          rank: null,
          totalMatches: 0,
          wins: 0,
          losses: 0,
        });
      }

      offset += data.length;
      pages++;
      if (data.length < limit) hasMore = false;

      if (onProgress) {
        onProgress(`Found ${nftMap.size} listed Harmies...`, Math.min(60, 20 + nftMap.size / 2));
      }
      await delay(250);
    } catch (err) {
      devWarn('ME listing fetch error:', err.message);
      break;
    }
  }

  if (onProgress) onProgress('Scanning activity history...', 65);

  let actOffset = 0;
  let actPages = 0;
  while (actPages < 10) {
    try {
      const url = `${CONFIG.ME_API_BASE}/collections/${CONFIG.ME_COLLECTION_SYMBOL}/activities?offset=${actOffset}&limit=100`;
      const response = await fetchMagicEdenWithRetry(url);
      if (!response.ok) break;

      const activities = await response.json();
      if (!Array.isArray(activities) || activities.length === 0) break;

      for (const act of activities) {
        const mint = act.tokenMint;
        if (!mint || nftMap.has(mint)) continue;

        nftMap.set(mint, {
          id: mint,
          name: `Harmies #${mint.slice(0, 6)}`,
          image: '',
          description: '',
          attributes: {},
          bgColor: null,
          owner: act.buyer || act.seller || null,
          listPrice: null,
          highestSale: act.price || null,
          eloScore: CONFIG.ELO_DEFAULT,
          rank: null,
          totalMatches: 0,
          wins: 0,
          losses: 0,
        });
      }

      actOffset += activities.length;
      actPages++;
      if (activities.length < 100) break;
      await delay(250);
    } catch {
      break;
    }
  }

  // Fill missing token detail with bounded concurrency
  const unknownMints = [...nftMap.values()].filter((n) => !n.image).slice(0, ME_TOKEN_DETAIL_LIMIT);
  if (unknownMints.length > 0) {
    let processed = 0;
    await runWithConcurrency(unknownMints, ME_TOKEN_DETAIL_CONCURRENCY, async (nft) => {
      try {
        const url = `${CONFIG.ME_API_BASE}/tokens/${nft.id}`;
        const response = await fetchMagicEdenWithRetry(url);
        if (response.ok) {
          const token = await response.json();
          nft.name = token.name || nft.name;
          nft.image = normalizeNftMediaUrl(token.image || '') || nft.image;
          nft.attributes = parseAttributes(token.attributes || []);
          nft.bgColor = (token.attributes || []).find((a) => a.trait_type === 'Background')?.value || null;
        }
        await delay(120);
      } catch {
        /* ignore */
      } finally {
        processed++;
        if (onProgress && processed % 5 === 0) {
          onProgress(
            `Loading NFT details... ${processed}/${unknownMints.length}`,
            70 + (processed / unknownMints.length) * 20,
          );
        }
      }
    });
  }

  if (onProgress) onProgress(`Loaded ${nftMap.size} Harmies from marketplace!`, 95);
  return [...nftMap.values()];
}

async function fetchFromMagicEdenCollectionTokens(onProgress) {
  const nftMap = new Map();
  let offset = 0;
  let page = 0;
  let cursor = null;
  const seenCursors = new Set();

  while (page < ME_COLLECTION_TOKEN_MAX_PAGES) {
    try {
      const qs = cursor
        ? `continuation=${encodeURIComponent(cursor)}&limit=${ME_COLLECTION_TOKEN_LIMIT}`
        : `offset=${offset}&limit=${ME_COLLECTION_TOKEN_LIMIT}`;
      const url = `${CONFIG.ME_API_BASE}/collections/${CONFIG.ME_COLLECTION_SYMBOL}/tokens?${qs}`;
      const response = await fetchMagicEdenWithRetry(url, {}, { maxAttempts: 10, baseMs: 1000 });
      if (!response.ok) break;

      const payload = await response.json();
      const tokens = Array.isArray(payload)
        ? payload
        : Array.isArray(payload?.items)
          ? payload.items
          : Array.isArray(payload?.results)
            ? payload.results
            : Array.isArray(payload?.tokens)
              ? payload.tokens
              : [];
      if (!Array.isArray(tokens) || tokens.length === 0) break;

      for (const token of tokens) {
        const t = token.token || token;
        const mint =
          t.mintAddress ||
          t.tokenMint ||
          t.id ||
          t.address ||
          t.mint ||
          token.mintAddress ||
          token.tokenMint ||
          token.id ||
          token.address ||
          token.mint;
        if (!mint) continue;

        const attrs = t.attributes || t.traits || token.attributes || token.traits || [];
        const parsedAttrs = parseAttributes(attrs);
        nftMap.set(mint, {
          id: mint,
          name: t.name || t.title || token.name || token.title || `Harmies #${mint.slice(0, 6)}`,
          image: normalizeNftMediaUrl(
            t.image || t.img || t.imageUrl || token.image || token.img || token.imageUrl || '',
          ),
          description: t.description || token.description || '',
          attributes: parsedAttrs,
          bgColor:
            parsedAttrs.Background ||
            parsedAttrs.background ||
            (attrs.find?.((a) => a?.trait_type === 'Background')?.value ?? null),
          owner: t.owner || token.owner || null,
          listPrice: null,
          highestSale: null,
          eloScore: CONFIG.ELO_DEFAULT,
          rank: null,
          totalMatches: 0,
          wins: 0,
          losses: 0,
        });
      }

      if (onProgress) {
        onProgress(
          `Indexed ${nftMap.size} collection tokens...`,
          Math.min(70, 25 + page * 2),
        );
      }

      const meTotal =
        typeof payload?.total === 'number'
          ? payload.total
          : typeof payload?.tokenCount === 'number'
            ? payload.tokenCount
            : null;

      const nextCursor =
        payload?.continuation ||
        payload?.next ||
        payload?.nextCursor ||
        payload?.cursor ||
        null;
      if (nextCursor && !seenCursors.has(nextCursor)) {
        seenCursors.add(nextCursor);
        cursor = nextCursor;
      } else {
        cursor = null;
      }

      if (
        !cursor &&
        tokens.length < ME_COLLECTION_TOKEN_LIMIT &&
        (meTotal == null || nftMap.size >= meTotal)
      ) {
        break;
      }
      offset += tokens.length;
      page++;
      await delay(600);
    } catch {
      break;
    }
  }

  return [...nftMap.values()];
}

function parseAttributes(attrs) {
  const map = {};
  for (const attr of attrs) {
    if (attr.trait_type && attr.value !== undefined) {
      map[attr.trait_type] = attr.value;
    }
  }
  return map;
}

function parseHeliusAsset(item) {
  try {
    const id = item.id;
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
    const bgColor = attributeMap['Background'] || attributeMap['background'] || null;

    return {
      id,
      name: metadata.name || `Harmies #${id.slice(0, 6)}`,
      image: normalizeNftMediaUrl(imageUrl),
      description: metadata.description || '',
      attributes: attributeMap,
      bgColor,
      owner: item.ownership?.owner || null,
      listPrice: null,
      highestSale: null,
      eloScore: CONFIG.ELO_DEFAULT,
      rank: null,
      totalMatches: 0,
      wins: 0,
      losses: 0,
    };
  } catch (err) {
    devWarn('Failed to parse asset:', item?.id, err);
    return null;
  }
}

function extractNumber(name) {
  const match = name.match(/#(\d+)/);
  return match ? parseInt(match[1], 10) : null;
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function runWithConcurrency(items, concurrency, worker) {
  const queue = items.slice();
  const runners = Array.from({ length: Math.min(concurrency, queue.length) }, async () => {
    while (queue.length > 0) {
      const item = queue.shift();
      try {
        await worker(item);
      } catch {
        /* swallow */
      }
    }
  });
  await Promise.all(runners);
}

function hasCanonicalEditionName(name) {
  if (!name || typeof name !== 'string') return false;
  return /Harmies?\s*#\s*\d{1,5}\s*$/i.test(name.trim());
}

function needsMagicEdenEnrichment(nft) {
  if (!nft?.id || String(nft.id).startsWith('harmie_placeholder')) return false;
  if (!String(nft.image || '').trim()) return true;
  const name = String(nft.name || '');
  if (!name) return true;
  if (hasCanonicalEditionName(name)) return false;
  const m = name.match(/#\s*([A-Za-z0-9]+)\s*$/);
  if (!m) return false;
  const label = m[1];
  if (/^\d+$/.test(label)) return false;
  return label.length <= 12 && /[A-Za-z]/.test(label);
}

async function enrichMissingFromMagicEden(nfts, onProgress) {
  const maxRounds = 4;
  for (let round = 0; round < maxRounds; round++) {
    const targets = nfts.filter(needsMagicEdenEnrichment);
    if (targets.length === 0) return;

    const cap = Math.min(targets.length, ME_TOKEN_DETAIL_LIMIT);
    const slice = targets.slice(0, cap);
    let done = 0;

    await runWithConcurrency(slice, ME_TOKEN_DETAIL_CONCURRENCY, async (nft) => {
    try {
      const url = `${CONFIG.ME_API_BASE}/tokens/${nft.id}`;
      const response = await fetchMagicEdenWithRetry(url);
      if (!response.ok) return;
      const token = await response.json();
      const name = token.name || token.title;
      const image =
        token.image ||
        token.img ||
        token.imageUrl ||
        token.imageUri ||
        token.extra?.img ||
        '';
      if (name && (!nft.name || !hasCanonicalEditionName(nft.name))) {
        nft.name = name;
      }
      if (image && !String(nft.image || '').trim()) {
        nft.image = normalizeNftMediaUrl(image);
      }
      const rawAttrs = token.attributes || token.traits || [];
      if (
        (!nft.attributes || Object.keys(nft.attributes).length === 0) &&
        Array.isArray(rawAttrs) &&
        rawAttrs.length > 0
      ) {
        nft.attributes = parseAttributes(rawAttrs);
        nft.bgColor =
          nft.attributes.Background ||
          nft.attributes.background ||
          rawAttrs.find?.((a) => a?.trait_type === 'Background')?.value ||
          null;
      }
      await delay(100);
    } catch {
      /* ignore */
    } finally {
      done++;
      if (onProgress && done % 25 === 0) {
        onProgress(`Polishing metadata... ${done}/${cap}`, 96);
      }
    }
  });
  }
}

function mergeById(primary, secondary) {
  const map = new Map((primary || []).map((nft) => [nft.id, nft]));
  for (const nft of secondary || []) {
    if (!nft?.id) continue;
    const existing = map.get(nft.id);
    if (!existing) {
      map.set(nft.id, nft);
      continue;
    }
    map.set(nft.id, mergeTwoNftRecords(existing, nft));
  }
  return [...map.values()];
}

export function mergeTwoNftRecords(a, b) {
  const pickName = () => {
    const qa = hasCanonicalEditionName(a.name);
    const qb = hasCanonicalEditionName(b.name);
    if (qa && !qb) return a.name;
    if (qb && !qa) return b.name;
    if ((a.name || '').length >= (b.name || '').length) return a.name || b.name;
    return b.name || a.name;
  };

  const pickImage = () => {
    const ia = String(a.image || '').trim();
    const ib = String(b.image || '').trim();
    if (ib.length > ia.length) return b.image;
    if (ia.length > ib.length) return a.image;
    return ia ? a.image : b.image;
  };

  const attrA = a.attributes && Object.keys(a.attributes).length;
  const attrB = b.attributes && Object.keys(b.attributes).length;
  const attributes =
    attrA >= attrB && attrA > 0 ? a.attributes : attrB > 0 ? b.attributes : a.attributes || b.attributes || {};

  return {
    ...a,
    name: pickName(),
    image: normalizeNftMediaUrl(pickImage() || ''),
    description: (a.description || '').length >= (b.description || '').length ? a.description : b.description,
    attributes,
    bgColor: a.bgColor || b.bgColor,
    owner: a.owner || b.owner,
  };
}
