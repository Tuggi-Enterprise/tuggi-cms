-- Recreate pois and coordinates tables with all fields, indexes, RLS, triggers and views
-- This migration recreates everything needed for reimporting data with new UUID rules
-- Created: 2025-01-28

-- Step 1: Ensure UUID extension exists
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- Step 1b: Drop existing tables if they exist (to ensure clean recreation)
DROP TABLE IF EXISTS homolog.coordinates CASCADE;
DROP TABLE IF EXISTS homolog.pois CASCADE;

-- Step 2: Create pois table with UUID as primary key and all fields
CREATE TABLE homolog.pois (
  -- Primary key (UUID-based)
  uuid_id UUID PRIMARY KEY,
  
  -- Basic POI information
  name TEXT,
  city TEXT,
  state TEXT,
  country TEXT DEFAULT 'Brazil',
  category TEXT,
  
  -- Geographic coordinates (stored in coordinates table, but kept here for backward compatibility)
  lat DECIMAL(10,8),
  lon DECIMAL(11,8),
  
  -- OSM specific data
  osm_id BIGINT,
  osm_type TEXT,
  place_id BIGINT,
  
  -- Enrichment data
  formatted_address TEXT,
  importance DECIMAL(5,2),
  
  -- Source information
  source_file TEXT,
  source_type TEXT DEFAULT 'osm', -- 'osm', 'geojson', 'pbf'
  
  -- Processing metadata
  is_complete BOOLEAN DEFAULT FALSE,
  has_nominatim_data BOOLEAN DEFAULT FALSE,
  processing_status TEXT DEFAULT 'pending', -- 'pending', 'processing', 'completed', 'failed'
  
  -- Timestamps
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  
  -- Additional OSM properties (JSONB for flexibility)
  osm_properties JSONB,
  
  -- UUID migration fields
  approved BOOLEAN DEFAULT FALSE,
  osm_geometry GEOGRAPHY,
  
  -- Address fields
  description TEXT,
  neighborhood TEXT,
  street_name TEXT,
  house_number TEXT,
  postal_code TEXT,
  
  -- Category fields
  primary_category TEXT,
  primary_category_type TEXT,
  categories JSONB, -- JSON array of categories
  
  -- Contact fields
  website TEXT,
  contact_phone TEXT,
  contact_email TEXT,
  operator_name TEXT,
  
  -- Brand fields
  brand TEXT,
  brand_wikidata TEXT,
  brand_wikipedia TEXT,
  
  -- Internet fields
  internet_access TEXT,
  internet_access_fee TEXT,
  
  -- Accessibility fields
  wheelchair_accessible TEXT,
  wheelchair_toilets TEXT,
  accessibility_notes TEXT,
  
  -- Physical characteristics
  height DECIMAL(8,2),
  building_material TEXT,
  building_colour TEXT,
  roof_colour TEXT,
  architectural_style TEXT,
  
  -- Historical/Heritage fields
  historic_period TEXT,
  landmark_type TEXT,
  architect TEXT,
  construction_status TEXT,
  start_date TEXT,
  heritage_status TEXT,
  unesco_status TEXT,
  unesco_inscription_date TEXT,
  unesco_reference TEXT,
  landmark_level INTEGER,
  importance_level TEXT,
  
  -- Type-specific fields
  museum_type TEXT,
  museum_collection TEXT,
  museum_audience TEXT,
  museum_education TEXT,
  leisure_type TEXT,
  natural_type TEXT,
  natural_water TEXT,
  sport_facilities TEXT,
  leisure_playground TEXT,
  monument_type TEXT,
  monument_event TEXT,
  monument_person TEXT,
  
  -- Infrastructure fields
  parking_capacity TEXT,
  public_transport TEXT,
  access_points TEXT,
  entrance_fee TEXT,
  
  -- Environmental fields
  urban_density TEXT,
  noise_level TEXT,
  air_quality TEXT,
  shade_availability TEXT,
  
  -- Cultural fields
  cultural_significance TEXT,
  local_traditions TEXT,
  seasonal_attractions TEXT,
  
  -- Tourism flags (boolean fields)
  is_historic BOOLEAN DEFAULT FALSE,
  is_touristic BOOLEAN DEFAULT FALSE,
  has_train BOOLEAN DEFAULT FALSE,
  has_ferry BOOLEAN DEFAULT FALSE,
  has_bus BOOLEAN DEFAULT FALSE,
  has_wheelchair_access BOOLEAN DEFAULT FALSE,
  has_water BOOLEAN DEFAULT FALSE,
  has_fishing BOOLEAN DEFAULT FALSE,
  has_playground BOOLEAN DEFAULT FALSE,
  is_building BOOLEAN DEFAULT FALSE,
  has_ruins BOOLEAN DEFAULT FALSE,
  
  -- Additional fields from create_poi_with_uuid
  opening_hours TEXT,
  wikidata TEXT,
  wikipedia TEXT,
  amenity TEXT,
  building TEXT,
  artwork_type TEXT,
  information TEXT,
  source TEXT,
  landuse TEXT,
  access TEXT,
  ref TEXT,
  type TEXT,
  
  -- Additional PBF analysis fields
  contact_phone_alt TEXT,
  contact_mobile TEXT,
  contact_website_alt TEXT,
  contact_email_alt TEXT,
  contact_facebook TEXT,
  contact_instagram TEXT,
  contact_whatsapp TEXT,
  contact_twitter TEXT,
  contact_youtube TEXT,
  fee TEXT,
  payment_credit_cards TEXT,
  payment_cash TEXT,
  payment_visa TEXT,
  payment_mastercard TEXT,
  rooms INTEGER,
  air_conditioning TEXT,
  smoking TEXT,
  capacity INTEGER,
  pets_allowed TEXT,
  surface TEXT,
  waterway TEXT,
  power TEXT,
  lanes INTEGER,
  maxspeed INTEGER,
  intermittent TEXT,
  layer INTEGER,
  leisure TEXT,
  lit TEXT,
  service TEXT,
  barrier TEXT,
  alt_name TEXT,
  tunnel TEXT,
  bus TEXT,
  place TEXT,
  man_made TEXT,
  source_name TEXT,
  trees TEXT,
  bridge TEXT,
  shop TEXT,
  
  -- Constraints
  CONSTRAINT pois_lat_check CHECK (lat IS NULL OR (lat >= -90 AND lat <= 90)),
  CONSTRAINT pois_lon_check CHECK (lon IS NULL OR (lon >= -180 AND lon <= 180))
);

