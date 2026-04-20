// Gallery Page — Browse and sort the full collection
import { showNFTModal } from '../components/modal.js';
import {
  escapeHtml,
  attachImageFallback,
  FALLBACK_IMAGE,
  debounce,
} from '../utils/dom.js';

let currentNFTs = [];
let displayedCount = 0;
let currentSort = 'price-low';
let searchQuery = '';
const ITEMS_PER_PAGE = 40;

const ICONS = {
  priceLow: `
    <svg class="ui-icon" viewBox="0 0 24 24" aria-hidden="true">
      <path d="M4 7h12"/>
      <path d="M4 12h9"/>
      <path d="M4 17h6"/>
      <path d="m17 9 3 3-3 3"/>
      <path d="M14 12h6"/>
    </svg>
  `,
  priceHigh: `
    <svg class="ui-icon" viewBox="0 0 24 24" aria-hidden="true">
      <path d="M4 7h6"/>
      <path d="M4 12h9"/>
      <path d="M4 17h12"/>
      <path d="m17 9 3 3-3 3"/>
      <path d="M14 12h6"/>
    </svg>
  `,
  sale: `
    <svg class="ui-icon" viewBox="0 0 24 24" aria-hidden="true">
      <path d="M13 2 4 14h6l-1 8 9-12h-6z"/>
    </svg>
  `,
  rank: `
    <svg class="ui-icon" viewBox="0 0 24 24" aria-hidden="true">
      <path d="M7 4h10v4a5 5 0 0 1-10 0V4z"/>
      <path d="M9 16h6m-7 4h8"/>
      <path d="M17 6h2a2 2 0 0 1-2 2m-10-2H5a2 2 0 0 0 2 2"/>
    </svg>
  `,
  number: `
    <svg class="ui-icon" viewBox="0 0 24 24" aria-hidden="true">
      <path d="M8 3 6 21M18 3l-2 18M4 9h17M3 15h17"/>
    </svg>
  `,
  background: `
    <svg class="ui-icon" viewBox="0 0 24 24" aria-hidden="true">
      <path d="M4 4h16v16H4z"/>
      <path d="m6 14 3-3 3 3 4-4 2 2v6H6z"/>
      <circle cx="9" cy="8" r="1.5"/>
    </svg>
  `,
  search: `
    <svg class="empty-state-svg" viewBox="0 0 24 24" aria-hidden="true">
      <circle cx="11" cy="11" r="7"/>
      <path d="m20 20-4.3-4.3"/>
    </svg>
  `,
};

export function renderGallery(container, nfts) {
  currentNFTs = [...nfts];
  displayedCount = 0;

  const totalCount = nfts.length;
  const listedCount = nfts.filter((n) => n.listPrice !== null && n.listPrice !== undefined).length;

  container.innerHTML = `
    <div class="gallery-page">
      <div class="gallery-header">
        <h1 class="section-title">THE COLLECTION</h1>
        <p class="section-subtitle">Browse all ${escapeHtml(totalCount)} Harmies in a bold modern comic interface</p>

        <div class="gallery-controls">
          <input
            type="text"
            class="gallery-search"
            id="gallery-search"
            placeholder="Search by number or color..."
            autocomplete="off"
            aria-label="Search Harmies by number or color"
          />
          <button class="sort-btn active" data-sort="price-low" id="sort-price-low" type="button">${ICONS.priceLow}<span>Price: Low</span></button>
          <button class="sort-btn" data-sort="price-high" id="sort-price-high" type="button">${ICONS.priceHigh}<span>Price: High</span></button>
          <button class="sort-btn" data-sort="sale" id="sort-sale" type="button">${ICONS.sale}<span>Highest Sale</span></button>
          <button class="sort-btn" data-sort="rank" id="sort-rank" type="button">${ICONS.rank}<span>Ranked</span></button>
          <button class="sort-btn" data-sort="number" id="sort-number" type="button">${ICONS.number}<span>Number</span></button>
          <button class="sort-btn" data-sort="bg" id="sort-bg" type="button">${ICONS.background}<span>Background</span></button>
        </div>

        <div class="gallery-stats">
          <div class="stat-badge">
            <span>Total:</span>
            <span class="stat-value" id="stat-total">${escapeHtml(totalCount)}</span>
          </div>
          <div class="stat-badge">
            <span>Listed:</span>
            <span class="stat-value" id="stat-listed">${escapeHtml(listedCount)}</span>
          </div>
          <div class="stat-badge">
            <span>Floor:</span>
            <span class="stat-value" id="stat-floor">${escapeHtml(getFloorPrice(nfts))}</span>
          </div>
        </div>
      </div>

      <div class="nft-grid" id="nft-grid"></div>

      <div class="load-more-container" id="load-more-container">
        <button class="load-more-btn" id="load-more-btn" type="button">LOAD MORE</button>
      </div>
    </div>
  `;

  sortNFTs(currentSort);
  loadMoreNFTs();
  bindGalleryEvents();
}

function bindGalleryEvents() {
  const searchInput = document.getElementById('gallery-search');
  if (searchInput) {
    const handleSearch = debounce((value) => {
      searchQuery = value.toLowerCase().trim();
      refreshGrid();
    }, 250);
    searchInput.addEventListener('input', (e) => handleSearch(e.target.value));
  }

  document.querySelectorAll('.sort-btn').forEach((btn) => {
    btn.addEventListener('click', () => {
      const sort = btn.dataset.sort;
      document.querySelectorAll('.sort-btn').forEach((b) => b.classList.remove('active'));
      btn.classList.add('active');
      currentSort = sort;
      refreshGrid();
    });
  });

  const loadMoreBtn = document.getElementById('load-more-btn');
  if (loadMoreBtn) {
    loadMoreBtn.addEventListener('click', loadMoreNFTs);
  }
}

