// Harmie Charm Arena — Main Application Entry
import { devLog, devWarn } from './utils/dom.js';
import './style.css';
import { CONFIG } from './config.js';
import {
  fetchAllHarmies,
  primeNFTCache,
  mergeTwoNftRecords,
} from './services/heliusService.js';
import {
  fetchListings,
  fetchActivities,
  mergeMarketplaceData,
  invalidateMarketplaceCache,
} from './services/magicEdenService.js';
import {
  initSupabase,
  fetchEloScores,
  fetchAllHarmiesFromSupabase,
  subscribeToEloUpdates,
} from './services/supabaseService.js';
const THEME_KEY = 'harmies_theme_mode';
const VALID_THEMES = new Set(['light', 'mid', 'dark']);
const THEME_ORDER = ['light', 'mid', 'dark'];

const NFT_META_CACHE_KEY = 'harmies_meta_v4';
const NFT_DYN_CACHE_KEY = 'harmies_dyn_v4';
const NFT_META_TTL_MS = 7 * 24 * 60 * 60 * 1000; // 7 days
const NFT_DYN_TTL_MS = 24 * 60 * 60 * 1000; // 24 hours warm cache for dynamic data

let allNFTs = [];
let currentPage = 'pageant';
let isLoading = true;
let retryCount = 0;
const MAX_RETRIES = 3;

let realtimeChannel = null;
let marketplaceRefreshInterval = null;
let eloRefreshInterval = null;
let lastMarketplaceSync = 0;
let lastDataRefresh = 0;

// ============================================================
// INITIALIZATION
// ============================================================

document.addEventListener('DOMContentLoaded', () => {
  initThemeMode();

  const ghUrl = CONFIG.GITHUB_URL;
  const ghConfigured = ghUrl && !ghUrl.includes('your-username');
  if (ghConfigured) {
    document.querySelectorAll('#nav-github, #mobile-github, #footer-github').forEach((el) => {
      if (el) el.href = ghUrl;
    });
  } else {
    document.querySelectorAll('#nav-github, #mobile-github').forEach((el) => {
      if (el) el.classList.add('hidden');
    });
    const footerLine = document.getElementById('footer-github-line');
    if (footerLine) footerLine.classList.add('hidden');
  }

  initApp();
});

function initThemeMode() {
  const saved = localStorage.getItem(THEME_KEY);
  const initialTheme = VALID_THEMES.has(saved) ? saved : 'mid';
  applyThemeMode(initialTheme);

  const toggle = document.getElementById('theme-toggle');
  if (toggle) {
    toggle.addEventListener('click', () => {
      const current = document.documentElement.getAttribute('data-theme') || 'mid';
      const idx = THEME_ORDER.indexOf(current);
      const next = THEME_ORDER[(idx + 1) % THEME_ORDER.length];
      applyThemeMode(next);
      localStorage.setItem(THEME_KEY, next);
    });
  }
}

function applyThemeMode(theme) {
  document.documentElement.setAttribute('data-theme', theme);
  const label = document.getElementById('theme-toggle-label');
  const toggle = document.getElementById('theme-toggle');
  const themeMeta = document.querySelector('meta[name="theme-color"]');
  const themeColor = {
    light: '#f3f5fb',
    mid: '#1d2a78',
    dark: '#0f1324',
  }[theme] || '#1d2a78';
  if (label) label.textContent = theme.toUpperCase();
  if (toggle) toggle.dataset.mode = theme;
  if (themeMeta) themeMeta.setAttribute('content', themeColor);
}

