-- Geographic Stats - Materialized Performance Optimization
-- This implementation uses a Materialized View to avoid heavy GROUP BY on core.attractions.

-- 1. Create the Materialized View for geographic distribution
-- Including owner_id to support multi-tenant dashboard views
CREATE MATERIALIZED VIEW IF NOT EXISTS core.mv_geographic_stats AS
SELECT 
    owner_id,
    country,
    INITCAP(TRIM(LOWER(city))) as city,
    COUNT(*)::bigint as poi_count,
    COUNT(*) FILTER (WHERE approved = true)::bigint as approved_count,
    COUNT(*) FILTER (WHERE approved = false)::bigint as pending_count
FROM core.attractions
WHERE city IS NOT NULL AND TRIM(city) <> ''
GROUP BY owner_id, country, INITCAP(TRIM(LOWER(city)))
WITH DATA;

-- 2. Unique index to allow CONCURRENT refresh
CREATE UNIQUE INDEX IF NOT EXISTS idx_mv_geographic_stats_owner_country_city 
ON core.mv_geographic_stats (owner_id, country, city);

-- 3. Refresh function (called by cron or after migrations)
CREATE OR REPLACE FUNCTION core.refresh_geographic_stats()
RETURNS void LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
    REFRESH MATERIALIZED VIEW CONCURRENTLY core.mv_geographic_stats;
END;
$$;

-- 4. Optimized dashboard_city_stats
CREATE OR REPLACE FUNCTION core.dashboard_city_stats(
  p_owner_id uuid DEFAULT NULL
)
RETURNS TABLE (
  city text,
  country text,
  poi_count bigint,
  approved_count bigint,
  pending_count bigint
)
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  caller_cms_id uuid;
  is_admin boolean := false;
  target_owner_id uuid;
BEGIN
  -- Resolve identity (Standard Tuggi Security Pattern)
  BEGIN
    caller_cms_id := (SELECT cu.id FROM core.cms_users cu WHERE cu.email = current_setting('request.jwt.claims.email', true));
    is_admin := EXISTS (
      SELECT 1 FROM core.cms_users cu 
      WHERE cu.email = current_setting('request.jwt.claims.email', true) 
      AND cu.role IN ('admin','super_admin')
    );
  EXCEPTION WHEN OTHERS THEN
    is_admin := TRUE;
  END;

  -- Default target scoping
  IF NOT is_admin AND caller_cms_id IS NOT NULL THEN
    target_owner_id := COALESCE(p_owner_id, caller_cms_id);
  ELSE
    target_owner_id := p_owner_id;
  END IF;

  RETURN QUERY
  SELECT 
    gs.city,
    gs.country,
    SUM(gs.poi_count)::bigint as poi_count,
    SUM(gs.approved_count)::bigint as approved_count,
    SUM(gs.pending_count)::bigint as pending_count
  FROM core.mv_geographic_stats gs
  WHERE (target_owner_id IS NULL OR gs.owner_id = target_owner_id)
  GROUP BY gs.city, gs.country
  ORDER BY poi_count DESC
  LIMIT 50;
END;
$$;

-- 5. Optimized dashboard_country_stats
CREATE OR REPLACE FUNCTION core.dashboard_country_stats(
  p_owner_id uuid DEFAULT NULL
)
RETURNS TABLE (
  country text,
  poi_count bigint,
  city_count bigint,
  approved_count bigint
)
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  caller_cms_id uuid;
  is_admin boolean := false;
  target_owner_id uuid;
BEGIN
  -- Resolve identity
  BEGIN
    caller_cms_id := (SELECT cu.id FROM core.cms_users cu WHERE cu.email = current_setting('request.jwt.claims.email', true));
    is_admin := EXISTS (
      SELECT 1 FROM core.cms_users cu 
      WHERE cu.email = current_setting('request.jwt.claims.email', true) 
      AND cu.role IN ('admin','super_admin')
    );
  EXCEPTION WHEN OTHERS THEN
    is_admin := TRUE;
  END;

  -- Default target scoping
  IF NOT is_admin AND caller_cms_id IS NOT NULL THEN
    target_owner_id := COALESCE(p_owner_id, caller_cms_id);
  ELSE
    target_owner_id := p_owner_id;
  END IF;

  RETURN QUERY
  SELECT 
    gs.country,
    SUM(gs.poi_count)::bigint as poi_count,
    COUNT(DISTINCT gs.city)::bigint as city_count,
    SUM(gs.approved_count)::bigint as approved_count
  FROM core.mv_geographic_stats gs
  WHERE (target_owner_id IS NULL OR gs.owner_id = target_owner_id)
  GROUP BY gs.country
  ORDER BY poi_count DESC;
END;
$$;

GRANT EXECUTE ON FUNCTION core.refresh_geographic_stats() TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION core.dashboard_city_stats(uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION core.dashboard_country_stats(uuid) TO authenticated, service_role;
