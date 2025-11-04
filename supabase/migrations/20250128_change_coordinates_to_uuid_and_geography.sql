-- Change coordinates table to use UUID for id and GEOGRAPHY for boundary_geometry
-- Created: 2025-01-28

-- Step 1: Add new UUID column for id
ALTER TABLE homolog.coordinates ADD COLUMN IF NOT EXISTS uuid_id UUID DEFAULT gen_random_uuid();

-- Step 2: Generate UUIDs for existing records
UPDATE homolog.coordinates SET uuid_id = gen_random_uuid() WHERE uuid_id IS NULL;

-- Step 3: Add new GEOGRAPHY column for boundary_geometry
ALTER TABLE homolog.coordinates ADD COLUMN IF NOT EXISTS boundary_geography GEOGRAPHY;

-- Step 4: Convert existing boundary_geometry TEXT (GeoJSON) to GEOGRAPHY
UPDATE homolog.coordinates
SET boundary_geography = CASE
  WHEN boundary_geometry IS NOT NULL THEN
    ST_GeomFromGeoJSON(boundary_geometry)::GEOGRAPHY
  ELSE NULL
END
WHERE boundary_geometry IS NOT NULL AND boundary_geography IS NULL;

-- Step 5: Drop old PRIMARY KEY constraint on id
ALTER TABLE homolog.coordinates DROP CONSTRAINT IF EXISTS coordinates_pkey;

-- Step 6: Drop the old SERIAL id column (this will also drop the sequence)
ALTER TABLE homolog.coordinates DROP COLUMN IF EXISTS id CASCADE;

-- Step 7: Rename uuid_id to id and make it NOT NULL
ALTER TABLE homolog.coordinates ALTER COLUMN uuid_id SET NOT NULL;
ALTER TABLE homolog.coordinates RENAME COLUMN uuid_id TO id;

-- Step 8: Add PRIMARY KEY constraint on new UUID id
ALTER TABLE homolog.coordinates ADD CONSTRAINT coordinates_pkey PRIMARY KEY (id);

-- Step 9: Drop old boundary_geometry TEXT column
ALTER TABLE homolog.coordinates DROP COLUMN IF EXISTS boundary_geometry;

-- Step 10: Rename boundary_geography to boundary_geometry
ALTER TABLE homolog.coordinates RENAME COLUMN boundary_geography TO boundary_geometry;

-- Step 11: Update indexes if they reference the old id column
-- (Recreate any indexes that might have been dropped)
CREATE INDEX IF NOT EXISTS idx_coordinates_poi_uuid ON homolog.coordinates(poi_uuid_id);
CREATE INDEX IF NOT EXISTS idx_coordinates_location ON homolog.coordinates USING GIST(ST_Point(longitude, latitude)) WHERE latitude IS NOT NULL AND longitude IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_coordinates_boundary_geometry ON homolog.coordinates USING GIST(boundary_geometry) WHERE boundary_geometry IS NOT NULL;

-- Step 12: Update the get_coordinates_paginated function to return UUID id
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
  boundary_geometry TEXT, -- Convert GEOGRAPHY back to GeoJSON TEXT for API compatibility
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
    CASE 
      WHEN c.boundary_geometry IS NOT NULL THEN ST_AsGeoJSON(c.boundary_geometry::geometry)::TEXT
      ELSE NULL
    END AS boundary_geometry,
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

-- Step 13: Grant permissions
GRANT EXECUTE ON FUNCTION homolog.get_coordinates_paginated TO authenticated;
GRANT EXECUTE ON FUNCTION homolog.get_coordinates_paginated TO service_role;

-- Step 14: Create RPC function to upsert coordinates with GEOGRAPHY conversion
CREATE OR REPLACE FUNCTION homolog.upsert_coordinate(
  p_poi_uuid_id UUID,
  p_latitude DECIMAL(10,8),
  p_longitude DECIMAL(11,8),
  p_id UUID DEFAULT gen_random_uuid(),
  p_elevation_m INTEGER DEFAULT NULL,
  p_distance_from_sao_paulo_km DECIMAL(8,2) DEFAULT NULL,
  p_distance_from_rio_km DECIMAL(8,2) DEFAULT NULL,
  p_boundary_geometry_geojson TEXT DEFAULT NULL,
  p_boundary_type TEXT DEFAULT 'point',
  p_boundary_source TEXT DEFAULT 'osm',
  p_boundary_confidence DECIMAL(3,2) DEFAULT NULL,
  p_boundary_area_m2 DECIMAL(12,2) DEFAULT NULL,
  p_boundary_centroid_lat DECIMAL(10,8) DEFAULT NULL,
  p_boundary_centroid_lng DECIMAL(11,8) DEFAULT NULL,
  p_show_in_map BOOLEAN DEFAULT true
) RETURNS TABLE (
  id UUID,
  poi_uuid_id UUID,
  latitude DECIMAL(10,8),
  longitude DECIMAL(11,8),
  elevation_m INTEGER,
  distance_from_sao_paulo_km DECIMAL(8,2),
  distance_from_rio_km DECIMAL(8,2),
  boundary_geometry TEXT, -- Converted back to GeoJSON for API
  boundary_type TEXT,
  boundary_source TEXT,
  boundary_confidence DECIMAL(3,2),
  boundary_area_m2 DECIMAL(12,2),
  boundary_centroid_lat DECIMAL(10,8),
  boundary_centroid_lng DECIMAL(11,8),
  show_in_map BOOLEAN,
  created_at TIMESTAMP WITH TIME ZONE,
  updated_at TIMESTAMP WITH TIME ZONE
) AS $$
DECLARE
  boundary_geography GEOGRAPHY;
