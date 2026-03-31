-- Migration: Gamification Passport RPCs (v3 - Schema: drive)
-- Date: 2026-03-31
-- Purpose: Support User Passport views with lifetime stats and trip FOMO analysis.
-- Changes: Moved to 'drive' schema and added security/performance.

-- ============================================
-- 0. INDEXES PARA PERFORMANCE
-- ============================================
CREATE INDEX IF NOT EXISTS idx_route_trail_user_session ON drive.route_trail (user_id, trip_session_id);
CREATE INDEX IF NOT EXISTS idx_route_trail_timestamp ON drive.route_trail (timestamp);
CREATE INDEX IF NOT EXISTS idx_poi_visits_user_session ON drive.poi_visits (user_id, trip_session_id);

-- ============================================
-- 1. drive.get_user_passport_stats
-- ============================================
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
BEGIN
  -- SECURITY: Check if caller is Admin in core.cms_users or the actual user
  SELECT (role = 'admin') INTO v_is_admin FROM core.cms_users WHERE email = v_caller_email AND is_active = true;
  
  IF (COALESCE(v_is_admin, false) = false) AND (p_user_id != auth.uid()) THEN
    RAISE EXCEPTION 'Access Denied: You can only view your own passport data.';
  END IF;

  -- 1. Total trips
  SELECT COUNT(DISTINCT trip_session_id) 
  INTO v_total_trips 
  FROM drive.route_trail 
  WHERE user_id = p_user_id;

  -- 2. Total unique POIs across all trips (sum of unique per trip)
  WITH unique_per_session AS (
    SELECT trip_session_id, COUNT(DISTINCT poi_id) as unique_count
    FROM drive.poi_visits
    WHERE user_id = p_user_id
    GROUP BY trip_session_id
  )
  SELECT COALESCE(SUM(unique_count), 0)
  INTO v_unique_pois_per_trip
  FROM unique_per_session;

  -- 3. Top categories (breakdown by osm_category)
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

  RETURN jsonb_build_object(
    'total_trips', v_total_trips,
    'total_passed_lifetime', v_unique_pois_per_trip,
    'top_categories', v_top_categories,
    'total_distance_km', 0
  );
END;
$$;

-- ============================================
-- 2. drive.get_trip_exploration_stats
-- ============================================
CREATE OR REPLACE FUNCTION drive.get_trip_exploration_stats(
  p_trip_session_id UUID,
  p_buffer_meters FLOAT DEFAULT 1000
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_caller_email TEXT := (auth.jwt() ->> 'email');
  v_is_admin BOOLEAN;
  v_user_id UUID;
  v_route_line GEOMETRY;
  v_heard_pois JSONB;
  v_missed_pois JSONB;
BEGIN
  -- Get owner of trip
  SELECT DISTINCT user_id INTO v_user_id FROM drive.route_trail WHERE trip_session_id = p_trip_session_id;
  
  -- Check Admin status
  SELECT (role = 'admin') INTO v_is_admin FROM core.cms_users WHERE email = v_caller_email AND is_active = true;

  IF (COALESCE(v_is_admin, false) = false) AND (v_user_id != auth.uid()) THEN
    RAISE EXCEPTION 'Access Denied: This trip session does not belong to you.';
  END IF;

  -- Create route geometry
  SELECT ST_Simplify(ST_MakeLine(ST_SetSRID(ST_MakePoint(longitude, latitude), 4326) ORDER BY timestamp), 0.0001)
  INTO v_route_line
  FROM drive.route_trail
  WHERE trip_session_id = p_trip_session_id;

  IF v_route_line IS NULL THEN
    RETURN jsonb_build_object(
      'heard_count', 0,
      'missed_count', 0,
      'heard_pois', '[]'::jsonb,
      'missed_pois', '[]'::jsonb
    );
  END IF;

  -- Heard POIs
  SELECT COALESCE(jsonb_agg(sub.poi_row), '[]'::jsonb)
  INTO v_heard_pois
  FROM (
    SELECT DISTINCT ON (a.id)
      jsonb_build_object(
        'id', a.id,
        'name', a.name,
        'city', a.city,
        'osm_category', a.osm_category,
        'category', a.category,
        'latitude', ac.latitude,
        'longitude', ac.longitude,
        'visit_timestamp', pv.visit_timestamp
      ) as poi_row
    FROM drive.poi_visits pv
    JOIN core.attractions a ON a.id = pv.poi_id
    JOIN core.attraction_coordinate ac ON ac.attraction_id = a.id
    WHERE pv.trip_session_id = p_trip_session_id
  ) sub;

  -- Missed POIs (Within buffer but NOT visited)
  SELECT COALESCE(jsonb_agg(sub.poi_row), '[]'::jsonb)
  INTO v_missed_pois
  FROM (
    SELECT 
      jsonb_build_object(
        'id', a.id,
        'name', a.name,
        'city', a.city,
        'osm_category', a.osm_category,
        'category', a.category,
        'latitude', ac.latitude,
        'longitude', ac.longitude
      ) as poi_row
    FROM core.attractions a
    JOIN core.attraction_coordinate ac ON ac.attraction_id = a.id
    WHERE 
      ST_DWithin(
        v_route_line::geography, 
        ST_SetSRID(ST_MakePoint(ac.longitude, ac.latitude), 4326)::geography, 
        p_buffer_meters
      )
      AND NOT EXISTS (
        SELECT 1 FROM drive.poi_visits pv 
        WHERE pv.poi_id = a.id 
        AND pv.trip_session_id = p_trip_session_id
      )
  ) sub;

  RETURN jsonb_build_object(
    'trip_session_id', p_trip_session_id,
    'user_id', v_user_id,
    'heard_count', jsonb_array_length(v_heard_pois),
    'missed_count', jsonb_array_length(v_missed_pois),
    'heard_pois', v_heard_pois,
    'missed_pois', v_missed_pois,
    'buffer_meters', p_buffer_meters
  );
END;
$$;

-- Permissions
GRANT EXECUTE ON FUNCTION drive.get_user_passport_stats(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION drive.get_user_passport_stats(UUID) TO service_role;
GRANT EXECUTE ON FUNCTION drive.get_trip_exploration_stats(UUID, FLOAT) TO authenticated;
GRANT EXECUTE ON FUNCTION drive.get_trip_exploration_stats(UUID, FLOAT) TO service_role;