async function initApp() {
  const loadingBar = document.getElementById('loading-bar');
  const loadingText = document.getElementById('loading-text');
  const loadingScreen = document.getElementById('loading-screen');
  const app = document.getElementById('app');

  function updateLoading(text, percent) {
    if (loadingText) loadingText.textContent = text;
    if (loadingBar) loadingBar.style.width = `${percent}%`;
  }

  try {
    updateLoading('Connecting to the pageant...', 10);
    const supabaseInitPromise = initSupabase().catch(() => false);

    // Try warm cache first for an instant first paint
    const cached = readCachedNFTs();
    if (cached && cached.length > 0) {
      allNFTs = cached;
      primeNFTCache(cached);
      updateLoading('Loading from cache...', 60);
    } else {
      updateLoading('Summoning the Harmies...', 20);
      allNFTs = await fetchAllHarmies((text, pct) => {
        updateLoading(text, 20 + pct * 0.55);
      });
    }

    const startingHash = window.location.hash.replace('#', '') || 'pageant';
    const needsSupabaseImmediately = startingHash === 'pageant';
    if (needsSupabaseImmediately) {
      await supabaseInitPromise;
    }

    if (allNFTs.length === 0) {
      updateLoading('Could not load NFTs. Please refresh later.', 0);
      return;
    }

    updateLoading('Launching pageant...', 92);
    setupNavigation();
    setupDataRefresh();

    updateLoading('LET\'S GO!', 100);
    isLoading = false;
    
    // Defer async route rendering
    handleRoute().catch(devWarn);

    setTimeout(() => {
      if (loadingScreen) loadingScreen.classList.add('fade-out');
      if (app) app.classList.remove('hidden');
      setTimeout(() => {
        if (loadingScreen) loadingScreen.style.display = 'none';
      }, 600);
    }, 350);

    hydrateSecondaryData(supabaseInitPromise, !!cached).catch((err) => {
      devWarn('Background hydration error:', err);
    });
  } catch (err) {
    console.error('Initialization error:', err);
    retryCount++;
    if (retryCount < MAX_RETRIES) {
      const delayMs = Math.min(30000, 2000 * Math.pow(2, retryCount - 1));
      updateLoading(`Hit a snag. Retrying (${retryCount}/${MAX_RETRIES})...`, 0);
      setTimeout(() => initApp(), delayMs);
    } else {
      updateLoading('Failed to load. Please refresh and try again.', 0);
    }
  }
}

async function hydrateSecondaryData(supabaseInitPromise, hadCache) {
  const supabaseReady = await supabaseInitPromise;

  // If we used a cache, also kick off a fresh fetch in the background
  let freshFetchPromise = Promise.resolve(allNFTs);
  if (hadCache) {
    freshFetchPromise = fetchAllHarmies().then((fresh) => {
      if (Array.isArray(fresh) && fresh.length > 0) {
        allNFTs = mergeFreshNfts(allNFTs, fresh);
        writeCachedNFTs(allNFTs);
      }
      return allNFTs;
    }).catch(() => allNFTs);
  } else {
    writeCachedNFTs(allNFTs);
  }

  const marketplacePromise = Promise.allSettled([fetchListings(), fetchActivities()])
    .then(([listings, activities]) => {
      const listingsData = listings.status === 'fulfilled' ? listings.value : {};
      const activitiesData = activities.status === 'fulfilled' ? activities.value : {};
      mergeMarketplaceData(allNFTs, listingsData, activitiesData);
    })
    .catch(() => {});

  const eloPromise = supabaseReady
    ? fetchEloScores()
        .then((eloData) => {
          mergeEloData(allNFTs, eloData);
          setupRealtimeSubscriptions();
        })
        .catch(devWarn)
    : Promise.resolve();

  const collectionPromise = supabaseReady
    ? fetchAllHarmiesFromSupabase()
        .then((rows) => {
          if (rows.length > 0) {
            allNFTs = mergeFreshNfts(allNFTs, rows);
            recomputeRanks(allNFTs);
          }
        })
        .catch(devWarn)
    : Promise.resolve();

  await Promise.allSettled([freshFetchPromise, marketplacePromise, eloPromise, collectionPromise]);

  writeCachedNFTs(allNFTs);
  pushDataToCurrentPage();
  lastDataRefresh = Date.now();
}

function mergeFreshNfts(existing, fresh) {
  const map = new Map(existing.map((n) => [n.id, n]));
  for (const nft of fresh) {
    if (!nft || !nft.id) continue;
    const prev = map.get(nft.id);
    if (prev) {
      const merged = mergeTwoNftRecords(prev, nft);
      merged.eloScore = nft.eloScore ?? merged.eloScore;
      merged.totalMatches = nft.totalMatches ?? merged.totalMatches;
      merged.wins = nft.wins ?? merged.wins;
      merged.losses = nft.losses ?? merged.losses;
      merged.rank = nft.rank ?? merged.rank;
      Object.assign(prev, merged);
    } else {
      map.set(nft.id, nft);
    }
  }
  return [...map.values()];
}

// ============================================================
// LOCAL CACHE
// ============================================================

