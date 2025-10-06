-- Dashboard City Statistics RPC
-- Optimized RPC that returns city statistics without fetching all POIs
-- This avoids the Supabase JS Client limit of 1000 records

CREATE OR REPLACE FUNCTION core.dashboard_city_stats()
RETURNS TABLE (
  city TEXT,
  poi_count BIGINT
)
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  RETURN QUERY
  SELECT 
    a.city,
    COUNT(*) as poi_count
  FROM core.attractions a
  WHERE a.city IS NOT NULL AND a.city != ''
  GROUP BY a.city
  ORDER BY poi_count DESC
  LIMIT 10; -- Top 10 cities
END;
$$;

-- Grant execute permission
GRANT EXECUTE ON FUNCTION core.dashboard_city_stats() TO authenticated;

-- Add comment
COMMENT ON FUNCTION core.dashboard_city_stats() IS 'Returns POI count by city for dashboard - avoids Supabase client 1000 record limit';

-- Test the function
SELECT * FROM core.dashboard_city_stats();