-- Step 3: Create coordinates table with UUID foreign key
-- Note: uuid_id is already PRIMARY KEY, so UNIQUE constraint is implicit
CREATE TABLE homolog.coordinates (
  id SERIAL PRIMARY KEY,
  
  -- Reference to POI (UUID-based)
  poi_uuid_id UUID NOT NULL REFERENCES homolog.pois(uuid_id) ON DELETE CASCADE,
  
  -- Basic coordinates
  latitude DECIMAL(10,8) NOT NULL,
  longitude DECIMAL(11,8) NOT NULL,
  
  -- Elevation data
  elevation_m INTEGER,
  
  -- Distance calculations
  distance_from_sao_paulo_km DECIMAL(8,2),
  distance_from_rio_km DECIMAL(8,2),
  
  -- Boundary information
  boundary_geometry TEXT, -- GeoJSON string
  boundary_type TEXT, -- 'polygon', 'circle', 'point'
  boundary_source TEXT, -- 'osm', 'nominatim', 'manual'
  boundary_confidence DECIMAL(3,2) CHECK (boundary_confidence >= 0 AND boundary_confidence <= 1),
  boundary_area_m2 DECIMAL(12,2),
  boundary_centroid_lat DECIMAL(10,8),
  boundary_centroid_lng DECIMAL(11,8),
  
  -- Display settings
  show_in_map BOOLEAN DEFAULT true,
  
  -- Timestamps
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  
  -- Constraints
  CONSTRAINT coordinates_lat_check CHECK (latitude >= -90 AND latitude <= 90),
  CONSTRAINT coordinates_lon_check CHECK (longitude >= -180 AND longitude <= 180),
  CONSTRAINT coordinates_elevation_check CHECK (elevation_m IS NULL OR elevation_m >= -500 AND elevation_m <= 10000),
  
  -- UNIQUE constraint: one coordinate per POI
  CONSTRAINT coordinates_poi_uuid_unique UNIQUE (poi_uuid_id)
);

