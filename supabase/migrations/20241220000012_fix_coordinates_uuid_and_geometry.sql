-- Fix coordinates table to use native UUID and add location_geography
-- Also ensure boundary_geometry is properly saved

-- Step 1: Add UUID column to coordinates table
ALTER TABLE homolog.coordinates ADD COLUMN IF NOT EXISTS uuid_id UUID DEFAULT gen_random_uuid();

-- Step 2: Add location_geography column with GEOGRAPHY type
ALTER TABLE homolog.coordinates ADD COLUMN IF NOT EXISTS location_geography GEOGRAPHY(POINT, 4326);

-- Step 3: Update existing records to populate location_geography
UPDATE homolog.coordinates 
SET location_geography = ST_SetSRID(ST_MakePoint(longitude, latitude), 4326)::geography
WHERE location_geography IS NULL;

-- Step 4: Create function to automatically populate location_geography
CREATE OR REPLACE FUNCTION homolog.update_coordinates_geography()
RETURNS TRIGGER AS $$
BEGIN
  -- Update location_geography when latitude/longitude changes
  IF NEW.latitude IS NOT NULL AND NEW.longitude IS NOT NULL THEN
    NEW.location_geography = ST_SetSRID(ST_MakePoint(NEW.longitude, NEW.latitude), 4326)::geography;
  END IF;
  
  -- Update boundary_geometry if it's null but we have coordinates
  IF NEW.boundary_geometry IS NULL AND NEW.latitude IS NOT NULL AND NEW.longitude IS NOT NULL THEN
    NEW.boundary_geometry = ST_AsGeoJSON(ST_SetSRID(ST_MakePoint(NEW.longitude, NEW.latitude), 4326));
  END IF;
  
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Step 5: Create trigger to automatically update geography
DROP TRIGGER IF EXISTS update_coordinates_geography_trigger ON homolog.coordinates;
CREATE TRIGGER update_coordinates_geography_trigger
  BEFORE INSERT OR UPDATE ON homolog.coordinates
  FOR EACH ROW
  EXECUTE FUNCTION homolog.update_coordinates_geography();

-- Step 6: Create indexes for better performance
CREATE INDEX IF NOT EXISTS idx_coordinates_uuid_id ON homolog.coordinates(uuid_id);
CREATE INDEX IF NOT EXISTS idx_coordinates_location_geography ON homolog.coordinates USING GIST(location_geography);

-- Step 7: Update the get_coordinates_paginated function to include new fields
DROP FUNCTION IF EXISTS homolog.get_coordinates_paginated CASCADE;

CREATE OR REPLACE FUNCTION homolog.get_coordinates_paginated(
  poi_uuid_filter UUID DEFAULT NULL,
  page_limit INTEGER DEFAULT 50,
  page_offset INTEGER DEFAULT 0
)
RETURNS TABLE (
  id INTEGER,
  uuid_id UUID,
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
    c.uuid_id,
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

-- Step 8: Grant permissions on updated function
GRANT EXECUTE ON FUNCTION homolog.get_coordinates_paginated(UUID, INTEGER, INTEGER) TO authenticated;
GRANT EXECUTE ON FUNCTION homolog.get_coordinates_paginated(UUID, INTEGER, INTEGER) TO service_role;
GRANT EXECUTE ON FUNCTION homolog.get_coordinates_paginated(UUID, INTEGER, INTEGER) TO anon;

-- Step 9: Add comments for documentation
COMMENT ON COLUMN homolog.coordinates.uuid_id IS 'Native UUID for coordinates record';
COMMENT ON COLUMN homolog.coordinates.location_geography IS 'PostGIS geography point for spatial queries';
COMMENT ON COLUMN homolog.coordinates.boundary_geometry IS 'GeoJSON geometry data';
