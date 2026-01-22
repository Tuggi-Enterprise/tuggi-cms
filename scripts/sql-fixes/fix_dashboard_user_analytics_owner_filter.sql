-- Fix: dashboard_user_analytics owner scoping
-- Run in Supabase SQL Editor

-- Drop existing function (if any) and create a new one with owner scoping
DROP FUNCTION IF EXISTS core.dashboard_user_analytics();

CREATE OR REPLACE FUNCTION core.dashboard_user_analytics(
  owner_id uuid DEFAULT NULL
)
RETURNS TABLE (
  total_users bigint,
  total_trips bigint,
  total_km_driven numeric,
  total_pois_played bigint,
  avg_trip_duration text,
  trips_by_platform jsonb
)
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  caller_cms_id uuid;
  is_admin boolean := false;
  trips_json jsonb;
BEGIN
  -- Resolve caller and admin check via JWT email
  caller_cms_id := (SELECT id FROM core.cms_users WHERE email = current_setting('request.jwt.claims.email', true));
  is_admin := EXISTS (
    SELECT 1 FROM core.cms_users cu WHERE cu.email = current_setting('request.jwt.claims.email', true) AND cu.role IN ('admin','super_admin')
  );

  IF NOT is_admin THEN
    owner_id := caller_cms_id;
  END IF;

  -- Total users interacting with POIs owned by owner_id
  IF owner_id IS NULL THEN
    -- Admin: global stats
    RETURN QUERY
    SELECT
      (SELECT COUNT(DISTINCT u.id) FROM auth.users u) AS total_users,
      (SELECT COUNT(*) FROM drive.trail_trips_unified) AS total_trips,
      (SELECT COALESCE(SUM(distance_km),0) FROM drive.trail_trips_unified) AS total_km_driven,
      (SELECT COUNT(*) FROM core.attraction_plays) AS total_pois_played,
      (SELECT COALESCE(AVG(duration)::text, '00:00:00') FROM drive.trail_trips_unified) AS avg_trip_duration,
      (SELECT jsonb_agg(jsonb_build_object('platform', platform, 'trips', trips)) FROM (
         SELECT platform, COUNT(*) as trips FROM drive.trail_trips_unified GROUP BY platform
      ) t) AS trips_by_platform;
  ELSE
    -- Scoped to owner: find trips referencing POIs owned by owner_id
    RETURN QUERY
    SELECT
      (SELECT COUNT(DISTINCT t.user_id) FROM drive.trail_trips_unified t JOIN core.attractions a ON t.attraction_id = a.id WHERE a.created_by = owner_id) AS total_users,
      (SELECT COUNT(*) FROM drive.trail_trips_unified t JOIN core.attractions a ON t.attraction_id = a.id WHERE a.created_by = owner_id) AS total_trips,
      (SELECT COALESCE(SUM(t.distance_km),0) FROM drive.trail_trips_unified t JOIN core.attractions a ON t.attraction_id = a.id WHERE a.created_by = owner_id) AS total_km_driven,
      (SELECT COUNT(*) FROM core.attraction_plays ap JOIN core.attractions a ON ap.attraction_id = a.id WHERE a.created_by = owner_id) AS total_pois_played,
      (SELECT COALESCE(AVG(t.duration)::text, '00:00:00') FROM drive.trail_trips_unified t JOIN core.attractions a ON t.attraction_id = a.id WHERE a.created_by = owner_id) AS avg_trip_duration,
      (SELECT jsonb_agg(jsonb_build_object('platform', platform, 'trips', trips)) FROM (
         SELECT t.platform, COUNT(*) as trips FROM drive.trail_trips_unified t JOIN core.attractions a ON t.attraction_id = a.id WHERE a.created_by = owner_id GROUP BY t.platform
      ) q) AS trips_by_platform;
  END IF;
END;
$$;

GRANT EXECUTE ON FUNCTION core.dashboard_user_analytics(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION core.dashboard_user_analytics(uuid) TO service_role;

-- Compatibility wrapper
DROP FUNCTION IF EXISTS core.dashboard_user_analytics_old();
CREATE OR REPLACE FUNCTION core.dashboard_user_analytics_old()
RETURNS TABLE (total_users bigint, total_trips bigint, total_km_driven numeric, total_pois_played bigint, avg_trip_duration text, trips_by_platform jsonb)
LANGUAGE sql
STABLE
AS $$
  SELECT * FROM core.dashboard_user_analytics(NULL::uuid);
$$;

GRANT EXECUTE ON FUNCTION core.dashboard_user_analytics_old() TO authenticated;
GRANT EXECUTE ON FUNCTION core.dashboard_user_analytics_old() TO service_role;

-- Note: The function references drive.trail_trips_unified and core.attraction_plays - adjust table names if your schema differs.
-- Test examples:
-- SELECT * FROM core.dashboard_user_analytics(NULL) LIMIT 1; -- admin
-- SELECT * FROM core.dashboard_user_analytics('some-owner-uuid') LIMIT 1; -- scoped