-- Step 4: Create indexes for pois table
CREATE INDEX IF NOT EXISTS idx_pois_location ON homolog.pois USING GIST (ST_Point(lon, lat)) WHERE lon IS NOT NULL AND lat IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_pois_city ON homolog.pois (city);
CREATE INDEX IF NOT EXISTS idx_pois_state ON homolog.pois (state);
CREATE INDEX IF NOT EXISTS idx_pois_category ON homolog.pois (category);
CREATE INDEX IF NOT EXISTS idx_pois_source_file ON homolog.pois (source_file);
CREATE INDEX IF NOT EXISTS idx_pois_created_at ON homolog.pois (created_at);
CREATE INDEX IF NOT EXISTS idx_pois_is_complete ON homolog.pois (is_complete);
CREATE INDEX IF NOT EXISTS idx_pois_processing_status ON homolog.pois (processing_status);
CREATE INDEX IF NOT EXISTS idx_pois_osm_id ON homolog.pois (osm_id);
CREATE INDEX IF NOT EXISTS idx_pois_osm_type ON homolog.pois (osm_type);
CREATE INDEX IF NOT EXISTS idx_pois_approved ON homolog.pois (approved);
CREATE INDEX IF NOT EXISTS idx_pois_geometry ON homolog.pois USING GIST(osm_geometry);
CREATE INDEX IF NOT EXISTS idx_pois_primary_category ON homolog.pois(primary_category);
CREATE INDEX IF NOT EXISTS idx_pois_website ON homolog.pois(website) WHERE website IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_pois_heritage_status ON homolog.pois(heritage_status) WHERE heritage_status IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_pois_unesco_status ON homolog.pois(unesco_status) WHERE unesco_status IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_pois_is_historic ON homolog.pois(is_historic);
CREATE INDEX IF NOT EXISTS idx_pois_is_touristic ON homolog.pois(is_touristic);
CREATE INDEX IF NOT EXISTS idx_pois_has_wheelchair_access ON homolog.pois(has_wheelchair_access);
CREATE INDEX IF NOT EXISTS idx_pois_source ON homolog.pois (source) WHERE source IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_pois_natural_type ON homolog.pois (natural_type) WHERE natural_type IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_pois_landuse ON homolog.pois (landuse) WHERE landuse IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_pois_access ON homolog.pois (access) WHERE access IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_pois_rooms ON homolog.pois (rooms) WHERE rooms IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_pois_capacity ON homolog.pois (capacity) WHERE capacity IS NOT NULL;

-- Composite indexes for common queries
CREATE INDEX IF NOT EXISTS idx_pois_city_state ON homolog.pois (city, state);
CREATE INDEX IF NOT EXISTS idx_pois_category_city ON homolog.pois (category, city);
CREATE INDEX IF NOT EXISTS idx_pois_osm_id_type ON homolog.pois (osm_id, osm_type);

-- Step 5: Create indexes for coordinates table
CREATE INDEX IF NOT EXISTS idx_coordinates_poi_uuid ON homolog.coordinates (poi_uuid_id);
CREATE INDEX IF NOT EXISTS idx_coordinates_location ON homolog.coordinates USING GIST (ST_Point(longitude, latitude));
CREATE INDEX IF NOT EXISTS idx_coordinates_lat_lng ON homolog.coordinates (latitude, longitude);
CREATE INDEX IF NOT EXISTS idx_coordinates_boundary_type ON homolog.coordinates (boundary_type);
CREATE INDEX IF NOT EXISTS idx_coordinates_show_in_map ON homolog.coordinates (show_in_map);
CREATE INDEX IF NOT EXISTS idx_coordinates_created_at ON homolog.coordinates (created_at);

-- Composite indexes for common queries
CREATE INDEX IF NOT EXISTS idx_coordinates_poi_location ON homolog.coordinates (poi_uuid_id, latitude, longitude);
CREATE INDEX IF NOT EXISTS idx_coordinates_boundary ON homolog.coordinates (boundary_type, boundary_confidence);

-- Step 6: Enable Row Level Security (RLS)
ALTER TABLE homolog.pois ENABLE ROW LEVEL SECURITY;
ALTER TABLE homolog.coordinates ENABLE ROW LEVEL SECURITY;

-- Step 7: Create RLS policies
-- Allow all operations for authenticated users
CREATE POLICY "Allow all operations on pois" ON homolog.pois
  FOR ALL USING (true);

CREATE POLICY "Allow all operations on coordinates" ON homolog.coordinates
  FOR ALL USING (true);

-- Step 8: Create functions for automatic timestamp updates
CREATE OR REPLACE FUNCTION homolog.update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION homolog.update_coordinates_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Step 9: Create triggers for automatic timestamp updates
CREATE TRIGGER update_pois_updated_at
  BEFORE UPDATE ON homolog.pois
  FOR EACH ROW
  EXECUTE FUNCTION homolog.update_updated_at_column();

CREATE TRIGGER update_coordinates_updated_at
  BEFORE UPDATE ON homolog.coordinates
  FOR EACH ROW
  EXECUTE FUNCTION homolog.update_coordinates_updated_at();