function readCachedNFTs() {
  try {
    const rawMeta = localStorage.getItem(NFT_META_CACHE_KEY);
    const rawDyn = localStorage.getItem(NFT_DYN_CACHE_KEY);
    if (!rawMeta) return null;

    const parsedMeta = JSON.parse(rawMeta);
    if (!parsedMeta || !Array.isArray(parsedMeta.nfts)) return null;
    if (Date.now() - (parsedMeta.timestamp || 0) > NFT_META_TTL_MS) return null;

    const metaNfts = parsedMeta.nfts;
    if (metaNfts.length === 0) return null;

    let parsedDyn = null;
    if (rawDyn) {
      parsedDyn = JSON.parse(rawDyn);
      if (Date.now() - (parsedDyn.timestamp || 0) > NFT_DYN_TTL_MS) {
        parsedDyn = null;
      }
    }

    if (parsedDyn && parsedDyn.nfts) {
      const dynMap = parsedDyn.nfts;
      for (const meta of metaNfts) {
        const dyn = dynMap[meta.id];
        if (dyn) {
          Object.assign(meta, dyn);
        }
      }
    }
    return metaNfts;
  } catch {
    return null;
  }
}

function writeCachedNFTs(nfts) {
  try {
    const slimMeta = nfts.map((n) => ({
      id: n.id,
      name: n.name,
      image: n.image,
      bgColor: n.bgColor,
      attributes: n.attributes,
      owner: n.owner,
    }));

    const dynMap = {};
    for (const n of nfts) {
      dynMap[n.id] = {
        listPrice: n.listPrice,
        highestSale: n.highestSale,
        eloScore: n.eloScore,
        rank: n.rank,
        totalMatches: n.totalMatches,
        wins: n.wins,
        losses: n.losses,
      };
    }

    localStorage.setItem(
      NFT_META_CACHE_KEY,
      JSON.stringify({ timestamp: Date.now(), nfts: slimMeta }),
    );
    localStorage.setItem(
      NFT_DYN_CACHE_KEY,
      JSON.stringify({ timestamp: Date.now(), nfts: dynMap }),
    );
  } catch {
    /* quota or serialization errors are non-fatal */
  }
}

// ============================================================
// ROUTING
// ============================================================

function setupNavigation() {
  window.addEventListener('hashchange', handleRoute);

  document.querySelectorAll('[data-page]').forEach((link) => {
    link.addEventListener('click', () => closeMobileMenu());
  });

  const hamburger = document.getElementById('nav-hamburger');
  if (hamburger) {
    hamburger.addEventListener('click', toggleMobileMenu);
  }

  document.addEventListener('click', (e) => {
    const menu = document.getElementById('mobile-menu');
    const hamburgerBtn = document.getElementById('nav-hamburger');
    if (!menu || !hamburgerBtn || menu.classList.contains('hidden')) return;
    const clickedInsideMenu = menu.contains(e.target);
    const clickedHamburger = hamburgerBtn.contains(e.target);
    if (!clickedInsideMenu && !clickedHamburger) {
      closeMobileMenu();
    }
  });

  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') closeMobileMenu();
  });
}

async function handleRoute() {
  const hash = window.location.hash.replace('#', '') || 'pageant';
  const validPages = ['gallery', 'pageant', 'leaderboard'];
  currentPage = validPages.includes(hash) ? hash : 'pageant';

  document.querySelectorAll('.nav-link').forEach((link) => {
    link.classList.toggle('active', link.dataset.page === currentPage);
  });
  document.querySelectorAll('.mobile-link').forEach((link) => {
    link.classList.toggle('active', link.dataset.page === currentPage);
  });

  const container = document.getElementById('page-container');
  if (!container) return;

  if (isLoading) {
    container.innerHTML = '<div class="spinner" role="status" aria-label="Loading"></div>';
    return;
  }

  // Ensure Supabase is awake for the pageant page if they just navigated here
  if (currentPage === 'pageant') {
    initSupabase().catch(() => false);
  }

  switch (currentPage) {
    case 'gallery': {
      const { renderGallery } = await import('./pages/gallery.js');
      renderGallery(container, allNFTs);
      void runMarketplaceSync();
      break;
    }
    case 'pageant': {
      const { renderPageant } = await import('./pages/pageant.js');
      renderPageant(container, allNFTs);
      break;
    }
    case 'leaderboard': {
      const { renderLeaderboard } = await import('./pages/leaderboard.js');
      renderLeaderboard(container, allNFTs);
      break;
    }
  }

  const prefersReducedMotion = window.matchMedia
    && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  window.scrollTo({ top: 0, behavior: prefersReducedMotion ? 'auto' : 'smooth' });
}

async function pushDataToCurrentPage() {
  switch (currentPage) {
    case 'gallery': {
      const { updateGalleryData } = await import('./pages/gallery.js');
      updateGalleryData(allNFTs);
      break;
    }
    case 'pageant': {
      const { updatePageantData } = await import('./pages/pageant.js');
      updatePageantData(allNFTs);
      break;
    }
    case 'leaderboard': {
      const { updateLeaderboardData } = await import('./pages/leaderboard.js');
      updateLeaderboardData(allNFTs);
      break;
    }
  }
}

