-- Migration: Session Heartbeats for background-survival diagnostics
-- Date: 2026-05-13
--
-- Context: The drive app survives in iOS background for multi-hour trips
-- (per docs/architecture/06-GUIDE-ENGINE-NATIVE.md). When iOS silently
-- suspends the process (e.g. activityType mismatch, jetsam without crash
-- log), we have no evidence of "app was alive at T, dead at T+N" because
-- the only signals are gaps in route_trail / client_error_logs.
--
-- session_heartbeats is a periodic (~60s) native snapshot of process
-- health (memory, battery, thermal, app_state, audio_active, gps age)
-- written to SQLite locally and synced to Supabase via triggerNativeSync.
-- Lets us reconstruct exactly when and under what conditions the app
-- went silent.

-- 1. Table
CREATE TABLE IF NOT EXISTS drive.session_heartbeats (
  id UUID PRIMARY KEY,
  trip_session_id UUID NOT NULL,
  user_id UUID NOT NULL,
  client_timestamp TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW(),

  -- Memory (iOSBackgroundGuardian SSOT)
  memory_available_mb REAL,
  memory_used_mb REAL,
  guardian_level SMALLINT,         -- 0=normal, 1=elevated, 2=critical, 3=emergency

  -- Power
  battery_pct SMALLINT,
  low_power_mode BOOLEAN,
  thermal_state SMALLINT,          -- 0=nominal, 1=fair, 2=serious, 3=critical

  -- App state
  app_state TEXT,                  -- 'active' | 'inactive' | 'background'
  audio_active BOOLEAN,
  guide_state TEXT,                -- 'active' | 'paused' | 'passive'

  -- GPS health
  last_location_age_sec INTEGER,

  -- Network
  network_available BOOLEAN,

  -- Device context (for cross-device analysis)
  platform TEXT DEFAULT 'ios',
  app_version TEXT,
  device_model TEXT
);

-- 2. Indexes
CREATE INDEX IF NOT EXISTS idx_session_heartbeats_session_ts
  ON drive.session_heartbeats (trip_session_id, client_timestamp DESC);

CREATE INDEX IF NOT EXISTS idx_session_heartbeats_user_created
  ON drive.session_heartbeats (user_id, created_at DESC);

-- 3. RPC: batch insert called by native SupabaseRPCClient every ~30s
-- Mirrors the pattern of save_route_trail_batch (jsonb array input, jsonb
-- return with success/count/error).
CREATE OR REPLACE FUNCTION drive.batch_insert_session_heartbeats(
  p_heartbeats JSONB
)
RETURNS JSONB AS $$
DECLARE
  v_inserted INTEGER := 0;
BEGIN
  IF p_heartbeats IS NULL OR jsonb_array_length(p_heartbeats) = 0 THEN
    RETURN jsonb_build_object('success', true, 'count', 0);
  END IF;

  INSERT INTO drive.session_heartbeats (
    id,
    trip_session_id,
    user_id,
    client_timestamp,
    memory_available_mb,
    memory_used_mb,
    guardian_level,
    battery_pct,
    low_power_mode,
    thermal_state,
    app_state,
    audio_active,
    guide_state,
    last_location_age_sec,
    network_available,
    platform,
    app_version,
    device_model
  )
  SELECT
    (h->>'id')::UUID,
    (h->>'trip_session_id')::UUID,
    (h->>'user_id')::UUID,
    (h->>'client_timestamp')::TIMESTAMPTZ,
    NULLIF(h->>'memory_available_mb', '')::REAL,
    NULLIF(h->>'memory_used_mb', '')::REAL,
    NULLIF(h->>'guardian_level', '')::SMALLINT,
    NULLIF(h->>'battery_pct', '')::SMALLINT,
    NULLIF(h->>'low_power_mode', '')::BOOLEAN,
    NULLIF(h->>'thermal_state', '')::SMALLINT,
    h->>'app_state',
    NULLIF(h->>'audio_active', '')::BOOLEAN,
    h->>'guide_state',
    NULLIF(h->>'last_location_age_sec', '')::INTEGER,
    NULLIF(h->>'network_available', '')::BOOLEAN,
    COALESCE(h->>'platform', 'ios'),
    h->>'app_version',
    h->>'device_model'
  FROM jsonb_array_elements(p_heartbeats) AS h
  ON CONFLICT (id) DO NOTHING;

  GET DIAGNOSTICS v_inserted = ROW_COUNT;

  RETURN jsonb_build_object('success', true, 'count', v_inserted);
EXCEPTION WHEN OTHERS THEN
  RETURN jsonb_build_object(
    'success', false,
    'error', SQLERRM,
    'sqlstate', SQLSTATE
  );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

GRANT EXECUTE ON FUNCTION drive.batch_insert_session_heartbeats(JSONB)
  TO authenticated, service_role;
