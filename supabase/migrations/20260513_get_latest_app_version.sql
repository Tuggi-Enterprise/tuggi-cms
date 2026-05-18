-- Migration: drive.get_latest_app_version
-- Date: 2026-05-13
--
-- Context: Replaces `react-native-version-check` for the in-app update
-- prompt. That lib (a) had a property-name bug in our wrapper, (b) scrapes
-- the Play Store HTML which Google broke years ago, and (c) is effectively
-- unmaintained. Instead we derive "the latest version live in the wild"
-- directly from real user trip data, which we already collect.
--
-- Heuristic (calibrated on prod data on 2026-05-13):
--   - app_version must match strict semver (x.y.z) — filters out dev
--     builds like "1.4.0-dev" or "1.4.0.1"
--   - must have been seen in the last 14 days — filters out stale versions
--   - must have at least 3 distinct users — filters out lone testers /
--     devs with local builds
--
-- Why N=3 + 14d: at current MAU, N=5 sits on the edge and risks false
-- negatives (returning NULL on a freshly released real version). N=3 still
-- defeats the "1 tester sees the future" scenario which was the original
-- pollution concern.
--
-- Returns NULL when no version meets the threshold. Clients must treat
-- NULL as "do not prompt for update".

CREATE OR REPLACE FUNCTION drive.get_latest_app_version(p_platform TEXT)
RETURNS TEXT
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = drive, public
AS $$
  SELECT app_version
  FROM drive.trip_sessions
  WHERE platform = p_platform
    AND start_time > NOW() - INTERVAL '14 days'
    AND app_version ~ '^\d+\.\d+\.\d+$'
  GROUP BY app_version
  HAVING COUNT(DISTINCT user_id) >= 3
  ORDER BY
    split_part(app_version, '.', 1)::int DESC,
    split_part(app_version, '.', 2)::int DESC,
    split_part(app_version, '.', 3)::int DESC
  LIMIT 1;
$$;

GRANT EXECUTE ON FUNCTION drive.get_latest_app_version(TEXT)
  TO authenticated, service_role;
