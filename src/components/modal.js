// NFT Detail Modal
import { CONFIG } from '../config.js';
import { escapeHtml, safeUrl, attachImageFallback, FALLBACK_IMAGE } from '../utils/dom.js';
import { solAmountHtml } from '../utils/solanaCurrencyIcon.js';

let activeEscHandler = null;
let lastFocusedElement = null;
let listenersBound = false;

function getFocusableElements(scope) {
  if (!scope) return [];
  return [...scope.querySelectorAll('a[href], button:not([disabled]), textarea, input, select, [tabindex]:not([tabindex="-1"])')]
    .filter((el) => !el.hasAttribute('disabled') && !el.getAttribute('aria-hidden'));
}

function ensureListeners() {
  if (listenersBound) return;
  listenersBound = true;

  const closeBtn = document.getElementById('modal-close');
  const overlay = document.getElementById('nft-modal');

  if (closeBtn) {
    closeBtn.addEventListener('click', closeModal);
  }
  if (overlay) {
    overlay.addEventListener('click', (e) => {
      if (e.target === overlay) closeModal();
    });
  }
}

function buildSafeMarketplaceUrl(base, id) {
  if (!id || typeof id !== 'string') return '#';
  const safeId = encodeURIComponent(id);
  return safeUrl(`${base}${safeId}`);
}

export function showNFTModal(nft) {
  if (!nft) return;

  const modalOverlay = document.getElementById('nft-modal');
  const modalBody = document.getElementById('modal-body');
  if (!modalOverlay || !modalBody) return;

  ensureListeners();
  lastFocusedElement = document.activeElement;

  const listPriceBlock =
    nft.listPrice !== null && nft.listPrice !== undefined
      ? `<span class="sol-amount">${solAmountHtml(escapeHtml(Number(nft.listPrice).toFixed(2)))}</span>`
      : escapeHtml('Unlisted');
  const saleBlock = nft.highestSale
    ? `<span class="sol-amount">${solAmountHtml(escapeHtml(Number(nft.highestSale).toFixed(2)))}</span>`
    : '—';
  const winRate = nft.totalMatches > 0
    ? Math.round((nft.wins / nft.totalMatches) * 100)
    : 0;

  const tensorUrl = buildSafeMarketplaceUrl('https://www.tensor.trade/item/', nft.id);
  const meUrl = buildSafeMarketplaceUrl('https://magiceden.io/item-details/', nft.id);
  const priceValueClass = nft.listPrice !== null && nft.listPrice !== undefined
    ? 'modal-stat-value-positive'
    : 'modal-stat-value-dim';

  modalBody.innerHTML = `
    <img
      class="modal-image"
      src="${escapeHtml(nft.image || FALLBACK_IMAGE)}"
      alt="${escapeHtml(nft.name || 'Harmie')}"
      data-fallback
    />
    <div class="modal-info">
      <h2 class="modal-name" id="modal-title">${escapeHtml(nft.name || 'Harmie')}</h2>

      <div class="modal-stats-grid">
        <div class="modal-stat">
          <div class="modal-stat-label">Community Rank</div>
          <div class="modal-stat-value">${nft.rank ? `#${escapeHtml(nft.rank)}` : '—'}</div>
        </div>
        <div class="modal-stat">
          <div class="modal-stat-label">ELO Score</div>
          <div class="modal-stat-value">${escapeHtml(nft.eloScore || CONFIG.ELO_DEFAULT)}</div>
        </div>
        <div class="modal-stat">
          <div class="modal-stat-label">Listed Price</div>
          <div class="modal-stat-value ${priceValueClass}">${listPriceBlock}</div>
        </div>
        <div class="modal-stat">
          <div class="modal-stat-label">Highest Sale</div>
          <div class="modal-stat-value">${saleBlock}</div>
        </div>
        <div class="modal-stat">
          <div class="modal-stat-label">Win Rate</div>
          <div class="modal-stat-value modal-stat-value-positive">${escapeHtml(winRate)}%</div>
        </div>
        <div class="modal-stat">
          <div class="modal-stat-label">Walks</div>
          <div class="modal-stat-value">${escapeHtml(nft.totalMatches || 0)} (${escapeHtml(nft.wins || 0)} W's / ${escapeHtml(nft.losses || 0)} L's)</div>
        </div>
      </div>

      ${nft.bgColor ? `
        <div class="modal-bg-row">
          Background: <span class="modal-bg-value">${escapeHtml(nft.bgColor)}</span>
        </div>
      ` : ''}

      <div class="modal-links">
        <a
          href="${escapeHtml(tensorUrl)}"
          target="_blank"
          rel="noopener noreferrer"
          class="modal-link-btn modal-link-tensor"
        >
          View on Tensor
        </a>
        <a
          href="${escapeHtml(meUrl)}"
          target="_blank"
          rel="noopener noreferrer"
          class="modal-link-btn modal-link-me"
        >
          View on Magic Eden
        </a>
      </div>
    </div>
  `;

  modalBody.querySelectorAll('img[data-fallback]').forEach(attachImageFallback);

  modalOverlay.classList.remove('hidden');
  modalOverlay.setAttribute('aria-hidden', 'false');
  modalOverlay.setAttribute('tabindex', '-1');
  document.body.classList.add('modal-open');

  if (activeEscHandler) {
    document.removeEventListener('keydown', activeEscHandler);
  }
  activeEscHandler = (e) => {
    if (e.key === 'Escape') {
      closeModal();
      return;
    }
    if (e.key !== 'Tab') return;

    const focusable = getFocusableElements(modalOverlay);
    if (focusable.length === 0) {
      e.preventDefault();
      modalOverlay.focus({ preventScroll: true });
      return;
    }

    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    const active = document.activeElement;
    const isInsideModal = modalOverlay.contains(active);

    if (e.shiftKey) {
      if (active === first || !isInsideModal) {
        e.preventDefault();
        last.focus({ preventScroll: true });
      }
      return;
    }

    if (active === last || !isInsideModal) {
      e.preventDefault();
      first.focus({ preventScroll: true });
    }
  };
  document.addEventListener('keydown', activeEscHandler);

  const closeBtn = document.getElementById('modal-close');
  if (closeBtn) closeBtn.focus({ preventScroll: true });
}

export function closeModal() {
  const modalOverlay = document.getElementById('nft-modal');
  if (!modalOverlay) return;

  modalOverlay.classList.add('hidden');
  modalOverlay.setAttribute('aria-hidden', 'true');
  document.body.classList.remove('modal-open');

  if (activeEscHandler) {
    document.removeEventListener('keydown', activeEscHandler);
    activeEscHandler = null;
  }

  if (lastFocusedElement && typeof lastFocusedElement.focus === 'function') {
    try {
      lastFocusedElement.focus({ preventScroll: true });
    } catch {
      /* ignore */
    }
    lastFocusedElement = null;
  }
}
