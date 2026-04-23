// Leaderboard Page — Top ranked Harmies by ELO
import { showNFTModal } from '../components/modal.js';
import { escapeHtml, attachImageFallback, FALLBACK_IMAGE } from '../utils/dom.js';

let leaderboardNFTs = [];

const ICONS = {
  duel: `
    <svg class="empty-state-svg" viewBox="0 0 24 24" aria-hidden="true">
      <path d="M7 4h4v4H7zM13 16h4v4h-4z"/>
      <path d="m11 9 2 2m0 0-2 2m2-2 2-2m-2 2 2 2"/>
    </svg>
  `,
};

export function renderLeaderboard(container, nfts) {
  leaderboardNFTs = [...nfts]
    .filter((n) => n.totalMatches > 0 || n.eloScore !== 1200)
    .sort((a, b) => (b.eloScore || 1200) - (a.eloScore || 1200));

  if (leaderboardNFTs.length === 0) {
    leaderboardNFTs = [...nfts].slice(0, 50);
  }

  const top3 = leaderboardNFTs.slice(0, 3);
  const rest = leaderboardNFTs.slice(3, 50);

  const totalMatches = leaderboardNFTs.reduce((acc, n) => acc + (n.totalMatches || 0), 0);
  const hasVotes = leaderboardNFTs.length > 0 && leaderboardNFTs[0].totalMatches > 0;

  container.innerHTML = `
    <div class="leaderboard-page">
      <div class="leaderboard-header">
        <h1 class="section-title">COMMUNITY RANKINGS</h1>
        <p class="section-subtitle">Ranked by community votes — the people's choice!</p>
        <div class="gallery-stats leaderboard-stats">
          <div class="stat-badge">
            <span>Ranked NFTs:</span>
            <span class="stat-value">${escapeHtml(leaderboardNFTs.length)}</span>
          </div>
          <div class="stat-badge">
            <span>Total Votes:</span>
            <span class="stat-value">${escapeHtml(totalMatches)}</span>
          </div>
        </div>
      </div>

      ${hasVotes ? renderPodium(top3) : renderNoVotesYet()}

      ${rest.length > 0 && rest[0].totalMatches > 0 ? renderTable(rest) : ''}
    </div>
  `;

  container.querySelectorAll('img[data-fallback]').forEach(attachImageFallback);
  bindLeaderboardEvents();
}

function renderPodium(top3) {
  if (top3.length < 3) return '';

  const medals = ['01', '02', '03'];
  const classes = ['first', 'second', 'third'];

  return `
    <div class="podium">
      ${top3.map((nft, i) => `
        <div
          class="podium-spot ${classes[i]}"
          data-nft-id="${escapeHtml(nft.id)}"
          role="button"
          tabindex="0"
          aria-label="Open details for ${escapeHtml(nft.name || 'Harmie')}"
        >
          <div class="podium-medal">${medals[i]}</div>
          <img
            class="podium-image"
            src="${escapeHtml(nft.image || FALLBACK_IMAGE)}"
            alt="${escapeHtml(nft.name || 'Harmie')}"
            loading="lazy"
            data-fallback
          />
          <div class="podium-name">${escapeHtml(nft.name || 'Harmie')}</div>
          <div class="podium-elo">${escapeHtml(nft.eloScore || 1200)}</div>
          <div class="podium-record">
            ${escapeHtml(nft.wins || 0)} W's / ${escapeHtml(nft.losses || 0)} L's
          </div>
        </div>
      `).join('')}
    </div>
  `;
}

function renderNoVotesYet() {
  return `
    <div class="empty-state empty-state-large">
      <div class="empty-state-icon">${ICONS.duel}</div>
      <h2 class="empty-state-title">NO VOTES YET!</h2>
      <p>Head to the <a class="inline-link" href="#pageant">Pageant</a> and cast your first vote!</p>
      <p class="empty-state-sub">Rankings will appear after the community starts voting.</p>
    </div>
  `;
}

function renderTable(nfts) {
  return `
    <div class="leaderboard-table-wrapper">
      <table class="leaderboard-table">
        <thead>
          <tr>
            <th>Rank</th>
            <th>Harmie</th>
            <th>ELO</th>
            <th>Win %</th>
            <th>Walks</th>
          </tr>
        </thead>
        <tbody>
          ${nfts.map((nft, i) => {
            const rank = i + 4;
            const winRate = nft.totalMatches > 0
              ? Math.round((nft.wins / nft.totalMatches) * 100)
              : 0;

            return `
              <tr
                data-nft-id="${escapeHtml(nft.id)}"
                tabindex="0"
                aria-label="Open details for ${escapeHtml(nft.name || 'Harmie')}"
              >
                <td class="lb-rank ${rank <= 10 ? 'top' : ''}">${escapeHtml(rank)}</td>
                <td>
                  <div class="lb-nft-cell">
                    <img
                      class="lb-nft-thumb"
                      src="${escapeHtml(nft.image || FALLBACK_IMAGE)}"
                      alt="${escapeHtml(nft.name || 'Harmie')}"
                      loading="lazy"
                      data-fallback
                    />
                    <span class="lb-nft-name">${escapeHtml(nft.name || 'Harmie')}</span>
                  </div>
                </td>
                <td class="lb-elo">${escapeHtml(nft.eloScore || 1200)}</td>
                <td class="lb-winrate">${escapeHtml(winRate)}%</td>
                <td class="lb-matches">${escapeHtml(nft.totalMatches || 0)}</td>
              </tr>
            `;
          }).join('')}
        </tbody>
      </table>
    </div>
  `;
}

function bindLeaderboardEvents() {
  document.querySelectorAll('.podium-spot').forEach((spot) => {
    const openSpot = () => {
      const nftId = spot.dataset.nftId;
      const nft = leaderboardNFTs.find((n) => n.id === nftId);
      if (nft) showNFTModal(nft);
    };
    spot.addEventListener('click', openSpot);
    spot.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        openSpot();
      }
    });
  });

  document.querySelectorAll('.leaderboard-table tbody tr').forEach((row) => {
    const openRow = () => {
      const nftId = row.dataset.nftId;
      const nft = leaderboardNFTs.find((n) => n.id === nftId);
      if (nft) showNFTModal(nft);
    };
    row.addEventListener('click', openRow);
    row.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        openRow();
      }
    });
  });
}

export function updateLeaderboardData(nfts) {
  leaderboardNFTs = [...nfts]
    .filter((n) => n.totalMatches > 0)
    .sort((a, b) => (b.eloScore || 1200) - (a.eloScore || 1200));

  // Re-render only if leaderboard is on screen.
  const container = document.querySelector('.leaderboard-page');
  if (container && container.parentElement) {
    renderLeaderboard(container.parentElement, nfts);
  }
}
