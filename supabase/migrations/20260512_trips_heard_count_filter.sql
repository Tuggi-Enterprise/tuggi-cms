-- Add optional p_min_heard_count filter to drive.get_user_trips_with_stats.
--
-- Motivation: The mobile app's Journal renders this list as a "diary of
-- discoveries" — trips with 0 heard POIs (no audio narration triggered) feel
-- like noise. The CMS, in contrast, still needs to see all trips for debug
-- (audio coverage, geofence regressions, support).
--
-- Strategy: single RPC + parameter with DEFAULT 0 so every existing caller
-- (CMS, dashboards, ad-hoc SQL) keeps current behavior. The app passes 1.
--
-- Reversible: dropping the param returns to the pre-2026-05-12 behavior.

CREATE OR REPLACE FUNCTION drive.get_user_trips_with_stats(
    p_user_id UUID,
    p_min_heard_count INT DEFAULT 0
)
RETURNS TABLE (
    trip_session_id UUID,
    trip_start TIMESTAMPTZ,
    trip_end TIMESTAMPTZ,
    duration_minutes FLOAT,
    avg_speed FLOAT,
    heard_count BIGINT
) AS $$
BEGIN
    RETURN QUERY
    WITH trip_stats AS (
        SELECT
            t.trip_session_id,
            t.trip_start,
            t.trip_end,
            t.duration_minutes::FLOAT,
            t.avg_speed::FLOAT,
            (
                SELECT COUNT(DISTINCT poi_id)
                FROM drive.poi_visits pv
                WHERE pv.trip_session_id = t.trip_session_id
            ) AS heard_count
        FROM drive.trail_trips_unified t
        WHERE t.user_id = p_user_id
          AND t.trip_start > '2000-01-01'
    )
    SELECT
        ts.trip_session_id,
        ts.trip_start,
        ts.trip_end,
        ts.duration_minutes,
        ts.avg_speed,
        ts.heard_count
    FROM trip_stats ts
    WHERE ts.heard_count >= p_min_heard_count
    ORDER BY ts.trip_start DESC;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Re-grant (the new signature is a new overload from PG's perspective).
GRANT EXECUTE ON FUNCTION drive.get_user_trips_with_stats(UUID, INT) TO authenticated;
GRANT EXECUTE ON FUNCTION drive.get_user_trips_with_stats(UUID, INT) TO service_role;
