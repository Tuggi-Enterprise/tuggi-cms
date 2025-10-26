-- Fix primary key to use UUID instead of SERIAL
-- This aligns homolog.pois with production core.attractions structure

-- Step 1: Drop existing foreign key constraint first (to remove dependency)
ALTER TABLE homolog.coordinates DROP CONSTRAINT IF EXISTS coordinates_poi_id_fkey;

-- Step 2: Drop dependent views that use poi_id
DROP VIEW IF EXISTS homolog.coordinates_with_pois CASCADE;

-- Step 3: Drop the old poi_id column from coordinates
ALTER TABLE homolog.coordinates DROP COLUMN IF EXISTS poi_id;

-- Step 4: Drop existing primary key constraint
ALTER TABLE homolog.pois DROP CONSTRAINT IF EXISTS pois_pkey;

-- Step 5: Drop the old id column
ALTER TABLE homolog.pois DROP COLUMN IF EXISTS id;

-- Step 6: Make uuid_id the primary key (if not exists)
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.table_constraints 
        WHERE constraint_name = 'pois_pkey' 
        AND table_name = 'pois' 
        AND table_schema = 'homolog'
    ) THEN
        ALTER TABLE homolog.pois ADD CONSTRAINT pois_pkey PRIMARY KEY (uuid_id);
    END IF;
END $$;

-- Step 7: Make poi_uuid_id the primary foreign key reference (if not exists)
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.table_constraints 
        WHERE constraint_name = 'coordinates_poi_uuid_fkey' 
        AND table_name = 'coordinates' 
        AND table_schema = 'homolog'
    ) THEN
        ALTER TABLE homolog.coordinates ADD CONSTRAINT coordinates_poi_uuid_fkey 
        FOREIGN KEY (poi_uuid_id) REFERENCES homolog.pois(uuid_id) ON DELETE CASCADE;
    END IF;
END $$;

-- Step 8: Update indexes
DROP INDEX IF EXISTS idx_homolog_coordinates_poi_id;
CREATE INDEX IF NOT EXISTS idx_homolog_coordinates_poi_uuid ON homolog.coordinates(poi_uuid_id);

-- Step 9: Recreate the coordinates_with_pois view with UUID
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
  c.created_at as coordinate_created_at,
  c.updated_at as coordinate_updated_at,
  p.uuid_id as poi_uuid,
  p.name as poi_name,
  p.city as poi_city,
  p.state as poi_state,
  p.country as poi_country,
  p.category as poi_category,
  p.lat as poi_lat,
  p.lon as poi_lon,
  p.approved as poi_approved
FROM homolog.coordinates c
LEFT JOIN homolog.pois p ON c.poi_uuid_id = p.uuid_id;

-- Step 10: Update functions to use UUID
-- Drop existing function first to avoid conflicts
DROP FUNCTION IF EXISTS homolog.get_pois_paginated CASCADE;

CREATE OR REPLACE FUNCTION homolog.get_pois_paginated(
  category_filter TEXT DEFAULT NULL,
  city_filter TEXT DEFAULT NULL,
  only_complete BOOLEAN DEFAULT FALSE,
  page_limit INTEGER DEFAULT 50,
  page_offset INTEGER DEFAULT 0,
  search_term TEXT DEFAULT NULL,
  state_filter TEXT DEFAULT NULL
)
RETURNS TABLE (
  uuid_id UUID,
  name TEXT,
  city TEXT,
  state TEXT,
  country TEXT,
  category TEXT,
  lat DECIMAL(10,8),
  lon DECIMAL(11,8),
  osm_id BIGINT,
  osm_type TEXT,
  place_id BIGINT,
  formatted_address TEXT,
  importance DECIMAL(5,2),
  source_file TEXT,
  source_type TEXT,
  is_complete BOOLEAN,
  has_nominatim_data BOOLEAN,
  processing_status TEXT,
  created_at TIMESTAMP WITH TIME ZONE,
  updated_at TIMESTAMP WITH TIME ZONE,
  osm_properties JSONB,
  approved BOOLEAN,
  osm_geometry GEOGRAPHY
) AS $$
BEGIN
  RETURN QUERY
  SELECT 
    p.uuid_id,
    p.name,
    p.city,
    p.state,
    p.country,
    p.category,
    p.lat,
    p.lon,
    p.osm_id,
    p.osm_type,
    p.place_id,
    p.formatted_address,
    p.importance,
    p.source_file,
    p.source_type,
    p.is_complete,
    p.has_nominatim_data,
    p.processing_status,
    p.created_at,
    p.updated_at,
    p.osm_properties,
    p.approved,
    p.osm_geometry
  FROM homolog.pois p
  WHERE 
    (category_filter IS NULL OR p.category = category_filter)
    AND (city_filter IS NULL OR p.city = city_filter)
    AND (state_filter IS NULL OR p.state = state_filter)
    AND (search_term IS NULL OR p.name ILIKE '%' || search_term || '%')
    AND (NOT only_complete OR p.is_complete = TRUE)
  ORDER BY p.created_at DESC
  LIMIT page_limit
  OFFSET page_offset;
END;
$$ LANGUAGE plpgsql;

-- Step 9: Update coordinates functions to use UUID
-- Drop existing function first to avoid conflicts
DROP FUNCTION IF EXISTS homolog.get_coordinates_paginated CASCADE;

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
  elevation_m DECIMAL(8,2),
  distance_from_sao_paulo_km DECIMAL(8,2),
  distance_from_rio_km DECIMAL(8,2),
  boundary_geometry GEOGRAPHY,
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
BEGIN
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
    c.updated_at
  FROM homolog.coordinates c
  WHERE 
    (poi_uuid_filter IS NULL OR c.poi_uuid_id = poi_uuid_filter)
  ORDER BY c.created_at DESC
  LIMIT page_limit
  OFFSET page_offset;
END;
$$ LANGUAGE plpgsql;

-- Step 11: Grant permissions on updated functions
GRANT EXECUTE ON FUNCTION homolog.get_pois_paginated TO authenticated;
GRANT EXECUTE ON FUNCTION homolog.get_pois_paginated TO service_role;
GRANT EXECUTE ON FUNCTION homolog.get_coordinates_paginated TO authenticated;
GRANT EXECUTE ON FUNCTION homolog.get_coordinates_paginated TO service_role;

-- Step 12: Grant permissions on recreated view
GRANT SELECT ON homolog.coordinates_with_pois TO authenticated;
GRANT SELECT ON homolog.coordinates_with_pois TO service_role;
GRANT SELECT ON homolog.coordinates_with_pois TO anon;

-- Step 13: Add comments
COMMENT ON COLUMN homolog.pois.uuid_id IS 'Primary key - Deterministic UUID based on OSM data';
COMMENT ON COLUMN homolog.coordinates.poi_uuid_id IS 'Foreign key reference to pois.uuid_id';
