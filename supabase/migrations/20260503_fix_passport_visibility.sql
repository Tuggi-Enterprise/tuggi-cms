-- Migration: Fix User Passport Visibility
-- Date: 2026-05-03
-- Purpose: Ensure trips without discoveries (0 POIs) are visible in the user passport and stats.
-- Rationale: Users expect to see their trip history even if no POIs were triggered during a session.

-- 1. Update drive.get_user_passport_stats to be more inclusive
CREATE OR REPLACE FUNCTION drive.get_user_passport_stats(
  p_user_id UUID
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_caller_email TEXT := (auth.jwt() ->> 'email');
  v_is_admin BOOLEAN;
  v_total_trips BIGINT;
  v_unique_pois_per_trip BIGINT;
  v_total_distance_km FLOAT;
  v_top_categories JSONB;
  v_total_cities BIGINT;
  v_total_time_minutes FLOAT;
  v_member_since TIMESTAMPTZ;
BEGIN
  -- SECURITY: Check if caller is Admin in core.cms_users or the actual user
  SELECT (role = 'admin') INTO v_is_admin FROM core.cms_users WHERE email = v_caller_email AND is_active = true;
  
  IF (COALESCE(v_is_admin, false) = false) AND (p_user_id != auth.uid()) THEN
    RAISE EXCEPTION 'Access Denied: You can only view your own passport data.';
  END IF;

  -- 1. Total trips (Count all sessions with GPS data, not just those with discoveries)
  SELECT COUNT(*) 
  INTO v_total_trips 
  FROM drive.trail_trips_unified 
  WHERE user_id = p_user_id
    AND trip_start > '2000-01-01';

  -- 2. Total unique POIs across all trips
  WITH unique_per_session AS (
    SELECT trip_session_id, COUNT(DISTINCT poi_id) as unique_count
    FROM drive.poi_visits
    WHERE user_id = p_user_id
        AND visit_timestamp > '2000-01-01'
    GROUP BY trip_session_id
  )
  SELECT COALESCE(SUM(unique_count), 0)
  INTO v_unique_pois_per_trip
  FROM unique_per_session;

  -- 3. Total distance (Calculated for ALL trips, not just those with discoveries)
  WITH point_deltas AS (
    SELECT 
      rt.trip_session_id,
      ST_SetSRID(ST_MakePoint(rt.longitude, rt.latitude), 4326)::geography as current_geom,
      LAG(ST_SetSRID(ST_MakePoint(rt.longitude, rt.latitude), 4326)::geography) OVER (PARTITION BY rt.trip_session_id ORDER BY rt.timestamp) as prev_geom,
      rt.timestamp as current_ts,
      LAG(rt.timestamp) OVER (PARTITION BY rt.trip_session_id ORDER BY rt.timestamp) as prev_ts
    FROM drive.route_trail rt
    WHERE rt.user_id = p_user_id
      AND rt.latitude != 0 AND rt.longitude != 0
      AND rt.timestamp > '2000-01-01'
  ),
  segments AS (
    SELECT 
      ST_Distance(current_geom, prev_geom) as dist_meters,
      EXTRACT(EPOCH FROM (current_ts - prev_ts)) as time_diff
    FROM point_deltas
    WHERE prev_geom IS NOT NULL AND prev_ts IS NOT NULL
      AND current_ts > prev_ts
  )
  SELECT COALESCE(SUM(dist_meters) FILTER (
    WHERE (dist_meters / NULLIF(time_diff, 0)) < 150 -- Safety speed limit
  ), 0) / 1000.0
  INTO v_total_distance_km
  FROM segments;

  -- 4. Top categories
  SELECT COALESCE(jsonb_agg(sub.cat_row), '[]'::jsonb)
  INTO v_top_categories
  FROM (
    SELECT jsonb_build_object(
      'category', COALESCE(a.osm_category, a.category, 'Other'),
      'count', COUNT(*)
    ) as cat_row
    FROM drive.poi_visits pv
    JOIN core.attractions a ON a.id = pv.poi_id
    WHERE pv.user_id = p_user_id
    GROUP BY COALESCE(a.osm_category, a.category, 'Other')
    ORDER BY COUNT(*) DESC
    LIMIT 5
  ) sub;

  -- 5. Total cities explored
  SELECT COUNT(DISTINCT a.city)
  INTO v_total_cities
  FROM drive.poi_visits pv
  JOIN core.attractions a ON a.id = pv.poi_id
  WHERE pv.user_id = p_user_id
    AND pv.visit_timestamp > '2000-01-01'
    AND a.city IS NOT NULL AND a.city <> '';

  -- 6. Total duration (All trips)
  SELECT COALESCE(SUM(duration_minutes), 0)
  INTO v_total_time_minutes
  FROM drive.trail_trips_unified
  WHERE user_id = p_user_id
    AND trip_start > '2000-01-01';

  -- 7. Member since
  SELECT created_at INTO v_member_since 
  FROM drive.profiles 
  WHERE id = p_user_id;

  IF v_member_since IS NULL THEN
    SELECT created_at INTO v_member_since FROM public.profiles WHERE id = p_user_id;
  END IF;

  RETURN jsonb_build_object(
    'total_trips', COALESCE(v_total_trips, 0),
    'total_passed_lifetime', COALESCE(v_unique_pois_per_trip, 0),
    'top_categories', COALESCE(v_top_categories, '[]'::jsonb),
    'total_distance_km', ROUND(COALESCE(v_total_distance_km, 0)::numeric, 1),
    'total_cities_count', COALESCE(v_total_cities, 0),
    'total_time_minutes', ROUND(COALESCE(v_total_time_minutes, 0)::numeric, 0),
    'member_since', v_member_since
  );
END;
$$;

-- 2. Update drive.get_user_trips_with_stats to remove discoveries filter
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
    ORDER BY ts.trip_start DESC;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Permissions
GRANT EXECUTE ON FUNCTION drive.get_user_passport_stats(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION drive.get_user_passport_stats(UUID) TO service_role;
GRANT EXECUTE ON FUNCTION drive.get_user_trips_with_stats(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION drive.get_user_trips_with_stats(UUID) TO service_role;