function refreshGrid() {
  sortNFTs(currentSort);
  displayedCount = 0;
  const grid = document.getElementById('nft-grid');
  if (grid) grid.innerHTML = '';
  loadMoreNFTs();
}

function sortNFTs(sortType) {
  switch (sortType) {
    case 'price-low':
      currentNFTs.sort((a, b) => {
        if (a.listPrice == null && b.listPrice == null) return 0;
        if (a.listPrice == null) return 1;
        if (b.listPrice == null) return -1;
        return a.listPrice - b.listPrice;
      });
      break;
    case 'price-high':
      currentNFTs.sort((a, b) => {
        if (a.listPrice == null && b.listPrice == null) return 0;
        if (a.listPrice == null) return 1;
        if (b.listPrice == null) return -1;
        return b.listPrice - a.listPrice;
      });
      break;
    case 'sale':
      currentNFTs.sort((a, b) => {
        if (!a.highestSale && !b.highestSale) return 0;
        if (!a.highestSale) return 1;
        if (!b.highestSale) return -1;
        return b.highestSale - a.highestSale;
      });
      break;
    case 'rank':
      currentNFTs.sort((a, b) => (a.rank || Number.MAX_SAFE_INTEGER) - (b.rank || Number.MAX_SAFE_INTEGER));
      break;
    case 'number':
      currentNFTs.sort((a, b) => extractHarmieNumber(a) - extractHarmieNumber(b));
      break;
    case 'bg':
      currentNFTs.sort((a, b) => {
        const bgA = a.bgColor || 'zzz';
        const bgB = b.bgColor || 'zzz';
        return String(bgA).localeCompare(String(bgB));
      });
      break;
  }
}

function loadMoreNFTs() {
  const grid = document.getElementById('nft-grid');
  const loadMoreContainer = document.getElementById('load-more-container');
  if (!grid) return;

  const filtered = searchQuery
    ? currentNFTs.filter((nft) =>
        (nft.name && String(nft.name).toLowerCase().includes(searchQuery)) ||
        extractHarmieNumber(nft).toString().includes(searchQuery) ||
        (nft.bgColor && String(nft.bgColor).toLowerCase().includes(searchQuery))
      )
    : currentNFTs;

  if (filtered.length === 0) {
    grid.innerHTML = `
      <div class="empty-state empty-state-full-width">
        <div class="empty-state-icon">${ICONS.search}</div>
        <p>No Harmies found${searchQuery ? ` matching "${escapeHtml(searchQuery)}"` : ''}</p>
      </div>
    `;
    if (loadMoreContainer) loadMoreContainer.classList.add('hidden');
    return;
  }

  const end = Math.min(displayedCount + ITEMS_PER_PAGE, filtered.length);
  const fragment = document.createDocumentFragment();
  for (let i = displayedCount; i < end; i++) {
    fragment.appendChild(createNFTCard(filtered[i]));
  }
  grid.appendChild(fragment);

  displayedCount = end;
  if (loadMoreContainer) {
    loadMoreContainer.classList.toggle('hidden', displayedCount >= filtered.length);
  }
}

function extractHarmieNumber(nft) {
  const match = `${nft.name || ''} ${nft.id || ''}`.match(/\d+/);
  return match ? parseInt(match[0], 10) : Number.MAX_SAFE_INTEGER;
}

function createNFTCard(nft) {
  const card = document.createElement('div');
  card.className = 'nft-card';
  card.id = `nft-card-${escapeHtml(String(nft.id || '').slice(0, 8))}`;
  card.tabIndex = 0;
  card.setAttribute('role', 'button');
  card.setAttribute('aria-label', `Open details for ${nft.name || 'Harmie'}`);

  const rankClass = nft.rank <= 3 ? 'top-3' : nft.rank <= 10 ? 'top-10' : '';
  const priceText = nft.listPrice != null ? `◎ ${Number(nft.listPrice).toFixed(2)}` : 'Unlisted';
  const saleText = nft.highestSale ? `Highest: ◎ ${Number(nft.highestSale).toFixed(2)}` : '';
  const rankText = nft.rank ? `#${nft.rank}` : '—';

  card.innerHTML = `
    <img
      class="nft-card-image"
      src="${escapeHtml(nft.image || FALLBACK_IMAGE)}"
      alt="${escapeHtml(nft.name || 'Harmie')}"
      loading="lazy"
      data-fallback
    />
    <div class="nft-card-info">
      <div class="nft-card-name">${escapeHtml(nft.name || 'Harmie')}</div>
      <div class="nft-card-meta">
        <span class="nft-price">${escapeHtml(priceText)}</span>
        <span class="nft-rank-badge ${rankClass}">${escapeHtml(rankText)}</span>
      </div>
      ${saleText ? `<div class="nft-highest-sale">${escapeHtml(saleText)}</div>` : ''}
    </div>
  `;

  card.querySelectorAll('img[data-fallback]').forEach(attachImageFallback);
  card.addEventListener('click', () => showNFTModal(nft));
  card.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      showNFTModal(nft);
    }
  });
  return card;
}

function getFloorPrice(nfts) {
  const listed = nfts.filter((n) => n.listPrice != null && n.listPrice > 0);
  if (listed.length === 0) return '—';
  const floor = Math.min(...listed.map((n) => n.listPrice));
  return `◎ ${floor.toFixed(2)}`;
}

export function updateGalleryData(nfts) {
  currentNFTs = [...nfts];
  const grid = document.getElementById('nft-grid');
  if (!grid) return;

  // Preserve scroll position to avoid jump from full re-render
  const scrollY = window.scrollY;
  refreshGrid();
  window.scrollTo({ top: scrollY });
}
