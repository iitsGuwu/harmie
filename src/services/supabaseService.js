// Supabase Service — votes and ELO; voter identity is Supabase Auth (anonymous or signed-in).
import { createClient } from '@supabase/supabase-js';
import { CONFIG } from '../config.js';
import { devLog, devWarn, normalizeNftMediaUrl } from '../utils/dom.js';

const G =
  typeof globalThis !== 'undefined'
    ? globalThis
    : typeof window !== 'undefined'
      ? window
      : {};

const GLOBAL_CLIENT_KEY = '__harmieSupabaseClient_v2';
const GLOBAL_INIT_KEY = '__harmieSupabaseInit_v2';

let lastInitFailureMessage = '';

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * One client for the whole app (survives Vite HMR / duplicate module evaluation).
 * Never destroy the client on auth errors — that was leaving multiple GoTrue instances alive.
 */
function getOrCreateSupabaseClient() {
  if (G[GLOBAL_CLIENT_KEY]) {
    return G[GLOBAL_CLIENT_KEY];
  }
  const client = createClient(CONFIG.SUPABASE_URL, CONFIG.SUPABASE_ANON_KEY, {
    auth: {
      persistSession: true,
      autoRefreshToken: true,
      detectSessionInUrl: false,
      storageKey: 'harmie-supabase-auth-v2',
    },
  });
  G[GLOBAL_CLIENT_KEY] = client;
  return client;
}

let supabase = null;
let lastVoteTime = 0;
let isInitialized = false;
let authSessionReady = false;

async function establishAnonymousSession(client) {
  lastInitFailureMessage = '';
  let {
    data: { session },
  } = await client.auth.getSession();

  if (session?.user?.id) return true;

  await client.auth.signOut({ scope: 'local' }).catch(() => {});

  const maxAttempts = 3;
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    const { error } = await client.auth.signInAnonymously();
    if (!error) {
      ({
        data: { session },
      } = await client.auth.getSession());
      if (session?.user?.id) return true;
      lastInitFailureMessage = 'Session did not persist after anonymous sign-in.';
      return false;
    }

    const msg = (error.message || '').toLowerCase();
    const code = error.status || error.code;
    devWarn('Anonymous sign-in attempt failed:', error.message, code);

    if (code === 422 || msg.includes('captcha') || msg.includes('hcaptcha') || msg.includes('turnstile')) {
      lastInitFailureMessage =
        'Sign-in was rejected (often captcha / bot protection). Supabase → Authentication → Attack Protection: turn off captcha for anonymous users, or complete captcha setup.';
    } else if (msg.includes('disabled') || msg.includes('not allowed')) {
      lastInitFailureMessage =
        'Anonymous sign-ins may be disabled. Supabase → Authentication → Providers → Anonymous: enable.';
    } else {
      lastInitFailureMessage = error.message || 'Anonymous sign-in failed.';
    }

    if (attempt < maxAttempts - 1) {
      await delay(350 * (attempt + 1));
      await client.auth.signOut({ scope: 'local' }).catch(() => {});
    }
  }

  return false;
}

export function getLastSupabaseInitFailure() {
  return lastInitFailureMessage;
}

export async function initSupabase() {
  if (!CONFIG.SUPABASE_URL || !CONFIG.SUPABASE_ANON_KEY) {
    devWarn('Supabase not configured. Voting will be disabled.');
    lastInitFailureMessage = 'Missing VITE_SUPABASE_URL or VITE_SUPABASE_ANON_KEY in the build.';
    return false;
  }

  supabase = getOrCreateSupabaseClient();

  if (isInitialized && supabase) {
    try {
      const {
        data: { session: quick },
      } = await supabase.auth.getSession();
      if (quick?.user?.id) return true;
    } catch {
      /* reconnect */
    }
    isInitialized = false;
    authSessionReady = false;
  }

  if (!G[GLOBAL_INIT_KEY]) {
    G[GLOBAL_INIT_KEY] = (async () => {
      try {
        const client = getOrCreateSupabaseClient();
        supabase = client;

        const ok = await establishAnonymousSession(client);
        if (!ok) {
          isInitialized = false;
          authSessionReady = false;
          return false;
        }

        authSessionReady = true;
        isInitialized = true;
        lastInitFailureMessage = '';
        devLog('Supabase initialized (auth session ready)');
        return true;
      } catch (err) {
        devWarn('Supabase init error:', err);
        isInitialized = false;
        authSessionReady = false;
        lastInitFailureMessage = err?.message || 'Unexpected error during sign-in.';
        return false;
      } finally {
        delete G[GLOBAL_INIT_KEY];
      }
    })();
  }

  return G[GLOBAL_INIT_KEY];
}

