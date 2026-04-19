// Harmie Charm Arena — Main Application Entry
import './style.css';
import { CONFIG } from './config.js';
import { fetchAllHarmies, primeNFTCache } from './services/heliusService.js';
import { fetchListings, fetchActivities, mergeMarketplaceData } from './services/magicEdenService.js';
import {
  initSupabase,
  fetchEloScores,
  syncNFTsToSupabase,
  subscribeToEloUpdates,
} from './services/supabaseService.js';
import { renderGallery, updateGalleryData } from './pages/gallery.js';
import { renderArena, updateArenaData } from './pages/arena.js';
import { renderLeaderboard, updateLeaderboardData } from './pages/leaderboard.js';
import { devLog, devWarn } from './utils/dom.js';
export { showToast } from './utils/toast.js';

// App State
let allNFTs = [];
let currentPage = 'arena';
let isLoading = true;
let retryCount = 0;
const MAX_RETRIES = 3;

const THEME_KEY = 'harmies_theme_mode';
const VALID_THEMES = new Set(['light', 'mid', 'dark']);
const THEME_ORDER = ['light', 'mid', 'dark'];

const NFT_CACHE_KEY = 'harmies_nft_cache_v1';
const NFT_CACHE_TTL_MS = 24 * 60 * 60 * 1000; // 24 hours warm cache

let realtimeChannel = null;
let refreshInterval = null;
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
    updateLoading('Connecting to the arena...', 10);
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

    if (allNFTs.length === 0) {
      updateLoading('Could not load NFTs. Please refresh later.', 0);
      return;
    }

    updateLoading('Launching arena...', 92);
    setupNavigation();
    setupAutoRefresh();

    handleRoute();

    updateLoading('LET\'S GO!', 100);
    isLoading = false;

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
          syncNFTsToSupabase(allNFTs).catch(devWarn);
        })
        .catch(devWarn)
    : Promise.resolve();

  await Promise.allSettled([freshFetchPromise, marketplacePromise, eloPromise]);

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
      Object.assign(prev, {
        name: nft.name || prev.name,
        image: nft.image || prev.image,
        attributes: nft.attributes || prev.attributes,
        bgColor: nft.bgColor || prev.bgColor,
        owner: nft.owner || prev.owner,
      });
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
    const raw = localStorage.getItem(NFT_CACHE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!parsed || !Array.isArray(parsed.nfts)) return null;
    if (Date.now() - (parsed.timestamp || 0) > NFT_CACHE_TTL_MS) return null;
    return parsed.nfts;
  } catch {
    return null;
  }
}

function writeCachedNFTs(nfts) {
  try {
    const slim = nfts.map((n) => ({
      id: n.id,
      name: n.name,
      image: n.image,
      bgColor: n.bgColor,
      attributes: n.attributes,
      owner: n.owner,
      listPrice: n.listPrice,
      highestSale: n.highestSale,
      eloScore: n.eloScore,
      rank: n.rank,
      totalMatches: n.totalMatches,
      wins: n.wins,
      losses: n.losses,
    }));
    localStorage.setItem(
      NFT_CACHE_KEY,
      JSON.stringify({ timestamp: Date.now(), nfts: slim }),
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

function handleRoute() {
  const hash = window.location.hash.replace('#', '') || 'arena';
  const validPages = ['gallery', 'arena', 'leaderboard'];
  currentPage = validPages.includes(hash) ? hash : 'arena';

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

  switch (currentPage) {
    case 'gallery':
      renderGallery(container, allNFTs);
      break;
    case 'arena':
      renderArena(container, allNFTs);
      break;
    case 'leaderboard':
      renderLeaderboard(container, allNFTs);
      break;
  }

  const prefersReducedMotion = window.matchMedia
    && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  window.scrollTo({ top: 0, behavior: prefersReducedMotion ? 'auto' : 'smooth' });
}

function pushDataToCurrentPage() {
  switch (currentPage) {
    case 'gallery':
      updateGalleryData(allNFTs);
      break;
    case 'arena':
      updateArenaData(allNFTs);
      break;
    case 'leaderboard':
      updateLeaderboardData(allNFTs);
      break;
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

function setupAutoRefresh() {
  if (refreshInterval) clearInterval(refreshInterval);
  refreshInterval = setInterval(async () => {
    // Don't refresh if tab is hidden
    if (document.hidden) return;
    try {
      const [listings, activities, eloData] = await Promise.allSettled([
        fetchListings(),
        fetchActivities(),
        fetchEloScores(),
      ]);

      const listingsData = listings.status === 'fulfilled' ? listings.value : {};
      const activitiesData = activities.status === 'fulfilled' ? activities.value : {};
      const elo = eloData.status === 'fulfilled' ? eloData.value : {};

      mergeMarketplaceData(allNFTs, listingsData, activitiesData);
      mergeEloData(allNFTs, elo);
      writeCachedNFTs(allNFTs);

      pushDataToCurrentPage();
      lastDataRefresh = Date.now();
      devLog('Data refreshed at', new Date().toLocaleTimeString());
    } catch (err) {
      devWarn('Auto-refresh error:', err);
    }
  }, CONFIG.CACHE_TTL_MS);
}

window.addEventListener('beforeunload', () => {
  if (refreshInterval) clearInterval(refreshInterval);
  if (realtimeChannel && typeof realtimeChannel.unsubscribe === 'function') {
    try { realtimeChannel.unsubscribe(); } catch { /* ignore */ }
  }
});