-- Step 10: Create function to automatically set is_complete flag
CREATE OR REPLACE FUNCTION homolog.set_poi_completeness()
RETURNS TRIGGER AS $$
BEGIN
  -- Set is_complete based on required fields
  NEW.is_complete = (
    NEW.name IS NOT NULL AND 
    NEW.name != '' AND 
    NEW.name != 'Unnamed POI' AND
    NEW.city IS NOT NULL AND 
    NEW.city != '' AND
    NEW.state IS NOT NULL AND 
    NEW.state != ''
  );
  
  -- Set has_nominatim_data flag
  NEW.has_nominatim_data = (
    NEW.formatted_address IS NOT NULL OR
    NEW.importance IS NOT NULL OR
    NEW.place_id IS NOT NULL
  );
  
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Step 11: Create trigger to automatically set completeness flags
CREATE TRIGGER set_poi_completeness_trigger
  BEFORE INSERT OR UPDATE ON homolog.pois
  FOR EACH ROW
  EXECUTE FUNCTION homolog.set_poi_completeness();

-- Step 12: Create function to calculate distances from major cities
CREATE OR REPLACE FUNCTION homolog.calculate_distances(
  lat DECIMAL(10,8),
  lng DECIMAL(11,8)
)
RETURNS TABLE (
  distance_sao_paulo_km DECIMAL(8,2),
  distance_rio_km DECIMAL(8,2)
) AS $$
BEGIN
  RETURN QUERY
  SELECT 
    ROUND(
      (ST_Distance(
        ST_Point(lng, lat)::geography,
        ST_Point(-46.6333, -23.5505)::geography -- São Paulo coordinates
      ) / 1000)::NUMERIC, 2
    )::DECIMAL(8,2) as distance_sao_paulo_km,
    ROUND(
      (ST_Distance(
        ST_Point(lng, lat)::geography,
        ST_Point(-43.2105, -22.9519)::geography -- Rio de Janeiro coordinates
      ) / 1000)::NUMERIC, 2
    )::DECIMAL(8,2) as distance_rio_km;
END;
$$ LANGUAGE plpgsql;

-- Step 13: Create function to automatically calculate distances when inserting coordinates
CREATE OR REPLACE FUNCTION homolog.auto_calculate_distances()
RETURNS TRIGGER AS $$
DECLARE
  distances RECORD;
BEGIN
  -- Calculate distances if not provided
  IF NEW.distance_from_sao_paulo_km IS NULL OR NEW.distance_from_rio_km IS NULL THEN
    SELECT * INTO distances FROM homolog.calculate_distances(NEW.latitude, NEW.longitude);
    
    IF NEW.distance_from_sao_paulo_km IS NULL THEN
      NEW.distance_from_sao_paulo_km := distances.distance_sao_paulo_km;
    END IF;
    
    IF NEW.distance_from_rio_km IS NULL THEN
      NEW.distance_from_rio_km := distances.distance_rio_km;
    END IF;
  END IF;
  
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Step 14: Create trigger to automatically calculate distances
CREATE TRIGGER auto_calculate_distances_trigger
  BEFORE INSERT OR UPDATE ON homolog.coordinates
  FOR EACH ROW
  EXECUTE FUNCTION homolog.auto_calculate_distances();

-- Step 15: Create views
-- View for statistics
CREATE OR REPLACE VIEW homolog.pois_stats AS
SELECT 
  COUNT(*) as total_pois,
  COUNT(*) FILTER (WHERE is_complete = true) as complete_pois,
  COUNT(*) FILTER (WHERE is_complete = false) as incomplete_pois,
  COUNT(*) FILTER (WHERE has_nominatim_data = true) as enriched_pois,
  COUNT(DISTINCT city) as unique_cities,
  COUNT(DISTINCT state) as unique_states,
  COUNT(DISTINCT category) as unique_categories,
  COUNT(DISTINCT source_file) as unique_source_files,
  MIN(created_at) as first_import,
  MAX(created_at) as last_import
FROM homolog.pois;

-- View for coordinates with POI information
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
  c.latitude as poi_lat,
  c.longitude as poi_lon,
  p.approved as poi_approved
FROM homolog.coordinates c
LEFT JOIN homolog.pois p ON c.poi_uuid_id = p.uuid_id;

-- Step 16: Create pagination functions
-- Drop existing functions first to avoid conflicts
-- Use DO block to drop all variations of the functions
DO $$
DECLARE
  func_record RECORD;
