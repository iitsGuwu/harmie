// Grow Page — community funding rounds for upcoming Harmie builds.
//
// Each funded proposal can track a Solana wallet's live SOL balance against a
// target. With a wallet + `targetSol`, the bar reflects the wallet's balance and
// flips to "Build in progress" the moment the balance reaches the target. With a
// wallet but no target yet, it live-watches the wallet and shows the amount
// raised ("goal TBA"). With no wallet, it shows the proposal's pending state.
import { CONFIG } from '../config.js';
import { escapeHtml, devWarn } from '../utils/dom.js';

// ── Build proposals ──────────────────────────────────────────────────────────
// To enable a progress fill + "Build in progress", set `targetSol` (goal in SOL)
// on a proposal that has a `wallet`.
const PROPOSALS = [
  {
    id: 'trade',
    index: '01',
    name: 'Trade',
    domain: 'trade.harmie.xyz',
    href: 'https://trade.harmie.xyz',
    blurb:
      'A Neuko asset only marketplace — buy and sell Badges and Harmies using $GBOY or SOL, all in one place. Zero marketplace fees. ',
    hasFunding: true,
    tagLabel: 'Building',
    wallet: 'egrDuJh8qtdC1R9uJ7za2Y2rD5diXVA9hazHDcLp7jB',
    targetSol: 4,
    isFunded: true,
  },
  {
    id: 'dao',
    index: '02',
    name: 'DAO',
    domain: 'dao.harmie.xyz',
    href: 'https://dao.harmie.xyz',
    blurb:
      'Holder proposals and community votes. Governance structure and DAO fund source to be defined.',
    hasFunding: false, // gated behind a community vote — no funding round yet
    tagLabel: 'Approval required',
    upcomingNote: 'Community decision required — TBA.',
    wallet: null,
    targetSol: null,
  },
  {
    id: 'circuit',
    index: '03',
    name: 'Circuit',
    domain: 'circuit.harmie.xyz (or other domain)',
    href: 'https://circuit.harmie.xyz',
    blurb:
      'A Smash Karts-style racer with all 500 Harmies as 3D drivers. Pay to add a custom NFT driver and help fund DAO projects.',
    hasFunding: false, // first DAO proposal — no funding round, no wallet, no bar
    tagLabel: 'First DAO proposal',
    upcomingNote: 'Moves to the DAO as the first community proposal.',
    wallet: null,
    targetSol: null,
  },
];

let livePollInterval = null;

export function renderGrow(container) {
  container.innerHTML = `
    <div class="grow-page">
      <header class="grow-header">
        <h1 class="section-title">GROW</h1>
        <p class="section-subtitle">Community funding rounds for the next Harmie builds. Back a proposal — when it hits its goal, we ship it.</p>
        <div class="grow-note">
          "Grow" funding rounds cover builds <strong>01</strong> and <strong>02</strong>. After that, new project proposals and launches move to the <strong>DAO</strong>.
        </div>
      </header>

      <div class="proposal-list">
        ${PROPOSALS.map(renderProposal).join('')}
      </div>
    </div>
  `;

  // Attach event listener for More Info buttons
  container.querySelectorAll('[data-action="more-info"]').forEach((btn) => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const id = btn.dataset.id;
      if (id === 'trade') {
        showInfoModal();
      } else if (id === 'dao') {
        showDaoModal();
      }
    });
  });

  hydrateBalances();

  // Start polling every 10 seconds to track wallet amount in live
  if (livePollInterval) {
    clearInterval(livePollInterval);
  }
  livePollInterval = setInterval(() => {
    if (!document.querySelector('.grow-page')) {
      clearInterval(livePollInterval);
      livePollInterval = null;
      return;
    }
    hydrateBalances();
  }, 10000);
}

