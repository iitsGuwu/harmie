// Home Page — site entry point: header (global nav) + hero + 4 tiles + footer.
// Tiles: Grow, Trade (coming soon), Collection, Pageant. Each links to its page.
import { escapeHtml } from '../utils/dom.js';
import harmieLogo from '../assets/harmie-logo.png';

const ICONS = {
  grow: `
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M12 21V11" />
      <path d="M12 11c0-3.3 2.7-5.5 6.5-5.5C18.5 8.8 15.8 11 12 11Z" />
      <path d="M12 13.5C12 10.4 9.4 8.3 6 8.3c0 3.1 2.6 5.2 6 5.2Z" />
    </svg>`,
  trade: `
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M4 8h13l-3-3" />
      <path d="M20 16H7l3 3" />
    </svg>`,
  collection: `
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <rect x="3.5" y="3.5" width="7" height="7" rx="1.5" />
      <rect x="13.5" y="3.5" width="7" height="7" rx="1.5" />
      <rect x="3.5" y="13.5" width="7" height="7" rx="1.5" />
      <rect x="13.5" y="13.5" width="7" height="7" rx="1.5" />
    </svg>`,
  pageant: `
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M4 7l3.5 3L12 5l4.5 5L20 7l-1.5 11h-13L4 7Z" />
      <path d="M5.5 18h13" />
    </svg>`,
};

const TILES = [
  {
    id: 'grow',
    label: 'Grow',
    href: '#grow',
    featured: true,
    badge: 'New',
    tagline: 'The beginning',
    desc: 'Planting the seeds to greatness. When a proposal hits its goal, we ship it.',
    cta: "Let's Grow",
    icon: ICONS.grow,
  },
  {
    id: 'trade',
    label: 'Trade',
    soon: true,
    tagline: 'Neuko asset marketplace',
    desc: 'Buy and sell badges and Harmies with $GBOY or SOL — all in one place.',
    cta: 'Coming soon',
    icon: ICONS.trade,
  },
  {
    id: 'collection',
    label: 'Collection',
    href: '#gallery',
    tagline: 'Browse all Harmies',
    desc: 'Explore the full live Harmies collection from Solana — sort, search, and inspect every trait.',
    cta: 'View collection',
    icon: ICONS.collection,
  },
  {
    id: 'pageant',
    label: 'Pageant',
    href: '#pageant',
    tagline: 'Crown your favorites',
    desc: 'Vote head-to-head in charm contests. Your votes shape the community rankings.',
    cta: 'Enter pageant',
    icon: ICONS.pageant,
  },
];

export function renderHome(container) {
  container.innerHTML = `
    <div class="home-page">
      <section class="hero">
        <h1 class="hero-title">
          <img class="hero-logo" src="${harmieLogo}" alt="Harmie" width="1254" height="373" />
        </h1>
        <p class="hero-subtitle">Vote in head-to-head battles, browse the collection gallery, and track real-time leaderboards.</p>
        <div class="hero-actions">
          <a class="hero-btn hero-btn-primary" href="#gallery">View gallery <span aria-hidden="true">→</span></a>
          <a class="hero-btn hero-btn-ghost" href="#pageant">Pageant</a>
        </div>
      </section>

      <section class="tiles" aria-label="Explore Harmie">
        ${TILES.map(renderTile).join('')}
      </section>
    </div>
  `;
}

function renderTile(tile) {
  let badge = '';
  if (tile.soon) {
    badge = '<span class="tile-badge tile-badge-soon">Coming soon</span>';
  } else if (tile.badge) {
    badge = `<span class="tile-badge tile-badge-new">${escapeHtml(tile.badge)}</span>`;
  }
  const ctaArrow = tile.soon ? '' : ' <span class="tile-cta-arrow" aria-hidden="true">→</span>';
  const classes = ['tile'];
  if (tile.soon) classes.push('tile-soon');
  if (tile.featured) classes.push('tile-featured');
  const inner = `
    <span class="tile-icon" aria-hidden="true">${tile.icon}</span>
    <div class="tile-head">
      <h2 class="tile-title">${escapeHtml(tile.label)}</h2>
      ${badge}
    </div>
    <p class="tile-tagline">${escapeHtml(tile.tagline)}</p>
    <p class="tile-desc">${escapeHtml(tile.desc)}</p>
    <span class="tile-cta">${escapeHtml(tile.cta)}${ctaArrow}</span>
  `;

  if (tile.soon) {
    return `<div class="${classes.join(' ')}" data-tile="${escapeHtml(tile.id)}" aria-disabled="true">${inner}</div>`;
  }
  return `<a class="${classes.join(' ')}" data-tile="${escapeHtml(tile.id)}" href="${escapeHtml(tile.href)}">${inner}</a>`;
}
