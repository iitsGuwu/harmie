// Supabase Service — votes and ELO; voter identity is Supabase Auth (anonymous or signed-in).
import { createClient } from '@supabase/supabase-js';
import { CONFIG } from '../config.js';
import { devLog, devWarn } from '../utils/dom.js';

let supabase = null;
let lastVoteTime = 0;
let isInitialized = false;
/** True after we have a persisted Supabase session (anonymous is enough). */
let authSessionReady = false;

export async function initSupabase() {
  if (!CONFIG.SUPABASE_URL || !CONFIG.SUPABASE_ANON_KEY) {
    devWarn('Supabase not configured. Voting will be disabled.');
    return false;
  }

  if (isInitialized && supabase) {
    const {
      data: { session: quick },
    } = await supabase.auth.getSession();
    if (quick?.user?.id) return true;
    isInitialized = false;
    authSessionReady = false;
  }

  try {
    if (!supabase) {
      supabase = createClient(CONFIG.SUPABASE_URL, CONFIG.SUPABASE_ANON_KEY, {
        auth: {
          persistSession: true,
          autoRefreshToken: true,
          // Hash router uses #gallery / #arena; do not let GoTrue consume the hash.
          detectSessionInUrl: false,
          storageKey: 'harmie-supabase-auth',
        },
      });
    }

    let {
      data: { session: existing },
    } = await supabase.auth.getSession();

    if (!existing?.user?.id) {
      const { error } = await supabase.auth.signInAnonymously();
      if (error) {
        devWarn('Anonymous sign-in failed:', error.message);
        devWarn('Enable Anonymous sign-ins in Supabase Auth → Providers.');
        supabase = null;
        isInitialized = false;
        authSessionReady = false;
        return false;
      }
      ({
        data: { session: existing },
      } = await supabase.auth.getSession());
    }

    if (!existing?.user?.id) {
      devWarn('Supabase session missing after sign-in.');
      supabase = null;
      isInitialized = false;
      authSessionReady = false;
      return false;
    }

    authSessionReady = true;
    isInitialized = true;
    devLog('Supabase initialized (auth session ready)');
    return true;
  } catch (err) {
    devWarn('Supabase init error:', err);
    supabase = null;
    isInitialized = false;
    authSessionReady = false;
    return false;
  }
}

/** Call before voting; re-runs auth if the first init raced or the session was lost. */
export async function ensureSupabaseForVoting() {
  return initSupabase();
}

export async function submitVote(winnerId, loserId) {
  if (!supabase || !authSessionReady) return null;

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
    });

    if (error) {
      const msg = (error.message || '').toLowerCase();
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
      return { error: error.message || 'Failed to submit vote' };
    }

    lastVoteTime = now;
    return data;
  } catch (err) {
    devWarn('Vote error:', err);
    return { error: 'Network error. Please try again.' };
  }
}

export async function fetchEloScores() {
  if (!supabase) return {};

  try {
    const { data, error } = await supabase
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
  if (!supabase) return [];

  try {
    const { data, error } = await supabase
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
        image: item.image_url || '',
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

/**
 * Collection rows must be seeded with the Supabase service_role key
 * (SQL editor, Edge Function, or CI script calling upsert_harmie).
 * The browser cannot call upsert_harmie after the security migration.
 */
export async function syncNFTsToSupabase() {
  return;
}

export function subscribeToEloUpdates(callback) {
  if (!supabase) return null;

  return supabase
    .channel('harmies-elo-changes')
    .on(
      'postgres_changes',
      { event: 'UPDATE', schema: 'public', table: 'harmies' },
      (payload) => callback(payload.new),
    )
    .subscribe();
}

export function isSupabaseReady() {
  return isInitialized && !!supabase && authSessionReady;
}
