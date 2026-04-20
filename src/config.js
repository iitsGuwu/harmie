// Harmies Arena Configuration
// All sensitive keys come from environment variables (see .env.example)

export const CONFIG = {
  // Helius DAS API — proxied in both dev (Vite proxy) and prod (Netlify Function)
  // The API key is appended server-side (in Vite proxy or Netlify Function) to hide it from the client
  HELIUS_RPC_URL: '/api/helius',
  
  // Collection mint address
  COLLECTION_MINT: 'D67sv3pznj6qKkuY45K2uJrEGTtrWQVisD7opQ4ooM1s',

  /** Full set size for this collection — used so caches are not treated complete at ~450. */
  COLLECTION_EXPECTED_SUPPLY: 500,
  
  // Magic Eden API — proxied in both dev and prod
  ME_API_BASE: '/api/magiceden/v2',
  ME_COLLECTION_SYMBOL: 'harmies',
  
  // Supabase
  SUPABASE_URL: import.meta.env.VITE_SUPABASE_URL || '',
  SUPABASE_ANON_KEY: import.meta.env.VITE_SUPABASE_ANON_KEY || '',
  
  // GitHub (open source)
  GITHUB_URL: import.meta.env.VITE_GITHUB_URL || 'https://github.com/your-username/harmies',
  
  // ELO Settings
  ELO_DEFAULT: 1200,
  ELO_K_FACTOR_NEW: 32,
  ELO_K_FACTOR_ESTABLISHED: 16,
  ELO_THRESHOLD: 100,
  
  // Anti-rigging
  VOTE_COOLDOWN_MS: 3000,
  MAX_VOTES_PER_DAY: 500,
  DUPLICATE_PAIR_COOLDOWN_HOURS: 24,
  
  // Cache
  CACHE_TTL_MS: 5 * 60 * 1000, // 5 minutes
  
  // Marketplace links
  TENSOR_COLLECTION_URL: 'https://www.tensor.trade/trade/c7d45db9-0726-459c-bc42-afc8ee32e10a',
  ME_COLLECTION_URL: 'https://magiceden.io/marketplace/harmies',
  
  // Comic text effects
  COMIC_EFFECTS: ['KAPOW!', 'SLAM!', 'BOOM!', 'ZAP!', 'WHAM!', 'POW!', 'CRACK!', 'BANG!', 'SMASH!', 'KO!'],
};
