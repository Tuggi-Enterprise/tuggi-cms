-- Migration: Add interruption_reason to drive.trip_sessions
-- Date: 2026-05-13
--
-- Context: was_interrupted is a boolean that conflates 4 distinct scenarios:
-- (a) app crashed, (b) iOS suspended the process silently in background,
-- (c) user force-killed (swipe up), (d) stale session detected at next
-- launch with no clear cause. Each has different remediation implications.
--
-- interruption_reason is set by the JS heuristic in useGuideSession.ts
-- when finalizing an orphaned session at startup, reading
-- MMKV.last_lifecycle_event written by native lifecycle hooks (P1.1).
-- was_interrupted is kept for Android parity and existing dashboards.

ALTER TABLE drive.trip_sessions
  ADD COLUMN IF NOT EXISTS interruption_reason TEXT
  CHECK (
    interruption_reason IS NULL OR
    interruption_reason IN (
      'crash',           -- guardian_emergency followed by orphan (likely jetsam)
      'suspended_long',  -- last trail > 10 min before orphan detection
      'killed_by_user',  -- applicationWillTerminate fired for this session
      'stale_at_start'   -- none of the above (unknown / sync race)
    )
  );

COMMENT ON COLUMN drive.trip_sessions.interruption_reason IS
  'Fine-grained reason for was_interrupted=true. Set by client at session '
  'finalization based on MMKV.last_lifecycle_event. NULL when the session '
  'ended normally (was_interrupted=false).';

-- Dedicated RPC: avoids modifying the existing save_trip_session contract.
-- Called by JS in useGuideSession.ts during orphan finalization.
CREATE OR REPLACE FUNCTION drive.set_trip_session_interruption_reason(
  p_session_id UUID,
  p_reason TEXT
)
RETURNS JSONB AS $$
BEGIN
  IF p_reason IS NOT NULL AND p_reason NOT IN (
    'crash', 'suspended_long', 'killed_by_user', 'stale_at_start'
  ) THEN
    RETURN jsonb_build_object(
      'success', false,
      'error', 'invalid_reason'
    );
  END IF;

  UPDATE drive.trip_sessions
    SET interruption_reason = p_reason
    WHERE id = p_session_id;

  IF NOT FOUND THEN
    RETURN jsonb_build_object(
      'success', false,
      'error', 'session_not_found'
    );
  END IF;

  RETURN jsonb_build_object('success', true);
EXCEPTION WHEN OTHERS THEN
  RETURN jsonb_build_object(
    'success', false,
    'error', SQLERRM,
    'sqlstate', SQLSTATE
  );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

GRANT EXECUTE ON FUNCTION
  drive.set_trip_session_interruption_reason(UUID, TEXT)
  TO authenticated, service_role;
