-- Migration: drive.get_trip_exploration_stats — make "missed POIs" optional + optimized
-- Date: 2026-06-12
--
-- Why: the missed-POIs block did a full ST_DWithin scan over core.attraction_coordinate
--      (~640k rows, growing with the global POI backfill), causing statement_timeout (57014)
--      on the mobile "share trip" flow (drive.get_trip_exploration_stats is called when
--      generating the wrapped/share card).
--
-- Key fact: the mobile app never reads missed_pois/missed_count — only heard_pois,
--      heard_count and trail. Only the CMS admin dashboard (TripExplorationMap) uses missed_*.
--      So we gate the expensive block behind p_include_missed (default false):
--        - app calls rpc(..., { p_trip_session_id })          -> missed skipped -> instant
--        - CMS calls rpc(..., { ..., p_include_missed: true }) -> optimized missed
--
-- Adding a parameter changes the signature, so we DROP the old (UUID, FLOAT) overload and
-- CREATE the (UUID, FLOAT, BOOLEAN) one. PostgREST resolves the app's call via the defaults,
-- so the app needs NO redeploy. The optimized missed query relies on
-- idx_attraction_coordinate_point_geog (see 20260612_attraction_coordinate_point_geog_index.sql).

DROP FUNCTION IF EXISTS drive.get_trip_exploration_stats(UUID, FLOAT);

CREATE OR REPLACE FUNCTION drive.get_trip_exploration_stats(
  p_trip_session_id UUID,
  p_buffer_meters FLOAT DEFAULT 1000,
  p_include_missed BOOLEAN DEFAULT false
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_caller_email TEXT := (auth.jwt() ->> 'email');
  v_is_admin BOOLEAN;
  v_user_id UUID;
  v_trail GEOMETRY;
  v_heard_pois JSONB;
  v_missed_pois JSONB := '[]'::jsonb;
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
  INTO v_trail
  FROM drive.route_trail
  WHERE trip_session_id = p_trip_session_id;

  IF v_trail IS NULL THEN
    RETURN jsonb_build_object(
      'heard_count', 0,
      'missed_count', 0,
      'heard_pois', '[]'::jsonb,
      'missed_pois', '[]'::jsonb,
      'trail', null
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

  -- Missed POIs (within buffer but NOT visited) — only when requested (CMS admin dashboard).
  -- Index-accelerated via idx_attraction_coordinate_point_geog; ordered by distance and
  -- capped at 300 so dense urban routes (up to the 5km buffer) stay bounded in time/payload.
  IF p_include_missed THEN
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
      FROM core.attraction_coordinate ac
      JOIN core.attractions a ON a.id = ac.attraction_id
      WHERE
        ST_DWithin(
          v_trail::geography,
          ST_SetSRID(ST_MakePoint(ac.longitude, ac.latitude), 4326)::geography,  -- must match index expr
          p_buffer_meters
        )
        AND NOT EXISTS (
          SELECT 1 FROM drive.poi_visits pv
          WHERE pv.poi_id = a.id
          AND pv.trip_session_id = p_trip_session_id
        )
      ORDER BY ST_Distance(
        v_trail::geography,
        ST_SetSRID(ST_MakePoint(ac.longitude, ac.latitude), 4326)::geography
      ) ASC
      LIMIT 300
    ) sub;
  END IF;

  RETURN jsonb_build_object(
    'trip_session_id', p_trip_session_id,
    'user_id', v_user_id,
    'heard_count', jsonb_array_length(v_heard_pois),
    'missed_count', jsonb_array_length(v_missed_pois),
    'heard_pois', v_heard_pois,
    'missed_pois', v_missed_pois,
    'trail', ST_AsGeoJSON(v_trail)::jsonb,
    'buffer_meters', p_buffer_meters
  );
END;
$$;

GRANT EXECUTE ON FUNCTION drive.get_trip_exploration_stats(UUID, FLOAT, BOOLEAN) TO authenticated;
GRANT EXECUTE ON FUNCTION drive.get_trip_exploration_stats(UUID, FLOAT, BOOLEAN) TO service_role;