export async function ensureSupabaseForVoting() {
  return initSupabase();
}

export async function submitVote(winnerId, loserId) {
  if (!supabase || !authSessionReady) {
    return { error: 'Voting is not ready yet. Refresh the page and try again.' };
  }

  const {
    data: { session },
  } = await supabase.auth.getSession();
  if (!session?.user?.id) {
    return { error: 'Still connecting — try again in a moment.' };
  }

  const now = Date.now();
  if (now - lastVoteTime < CONFIG.VOTE_COOLDOWN_MS) {
    return { error: 'Too fast! Wait a moment between votes.' };
  }

  try {
    const { data, error } = await supabase.rpc('submit_vote', {
      p_winner_id: winnerId,
      p_loser_id: loserId,
      p_fingerprint: null,
    });

    if (error || (data && data.success === false)) {
      const msg = (error?.message || data?.error || '').toLowerCase();
      if (msg.includes('not authenticated')) {
        return { error: 'Session expired — refresh the page to vote again.' };
      }
      if (msg.includes('duplicate') || msg.includes('already voted')) {
        return { error: 'You already voted on this matchup recently!' };
      }
      if (msg.includes('rate limit') || msg.includes('too many') || msg.includes('too fast')) {
        return { error: 'Slow down — try again in a moment.' };
      }
      if (msg.includes('daily vote limit')) {
        return { error: 'Daily vote limit reached. Come back tomorrow!' };
      }
      if (msg.includes('not found')) {
        return { error: 'One or both NFTs not found in database. The collection must be seeded!' };
      }
      return { error: error?.message || data?.error || 'Failed to submit vote' };
    }

    lastVoteTime = now;
    return data;
  } catch (err) {
    devWarn('Vote error:', err);
    return { error: 'Network error. Please try again.' };
  }
}

export async function fetchEloScores() {
  const client = supabase || G[GLOBAL_CLIENT_KEY];
  if (!client) return {};

  try {
    const { data, error } = await client
      .from('harmies')
      .select('id, elo_score, total_matches, wins, losses')
      .order('elo_score', { ascending: false });

    if (error) {
      devWarn('Error fetching ELO scores:', error);
      return {};
    }

    const eloMap = {};
    (data || []).forEach((item, index) => {
      eloMap[item.id] = {
        eloScore: item.elo_score,
        rank: index + 1,
        totalMatches: item.total_matches,
        wins: item.wins,
        losses: item.losses,
      };
    });
    return eloMap;
  } catch (err) {
    devWarn('ELO fetch error:', err);
    return {};
  }
}

export async function fetchAllHarmiesFromSupabase() {
  const client = supabase || G[GLOBAL_CLIENT_KEY];
  if (!client) return [];

  try {
    const { data, error } = await client
      .from('harmies')
      .select('id, name, image_url, metadata, elo_score, total_matches, wins, losses')
      .order('name', { ascending: true });

    if (error) {
      devWarn('Error fetching harmies collection:', error);
      return [];
    }

    return (data || []).map((item) => {
      const metadata = item.metadata || {};
      const attrs = metadata.attributes || {};
      return {
        id: item.id,
        name: item.name || 'Unknown Harmie',
        image: normalizeNftMediaUrl(item.image_url || ''),
        description: metadata.description || '',
        attributes: attrs,
        bgColor: metadata.bgColor || attrs.Background || attrs.background || null,
        owner: null,
        listPrice: null,
        highestSale: null,
        eloScore: item.elo_score || CONFIG.ELO_DEFAULT,
        rank: null,
        totalMatches: item.total_matches || 0,
        wins: item.wins || 0,
        losses: item.losses || 0,
      };
    });
  } catch (err) {
    devWarn('Collection fetch error:', err);
    return [];
  }
}



export function subscribeToEloUpdates(callback) {
  const client = supabase || G[GLOBAL_CLIENT_KEY];
  if (!client) return null;

  return client
    .channel('harmies-elo-changes')
    .on(
      'postgres_changes',
      { event: 'UPDATE', schema: 'public', table: 'harmies' },
      (payload) => callback(payload.new),
    )
    .subscribe();
}

export function isSupabaseReady() {
  return isInitialized && !!(supabase || G[GLOBAL_CLIENT_KEY]) && authSessionReady;
}
