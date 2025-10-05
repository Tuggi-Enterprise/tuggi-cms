-- RPCs específicos para filtros de POIs
-- Otimizados para performance e consistência

-- 1. RPC para buscar países com contagens
CREATE OR REPLACE FUNCTION core.cms_get_countries()
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
    a.country as value,
    a.country as label,
    COUNT(*) as count
  FROM core.attractions a
  WHERE a.country IS NOT NULL 
    AND a.country != ''
  GROUP BY a.country
  ORDER BY a.country;
END;
$$;

-- 2. RPC para buscar estados por país com contagens
CREATE OR REPLACE FUNCTION core.cms_get_states(country_name TEXT)
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
    a.state as value,
    a.state as label,
    COUNT(*) as count
  FROM core.attractions a
  WHERE a.country = country_name
    AND a.state IS NOT NULL 
    AND a.state != ''
  GROUP BY a.state
  ORDER BY a.state;
END;
$$;

-- 3. RPC para buscar cidades por país/estado com contagens
CREATE OR REPLACE FUNCTION core.cms_get_cities(
  country_name TEXT,
  state_name TEXT DEFAULT NULL
)
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
    a.city as value,
    a.city as label,
    COUNT(*) as count
  FROM core.attractions a
  WHERE a.country = country_name
    AND (state_name IS NULL OR a.state = state_name)
    AND a.city IS NOT NULL 
    AND a.city != ''
  GROUP BY a.city
  ORDER BY a.city;
END;
$$;

-- 4. RPC para buscar categorias com contagens
CREATE OR REPLACE FUNCTION core.cms_get_categories()
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
    a.category as value,
    a.category as label,
    COUNT(*) as count
  FROM core.attractions a
  WHERE a.category IS NOT NULL 
    AND a.category != ''
  GROUP BY a.category
  ORDER BY a.category;
END;
$$;

-- 5. RPC para buscar tipos Google com contagens
CREATE OR REPLACE FUNCTION core.cms_get_google_types()
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
    unnest(a.google_types) as value,
    unnest(a.google_types) as label,
    COUNT(*) as count
  FROM core.attractions a
  WHERE a.google_types IS NOT NULL 
    AND array_length(a.google_types, 1) > 0
  GROUP BY unnest(a.google_types)
  ORDER BY unnest(a.google_types);
END;
$$;

-- Grant permissions
GRANT EXECUTE ON FUNCTION core.cms_get_countries() TO authenticated;
GRANT EXECUTE ON FUNCTION core.cms_get_countries() TO service_role;

GRANT EXECUTE ON FUNCTION core.cms_get_states(TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION core.cms_get_states(TEXT) TO service_role;

GRANT EXECUTE ON FUNCTION core.cms_get_cities(TEXT, TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION core.cms_get_cities(TEXT, TEXT) TO service_role;

GRANT EXECUTE ON FUNCTION core.cms_get_categories() TO authenticated;
GRANT EXECUTE ON FUNCTION core.cms_get_categories() TO service_role;

GRANT EXECUTE ON FUNCTION core.cms_get_google_types() TO authenticated;
GRANT EXECUTE ON FUNCTION core.cms_get_google_types() TO service_role;

-- Add comments
COMMENT ON FUNCTION core.cms_get_countries() IS 'Returns all countries with POI counts for filter dropdowns. Optimized for performance.';
COMMENT ON FUNCTION core.cms_get_states(TEXT) IS 'Returns all states for a given country with POI counts for filter dropdowns.';
COMMENT ON FUNCTION core.cms_get_cities(TEXT, TEXT) IS 'Returns all cities for a given country/state with POI counts for filter dropdowns.';
COMMENT ON FUNCTION core.cms_get_categories() IS 'Returns all categories with POI counts for filter dropdowns.';
COMMENT ON FUNCTION core.cms_get_google_types() IS 'Returns all Google types with POI counts for filter dropdowns.';
