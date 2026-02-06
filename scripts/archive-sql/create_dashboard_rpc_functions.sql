-- Create Dashboard RPC Functions
-- Run this in Supabase SQL Editor to create the missing RPC functions

-- ============================================
-- 1. dashboard_city_stats
-- ============================================

DROP FUNCTION IF EXISTS core.dashboard_city_stats(uuid);
DROP FUNCTION IF EXISTS core.dashboard_city_stats();

CREATE OR REPLACE FUNCTION core.dashboard_city_stats(
  owner_id uuid DEFAULT NULL
)
RETURNS TABLE (
  city text,
  poi_count bigint
)
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  caller_cms_id uuid;
  is_admin boolean := false;
BEGIN
  -- Resolve caller's cms_user id by JWT email
  caller_cms_id := (SELECT id FROM core.cms_users WHERE email = current_setting('request.jwt.claims.email', true));
  is_admin := EXISTS (
    SELECT 1 FROM core.cms_users cu 
    WHERE cu.email = current_setting('request.jwt.claims.email', true) 
    AND cu.role IN ('admin','super_admin')
  );

  -- Force owner scoping for non-admin callers
  IF NOT is_admin THEN
    owner_id := caller_cms_id;
  END IF;

  RETURN QUERY
  SELECT a.city,
         COUNT(*)::bigint AS poi_count
  FROM core.attractions a
  WHERE (owner_id IS NULL OR a.created_by = owner_id)
    AND (a.city IS NOT NULL AND a.city <> '')
  GROUP BY a.city
  ORDER BY poi_count DESC;
END;
$$;

GRANT EXECUTE ON FUNCTION core.dashboard_city_stats(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION core.dashboard_city_stats(uuid) TO service_role;

-- ============================================
-- 2. dashboard_user_analytics
-- ============================================

DROP FUNCTION IF EXISTS core.dashboard_user_analytics(uuid);
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
BEGIN
  -- Resolve caller and admin check via JWT email
  caller_cms_id := (SELECT id FROM core.cms_users WHERE email = current_setting('request.jwt.claims.email', true));
  is_admin := EXISTS (
    SELECT 1 FROM core.cms_users cu 
    WHERE cu.email = current_setting('request.jwt.claims.email', true) 
    AND cu.role IN ('admin','super_admin')
  );

  -- Force owner scoping for non-admin callers
  IF NOT is_admin THEN
    owner_id := caller_cms_id;
  END IF;

  -- Return analytics data
  IF owner_id IS NULL THEN
    -- Admin: global stats
    RETURN QUERY
    SELECT
      (SELECT COUNT(DISTINCT u.id) FROM auth.users u) AS total_users,
      (SELECT COUNT(*) FROM drive.trail_trips_unified) AS total_trips,
      (SELECT COALESCE(SUM(distance_km),0) FROM drive.trail_trips_unified) AS total_km_driven,
      0::bigint AS total_pois_played,
      (SELECT COALESCE(AVG(duration)::text, '00:00:00') FROM drive.trail_trips_unified) AS avg_trip_duration,
      (SELECT jsonb_agg(jsonb_build_object('platform', platform, 'trips', trips)) FROM (
         SELECT platform, COUNT(*) as trips FROM drive.trail_trips_unified GROUP BY platform
      ) t) AS trips_by_platform;
  ELSE
    -- Scoped to owner: trips referencing POIs owned by owner_id
    RETURN QUERY
    SELECT
      (SELECT COUNT(DISTINCT t.user_id) 
       FROM drive.trail_trips_unified t 
       JOIN core.attractions a ON t.attraction_id = a.id 
       WHERE a.created_by = owner_id) AS total_users,
      (SELECT COUNT(*) 
       FROM drive.trail_trips_unified t 
       JOIN core.attractions a ON t.attraction_id = a.id 
       WHERE a.created_by = owner_id) AS total_trips,
      (SELECT COALESCE(SUM(t.distance_km),0) 
       FROM drive.trail_trips_unified t 
       JOIN core.attractions a ON t.attraction_id = a.id 
       WHERE a.created_by = owner_id) AS total_km_driven,
      0::bigint AS total_pois_played,
      (SELECT COALESCE(AVG(t.duration)::text, '00:00:00') 
       FROM drive.trail_trips_unified t 
       JOIN core.attractions a ON t.attraction_id = a.id 
       WHERE a.created_by = owner_id) AS avg_trip_duration,
      (SELECT jsonb_agg(jsonb_build_object('platform', platform, 'trips', trips)) FROM (
         SELECT t.platform, COUNT(*) as trips 
         FROM drive.trail_trips_unified t 
         JOIN core.attractions a ON t.attraction_id = a.id 
         WHERE a.created_by = owner_id 
         GROUP BY t.platform
      ) q) AS trips_by_platform;
  END IF;
END;
$$;

GRANT EXECUTE ON FUNCTION core.dashboard_user_analytics(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION core.dashboard_user_analytics(uuid) TO service_role;

-- ============================================
-- Verify functions were created
-- ============================================

SELECT 'dashboard_city_stats created' as status 
WHERE EXISTS (
  SELECT 1 FROM pg_proc WHERE proname = 'dashboard_city_stats'
);

SELECT 'dashboard_user_analytics created' as status 
WHERE EXISTS (
  SELECT 1 FROM pg_proc WHERE proname = 'dashboard_user_analytics'
);
