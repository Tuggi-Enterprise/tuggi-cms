-- Migration: OSM Importer Paginated Query v2
-- Adds server-side filtering and proper pagination
-- Date: 2026-01-07 14:00:00

-- Drop existing function to update signature
DROP FUNCTION IF EXISTS homolog.get_pois_paginated_v2;

-- Create optimized paginated function with server-side filtering
CREATE OR REPLACE FUNCTION homolog.get_pois_paginated_v2(
  p_page INTEGER DEFAULT 1,
  p_limit INTEGER DEFAULT 50,
  p_search TEXT DEFAULT NULL,
  p_state TEXT DEFAULT NULL,
  p_city TEXT DEFAULT NULL,
  p_category TEXT DEFAULT NULL
)
RETURNS TABLE (
  uuid_id UUID,
  name TEXT,
  city TEXT,
  state TEXT,
  country TEXT,
  lat DECIMAL(10,8),
  lon DECIMAL(11,8),
  primary_category TEXT,
  category TEXT,
  osm_id BIGINT,
  osm_type TEXT,
  created_at TIMESTAMPTZ,
  updated_at TIMESTAMPTZ,
  -- Pagination metadata
  total_count BIGINT,
  total_pages INTEGER,
  current_page INTEGER
) AS $$
DECLARE
  v_offset INTEGER;
  v_total BIGINT;
  v_total_pages INTEGER;
BEGIN
  -- Calculate offset
  v_offset := (p_page - 1) * p_limit;
  
  -- Get total count with filters (for pagination info)
  SELECT COUNT(*) INTO v_total
  FROM homolog.pois p
  WHERE 
    (p_state IS NULL OR p.state = p_state)
    AND (p_city IS NULL OR p.city = p_city)
    AND (p_category IS NULL OR p.category = p_category OR p.primary_category = p_category)
    AND (p_search IS NULL OR 
         p.name ILIKE '%' || p_search || '%' OR 
         p.city ILIKE '%' || p_search || '%' OR
         p.state ILIKE '%' || p_search || '%');
  
  -- Calculate total pages
  v_total_pages := CEIL(v_total::NUMERIC / p_limit);
  
  -- Return paginated results
  RETURN QUERY
  SELECT 
    p.uuid_id,
    p.name,
    p.city,
    p.state,
    p.country,
    p.lat,
    p.lon,
    p.primary_category,
    p.category,
    p.osm_id,
    p.osm_type,
    p.created_at,
    p.updated_at,
    v_total AS total_count,
    v_total_pages AS total_pages,
    p_page AS current_page
  FROM homolog.pois p
  WHERE 
    (p_state IS NULL OR p.state = p_state)
    AND (p_city IS NULL OR p.city = p_city)
    AND (p_category IS NULL OR p.category = p_category OR p.primary_category = p_category)
    AND (p_search IS NULL OR 
         p.name ILIKE '%' || p_search || '%' OR 
         p.city ILIKE '%' || p_search || '%' OR
         p.state ILIKE '%' || p_search || '%')
  ORDER BY p.name ASC
  LIMIT p_limit
  OFFSET v_offset;
END;
$$ LANGUAGE plpgsql;

-- Create indexes for filter columns (if not exist)
CREATE INDEX IF NOT EXISTS idx_pois_state ON homolog.pois(state);
CREATE INDEX IF NOT EXISTS idx_pois_city ON homolog.pois(city);
CREATE INDEX IF NOT EXISTS idx_pois_category ON homolog.pois(category);
CREATE INDEX IF NOT EXISTS idx_pois_primary_category ON homolog.pois(primary_category);
CREATE INDEX IF NOT EXISTS idx_pois_name_trgm ON homolog.pois USING gin(name gin_trgm_ops);

-- Grant permissions
GRANT EXECUTE ON FUNCTION homolog.get_pois_paginated_v2 TO authenticated;
GRANT EXECUTE ON FUNCTION homolog.get_pois_paginated_v2 TO anon;
GRANT EXECUTE ON FUNCTION homolog.get_pois_paginated_v2 TO service_role;

-- Also create a function to get distinct filter values efficiently
DROP FUNCTION IF EXISTS homolog.get_filter_options;

CREATE OR REPLACE FUNCTION homolog.get_filter_options(
  p_state TEXT DEFAULT NULL
)
RETURNS TABLE (
  states TEXT[],
  cities TEXT[],
  categories TEXT[],
  total_count BIGINT
) AS $$
BEGIN
  RETURN QUERY
  SELECT 
    (SELECT ARRAY_AGG(DISTINCT p.state ORDER BY p.state) 
     FROM homolog.pois p 
     WHERE p.state IS NOT NULL AND p.state != '') AS states,
    (SELECT ARRAY_AGG(DISTINCT p.city ORDER BY p.city) 
     FROM homolog.pois p 
     WHERE p.city IS NOT NULL AND p.city != ''
     AND (p_state IS NULL OR p.state = p_state)) AS cities,
    (SELECT ARRAY_AGG(DISTINCT COALESCE(p.primary_category, p.category) ORDER BY COALESCE(p.primary_category, p.category)) 
     FROM homolog.pois p 
     WHERE COALESCE(p.primary_category, p.category) IS NOT NULL) AS categories,
    (SELECT COUNT(*) FROM homolog.pois) AS total_count;
END;
$$ LANGUAGE plpgsql;

GRANT EXECUTE ON FUNCTION homolog.get_filter_options TO authenticated;
GRANT EXECUTE ON FUNCTION homolog.get_filter_options TO anon;
GRANT EXECUTE ON FUNCTION homolog.get_filter_options TO service_role;
