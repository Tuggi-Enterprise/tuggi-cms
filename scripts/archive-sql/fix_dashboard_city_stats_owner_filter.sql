-- Fix: dashboard_city_stats owner scoping
-- Run in Supabase SQL Editor

-- Drop old function if exists (no-arg signature)
DROP FUNCTION IF EXISTS core.dashboard_city_stats();

-- Create new function with optional owner_id param and caller scoping
CREATE OR REPLACE FUNCTION core.dashboard_city_stats(
  owner_id uuid DEFAULT NULL -- Optional: restrict to POIs created_by this cms_users.id
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
  -- Resolve caller's cms_user id by JWT email (if present)
  caller_cms_id := (SELECT id FROM core.cms_users WHERE email = current_setting('request.jwt.claims.email', true));
  is_admin := EXISTS (
    SELECT 1 FROM core.cms_users cu WHERE cu.email = current_setting('request.jwt.claims.email', true) AND cu.role IN ('admin','super_admin')
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

-- Grant execute
GRANT EXECUTE ON FUNCTION core.dashboard_city_stats(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION core.dashboard_city_stats(uuid) TO service_role;

-- Compatibility wrapper for previous zero-arg callers (calls new function with NULL->then will be scoped by caller)
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

-- Test (admin will see all cities; non-admin will be scoped by JWT email mapping)
-- SELECT * FROM core.dashboard_city_stats(NULL) LIMIT 10;