BEGIN
  -- Convert GeoJSON string to GEOGRAPHY if provided
  IF p_boundary_geometry_geojson IS NOT NULL THEN
    boundary_geography := ST_GeomFromGeoJSON(p_boundary_geometry_geojson)::GEOGRAPHY;
  ELSE
    boundary_geography := NULL;
  END IF;

  -- Upsert coordinate and return the result
  RETURN QUERY
  INSERT INTO homolog.coordinates (
    id,
    poi_uuid_id,
    latitude,
    longitude,
    elevation_m,
    distance_from_sao_paulo_km,
    distance_from_rio_km,
    boundary_geometry,
    boundary_type,
    boundary_source,
    boundary_confidence,
    boundary_area_m2,
    boundary_centroid_lat,
    boundary_centroid_lng,
    show_in_map
  ) VALUES (
    p_id,
    p_poi_uuid_id,
    p_latitude,
    p_longitude,
    p_elevation_m,
    p_distance_from_sao_paulo_km,
    p_distance_from_rio_km,
    boundary_geography,
    p_boundary_type,
    p_boundary_source,
    p_boundary_confidence,
    p_boundary_area_m2,
    p_boundary_centroid_lat,
    p_boundary_centroid_lng,
    p_show_in_map
  )
  ON CONFLICT (poi_uuid_id) DO UPDATE SET
    latitude = EXCLUDED.latitude,
    longitude = EXCLUDED.longitude,
    elevation_m = EXCLUDED.elevation_m,
    distance_from_sao_paulo_km = EXCLUDED.distance_from_sao_paulo_km,
    distance_from_rio_km = EXCLUDED.distance_from_rio_km,
    boundary_geometry = EXCLUDED.boundary_geometry,
    boundary_type = EXCLUDED.boundary_type,
    boundary_source = EXCLUDED.boundary_source,
    boundary_confidence = EXCLUDED.boundary_confidence,
    boundary_area_m2 = EXCLUDED.boundary_area_m2,
    boundary_centroid_lat = EXCLUDED.boundary_centroid_lat,
    boundary_centroid_lng = EXCLUDED.boundary_centroid_lng,
    show_in_map = EXCLUDED.show_in_map,
    updated_at = NOW()
  RETURNING 
    coordinates.id,
    coordinates.poi_uuid_id,
    coordinates.latitude,
    coordinates.longitude,
    coordinates.elevation_m,
    coordinates.distance_from_sao_paulo_km,
    coordinates.distance_from_rio_km,
    CASE 
      WHEN coordinates.boundary_geometry IS NOT NULL THEN ST_AsGeoJSON(coordinates.boundary_geometry::geometry)::TEXT
      ELSE NULL
    END AS boundary_geometry,
    coordinates.boundary_type,
    coordinates.boundary_source,
    coordinates.boundary_confidence,
    coordinates.boundary_area_m2,
    coordinates.boundary_centroid_lat,
    coordinates.boundary_centroid_lng,
    coordinates.show_in_map,
    coordinates.created_at,
    coordinates.updated_at;
END;
$$ LANGUAGE plpgsql;

-- Step 15: Grant permissions on RPC function
GRANT EXECUTE ON FUNCTION homolog.upsert_coordinate TO authenticated;
GRANT EXECUTE ON FUNCTION homolog.upsert_coordinate TO service_role;

-- Step 16: Update comments
COMMENT ON COLUMN homolog.coordinates.id IS 'UUID primary key';
COMMENT ON COLUMN homolog.coordinates.boundary_geometry IS 'GEOGRAPHY type containing boundary geometry (GeoJSON converted to PostGIS)';
COMMENT ON FUNCTION homolog.upsert_coordinate IS 'Upserts a coordinate, converting GeoJSON boundary_geometry to GEOGRAPHY type';

