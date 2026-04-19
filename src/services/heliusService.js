// NFT Collection Data Service
// Primary: Helius DAS API (gets all 500). Fallback: Magic Eden + IPFS pattern.
import { CONFIG } from '../config.js';
import { devWarn } from '../utils/dom.js';

let cachedNFTs = null;
let cacheTimestamp = 0;

const HELIUS_MAX_PAGES = 10;
const ME_TOKEN_DETAIL_LIMIT = 60;
const ME_TOKEN_DETAIL_CONCURRENCY = 5;

export async function fetchAllHarmies(onProgress) {
  if (cachedNFTs && Date.now() - cacheTimestamp < CONFIG.CACHE_TTL_MS) {
    return cachedNFTs;
  }

  if (onProgress) onProgress('Summoning the Harmies...', 10);

  let allNFTs = await fetchFromHelius(onProgress);

  if (allNFTs.length === 0) {
    if (onProgress) onProgress('Using Magic Eden data...', 20);
    allNFTs = await fetchFromMagicEden(onProgress);
  }

  if (allNFTs.length === 0) {
    if (onProgress) onProgress('Building from collection data...', 30);
    allNFTs = generateFromKnownData();
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
  const allNFTs = [];
  let page = 1;
  const limit = 1000;

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
          },
        }),
      });
    } catch (err) {
      devWarn('Helius fetch error:', err.message);
      return allNFTs;
    }

    if (!response.ok) return allNFTs;

    let data;
    try {
      data = await response.json();
    } catch {
      return allNFTs;
    }
    if (data.error) {
      devWarn('Helius error:', data.error.message);
      return allNFTs;
    }

    const items = data.result?.items || [];
    for (const item of items) {
      const nft = parseHeliusAsset(item);
      if (nft) allNFTs.push(nft);
    }

    if (onProgress) {
      onProgress(`Found ${allNFTs.length} Harmies via RPC...`, Math.min(90, 20 + allNFTs.length / 5));
    }

    if (items.length < limit) break;
    page++;
  }

  return allNFTs;
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
      const response = await fetch(url);

      if (!response.ok) {
        if (response.status === 429) {
          await delay(2000);
          continue;
        }
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
          image: token.image || listing.extra?.img || '',
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
      const response = await fetch(url);
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
        const response = await fetch(url);
        if (response.ok) {
          const token = await response.json();
          nft.name = token.name || nft.name;
          nft.image = token.image || '';
          nft.attributes = parseAttributes(token.attributes || []);
          nft.bgColor = (token.attributes || []).find((a) => a.trait_type === 'Background')?.value || null;
        }
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

function generateFromKnownData() {
  const nfts = [];
  for (let i = 1; i <= 500; i++) {
    nfts.push({
      id: `harmie_placeholder_${i}`,
      name: `Harmies #${i}`,
      image: '',
      description: '',
      attributes: {},
      bgColor: null,
      owner: null,
      listPrice: null,
      highestSale: null,
      eloScore: CONFIG.ELO_DEFAULT,
      rank: null,
      totalMatches: 0,
      wins: 0,
      losses: 0,
    });
  }
  return nfts;
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

    let imageUrl = links.image || '';
    if (!imageUrl && files.length > 0) {
      imageUrl = files[0].cdn_uri || files[0].uri || '';
    }

    const attributes = metadata.attributes || [];
    const attributeMap = parseAttributes(attributes);
    const bgColor = attributeMap['Background'] || attributeMap['background'] || null;

    return {
      id,
      name: metadata.name || `Harmie #${id.slice(0, 6)}`,
      image: imageUrl,
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
