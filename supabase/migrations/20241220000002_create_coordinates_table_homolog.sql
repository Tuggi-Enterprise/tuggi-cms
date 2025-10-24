-- Create coordinates table in homolog schema
-- This table stores coordinate data for POIs with spatial information

CREATE TABLE IF NOT EXISTS homolog.coordinates (
  id SERIAL PRIMARY KEY,
  
  -- Reference to POI
  poi_id INTEGER NOT NULL REFERENCES homolog.pois(id) ON DELETE CASCADE,
  
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
  CONSTRAINT coordinates_elevation_check CHECK (elevation_m IS NULL OR elevation_m >= -500 AND elevation_m <= 10000)
);

-- Add boundary_confidence constraint if it doesn't exist
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.check_constraints 
    WHERE constraint_name = 'coordinates_boundary_confidence_check'
  ) THEN
    ALTER TABLE homolog.coordinates 
    ADD CONSTRAINT coordinates_boundary_confidence_check 
    CHECK (boundary_confidence IS NULL OR boundary_confidence >= 0 AND boundary_confidence <= 1);
  END IF;
END $$;

-- Create indexes for better performance
CREATE INDEX IF NOT EXISTS idx_coordinates_poi_id ON homolog.coordinates (poi_id);
CREATE INDEX IF NOT EXISTS idx_coordinates_location ON homolog.coordinates USING GIST (ST_Point(longitude, latitude));
CREATE INDEX IF NOT EXISTS idx_coordinates_lat_lng ON homolog.coordinates (latitude, longitude);
CREATE INDEX IF NOT EXISTS idx_coordinates_boundary_type ON homolog.coordinates (boundary_type);
CREATE INDEX IF NOT EXISTS idx_coordinates_show_in_map ON homolog.coordinates (show_in_map);
CREATE INDEX IF NOT EXISTS idx_coordinates_created_at ON homolog.coordinates (created_at);

-- Create composite indexes for common queries
CREATE INDEX IF NOT EXISTS idx_coordinates_poi_location ON homolog.coordinates (poi_id, latitude, longitude);
CREATE INDEX IF NOT EXISTS idx_coordinates_boundary ON homolog.coordinates (boundary_type, boundary_confidence);

-- Enable Row Level Security (RLS)
ALTER TABLE homolog.coordinates ENABLE ROW LEVEL SECURITY;

-- Create RLS policies (adjust based on your auth requirements)
-- For now, allow all operations (you can restrict later)
CREATE POLICY "Allow all operations on coordinates" ON homolog.coordinates
  FOR ALL USING (true);

-- Create function to update updated_at timestamp (if not exists)
CREATE OR REPLACE FUNCTION homolog.update_coordinates_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Create trigger to automatically update updated_at (if not exists)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.triggers 
    WHERE trigger_name = 'update_coordinates_updated_at'
  ) THEN
    CREATE TRIGGER update_coordinates_updated_at
      BEFORE UPDATE ON homolog.coordinates
      FOR EACH ROW
      EXECUTE FUNCTION homolog.update_coordinates_updated_at();
  END IF;
END $$;

-- Create function to calculate distances from major cities (if not exists)
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
      ST_Distance(
        ST_Point(lng, lat)::geography,
        ST_Point(-46.6333, -23.5505)::geography -- São Paulo coordinates
      ) / 1000, 2
    )::DECIMAL(8,2) as distance_sao_paulo_km,
    ROUND(
      ST_Distance(
        ST_Point(lng, lat)::geography,
        ST_Point(-43.2105, -22.9519)::geography -- Rio de Janeiro coordinates
      ) / 1000, 2
    )::DECIMAL(8,2) as distance_rio_km;
END;
$$ LANGUAGE plpgsql;

-- Create function to automatically calculate distances when inserting coordinates (if not exists)
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

-- Create trigger to automatically calculate distances (if not exists)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.triggers 
    WHERE trigger_name = 'auto_calculate_distances_trigger'
  ) THEN
    CREATE TRIGGER auto_calculate_distances_trigger
      BEFORE INSERT OR UPDATE ON homolog.coordinates
      FOR EACH ROW
      EXECUTE FUNCTION homolog.auto_calculate_distances();
  END IF;
END $$;

-- Create view for coordinates with POI information
CREATE OR REPLACE VIEW homolog.coordinates_with_pois AS
SELECT 
  c.id,
  c.poi_id,
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
  -- POI information
  p.name as poi_name,
  p.city as poi_city,
  p.state as poi_state,
  p.category as poi_category,
  p.is_complete as poi_is_complete,
  p.has_nominatim_data as poi_has_nominatim_data,
  p.source_file as poi_source_file
FROM homolog.coordinates c
JOIN homolog.pois p ON c.poi_id = p.id
ORDER BY c.created_at DESC;

