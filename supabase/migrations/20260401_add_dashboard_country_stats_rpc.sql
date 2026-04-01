-- Migration: Add dashboard_country_stats to correctly count POIs per country
-- Date: 2026-04-01

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
    INITCAP(TRIM(LOWER(a.country))) as country_name,
    COUNT(*)::bigint AS poi_count,
    COUNT(DISTINCT INITCAP(TRIM(LOWER(a.city))))::bigint AS city_count,
    COUNT(*) FILTER (WHERE a.approved = true)::bigint AS approved_count
  FROM core.attractions a
  WHERE (target_owner_id IS NULL OR a.owner_id = target_owner_id OR a.created_by = target_owner_id)
    AND a.country IS NOT NULL AND TRIM(a.country) <> ''
  GROUP BY INITCAP(TRIM(LOWER(a.country)))
  ORDER BY poi_count DESC;
END;
$$;

GRANT EXECUTE ON FUNCTION core.dashboard_country_stats(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION core.dashboard_country_stats(uuid) TO service_role;
