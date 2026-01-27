-- Migration to optimize OSM Importer map visualization
-- Updates homolog.get_coordinates_in_bounds to support server-side clustering
-- Date: 2026-01-07 13:00:00

-- Drop existing function to update signature
DROP FUNCTION IF EXISTS homolog.get_coordinates_in_bounds;

CREATE OR REPLACE FUNCTION homolog.get_coordinates_in_bounds(
  min_lat DECIMAL(10,8),
  min_lng DECIMAL(11,8),
  max_lat DECIMAL(10,8),
  max_lng DECIMAL(11,8),
  zoom_level INTEGER DEFAULT 14,
  limit_count INTEGER DEFAULT 5000,
  city_filter TEXT DEFAULT NULL,
  state_filter TEXT DEFAULT NULL,
  category_filter TEXT DEFAULT NULL,
  search_term TEXT DEFAULT NULL
)
RETURNS TABLE (
  id UUID,
  type TEXT,
  count INTEGER,
  latitude DECIMAL(10,8),
  longitude DECIMAL(11,8),
  name TEXT,
  category TEXT
) AS $$
DECLARE
  -- Calculate epsilon for clustering based on zoom level
  zoom_factor NUMERIC := 360.0 / POWER(2, zoom_level);
  epsilon NUMERIC;
BEGIN
  IF zoom_level >= 8 THEN
    epsilon := 0; -- No clustering from zoom 8
  ELSE
    epsilon := zoom_factor / 10.0; -- Smaller clusters at low zoom
  END IF;
  RETURN QUERY
  WITH filtered_pois AS (
    SELECT 
      p.uuid_id,
      p.name,
      p.category,
      p.lat,
      p.lon,
      ST_SetSRID(ST_MakePoint(p.lon, p.lat), 4326) as geom
    FROM homolog.pois p
    WHERE 
      p.lat >= min_lat AND p.lat <= max_lat
      AND p.lon >= min_lng AND p.lon <= max_lng
      AND (city_filter IS NULL OR p.city = city_filter)
      AND (state_filter IS NULL OR p.state = state_filter)
      AND (category_filter IS NULL OR p.category = category_filter)
      AND (search_term IS NULL OR 
           p.name ILIKE '%' || search_term || '%' OR 
           p.city ILIKE '%' || search_term || '%')
  ),
  clustered_pois AS (
    SELECT
      fp.uuid_id,
      fp.name as poi_name, -- Alias to avoid ambiguity with return column
      fp.category as poi_category, -- Alias to avoid ambiguity
      fp.lat,
      fp.lon,
      fp.geom,
      ST_ClusterDBSCAN(fp.geom, epsilon, 3) OVER () as cid
    FROM filtered_pois fp
  )
  SELECT
    (CASE WHEN cp.cid IS NULL THEN cp.uuid_id ELSE NULL END) as id,
    CASE
      WHEN cp.cid IS NOT NULL THEN 'cluster'
      ELSE 'poi'
    END as type,
    COUNT(*)::INTEGER as count,
    AVG(cp.lat)::DECIMAL(10,8) as latitude,
    AVG(cp.lon)::DECIMAL(11,8) as longitude,
    CASE
      WHEN cp.cid IS NOT NULL THEN NULL
      ELSE MIN(cp.poi_name) -- Use aliased column
    END as name,
    CASE
      WHEN cp.cid IS NOT NULL THEN NULL
      ELSE MIN(cp.poi_category) -- Use aliased column
    END as category
  FROM clustered_pois cp
  GROUP BY cp.cid, (CASE WHEN cp.cid IS NULL THEN cp.uuid_id ELSE NULL END)
  LIMIT limit_count;
END;
$$ LANGUAGE plpgsql;

-- Grant permissions
GRANT EXECUTE ON FUNCTION homolog.get_coordinates_in_bounds TO authenticated;
GRANT EXECUTE ON FUNCTION homolog.get_coordinates_in_bounds TO anon;
GRANT EXECUTE ON FUNCTION homolog.get_coordinates_in_bounds TO service_role;
