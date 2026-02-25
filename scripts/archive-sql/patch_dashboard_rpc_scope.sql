-- patch_dashboard_rpc_scope.sql
--
-- Ensure every dashboard RPC accepts an optional owner_id parameter and
-- strictly filters data to that client's scope when the caller is NOT an
-- admin.  Existing functions may have used wrong columns (created_by) or not
-- accepted the parameter at all; this script replaces them with scoped
-- versions and provides compatibility wrappers.
--
-- Run this script in the Supabase SQL editor or via psql against the database.

-- #########################################
-- 1. dashboard_city_stats (POIs por cidade)
-- #########################################
DROP FUNCTION IF EXISTS core.dashboard_city_stats(uuid);
DROP FUNCTION IF EXISTS core.dashboard_city_stats();

CREATE OR REPLACE FUNCTION core.dashboard_city_stats(
  p_owner_id uuid DEFAULT NULL
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
  caller_cms_id := (SELECT id
                    FROM core.cms_users
                    WHERE email = current_setting('request.jwt.claims.email', true));
  is_admin := EXISTS (
    SELECT 1 FROM core.cms_users cu
    WHERE cu.email = current_setting('request.jwt.claims.email', true)
      AND cu.role IN ('admin','super_admin')
  );

  IF NOT is_admin THEN
    p_owner_id := caller_cms_id;
  END IF;

  RETURN QUERY
  SELECT a.city, COUNT(*)::bigint AS poi_count
  FROM core.attractions a
  WHERE (p_owner_id IS NULL OR a.owner_id = p_owner_id)
    AND a.city IS NOT NULL AND a.city <> ''
  GROUP BY a.city
  ORDER BY poi_count DESC;
END;
$$;

GRANT EXECUTE ON FUNCTION core.dashboard_city_stats(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION core.dashboard_city_stats(uuid) TO service_role;

-- compatibility wrapper for zero-arg callers
DROP FUNCTION IF EXISTS core.dashboard_city_stats_old();
CREATE OR REPLACE FUNCTION core.dashboard_city_stats_old()
RETURNS TABLE (city text, poi_count bigint)
LANGUAGE sql
STABLE
AS $$
  SELECT * FROM core.dashboard_city_stats(NULL::uuid);
$$;

GRANT EXECUTE ON FUNCTION core.dashboard_city_stats_old() TO authenticated;
GRANT EXECUTE ON FUNCTION core.dashboard_city_stats_old() TO service_role;


-- #########################################
-- 2. dashboard_user_analytics (usuários/trips)
-- #########################################
DROP FUNCTION IF EXISTS core.dashboard_user_analytics(uuid);
DROP FUNCTION IF EXISTS core.dashboard_user_analytics();

CREATE OR REPLACE FUNCTION core.dashboard_user_analytics(
  p_owner_id uuid DEFAULT NULL
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
  caller_cms_id := (SELECT id FROM core.cms_users WHERE email = current_setting('request.jwt.claims.email', true));
  is_admin := EXISTS (
    SELECT 1 FROM core.cms_users cu
    WHERE cu.email = current_setting('request.jwt.claims.email', true)
      AND cu.role IN ('admin','super_admin')
  );

  IF NOT is_admin THEN
    p_owner_id := caller_cms_id;
  END IF;

  IF p_owner_id IS NULL THEN
    -- admin: global
    RETURN QUERY
    SELECT
      (SELECT COUNT(DISTINCT u.id) FROM auth.users u) AS total_users,
      (SELECT COUNT(*) FROM drive.trail_trips_unified) AS total_trips,
      (SELECT COALESCE(SUM(distance_km),0) FROM drive.trail_trips_unified) AS total_km_driven,
      0::bigint AS total_pois_played,
      -- use duration_minutes and format as minutes string
      (SELECT COALESCE(ROUND(AVG(duration_minutes))::text || ' min', '0 min')
         FROM drive.trail_trips_unified) AS avg_trip_duration,
      (SELECT jsonb_agg(jsonb_build_object('platform', platform, 'trips', trips)) FROM (
         SELECT COALESCE(p.last_platform, 'unknown') AS platform,
                COUNT(*) AS trips
         FROM drive.trail_trips_unified t
         LEFT JOIN drive.profiles p ON t.user_id = p.id
         GROUP BY p.last_platform
      ) t) AS trips_by_platform;
  ELSE
    RETURN QUERY
    SELECT
      (SELECT COUNT(DISTINCT t.user_id)
       FROM drive.trail_trips_unified t
       JOIN core.attractions a ON t.attraction_id = a.id
       WHERE a.owner_id = p_owner_id) AS total_users,
      (SELECT COUNT(*)
       FROM drive.trail_trips_unified t
       JOIN core.attractions a ON t.attraction_id = a.id
       WHERE a.owner_id = p_owner_id) AS total_trips,
      (SELECT COALESCE(SUM(t.distance_km),0)
       FROM drive.trail_trips_unified t
       JOIN core.attractions a ON t.attraction_id = a.id
       WHERE a.owner_id = p_owner_id) AS total_km_driven,
      0::bigint AS total_pois_played,
      (SELECT COALESCE(ROUND(AVG(t.duration_minutes))::text || ' min', '0 min')
       FROM drive.trail_trips_unified t
       JOIN core.attractions a ON t.attraction_id = a.id
       WHERE a.owner_id = p_owner_id) AS avg_trip_duration,
      (SELECT jsonb_agg(jsonb_build_object('platform', platform, 'trips', trips)) FROM (
         SELECT COALESCE(p.last_platform, 'unknown') AS platform,
                COUNT(*) AS trips
         FROM drive.trail_trips_unified t
         LEFT JOIN drive.profiles p ON t.user_id = p.id
         JOIN core.attractions a ON t.attraction_id = a.id
         WHERE a.owner_id = p_owner_id
         GROUP BY p.last_platform
      ) q) AS trips_by_platform;
  END IF;
END;
$$;

GRANT EXECUTE ON FUNCTION core.dashboard_user_analytics(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION core.dashboard_user_analytics(uuid) TO service_role;

-- compatibility wrapper
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

-- #########################################
-- 3. other rpc skeletons: similar modifications below if needed
--    (dashboard_most_visited_cities, dashboard_top_visited_pois,
--     dashboard_recent_visited_pois,
--     dashboard_inventory_funnel,
--     dashboard_content_quality,
--     dashboard_visits_by_language)
--    These functions are not versioned in repo; inspect existing SQL and
--    add owner_id param + corresponding WHERE clauses.
-- #########################################

-- END OF PATCH
