// Pageant — Head-to-head voting system with ELO
import { CONFIG } from '../config.js';
import {
  submitVote,
  ensureSupabaseForVoting,
  getLastSupabaseInitFailure,
} from '../services/supabaseService.js';
import { showNFTModal } from '../components/modal.js';
import { escapeHtml, attachImageFallback, FALLBACK_IMAGE } from '../utils/dom.js';
import { showToast } from '../utils/toast.js';

let allNFTs = [];
let currentPair = [null, null];
let votesCast = 0;
let isVoting = false;
let streakCount = 0;

const sessionVotedPairs = new Set();
const MAX_PAIR_ATTEMPTS = 25;

let keyHandler = null;

export function renderPageant(container, nfts) {
  allNFTs = nfts.filter((n) => n.image);
  votesCast = parseInt(localStorage.getItem('harmies_votes') || '0', 10) || 0;

  container.innerHTML = `
    <div class="pageant-page">
      <div class="pageant-header">
        <h1 class="section-title">PAGEANT</h1>
        <p class="section-subtitle">Pick your favorite and most charming! Your vote shapes the community rankings.</p>
      </div>

      <div class="pageant-matchup" id="pageant-matchup">
        <div class="pageant-contestant left" id="contestant-left" role="button" tabindex="0" aria-label="Vote for left Harmie">
          <div class="contestant-panel">
            <div class="contestant-image-wrapper">
              <img class="contestant-image" id="contestant-left-img" src="${escapeHtml(FALLBACK_IMAGE)}" alt="" data-fallback />
            </div>
            <div class="contestant-info">
              <div class="contestant-name" id="contestant-left-name">Loading...</div>
              <div class="contestant-stats">
                <div class="contestant-stat">
                  <span>Score:</span>
                  <span class="contestant-elo" id="contestant-left-elo">—</span>
                </div>
                <div class="contestant-stat">
                  <span>W/L:</span>
                  <span class="contestant-stat-value" id="contestant-left-wl">—</span>
                </div>
              </div>
            </div>
          </div>
        </div>

        <div class="star-badge" aria-hidden="true">
          <div class="star-burst"></div>
          <span class="star-text">⭐</span>
        </div>

        <div class="pageant-contestant right" id="contestant-right" role="button" tabindex="0" aria-label="Vote for right Harmie">
          <div class="contestant-panel">
            <div class="contestant-image-wrapper">
              <img class="contestant-image" id="contestant-right-img" src="${escapeHtml(FALLBACK_IMAGE)}" alt="" data-fallback />
            </div>
            <div class="contestant-info">
              <div class="contestant-name" id="contestant-right-name">Loading...</div>
              <div class="contestant-stats">
                <div class="contestant-stat">
                  <span>Score:</span>
                  <span class="contestant-elo" id="contestant-right-elo">—</span>
                </div>
                <div class="contestant-stat">
                  <span>W/L:</span>
                  <span class="contestant-stat-value" id="contestant-right-wl">—</span>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>

      <div class="pageant-actions">
        <button class="pageant-btn pageant-btn-skip" id="pageant-skip" type="button">SKIP →</button>
      </div>

      <div class="pageant-stats-bar">
        <div class="pageant-stat">
          <div class="pageant-stat-value" id="stat-votes">${escapeHtml(votesCast)}</div>
          <div class="pageant-stat-label">Your Votes</div>
        </div>
        <div class="pageant-stat">
          <div class="pageant-stat-value" id="stat-streak">${escapeHtml(streakCount)}</div>
          <div class="pageant-stat-label">Streak</div>
        </div>
        <div class="pageant-stat">
          <div class="pageant-stat-value" id="stat-total-nfts">${escapeHtml(allNFTs.length)}</div>
          <div class="pageant-stat-label">Harmies</div>
        </div>
      </div>
    </div>
  `;

  container.querySelectorAll('img[data-fallback]').forEach(attachImageFallback);

  loadNewMatchup();
  bindPageantEvents();
}

function bindPageantEvents() {
  const leftContestant = document.getElementById('contestant-left');
  const rightContestant = document.getElementById('contestant-right');
  const skipBtn = document.getElementById('pageant-skip');

  if (leftContestant) {
    leftContestant.addEventListener('click', (e) => {
      if (e.target.closest('.contestant-info')) {
        showNFTModal(currentPair[0]);
        return;
      }
      handleVote('left');
    });
    leftContestant.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        handleVote('left');
      }
    });
  }

  if (rightContestant) {
    rightContestant.addEventListener('click', (e) => {
      if (e.target.closest('.contestant-info')) {
        showNFTModal(currentPair[1]);
        return;
      }
      handleVote('right');
    });
    rightContestant.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        handleVote('right');
      }
    });
  }

  if (skipBtn) {
    skipBtn.addEventListener('click', () => {
      if (!isVoting) loadNewMatchup();
    });
  }

  // Global keyboard shortcuts (only while pageant is on screen)
  if (keyHandler) {
    document.removeEventListener('keydown', keyHandler);
  }
  keyHandler = (e) => {
    if (!document.getElementById('pageant-matchup')) return;
    if (document.activeElement && ['INPUT', 'TEXTAREA'].includes(document.activeElement.tagName)) return;
    if (isVoting) return;
    if (e.key === 'ArrowLeft') {
      e.preventDefault();
      handleVote('left');
    } else if (e.key === 'ArrowRight') {
      e.preventDefault();
      handleVote('right');
    } else if (e.key.toLowerCase() === 's') {
      loadNewMatchup();
    }
  };
  document.addEventListener('keydown', keyHandler);
}

