-- Fix get_coordinates_paginated function to match correct types and parameters

-- Drop existing function first to avoid conflicts
DROP FUNCTION IF EXISTS homolog.get_coordinates_paginated CASCADE;

-- Create corrected function with proper types
CREATE OR REPLACE FUNCTION homolog.get_coordinates_paginated(
  poi_uuid_filter UUID DEFAULT NULL,
  page_limit INTEGER DEFAULT 50,
  page_offset INTEGER DEFAULT 0
)
RETURNS TABLE (
  id INTEGER,
  poi_uuid_id UUID,
  latitude DECIMAL(10,8),
  longitude DECIMAL(11,8),
  elevation_m INTEGER,
  distance_from_sao_paulo_km DECIMAL(8,2),
  distance_from_rio_km DECIMAL(8,2),
  boundary_geometry TEXT,
  boundary_type TEXT,
  boundary_source TEXT,
  boundary_confidence DECIMAL(3,2),
  boundary_area_m2 DECIMAL(12,2),
  boundary_centroid_lat DECIMAL(10,8),
  boundary_centroid_lng DECIMAL(11,8),
  show_in_map BOOLEAN,
  created_at TIMESTAMP WITH TIME ZONE,
  updated_at TIMESTAMP WITH TIME ZONE,
  total_count BIGINT
) AS $$
DECLARE
  total_rows BIGINT;
BEGIN
  -- Calculate total rows for pagination metadata
  SELECT COUNT(*) INTO total_rows
  FROM homolog.coordinates c
  WHERE (poi_uuid_filter IS NULL OR c.poi_uuid_id = poi_uuid_filter);

  RETURN QUERY
  SELECT 
    c.id,
    c.poi_uuid_id,
    c.latitude,
    c.longitude,
    c.elevation_m,
    c.distance_from_sao_paulo_km,
    c.distance_from_rio_km,
    c.boundary_geometry,
    c.boundary_type,
    c.boundary_source,
    c.boundary_confidence,
    c.boundary_area_m2,
    c.boundary_centroid_lat,
    c.boundary_centroid_lng,
    c.show_in_map,
    c.created_at,
    c.updated_at,
    total_rows AS total_count
  FROM homolog.coordinates c
  WHERE 
    (poi_uuid_filter IS NULL OR c.poi_uuid_id = poi_uuid_filter)
  ORDER BY c.created_at DESC
  LIMIT page_limit
  OFFSET page_offset;
END;
$$ LANGUAGE plpgsql;

-- Grant permissions on updated function
GRANT EXECUTE ON FUNCTION homolog.get_coordinates_paginated(UUID, INTEGER, INTEGER) TO authenticated;
GRANT EXECUTE ON FUNCTION homolog.get_coordinates_paginated(UUID, INTEGER, INTEGER) TO service_role;
GRANT EXECUTE ON FUNCTION homolog.get_coordinates_paginated(UUID, INTEGER, INTEGER) TO anon;