// ============================================================
// MOBILE MENU
// ============================================================

function toggleMobileMenu() {
  const menu = document.getElementById('mobile-menu');
  const hamburger = document.getElementById('nav-hamburger');
  if (!menu || !hamburger) return;
  const wasHidden = menu.classList.toggle('hidden');
  hamburger.classList.toggle('active', !wasHidden);
  hamburger.setAttribute('aria-expanded', String(!wasHidden));
  document.body.classList.toggle('mobile-menu-open', !wasHidden);
}

function closeMobileMenu() {
  const menu = document.getElementById('mobile-menu');
  const hamburger = document.getElementById('nav-hamburger');
  if (menu) menu.classList.add('hidden');
  if (hamburger) {
    hamburger.classList.remove('active');
    hamburger.setAttribute('aria-expanded', 'false');
  }
  document.body.classList.remove('mobile-menu-open');
}

// ============================================================
// DATA MANAGEMENT
// ============================================================

function mergeEloData(nfts, eloData) {
  for (const nft of nfts) {
    if (eloData[nft.id]) {
      nft.eloScore = eloData[nft.id].eloScore;
      nft.totalMatches = eloData[nft.id].totalMatches;
      nft.wins = eloData[nft.id].wins;
      nft.losses = eloData[nft.id].losses;
    }
  }
  recomputeRanks(nfts);
}

function recomputeRanks(nfts) {
  const sorted = [...nfts].sort((a, b) => (b.eloScore || 1200) - (a.eloScore || 1200));
  sorted.forEach((nft, i) => {
    nft.rank = i + 1;
  });
}

function setupRealtimeSubscriptions() {
  if (realtimeChannel) return;
  realtimeChannel = subscribeToEloUpdates((updatedNFT) => {
    const nft = allNFTs.find((n) => n.id === updatedNFT.id);
    if (!nft) return;
    nft.eloScore = updatedNFT.elo_score;
    nft.totalMatches = updatedNFT.total_matches;
    nft.wins = updatedNFT.wins;
    nft.losses = updatedNFT.losses;
    recomputeRanks(allNFTs);
  });
}

async function runMarketplaceSync() {
  if (document.hidden) return;
  try {
    invalidateMarketplaceCache();
    const [listings, activities] = await Promise.allSettled([fetchListings(), fetchActivities()]);

    const listingsData = listings.status === 'fulfilled' ? listings.value : {};
    const activitiesData = activities.status === 'fulfilled' ? activities.value : {};
    mergeMarketplaceData(allNFTs, listingsData, activitiesData);
    writeCachedNFTs(allNFTs);

    lastMarketplaceSync = Date.now();
    lastDataRefresh = Date.now();
    await pushDataToCurrentPage();
    devLog('Marketplace synced at', new Date().toLocaleTimeString());
  } catch (err) {
    devWarn('Marketplace sync error:', err);
  }
}

async function runEloSync() {
  if (document.hidden) return;
  try {
    const eloData = await fetchEloScores();
    mergeEloData(allNFTs, eloData);
    writeCachedNFTs(allNFTs);
    lastDataRefresh = Date.now();
    await pushDataToCurrentPage();
    devLog('ELO synced at', new Date().toLocaleTimeString());
  } catch (err) {
    devWarn('ELO sync error:', err);
  }
}

let visibilityResyncTimeout = null;

function setupDataRefresh() {
  if (marketplaceRefreshInterval) clearInterval(marketplaceRefreshInterval);
  if (eloRefreshInterval) clearInterval(eloRefreshInterval);

  marketplaceRefreshInterval = setInterval(() => {
    void runMarketplaceSync();
  }, CONFIG.MARKETPLACE_REFRESH_MS);

  eloRefreshInterval = setInterval(() => {
    void runEloSync();
  }, CONFIG.ELO_REFRESH_MS);

  document.addEventListener('visibilitychange', () => {
    if (document.hidden) return;
    if (visibilityResyncTimeout) clearTimeout(visibilityResyncTimeout);
    visibilityResyncTimeout = setTimeout(() => {
      void runMarketplaceSync();
    }, 400);
  });
}

window.addEventListener('beforeunload', () => {
  if (marketplaceRefreshInterval) clearInterval(marketplaceRefreshInterval);
  if (eloRefreshInterval) clearInterval(eloRefreshInterval);
  if (realtimeChannel && typeof realtimeChannel.unsubscribe === 'function') {
    try { realtimeChannel.unsubscribe(); } catch { /* ignore */ }
  }
});

if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js').catch(() => {});
  });
}
