-- Make coordinates table use UUID as primary key instead of serial id
-- Remove the serial id column and make uuid_id the primary key

-- Step 1: Drop dependent views first
DROP VIEW IF EXISTS homolog.coordinates_with_pois CASCADE;

-- Step 2: Drop existing primary key constraint
ALTER TABLE homolog.coordinates DROP CONSTRAINT IF EXISTS coordinates_pkey;

-- Step 3: Drop the old serial id column
ALTER TABLE homolog.coordinates DROP COLUMN IF EXISTS id;

-- Step 4: Rename uuid_id to id and make it the primary key
ALTER TABLE homolog.coordinates RENAME COLUMN uuid_id TO id;

-- Step 5: Make id (UUID) the primary key
ALTER TABLE homolog.coordinates ADD CONSTRAINT coordinates_pkey PRIMARY KEY (id);

-- Step 6: Update indexes
DROP INDEX IF EXISTS idx_coordinates_uuid_id;
CREATE INDEX IF NOT EXISTS idx_coordinates_id ON homolog.coordinates(id);

-- Step 7: Update the get_coordinates_paginated function to use UUID id
DROP FUNCTION IF EXISTS homolog.get_coordinates_paginated CASCADE;

CREATE OR REPLACE FUNCTION homolog.get_coordinates_paginated(
  poi_uuid_filter UUID DEFAULT NULL,
  page_limit INTEGER DEFAULT 50,
  page_offset INTEGER DEFAULT 0
)
RETURNS TABLE (
  id UUID,
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
  location_geography GEOGRAPHY,
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
    c.location_geography,
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

-- Step 8: Update the coordinates_with_pois view

CREATE OR REPLACE VIEW homolog.coordinates_with_pois AS
SELECT 
  c.id as coordinate_id,
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
  c.location_geography,
  c.created_at as coordinate_created_at,
  c.updated_at as coordinate_updated_at,
  p.uuid_id as poi_uuid,
  p.name as poi_name,
  p.city as poi_city,
  p.state as poi_state,
  p.country as poi_country,
  p.category as poi_category,
  c.latitude as poi_lat,  -- Use coordinates from coordinates table
  c.longitude as poi_lon, -- Use coordinates from coordinates table
  p.approved as poi_approved
FROM homolog.coordinates c
LEFT JOIN homolog.pois p ON c.poi_uuid_id = p.uuid_id;

-- Step 9: Grant permissions on updated function and view
GRANT EXECUTE ON FUNCTION homolog.get_coordinates_paginated(UUID, INTEGER, INTEGER) TO authenticated;
GRANT EXECUTE ON FUNCTION homolog.get_coordinates_paginated(UUID, INTEGER, INTEGER) TO service_role;
GRANT EXECUTE ON FUNCTION homolog.get_coordinates_paginated(UUID, INTEGER, INTEGER) TO anon;

GRANT SELECT ON homolog.coordinates_with_pois TO authenticated;
GRANT SELECT ON homolog.coordinates_with_pois TO service_role;
GRANT SELECT ON homolog.coordinates_with_pois TO anon;

-- Step 10: Add comments for documentation
COMMENT ON COLUMN homolog.coordinates.id IS 'Primary key - Native UUID for coordinates record';
COMMENT ON COLUMN homolog.coordinates.location_geography IS 'PostGIS geography point for spatial queries';
COMMENT ON COLUMN homolog.coordinates.boundary_geometry IS 'GeoJSON geometry data';
