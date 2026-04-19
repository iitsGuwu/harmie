// Supabase Service — Votes, ELO rankings, fingerprint-based identity
import { createClient } from '@supabase/supabase-js';
import { CONFIG } from '../config.js';
import { generateFingerprint } from './fingerprint.js';
import { devLog, devWarn } from '../utils/dom.js';

let supabase = null;
let currentVoterId = null;
let fingerprint = null;
let lastVoteTime = 0;
let isInitialized = false;

export async function initSupabase() {
  if (isInitialized) return true;

  if (!CONFIG.SUPABASE_URL || !CONFIG.SUPABASE_ANON_KEY) {
    devWarn('Supabase not configured. Voting will be disabled.');
    return false;
  }

  try {
    supabase = createClient(CONFIG.SUPABASE_URL, CONFIG.SUPABASE_ANON_KEY, {
      auth: { persistSession: false, autoRefreshToken: false },
    });

    fingerprint = await generateFingerprint();

    let storedSalt = localStorage.getItem('harmies_salt');
    if (!storedSalt) {
      storedSalt = crypto.randomUUID
        ? crypto.randomUUID()
        : Math.random().toString(36).slice(2) + Date.now().toString(36);
      localStorage.setItem('harmies_salt', storedSalt);
    }

    currentVoterId = localStorage.getItem('harmies_voter_id');
    if (!currentVoterId) {
      const raw = `${fingerprint}_${storedSalt}`;
      const encoder = new TextEncoder();
      const hashBuffer = await crypto.subtle.digest('SHA-256', encoder.encode(raw));
      const hashArray = Array.from(new Uint8Array(hashBuffer));
      currentVoterId =
        'v_' + hashArray.map((b) => b.toString(16).padStart(2, '0')).join('').slice(0, 40);
      localStorage.setItem('harmies_voter_id', currentVoterId);
    }

    isInitialized = true;
    devLog('Supabase initialized');
    return true;
  } catch (err) {
    devWarn('Supabase init error:', err);
    return false;
  }
}

export async function submitVote(winnerId, loserId) {
  if (!supabase || !currentVoterId) return null;

  const now = Date.now();
  if (now - lastVoteTime < CONFIG.VOTE_COOLDOWN_MS) {
    return { error: 'Too fast! Wait a moment between votes.' };
  }

  try {
    const { data, error } = await supabase.rpc('submit_vote', {
      p_voter_id: currentVoterId,
      p_fingerprint: fingerprint,
      p_winner_id: winnerId,
      p_loser_id: loserId,
    });

    if (error) {
      const msg = (error.message || '').toLowerCase();
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

// Synchronizes core NFT records into Supabase via the upsert_harmie RPC
// (which is SECURITY DEFINER, so anon can call it but cannot write to the
// harmies table directly).
export async function syncNFTsToSupabase(nfts) {
  if (!supabase) return;

  const concurrency = 4;
  const queue = nfts.slice();
  const runners = Array.from({ length: Math.min(concurrency, queue.length) }, async () => {
    while (queue.length > 0) {
      const nft = queue.shift();
      try {
        await supabase.rpc('upsert_harmie', {
          p_id: nft.id,
          p_name: nft.name || 'Unknown Harmie',
          p_image_url: nft.image || null,
          p_metadata: {
            attributes: nft.attributes || {},
            bgColor: nft.bgColor || null,
            description: nft.description || '',
          },
        });
      } catch {
        /* per-row failure is fine */
      }
    }
  });
  await Promise.all(runners);
  devLog(`Synced ${nfts.length} NFTs to Supabase`);
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
  return isInitialized && !!supabase;
}
