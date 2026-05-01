-- Migration: Add optimized location lookup RPCs for homolog schema
-- Date: 2026-05-01

-- Get countries from homolog.pois
CREATE OR REPLACE FUNCTION homolog.cms_get_countries(p_category TEXT DEFAULT NULL)
RETURNS TABLE (
  value TEXT,
  label TEXT,
  count BIGINT
)
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  RETURN QUERY
  SELECT 
    p.country as value,
    p.country as label,
    COUNT(*)::BIGINT as count
  FROM homolog.pois p
  WHERE (p_category IS NULL OR p.category = p_category)
    AND p.country IS NOT NULL AND p.country != ''
  GROUP BY p.country
  ORDER BY count DESC;
END;
$$;

-- Get states from homolog.pois
CREATE OR REPLACE FUNCTION homolog.cms_get_states(country_name TEXT, p_category TEXT DEFAULT NULL)
RETURNS TABLE (
  value TEXT,
  label TEXT,
  count BIGINT
)
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  RETURN QUERY
  SELECT 
    p.state as value,
    p.state as label,
    COUNT(*)::BIGINT as count
  FROM homolog.pois p
  WHERE p.country = country_name
    AND (p_category IS NULL OR p.category = p_category)
    AND p.state IS NOT NULL AND p.state != ''
  GROUP BY p.state
  ORDER BY count DESC;
END;
$$;

-- Get cities from homolog.pois
CREATE OR REPLACE FUNCTION homolog.cms_get_cities(country_name TEXT, state_name TEXT DEFAULT NULL, p_category TEXT DEFAULT NULL)
RETURNS TABLE (
  value TEXT,
  label TEXT,
  count BIGINT
)
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  RETURN QUERY
  SELECT 
    p.city as value,
    p.city as label,
    COUNT(*)::BIGINT as count
  FROM homolog.pois p
  WHERE p.country = country_name
    AND (state_name IS NULL OR p.state = state_name)
    AND (p_category IS NULL OR p.category = p_category)
    AND p.city IS NOT NULL AND p.city != ''
  GROUP BY p.city
  ORDER BY count DESC;
END;
$$;

GRANT EXECUTE ON FUNCTION homolog.cms_get_countries(TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION homolog.cms_get_countries(TEXT) TO service_role;
GRANT EXECUTE ON FUNCTION homolog.cms_get_states(TEXT, TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION homolog.cms_get_states(TEXT, TEXT) TO service_role;
GRANT EXECUTE ON FUNCTION homolog.cms_get_cities(TEXT, TEXT, TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION homolog.cms_get_cities(TEXT, TEXT, TEXT) TO service_role;

-- Performance Indexes
CREATE INDEX IF NOT EXISTS idx_homolog_pois_location_lookup 
ON homolog.pois (country, state, city);

CREATE INDEX IF NOT EXISTS idx_homolog_pois_country_state 
ON homolog.pois (country, state);

CREATE INDEX IF NOT EXISTS idx_homolog_pois_category 
ON homolog.pois (category);
