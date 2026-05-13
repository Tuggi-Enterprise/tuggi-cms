-- Migration: Add app_state to drive.route_trail and drive.poi_visits
-- Date: 2026-05-13
--
-- Context: We already log fg/bg transitions in client_error_logs (lifecycle)
-- and every 60s in session_heartbeats. But to measure foreground vs
-- background time AT POINT-LEVEL granularity (~1 Hz) and to know whether
-- a TP triggered while the user was in fg or bg, we tag each trail point
-- and each POI visit with the application_state at write time.
--
-- Values mirror drive.session_heartbeats.app_state (SSOT):
--   'active'      — foreground
--   'inactive'    — transition (call, Siri, control center)
--   'background'  — backgrounded
--   'unknown'     — extremely rare; main-thread snapshot failed
--
-- Both columns are NULLABLE so legacy rows (pre-migration) and
-- non-iOS clients (Android sync paths that don't yet write this) keep
-- working without changes.

-- 1. route_trail (per GPS tick, ~1 Hz inside a session)
ALTER TABLE drive.route_trail
  ADD COLUMN IF NOT EXISTS app_state TEXT
  CHECK (
    app_state IS NULL OR
    app_state IN ('active', 'inactive', 'background', 'unknown')
  );

CREATE INDEX IF NOT EXISTS idx_route_trail_session_app_state
  ON drive.route_trail (trip_session_id, app_state);

COMMENT ON COLUMN drive.route_trail.app_state IS
  'UIApplication.applicationState (iOS) snapshot at write time. NULL for '
  'rows persisted before the column existed. Use to compute time spent in '
  'foreground vs background per session.';

-- 2. poi_visits (per trigger fire)
ALTER TABLE drive.poi_visits
  ADD COLUMN IF NOT EXISTS app_state TEXT
  CHECK (
    app_state IS NULL OR
    app_state IN ('active', 'inactive', 'background', 'unknown')
  );

CREATE INDEX IF NOT EXISTS idx_poi_visits_session_app_state
  ON drive.poi_visits (trip_session_id, app_state);

COMMENT ON COLUMN drive.poi_visits.app_state IS
  'UIApplication.applicationState (iOS) snapshot at trigger fire time. NULL '
  'for rows persisted before the column existed. Lets us answer "did this TP '
  'fire while user was looking at the screen or in background?"';

-- ──────────────────────────────────────────────────────────────────────
-- View: Foreground vs background time per session (route_trail-based)
-- ──────────────────────────────────────────────────────────────────────
-- Computes seconds spent in each app_state by using the gap between
-- consecutive trail points as the duration of the *earlier* point. The
-- last point of each session contributes nothing (no successor).
--
-- Sample usage:
--   SELECT * FROM drive.v_session_state_time
--   WHERE user_id = '44e580aa-61cf-475e-9db0-c0ed7d069334'
--   ORDER BY trip_session_id, app_state;

CREATE OR REPLACE VIEW drive.v_session_state_time AS
WITH ordered AS (
  SELECT
    user_id,
    trip_session_id,
    app_state,
    timestamp,
    LEAD(timestamp) OVER (
      PARTITION BY trip_session_id ORDER BY timestamp
    ) AS next_ts
  FROM drive.route_trail
)
SELECT
  user_id,
  trip_session_id,
  COALESCE(app_state, 'unknown') AS app_state,
  COUNT(*)                                                    AS points,
  COALESCE(
    SUM(EXTRACT(EPOCH FROM (next_ts - timestamp))) FILTER (WHERE next_ts IS NOT NULL),
    0
  )                                                           AS seconds_in_state
FROM ordered
GROUP BY user_id, trip_session_id, app_state;

GRANT SELECT ON drive.v_session_state_time TO authenticated, service_role;

-- ──────────────────────────────────────────────────────────────────────
-- Safety-net RPCs (UPDATE by id)
-- ──────────────────────────────────────────────────────────────────────
-- Why: the existing save_route_trail_batch and record_poi_visit RPCs were
-- created via the Supabase dashboard (not under migrations). We don't know
-- whether they pick up the new app_state field automatically (jsonb_populate)
-- or ignore unknown jsonb keys / unknown typed parameters.
--
-- These small UPDATE RPCs let the native sync apply app_state AFTER the
-- main insert, regardless of how the existing RPCs are implemented.
-- They are no-ops if the existing RPCs already persisted app_state.
--
-- Idempotent: only UPDATE rows whose app_state is still NULL.

CREATE OR REPLACE FUNCTION drive.apply_app_state_to_route_trail(
  p_updates JSONB
)
RETURNS JSONB AS $$
DECLARE
  v_updated INTEGER := 0;
BEGIN
  IF p_updates IS NULL OR jsonb_array_length(p_updates) = 0 THEN
    RETURN jsonb_build_object('success', true, 'count', 0);
  END IF;

  UPDATE drive.route_trail rt
    SET app_state = u.app_state
    FROM (
      SELECT (e->>'id')::UUID AS id, e->>'app_state' AS app_state
      FROM jsonb_array_elements(p_updates) AS e
    ) u
    WHERE rt.id = u.id
      AND rt.app_state IS NULL
      AND u.app_state IS NOT NULL;

  GET DIAGNOSTICS v_updated = ROW_COUNT;
  RETURN jsonb_build_object('success', true, 'count', v_updated);
EXCEPTION WHEN OTHERS THEN
  RETURN jsonb_build_object(
    'success', false,
    'error', SQLERRM,
    'sqlstate', SQLSTATE
  );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

GRANT EXECUTE ON FUNCTION drive.apply_app_state_to_route_trail(JSONB)
  TO authenticated, service_role;

CREATE OR REPLACE FUNCTION drive.apply_app_state_to_poi_visits(
  p_updates JSONB
)
RETURNS JSONB AS $$
DECLARE
  v_updated INTEGER := 0;
BEGIN
  IF p_updates IS NULL OR jsonb_array_length(p_updates) = 0 THEN
    RETURN jsonb_build_object('success', true, 'count', 0);
  END IF;

  UPDATE drive.poi_visits pv
    SET app_state = u.app_state
    FROM (
      SELECT (e->>'id')::UUID AS id, e->>'app_state' AS app_state
      FROM jsonb_array_elements(p_updates) AS e
    ) u
    WHERE pv.id = u.id
      AND pv.app_state IS NULL
      AND u.app_state IS NOT NULL;

  GET DIAGNOSTICS v_updated = ROW_COUNT;
  RETURN jsonb_build_object('success', true, 'count', v_updated);
EXCEPTION WHEN OTHERS THEN
  RETURN jsonb_build_object(
    'success', false,
    'error', SQLERRM,
    'sqlstate', SQLSTATE
  );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

GRANT EXECUTE ON FUNCTION drive.apply_app_state_to_poi_visits(JSONB)
  TO authenticated, service_role;
