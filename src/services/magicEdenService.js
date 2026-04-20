// Magic Eden API — Fetch listings and sales data
import { CONFIG } from '../config.js';
import { fetchMagicEdenWithRetry } from './meFetchRetry.js';

const ME_BASE = CONFIG.ME_API_BASE;
const SYMBOL = CONFIG.ME_COLLECTION_SYMBOL;

let listingsCache = null;
let listingsCacheTime = 0;
let activitiesCache = null;
let activitiesCacheTime = 0;

/**
 * Fetch all current listings for the collection
 * Paginates through to get all listed items
 */
export async function fetchListings(onProgress) {
  if (listingsCache && (Date.now() - listingsCacheTime < CONFIG.CACHE_TTL_MS)) {
    return listingsCache;
  }

  const allListings = [];
  let offset = 0;
  const limit = 100;
  let hasMore = true;

  while (hasMore) {
    try {
      const url = `${ME_BASE}/collections/${SYMBOL}/listings?offset=${offset}&limit=${limit}&listingAggMode=true`;
      const response = await fetchMagicEdenWithRetry(url);

      if (!response.ok) {
        console.warn(`ME listings API returned ${response.status}`);
        break;
      }

      const data = await response.json();

      if (Array.isArray(data) && data.length > 0) {
        allListings.push(...data);
        offset += data.length;
        if (data.length < limit) hasMore = false;
      } else {
        hasMore = false;
      }

      // Small delay to respect rate limits
      await new Promise(r => setTimeout(r, 200));
    } catch (err) {
      console.warn('Error fetching ME listings:', err);
      hasMore = false;
    }
  }

  // Convert to lookup map by tokenMint
  const listingsMap = {};
  for (const listing of allListings) {
    const mint = listing.tokenMint;
    if (mint) {
      listingsMap[mint] = {
        price: listing.price, // in SOL
        seller: listing.seller,
        marketplace: listing.source || 'unknown',
      };
    }
  }

  listingsCache = listingsMap;
  listingsCacheTime = Date.now();

  if (onProgress) onProgress(`Found ${allListings.length} listings`);
  return listingsMap;
}

/**
 * Fetch recent activities (sales) for the collection
 */
export async function fetchActivities(onProgress) {
  if (activitiesCache && (Date.now() - activitiesCacheTime < CONFIG.CACHE_TTL_MS)) {
    return activitiesCache;
  }

  const allActivities = [];
  let offset = 0;
  const limit = 100;
  let pages = 0;
  const maxPages = 10; // Cap at 1000 activities

  while (pages < maxPages) {
    try {
      const url = `${ME_BASE}/collections/${SYMBOL}/activities?offset=${offset}&limit=${limit}`;
      const response = await fetchMagicEdenWithRetry(url);

      if (!response.ok) {
        console.warn(`ME activities API returned ${response.status}`);
        break;
      }

      const data = await response.json();

      if (Array.isArray(data) && data.length > 0) {
        allActivities.push(...data);
        offset += data.length;
        pages++;
        if (data.length < limit) break;
      } else {
        break;
      }

      await new Promise(r => setTimeout(r, 200));
    } catch (err) {
      console.warn('Error fetching ME activities:', err);
      break;
    }
  }

  // Build highest sale map
  const highestSaleMap = {};
  for (const activity of allActivities) {
    if (activity.type === 'buyNow' || activity.type === 'buy') {
      const mint = activity.tokenMint;
      const price = activity.price || 0;
      if (mint && (!highestSaleMap[mint] || price > highestSaleMap[mint].price)) {
        highestSaleMap[mint] = {
          price,
          buyer: activity.buyer,
          seller: activity.seller,
          date: activity.blockTime ? new Date(activity.blockTime * 1000).toISOString() : null,
        };
      }
    }
  }

  activitiesCache = highestSaleMap;
  activitiesCacheTime = Date.now();

  if (onProgress) onProgress(`Processed ${allActivities.length} activities`);
  return highestSaleMap;
}

/**
 * Merge marketplace data into NFT objects
 */
export function mergeMarketplaceData(nfts, listings, sales) {
  for (const nft of nfts) {
    // Listings
    if (listings[nft.id]) {
      nft.listPrice = listings[nft.id].price;
    }
    // Highest sale
    if (sales[nft.id]) {
      nft.highestSale = sales[nft.id].price;
    }
  }
  return nfts;
}

/**
 * Invalidate marketplace caches
 */
export function invalidateMarketplaceCache() {
  listingsCache = null;
  listingsCacheTime = 0;
  activitiesCache = null;
  activitiesCacheTime = 0;
}