-- Create function to get coordinates with pagination and filters (if not exists)
CREATE OR REPLACE FUNCTION homolog.get_coordinates_paginated(
  page_limit INTEGER DEFAULT 50,
  page_offset INTEGER DEFAULT 0,
  poi_id_filter INTEGER DEFAULT NULL,
  city_filter TEXT DEFAULT NULL,
  state_filter TEXT DEFAULT NULL,
  category_filter TEXT DEFAULT NULL,
  show_in_map_filter BOOLEAN DEFAULT NULL,
  boundary_type_filter TEXT DEFAULT NULL
)
RETURNS TABLE (
  id INTEGER,
  poi_id INTEGER,
  latitude DECIMAL(10,8),
  longitude DECIMAL(11,8),
  elevation_m INTEGER,
  distance_from_sao_paulo_km DECIMAL(8,2),
  distance_from_rio_km DECIMAL(8,2),
  boundary_type TEXT,
  boundary_confidence DECIMAL(3,2),
  show_in_map BOOLEAN,
  created_at TIMESTAMP WITH TIME ZONE,
  -- POI information
  poi_name TEXT,
  poi_city TEXT,
  poi_state TEXT,
  poi_category TEXT,
  total_count BIGINT
) AS $$
BEGIN
  RETURN QUERY
  WITH filtered_coordinates AS (
    SELECT 
      c.*,
      p.name as poi_name,
      p.city as poi_city,
      p.state as poi_state,
      p.category as poi_category,
      COUNT(*) OVER() as total_count
    FROM homolog.coordinates c
    JOIN homolog.pois p ON c.poi_id = p.id
    WHERE 
      (poi_id_filter IS NULL OR c.poi_id = poi_id_filter)
      AND (city_filter IS NULL OR p.city = city_filter)
      AND (state_filter IS NULL OR p.state = state_filter)
      AND (category_filter IS NULL OR p.category = category_filter)
      AND (show_in_map_filter IS NULL OR c.show_in_map = show_in_map_filter)
      AND (boundary_type_filter IS NULL OR c.boundary_type = boundary_type_filter)
  )
  SELECT 
    fc.id,
    fc.poi_id,
    fc.latitude,
    fc.longitude,
    fc.elevation_m,
    fc.distance_from_sao_paulo_km,
    fc.distance_from_rio_km,
    fc.boundary_type,
    fc.boundary_confidence,
    fc.show_in_map,
    fc.created_at,
    fc.poi_name,
    fc.poi_city,
    fc.poi_state,
    fc.poi_category,
    fc.total_count
  FROM filtered_coordinates fc
  ORDER BY fc.created_at DESC
  LIMIT page_limit
  OFFSET page_offset;
END;
$$ LANGUAGE plpgsql;

-- Create function to get coordinates within a bounding box (if not exists)
CREATE OR REPLACE FUNCTION homolog.get_coordinates_in_bounds(
  min_lat DECIMAL(10,8),
  min_lng DECIMAL(11,8),
  max_lat DECIMAL(10,8),
  max_lng DECIMAL(11,8),
  limit_count INTEGER DEFAULT 1000
)
RETURNS TABLE (
  id INTEGER,
  poi_id INTEGER,
  latitude DECIMAL(10,8),
  longitude DECIMAL(11,8),
  poi_name TEXT,
  poi_city TEXT,
  poi_state TEXT,
  poi_category TEXT
) AS $$
BEGIN
  RETURN QUERY
  SELECT 
    c.id,
    c.poi_id,
    c.latitude,
    c.longitude,
    p.name as poi_name,
    p.city as poi_city,
    p.state as poi_state,
    p.category as poi_category
  FROM homolog.coordinates c
  JOIN homolog.pois p ON c.poi_id = p.id
  WHERE 
    c.latitude >= min_lat 
    AND c.latitude <= max_lat
    AND c.longitude >= min_lng 
    AND c.longitude <= max_lng
    AND c.show_in_map = true
  ORDER BY c.created_at DESC
  LIMIT limit_count;
END;
$$ LANGUAGE plpgsql;

-- Grant necessary permissions
GRANT USAGE ON SCHEMA homolog TO authenticated;
GRANT ALL ON TABLE homolog.coordinates TO authenticated;
GRANT USAGE, SELECT ON SEQUENCE homolog.coordinates_id_seq TO authenticated;
GRANT SELECT ON TABLE homolog.coordinates_with_pois TO authenticated;
GRANT EXECUTE ON FUNCTION homolog.get_coordinates_paginated TO authenticated;
GRANT EXECUTE ON FUNCTION homolog.get_coordinates_in_bounds TO authenticated;
GRANT EXECUTE ON FUNCTION homolog.calculate_distances TO authenticated;

-- Insert sample data for testing (optional)
-- This will be inserted when POIs are created

COMMENT ON TABLE homolog.coordinates IS 'Coordinate data for POIs with spatial information and boundary data';
COMMENT ON COLUMN homolog.coordinates.boundary_geometry IS 'GeoJSON string containing boundary geometry';
COMMENT ON COLUMN homolog.coordinates.boundary_confidence IS 'Confidence score for boundary data (0.0 to 1.0)';
COMMENT ON COLUMN homolog.coordinates.distance_from_sao_paulo_km IS 'Distance from São Paulo in kilometers';
COMMENT ON COLUMN homolog.coordinates.distance_from_rio_km IS 'Distance from Rio de Janeiro in kilometers';