function showCustomModal(modalId, title, contentHtml) {
  if (document.getElementById(modalId)) return;

  const html = `
    <div id="${modalId}" class="modal-overlay" role="dialog" aria-modal="true">
      <div class="modal-content comic-panel info-modal-content">
        <button class="modal-close" id="${modalId}-close" aria-label="Close">&times;</button>
        <div class="info-modal-body">
          <h2 class="info-modal-title">${escapeHtml(title)}</h2>
          ${contentHtml}
        </div>
      </div>
    </div>
  `;
  document.body.insertAdjacentHTML('beforeend', html);

  const modal = document.getElementById(modalId);
  const closeBtn = document.getElementById(`${modalId}-close`);

  const close = () => {
    modal.classList.add('fade-out');
    setTimeout(() => {
      modal.remove();
    }, 300);
    document.removeEventListener('keydown', keyHandler);
  };

  const keyHandler = (e) => {
    if (e.key === 'Escape') close();
  };

  closeBtn.addEventListener('click', close);
  modal.addEventListener('click', (e) => {
    if (e.target === modal) close();
  });
  document.addEventListener('keydown', keyHandler);
}

function showInfoModal() {
  const contentHtml = `
    <div class="info-modal-img-container">
      <img src="/cost-breakdown.png" alt="Cost Breakdown" class="info-modal-img" />
    </div>
    <p class="info-modal-msg">Here is the current cost breakdown, while 2x is recommended, 1.5x will suffice for this build.</p>
  `;
  showCustomModal('info-modal', 'Cost Breakdown', contentHtml);
}

function showDaoModal() {
  const contentHtml = `
    <p class="info-modal-msg" style="border-left-color: var(--accent); line-height: 1.6;">
      <strong>Proposed Method of Proceeding:</strong><br><br>
      All top 50 Neuko supporters from the <code>gboyspecial/blocktracker</code> will be contacted to participate in proposing and voting on the DAO structure.<br><br>
      Once community discussions are held and initial proposals are submitted, successive rounds of voting will be cast until a single DAO structure is selected.<br><br>
      Should any eligible supporter choose not to participate or remain unreachable, their voting slot will be relinquished to the next holder in rank (e.g., top 51, 52, etc.).
    </p>
  `;
  showCustomModal('dao-modal', 'THE TOP50 VOTE', contentHtml);
}

function renderProposal(p) {
  const tagClass = p.hasFunding ? 'tag-funding' : 'tag-upcoming';
  const tag = `<span class="proposal-tag ${tagClass}">${escapeHtml(p.tagLabel)}</span>`;
  const body = p.hasFunding ? renderFunding(p) : renderUpcoming(p);
  const hasMoreInfo = p.id === 'trade' || p.id === 'dao';
  const moreInfoBtn = hasMoreInfo
    ? `<button class="more-info-btn" data-action="more-info" data-id="${escapeHtml(p.id)}">More Info</button>`
    : '';

  return `
    <article class="proposal-card${p.hasFunding ? '' : ' proposal-card-upcoming'}${hasMoreInfo ? ' proposal-card-has-info' : ''}" data-proposal="${escapeHtml(p.id)}">
      <div class="proposal-top">
        <span class="proposal-index" aria-hidden="true">${escapeHtml(p.index)}</span>
        <div class="proposal-heading">
          <div class="proposal-title-row">
            <h2 class="proposal-name">${escapeHtml(p.name)}</h2>
            ${tag}
          </div>
          <a class="proposal-domain" href="${escapeHtml(p.href)}" target="_blank" rel="noopener noreferrer">${escapeHtml(p.domain)}</a>
        </div>
      </div>
      <p class="proposal-blurb">${escapeHtml(p.blurb)}</p>
      ${body}
      ${moreInfoBtn}
    </article>
  `;
}

