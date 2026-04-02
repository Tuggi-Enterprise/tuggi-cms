-- Migration: Optimize Gamification Passport RPCs
-- Date: 2026-04-02
-- Purpose: Filter out empty trips (0 POIs) and limit history to the 5 most recent valuable trips.

CREATE OR REPLACE FUNCTION drive.get_user_trips_with_stats(p_user_id UUID)
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
            (SELECT COUNT(DISTINCT poi_id) FROM drive.poi_visits pv WHERE pv.trip_session_id = t.trip_session_id) as heard_count
        FROM drive.trail_trips_unified t
        WHERE t.user_id = p_user_id
    )
    SELECT 
        ts.trip_session_id,
        ts.trip_start,
        ts.trip_end,
        ts.duration_minutes,
        ts.avg_speed,
        ts.heard_count
    FROM trip_stats ts
    WHERE ts.heard_count > 0
    ORDER BY ts.trip_start DESC;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Permissions
GRANT EXECUTE ON FUNCTION drive.get_user_trips_with_stats(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION drive.get_user_trips_with_stats(UUID) TO service_role;
