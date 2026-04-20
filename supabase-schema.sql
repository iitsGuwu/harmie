-- ============================================================
-- HARMIE CHARM ARENA — Supabase Database Schema
-- Run this in your Supabase SQL Editor (Dashboard → SQL Editor)
--
-- BEFORE GOING LIVE:
-- 1) Auth → Providers → enable "Anonymous sign-ins" (voting uses auth.uid()).
-- 2) Apply this file (or the migration block below) on existing projects.
--
-- SECURITY NOTES:
-- - submit_vote uses auth.uid() only (no client-supplied voter id).
-- - upsert_harmie is service_role only — seed from a script with the
--   service key, never from the browser.
-- - Matchup tokens / wallet signatures can be added later for stronger
--   integrity than anonymous auth alone.
-- ============================================================

-- --- Upgrade path: drop legacy 4-arg vote RPC if present ---
DROP FUNCTION IF EXISTS submit_vote(text, text, text, text);

-- 1. Create the harmies table (NFT data + ELO scores)
CREATE TABLE IF NOT EXISTS harmies (
  id TEXT PRIMARY KEY,                           -- NFT mint address
  name TEXT NOT NULL DEFAULT 'Unknown Harmie',
  image_url TEXT,
  metadata JSONB DEFAULT '{}'::jsonb,
  elo_score INTEGER NOT NULL DEFAULT 1200,
  total_matches INTEGER NOT NULL DEFAULT 0,
  wins INTEGER NOT NULL DEFAULT 0,
  losses INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- 2. Create the votes table
CREATE TABLE IF NOT EXISTS votes (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  voter_id TEXT NOT NULL,
  fingerprint TEXT,
  winner_id TEXT NOT NULL REFERENCES harmies(id),
  loser_id TEXT NOT NULL REFERENCES harmies(id),
  winner_elo_change INTEGER,
  loser_elo_change INTEGER,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 3. Create voter sessions tracking table
CREATE TABLE IF NOT EXISTS voter_sessions (
  voter_id TEXT PRIMARY KEY,
  fingerprint TEXT,
  last_vote_at TIMESTAMPTZ,
  total_votes INTEGER DEFAULT 0,
  votes_today INTEGER DEFAULT 0,
  last_vote_date DATE DEFAULT CURRENT_DATE,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 4. Create indexes for performance
CREATE INDEX IF NOT EXISTS idx_harmies_elo ON harmies(elo_score DESC);
CREATE INDEX IF NOT EXISTS idx_votes_voter ON votes(voter_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_votes_winner ON votes(winner_id);
CREATE INDEX IF NOT EXISTS idx_votes_loser ON votes(loser_id);
CREATE INDEX IF NOT EXISTS idx_votes_pair ON votes(winner_id, loser_id, voter_id, created_at DESC);

-- 5. Create the submit_vote RPC function
-- Voter identity = auth.uid() (requires Anonymous or signed-in Supabase Auth).
-- Optional p_fingerprint is advisory only (not used for access control).
CREATE OR REPLACE FUNCTION submit_vote(
  p_winner_id TEXT,
  p_loser_id TEXT,
  p_fingerprint TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_voter_id TEXT;
  v_winner_elo INTEGER;
  v_loser_elo INTEGER;
  v_winner_matches INTEGER;
  v_loser_matches INTEGER;
  v_k_winner INTEGER;
  v_k_loser INTEGER;
  v_expected_winner FLOAT;
  v_expected_loser FLOAT;
  v_winner_change INTEGER;
  v_loser_change INTEGER;
  v_duplicate_count INTEGER;
  v_session_record RECORD;
  v_votes_today INTEGER;
BEGIN
  v_voter_id := (SELECT auth.uid())::text;
  IF v_voter_id IS NULL OR length(v_voter_id) < 10 THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  -- 0. Sanity check: winner and loser must be different
  IF p_winner_id = p_loser_id THEN
    RAISE EXCEPTION 'Winner and loser cannot be the same NFT';
  END IF;

  -- 1. Check for duplicate pair vote within 24 hours
  SELECT COUNT(*) INTO v_duplicate_count
  FROM votes
  WHERE voter_id = v_voter_id
    AND (
      (winner_id = p_winner_id AND loser_id = p_loser_id) OR
      (winner_id = p_loser_id AND loser_id = p_winner_id)
    )
    AND created_at > NOW() - INTERVAL '24 hours';

  IF v_duplicate_count > 0 THEN
    RAISE EXCEPTION 'You already voted on this matchup recently';
  END IF;

  -- 2. Check daily vote limit
  SELECT * INTO v_session_record FROM voter_sessions WHERE voter_id = v_voter_id;

  IF v_session_record IS NOT NULL THEN
    -- Reset daily count if new day
    IF v_session_record.last_vote_date < CURRENT_DATE THEN
      v_votes_today := 0;
    ELSE
      v_votes_today := COALESCE(v_session_record.votes_today, 0);
    END IF;

    IF v_votes_today >= 500 THEN
      RAISE EXCEPTION 'Daily vote limit reached. Try again tomorrow!';
    END IF;

    -- Rate limit: no more than 1 vote per 2 seconds
    IF v_session_record.last_vote_at IS NOT NULL AND
       v_session_record.last_vote_at > NOW() - INTERVAL '2 seconds' THEN
      RAISE EXCEPTION 'Too many votes too fast. Slow down!';
    END IF;
  END IF;

  -- 3. Get current ELO scores
  SELECT elo_score, total_matches INTO v_winner_elo, v_winner_matches
  FROM harmies WHERE id = p_winner_id;

  SELECT elo_score, total_matches INTO v_loser_elo, v_loser_matches
  FROM harmies WHERE id = p_loser_id;

  IF v_winner_elo IS NULL OR v_loser_elo IS NULL THEN
    RAISE EXCEPTION 'One or both NFTs not found in database';
  END IF;

  -- 4. Calculate ELO changes
  -- K-factor: 32 for new NFTs (< 100 matches), 16 for established
  v_k_winner := CASE WHEN v_winner_matches >= 100 THEN 16 ELSE 32 END;
  v_k_loser := CASE WHEN v_loser_matches >= 100 THEN 16 ELSE 32 END;

  -- Expected scores
  v_expected_winner := 1.0 / (1.0 + POWER(10.0, (v_loser_elo - v_winner_elo)::FLOAT / 400.0));
  v_expected_loser := 1.0 / (1.0 + POWER(10.0, (v_winner_elo - v_loser_elo)::FLOAT / 400.0));

  -- ELO changes
  v_winner_change := ROUND(v_k_winner * (1.0 - v_expected_winner));
  v_loser_change := ROUND(v_k_loser * (0.0 - v_expected_loser));

  -- 5. Update harmies scores
  UPDATE harmies SET
    elo_score = elo_score + v_winner_change,
    total_matches = total_matches + 1,
    wins = wins + 1,
    updated_at = NOW()
  WHERE id = p_winner_id;

  UPDATE harmies SET
    elo_score = elo_score + v_loser_change,
    total_matches = total_matches + 1,
    losses = losses + 1,
    updated_at = NOW()
  WHERE id = p_loser_id;

  -- 6. Record the vote
  INSERT INTO votes (voter_id, fingerprint, winner_id, loser_id, winner_elo_change, loser_elo_change)
  VALUES (v_voter_id, p_fingerprint, p_winner_id, p_loser_id, v_winner_change, v_loser_change);

  -- 7. Update voter session
  INSERT INTO voter_sessions (voter_id, fingerprint, last_vote_at, total_votes, votes_today, last_vote_date)
  VALUES (v_voter_id, p_fingerprint, NOW(), 1, 1, CURRENT_DATE)
  ON CONFLICT (voter_id) DO UPDATE SET
    last_vote_at = NOW(),
    total_votes = voter_sessions.total_votes + 1,
    votes_today = CASE
      WHEN voter_sessions.last_vote_date < CURRENT_DATE THEN 1
      ELSE voter_sessions.votes_today + 1
    END,
    last_vote_date = CURRENT_DATE,
    fingerprint = EXCLUDED.fingerprint;

  -- 8. Return the result
  RETURN jsonb_build_object(
    'winner_elo_change', v_winner_change,
    'loser_elo_change', v_loser_change,
    'winner_new_elo', v_winner_elo + v_winner_change,
    'loser_new_elo', v_loser_elo + v_loser_change,
    'success', true
  );
END;
$$;

-- 6. Enable Row Level Security
ALTER TABLE harmies ENABLE ROW LEVEL SECURITY;
ALTER TABLE votes ENABLE ROW LEVEL SECURITY;
ALTER TABLE voter_sessions ENABLE ROW LEVEL SECURITY;

-- 7. Drop any prior permissive policies (idempotent reset)
DROP POLICY IF EXISTS "harmies_select" ON harmies;
DROP POLICY IF EXISTS "harmies_insert" ON harmies;
DROP POLICY IF EXISTS "harmies_update" ON harmies;
DROP POLICY IF EXISTS "votes_select" ON votes;
DROP POLICY IF EXISTS "votes_insert" ON votes;
DROP POLICY IF EXISTS "sessions_select" ON voter_sessions;
DROP POLICY IF EXISTS "sessions_insert" ON voter_sessions;
DROP POLICY IF EXISTS "sessions_update" ON voter_sessions;

-- 8. RLS Policies — read-only for anon clients.
--    All writes happen through the SECURITY DEFINER submit_vote() RPC.
CREATE POLICY "harmies_read_all" ON harmies FOR SELECT USING (true);
CREATE POLICY "votes_read_all" ON votes FOR SELECT USING (true);
CREATE POLICY "sessions_read_all" ON voter_sessions FOR SELECT USING (true);

-- 9. Lock down direct table writes for anon/authenticated roles.
REVOKE INSERT, UPDATE, DELETE ON harmies FROM anon, authenticated;
REVOKE INSERT, UPDATE, DELETE ON votes FROM anon, authenticated;
REVOKE INSERT, UPDATE, DELETE ON voter_sessions FROM anon, authenticated;

-- 10. Vote RPC: authenticated sessions only (includes Supabase Anonymous users).
REVOKE ALL ON FUNCTION submit_vote(TEXT, TEXT, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION submit_vote(TEXT, TEXT, TEXT) TO authenticated;

-- 11. Service role still needs to seed the harmies table.
--     The Netlify build (or one-time admin script) should call into a
--     SECURITY DEFINER seed function rather than direct upserts from anon.
CREATE OR REPLACE FUNCTION upsert_harmie(
  p_id TEXT,
  p_name TEXT,
  p_image_url TEXT,
  p_metadata JSONB
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO harmies (id, name, image_url, metadata)
  VALUES (p_id, COALESCE(p_name, 'Unknown Harmie'), p_image_url, COALESCE(p_metadata, '{}'::jsonb))
  ON CONFLICT (id) DO UPDATE SET
    name = COALESCE(EXCLUDED.name, harmies.name),
    image_url = COALESCE(EXCLUDED.image_url, harmies.image_url),
    metadata = COALESCE(EXCLUDED.metadata, harmies.metadata),
    updated_at = NOW();
END;
$$;

REVOKE ALL ON FUNCTION upsert_harmie(TEXT, TEXT, TEXT, JSONB) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION upsert_harmie(TEXT, TEXT, TEXT, JSONB) TO service_role;

-- 12. Enable realtime for the harmies table (safe if already published)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime'
      AND schemaname = 'public'
      AND tablename = 'harmies'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE harmies;
  END IF;
END $$;

-- Done! Your Harmie Charm Arena database is ready.