function renderFunding(p) {
  const hasWallet = !!p.wallet;
  const hasTarget = typeof p.targetSol === 'number' && p.targetSol > 0;

  let state;
  let status;
  let goal;
  let valuenow = '0';
  let fillWidth = '0%';

  if (hasWallet) {
    if (p.isFunded) {
      state = 'building';
      status = '🚧 Build in progress';
      goal = `${formatSol(p.targetSol)} / ${formatSol(p.targetSol)} SOL`;
      valuenow = '100';
      fillWidth = '100%';
    } else {
      state = 'loading';
      status = 'Loading balance…';
      goal = hasTarget ? `Goal: ${formatSol(p.targetSol)} SOL` : 'Goal: TBA';
    }
  } else {
    state = 'pending';
    status = p.pendingLabel || 'Funding wallet — coming soon';
    goal = 'Goal: TBA';
  }

  const walletLink = p.wallet
    ? `<a class="funding-wallet" href="https://solscan.io/account/${escapeHtml(p.wallet)}" target="_blank" rel="noopener noreferrer" title="View funding wallet on Solscan">${escapeHtml(shortAddr(p.wallet))}</a>`
    : '';

  return `
    <div class="proposal-funding" data-funding="${escapeHtml(p.id)}" data-state="${state}">
      <div class="funding-bar" role="progressbar" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${valuenow}">
        <div class="funding-bar-fill" style="width: ${fillWidth}"></div>
      </div>
      <div class="funding-row">
        <span class="funding-status">${escapeHtml(status)}</span>
        <span class="funding-figures">${escapeHtml(goal)}</span>
      </div>
      ${walletLink}
    </div>
  `;
}

function renderUpcoming(p) {
  return `
    <div class="proposal-upcoming-note">
      <span class="upcoming-dot" aria-hidden="true"></span>
      ${escapeHtml(p.upcomingNote)}
    </div>
  `;
}

// ── Live balances ────────────────────────────────────────────────────────────

async function hydrateBalances() {
  for (const p of PROPOSALS) {
    if (!p.hasFunding || !p.wallet) continue;
    const el = document.querySelector(`[data-funding="${p.id}"]`);
    if (!el) continue;
    try {
      if (p.isFunded) {
        applyFunding(el, p.targetSol, p.targetSol);
      } else {
        const balance = await fetchSolBalance(p.wallet);
        applyFunding(el, balance, p.targetSol);
      }
    } catch (err) {
      devWarn('Grow: balance fetch failed for', p.id, err);
      setFundingError(el);
    }
  }
}

function applyFunding(el, balance, target) {
  const fill = el.querySelector('.funding-bar-fill');
  const bar = el.querySelector('.funding-bar');
  const status = el.querySelector('.funding-status');
  const figures = el.querySelector('.funding-figures');

  // Live-watching a wallet with no goal set yet — show the amount raised only.
  if (!(typeof target === 'number' && target > 0)) {
    el.dataset.state = 'watching';
    if (fill) fill.style.width = '0%';
    if (bar) bar.setAttribute('aria-valuenow', '0');
    if (figures) figures.textContent = `${formatSol(balance)} SOL raised`;
    if (status) status.textContent = 'Live • goal TBA';
    return;
  }

  const pct = Math.max(0, Math.min(100, (balance / target) * 100));
  const reached = balance >= target;
  el.dataset.state = reached ? 'building' : 'funding';
  if (fill) fill.style.width = `${pct}%`;
  if (bar) bar.setAttribute('aria-valuenow', String(Math.round(pct)));
  if (figures) figures.textContent = `${formatSol(balance)} / ${formatSol(target)} SOL`;
  if (status) status.textContent = reached ? '🚧 Build in progress' : `${Math.floor(pct)}% funded`;
}

function setFundingError(el) {
  el.dataset.state = 'error';
  const status = el.querySelector('.funding-status');
  if (status) status.textContent = 'Balance unavailable — try again later';
}

async function fetchSolBalance(address) {
  const res = await fetch(CONFIG.HELIUS_RPC_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      jsonrpc: '2.0',
      id: 'grow-balance',
      method: 'getBalance',
      params: [address],
    }),
  });
  if (!res.ok) throw new Error(`RPC ${res.status}`);
  const json = await res.json();
  const lamports = json?.result?.value;
  if (typeof lamports !== 'number') throw new Error('Unexpected getBalance response');
  return lamports / 1e9; // lamports → SOL
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function formatSol(n) {
  if (!Number.isFinite(n)) return '0';
  return n.toLocaleString('en-US', { maximumFractionDigits: 2 });
}

function shortAddr(addr) {
  if (!addr || addr.length < 10) return addr || '';
  return `${addr.slice(0, 4)}…${addr.slice(-4)}`;
}