function loadNewMatchup() {
  if (allNFTs.length < 2) return;

  const maxWalks = Math.max(...allNFTs.map((n) => n.totalMatches || 0), 1);
  const weights = allNFTs.map((n) => Math.max(1, maxWalks - (n.totalMatches || 0) + 10));
  const totalWeight = weights.reduce((a, b) => a + b, 0);

  const pickPair = () => {
    const leftIdx = weightedRandom(weights, totalWeight);
    let rightIdx;
    let attempts = 0;
    do {
      rightIdx = weightedRandom(weights, totalWeight);
      attempts++;
    } while (rightIdx === leftIdx && attempts < 50);

    if (rightIdx === leftIdx) {
      rightIdx = (leftIdx + 1) % allNFTs.length;
    }
    return [leftIdx, rightIdx];
  };

  let leftIdx;
  let rightIdx;
  let pairKey;
  let attempts = 0;

  do {
    [leftIdx, rightIdx] = pickPair();
    pairKey = [allNFTs[leftIdx].id, allNFTs[rightIdx].id].sort().join('_');
    attempts++;
  } while (sessionVotedPairs.has(pairKey) && attempts < MAX_PAIR_ATTEMPTS);

  currentPair = [allNFTs[leftIdx], allNFTs[rightIdx]];
  renderMatchup();
}

function weightedRandom(weights, totalWeight) {
  let random = Math.random() * totalWeight;
  for (let i = 0; i < weights.length; i++) {
    random -= weights[i];
    if (random <= 0) return i;
  }
  return weights.length - 1;
}

function renderMatchup() {
  const [left, right] = currentPair;
  if (!left || !right) return;

  const leftEl = document.getElementById('contestant-left');
  const rightEl = document.getElementById('contestant-right');
  if (leftEl) leftEl.classList.remove('contestant-winner', 'contestant-loser');
  if (rightEl) rightEl.classList.remove('contestant-winner', 'contestant-loser');

  document.querySelectorAll('.elo-change').forEach((el) => el.remove());

  const leftImg = document.getElementById('contestant-left-img');
  const leftName = document.getElementById('contestant-left-name');
  const leftElo = document.getElementById('contestant-left-elo');
  const leftWL = document.getElementById('contestant-left-wl');

  if (leftImg) {
    leftImg.src = left.image || FALLBACK_IMAGE;
    leftImg.alt = left.name || 'Harmie';
    attachImageFallback(leftImg);
  }
  if (leftName) leftName.textContent = left.name || 'Harmie';
  if (leftElo) leftElo.textContent = String(left.eloScore || CONFIG.ELO_DEFAULT);
  if (leftWL) leftWL.textContent = `${left.wins || 0}/${left.losses || 0}`;

  const rightImg = document.getElementById('contestant-right-img');
  const rightName = document.getElementById('contestant-right-name');
  const rightElo = document.getElementById('contestant-right-elo');
  const rightWL = document.getElementById('contestant-right-wl');

  if (rightImg) {
    rightImg.src = right.image || FALLBACK_IMAGE;
    rightImg.alt = right.name || 'Harmie';
    attachImageFallback(rightImg);
  }
  if (rightName) rightName.textContent = right.name || 'Harmie';
  if (rightElo) rightElo.textContent = String(right.eloScore || CONFIG.ELO_DEFAULT);
  if (rightWL) rightWL.textContent = `${right.wins || 0}/${right.losses || 0}`;

  isVoting = false;
}