BEGIN
  -- Drop all variations of get_pois_paginated
  FOR func_record IN
    SELECT oid::regprocedure as func_name
    FROM pg_proc
    WHERE proname = 'get_pois_paginated'
    AND pronamespace = (SELECT oid FROM pg_namespace WHERE nspname = 'homolog')
  LOOP
    EXECUTE 'DROP FUNCTION IF EXISTS ' || func_record.func_name || ' CASCADE';
  END LOOP;
  
  -- Drop all variations of get_coordinates_paginated
  FOR func_record IN
    SELECT oid::regprocedure as func_name
    FROM pg_proc
    WHERE proname = 'get_coordinates_paginated'
    AND pronamespace = (SELECT oid FROM pg_namespace WHERE nspname = 'homolog')
  LOOP
    EXECUTE 'DROP FUNCTION IF EXISTS ' || func_record.func_name || ' CASCADE';
  END LOOP;
END $$;

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

CREATE OR REPLACE FUNCTION homolog.get_coordinates_paginated(
  poi_uuid_filter UUID DEFAULT NULL,
  page_limit INTEGER DEFAULT 50,
  page_offset INTEGER DEFAULT 0
)
RETURNS TABLE (
  id BIGINT,
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

-- Step 17: Grant permissions
GRANT USAGE ON SCHEMA homolog TO authenticated;
GRANT USAGE ON SCHEMA homolog TO service_role;
GRANT USAGE ON SCHEMA homolog TO anon;

GRANT ALL ON TABLE homolog.pois TO authenticated;
GRANT ALL ON TABLE homolog.pois TO service_role;
GRANT SELECT ON TABLE homolog.pois TO anon;

GRANT ALL ON TABLE homolog.coordinates TO authenticated;
GRANT ALL ON TABLE homolog.coordinates TO service_role;
GRANT SELECT ON TABLE homolog.coordinates TO anon;

GRANT USAGE, SELECT ON SEQUENCE homolog.coordinates_id_seq TO authenticated;
GRANT USAGE, SELECT ON SEQUENCE homolog.coordinates_id_seq TO service_role;

GRANT SELECT ON TABLE homolog.pois_stats TO authenticated;
GRANT SELECT ON TABLE homolog.pois_stats TO service_role;
GRANT SELECT ON TABLE homolog.pois_stats TO anon;

GRANT SELECT ON TABLE homolog.coordinates_with_pois TO authenticated;
GRANT SELECT ON TABLE homolog.coordinates_with_pois TO service_role;
GRANT SELECT ON TABLE homolog.coordinates_with_pois TO anon;

GRANT EXECUTE ON FUNCTION homolog.get_pois_paginated TO authenticated;
GRANT EXECUTE ON FUNCTION homolog.get_pois_paginated TO service_role;
GRANT EXECUTE ON FUNCTION homolog.get_coordinates_paginated TO authenticated;
GRANT EXECUTE ON FUNCTION homolog.get_coordinates_paginated TO service_role;
GRANT EXECUTE ON FUNCTION homolog.calculate_distances TO authenticated;
GRANT EXECUTE ON FUNCTION homolog.calculate_distances TO service_role;

-- Step 18: Add comments for documentation
COMMENT ON TABLE homolog.pois IS 'OSM POIs imported from various file formats';
COMMENT ON COLUMN homolog.pois.uuid_id IS 'Primary key - Deterministic UUID based on OSM data (osm_id + osm_type + name)';
COMMENT ON COLUMN homolog.pois.is_complete IS 'Indicates if POI has name, city, and state';
COMMENT ON COLUMN homolog.pois.has_nominatim_data IS 'Indicates if POI was enriched with Nominatim data';
COMMENT ON COLUMN homolog.pois.processing_status IS 'Current processing status of the POI';
COMMENT ON COLUMN homolog.pois.osm_properties IS 'Additional OSM properties stored as JSON';
COMMENT ON COLUMN homolog.pois.approved IS 'Whether POI is approved for public display';
COMMENT ON COLUMN homolog.pois.osm_geometry IS 'Spatial geometry data for mapping';

COMMENT ON TABLE homolog.coordinates IS 'Coordinate data for POIs with spatial information and boundary data';
COMMENT ON COLUMN homolog.coordinates.poi_uuid_id IS 'Foreign key reference to pois.uuid_id';
COMMENT ON COLUMN homolog.coordinates.boundary_geometry IS 'GeoJSON string containing boundary geometry';
COMMENT ON COLUMN homolog.coordinates.boundary_confidence IS 'Confidence score for boundary data (0.0 to 1.0)';
COMMENT ON COLUMN homolog.coordinates.distance_from_sao_paulo_km IS 'Distance from São Paulo in kilometers';
COMMENT ON COLUMN homolog.coordinates.distance_from_rio_km IS 'Distance from Rio de Janeiro in kilometers';

