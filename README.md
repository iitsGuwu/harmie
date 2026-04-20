# Harmie Arena

Community-built voting and gallery platform for the [Harmies](https://magiceden.io/marketplace/harmies) NFT collection on Solana.

Vote for your favorite Harmies in head-to-head charm battles, browse the full live collection, and check out the community rankings — all powered by an ELO rating system.

## Features

- **Battle Arena** — Pick your favorite in head-to-head matchups. Votes update ELO scores in real time.
- **Gallery** — Browse, sort, and search all Harmies by price, highest sale, rank, number, or background.
- **Leaderboard** — Community rankings with podium display and detailed stats table.
- **NFT Detail Modal** — View stats, marketplace links (Tensor & Magic Eden), and traits for any Harmie.
- **Three Theme Modes** — Light, Mid (default), and Dark with localStorage persistence.
- **Anti-Rigging** — Duplicate pair cooldowns, daily vote limits, rate limiting, and server-side auth-bound votes.
- **Real-Time Updates** — Supabase Postgres Changes for live ELO updates across all clients.

## Tech Stack

| Layer | Technology |
|-------|------------|
| Frontend | Vanilla JS + Vite |
| Styling | CSS custom properties (3 theme modes) |
| Database | Supabase (PostgreSQL + RLS + Auth) |
| Hosting | Netlify (Functions + CDN) |
| NFT Data | Helius DAS API + Magic Eden API v2 |

## Getting Started

### Prerequisites

- [Node.js](https://nodejs.org/) v20+
- A [Supabase](https://supabase.com/) project
- A [Helius](https://www.helius.dev/) API key

### Setup

```bash
# Clone the repo
git clone https://github.com/iitsGuwu/harmie.git
cd harmie

# Install dependencies
npm install

# Copy environment template and fill in your keys
cp .env.example .env

# Start the dev server
npm run dev
```

### Environment Variables

See [`.env.example`](.env.example) for all required variables:

| Variable | Description |
|----------|-------------|
| `HELIUS_API_KEY` | Helius DAS API key (server-side only) |
| `VITE_SUPABASE_URL` | Your Supabase project URL |
| `VITE_SUPABASE_ANON_KEY` | Supabase publishable (anon) key |
| `VITE_GITHUB_URL` | GitHub repo URL for the nav/footer links |

### Database Setup

1. Create a new Supabase project.
2. Go to **SQL Editor** and run the contents of [`supabase-schema.sql`](supabase-schema.sql).
3. Enable **Anonymous sign-ins**: Authentication → Providers → Anonymous → Enable.

### Deployment (Netlify)

1. Connect your repo to Netlify.
2. Set environment variables in Netlify's dashboard (same as `.env.example`).
3. Build command: `npm run build` · Publish directory: `dist`.

The Netlify functions in `netlify/functions/` proxy API requests to Helius and Magic Eden, keeping API keys server-side.

## Architecture

```
├── index.html                  # SPA entry point
├── src/
│   ├── main.js                 # App initialization, routing, caching
│   ├── config.js               # Centralized configuration
│   ├── style.css               # Full design system (3 themes)
│   ├── pages/
│   │   ├── arena.js            # Battle Arena voting UI
│   │   ├── gallery.js          # Collection browser with sort/search
│   │   └── leaderboard.js      # Ranked list + podium
│   ├── components/
│   │   └── modal.js            # NFT detail modal with focus trap
│   ├── services/
│   │   ├── heliusService.js    # Helius DAS pagination + merging
│   │   ├── supabaseService.js  # Auth, voting RPC, real-time
│   │   ├── magicEdenService.js # Listings & sales data
│   │   └── meFetchRetry.js     # Retry with backoff for 429/503
│   └── utils/
│       ├── dom.js              # escapeHtml, image fallbacks, IPFS
│       └── toast.js            # Toast notifications
├── netlify/functions/
│   ├── helius-proxy.mjs        # Server-side Helius RPC proxy
│   ├── magiceden-proxy.mjs     # Server-side ME API proxy
│   ├── harmies-collection-snapshot.mjs  # CDN-cached full collection
│   └── proxy-utils.mjs         # Origin gating, CORS, rate limits
├── supabase-schema.sql         # Full database schema + RLS policies
└── netlify.toml                # Build, redirects, security headers
```

## Security

- **RLS** enabled on all Supabase tables; direct writes revoked from client roles.
- **SECURITY DEFINER** RPCs for all mutations (votes, NFT seeding).
- **Server-side API proxies** — Helius/Magic Eden keys never reach the browser.
- **CSP headers** — tight Content-Security-Policy, HSTS, X-Frame-Options.
- **XSS prevention** — all dynamic values escaped via `escapeHtml()`.
- **Origin gating** — Netlify functions only respond to allowed origins.

## Contributing

Contributions are welcome! Please open an issue or pull request.

---

Built by [iitsGuru](https://x.com/iitsGuru). Not affiliated with [Neuko](https://www.neuko.ai/) or the [Harmony](https://www.harmonyrx.net/) project.