async function handleVote(side) {
  if (isVoting) return;
  if (!currentPair[0] || !currentPair[1]) return;
  if (!(await ensureSupabaseForVoting())) {
    const detail = getLastSupabaseInitFailure();
    showToast(
      detail ||
        'Could not start a voting session. Check Supabase → Authentication (Anonymous provider + Attack Protection / captcha), then refresh.',
      'error',
    );
    return;
  }
  isVoting = true;

  const winnerIdx = side === 'left' ? 0 : 1;
  const loserIdx = side === 'left' ? 1 : 0;
  const winner = currentPair[winnerIdx];
  const loser = currentPair[loserIdx];

  const pairKey = [winner.id, loser.id].sort().join('_');
  sessionVotedPairs.add(pairKey);

  showGlamourEffect();

  const winnerEl = document.getElementById(side === 'left' ? 'contestant-left' : 'contestant-right');
  const loserEl = document.getElementById(side === 'left' ? 'contestant-right' : 'contestant-left');

  if (winnerEl) winnerEl.classList.add('contestant-winner');
  if (loserEl) loserEl.classList.add('contestant-loser');

  const eloResult = calculateElo(
    winner.eloScore || CONFIG.ELO_DEFAULT,
    loser.eloScore || CONFIG.ELO_DEFAULT,
    winner.totalMatches || 0,
    loser.totalMatches || 0,
  );

  showEloChange(winnerEl, `+${eloResult.winnerChange}`, true);
  showEloChange(loserEl, `${eloResult.loserChange}`, false);

  // Optimistic local update with rollback on failure
  const snapshot = {
    winner: { eloScore: winner.eloScore, totalMatches: winner.totalMatches, wins: winner.wins },
    loser: { eloScore: loser.eloScore, totalMatches: loser.totalMatches, losses: loser.losses },
    votesCast,
    streakCount,
  };

  winner.eloScore = (winner.eloScore || CONFIG.ELO_DEFAULT) + eloResult.winnerChange;
  winner.totalMatches = (winner.totalMatches || 0) + 1;
  winner.wins = (winner.wins || 0) + 1;
  loser.eloScore = (loser.eloScore || CONFIG.ELO_DEFAULT) + eloResult.loserChange;
  loser.totalMatches = (loser.totalMatches || 0) + 1;
  loser.losses = (loser.losses || 0) + 1;

  votesCast++;
  streakCount++;
  localStorage.setItem('harmies_votes', String(votesCast));
  updateStatsDisplay();

  try {
    const result = await submitVote(winner.id, loser.id);
    if (!result || result.error) {
      rollback(winner, loser, snapshot, result?.error || 'Vote could not be recorded.');
    }
  } catch (err) {
    rollback(winner, loser, snapshot, err?.message || 'Network error');
  }

  setTimeout(() => loadNewMatchup(), 1400);
}

function rollback(winner, loser, snapshot, message) {
  winner.eloScore = snapshot.winner.eloScore;
  winner.totalMatches = snapshot.winner.totalMatches;
  winner.wins = snapshot.winner.wins;
  loser.eloScore = snapshot.loser.eloScore;
  loser.totalMatches = snapshot.loser.totalMatches;
  loser.losses = snapshot.loser.losses;
  votesCast = snapshot.votesCast;
  streakCount = 0;
  localStorage.setItem('harmies_votes', String(votesCast));
  updateStatsDisplay();
  showToast(message || 'Vote rejected', 'error');
}

function updateStatsDisplay() {
  const statVotes = document.getElementById('stat-votes');
  const statStreak = document.getElementById('stat-streak');
  if (statVotes) statVotes.textContent = String(votesCast);
  if (statStreak) statStreak.textContent = String(streakCount);
}

function calculateElo(winnerElo, loserElo, winnerMatches, loserMatches) {
  const kWinner = winnerMatches >= CONFIG.ELO_THRESHOLD ? CONFIG.ELO_K_FACTOR_ESTABLISHED : CONFIG.ELO_K_FACTOR_NEW;
  const kLoser = loserMatches >= CONFIG.ELO_THRESHOLD ? CONFIG.ELO_K_FACTOR_ESTABLISHED : CONFIG.ELO_K_FACTOR_NEW;

  const expectedWinner = 1 / (1 + Math.pow(10, (loserElo - winnerElo) / 400));
  const expectedLoser = 1 / (1 + Math.pow(10, (winnerElo - loserElo) / 400));

  const winnerChange = Math.round(kWinner * (1 - expectedWinner));
  const loserChange = Math.round(kLoser * (0 - expectedLoser));

  return {
    winnerChange,
    loserChange,
    winnerNewElo: winnerElo + winnerChange,
    loserNewElo: loserElo + loserChange,
  };
}

function showGlamourEffect() {
  const overlay = document.getElementById('glamour-effect');
  if (!overlay) return;

  if (window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
    return;
  }

  const text = CONFIG.GLAMOUR_EFFECTS[Math.floor(Math.random() * CONFIG.GLAMOUR_EFFECTS.length)];

  overlay.innerHTML = `
    <div class="glamour-starburst"></div>
    <div class="glamour-text">${escapeHtml(text)}</div>
  `;
  overlay.classList.remove('hidden');

  setTimeout(() => {
    overlay.classList.add('hidden');
    overlay.innerHTML = '';
  }, 700);
}

function showEloChange(element, text, isPositive) {
  if (!element) return;

  const el = document.createElement('div');
  el.className = `elo-change ${isPositive ? 'positive' : 'negative'}`;
  el.textContent = text;
  element.style.position = 'relative';
  element.appendChild(el);

  setTimeout(() => el.remove(), 1300);
}

export function updatePageantData(nfts) {
  allNFTs = nfts.filter((n) => n.image);
  if (currentPair[0]) {
    const u0 = allNFTs.find((n) => n.id === currentPair[0].id);
    if (u0) currentPair[0] = u0;
  }
  if (currentPair[1]) {
    const u1 = allNFTs.find((n) => n.id === currentPair[1].id);
    if (u1) currentPair[1] = u1;
  }
}
