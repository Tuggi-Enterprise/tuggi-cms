-- Create POIs table in homolog schema
-- This table stores OSM POIs imported from files

CREATE SCHEMA IF NOT EXISTS homolog;

CREATE TABLE IF NOT EXISTS homolog.pois (
  id SERIAL PRIMARY KEY,
  
  -- Basic POI information
  name TEXT,
  city TEXT,
  state TEXT,
  country TEXT DEFAULT 'Brazil',
  category TEXT,
  
  -- Geographic coordinates
  lat DECIMAL(10,8) NOT NULL,
  lon DECIMAL(11,8) NOT NULL,
  
  -- OSM specific data
  osm_id BIGINT,
  osm_type TEXT,
  place_id BIGINT,
  
  -- Enrichment data
  formatted_address TEXT,
  importance DECIMAL(5,2),
  
  -- Source information
  source_file TEXT NOT NULL,
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
  
  -- Indexes for performance
  CONSTRAINT pois_lat_check CHECK (lat >= -90 AND lat <= 90),
  CONSTRAINT pois_lon_check CHECK (lon >= -180 AND lon <= 180)
);

-- Create indexes for better performance
CREATE INDEX IF NOT EXISTS idx_pois_location ON homolog.pois USING GIST (ST_Point(lon, lat));
CREATE INDEX IF NOT EXISTS idx_pois_city ON homolog.pois (city);
CREATE INDEX IF NOT EXISTS idx_pois_state ON homolog.pois (state);
CREATE INDEX IF NOT EXISTS idx_pois_category ON homolog.pois (category);
CREATE INDEX IF NOT EXISTS idx_pois_source_file ON homolog.pois (source_file);
CREATE INDEX IF NOT EXISTS idx_pois_created_at ON homolog.pois (created_at);
CREATE INDEX IF NOT EXISTS idx_pois_is_complete ON homolog.pois (is_complete);
CREATE INDEX IF NOT EXISTS idx_pois_processing_status ON homolog.pois (processing_status);

-- Create composite index for common queries
CREATE INDEX IF NOT EXISTS idx_pois_city_state ON homolog.pois (city, state);
CREATE INDEX IF NOT EXISTS idx_pois_category_city ON homolog.pois (category, city);

-- Enable Row Level Security (RLS)
ALTER TABLE homolog.pois ENABLE ROW LEVEL SECURITY;

-- Create RLS policies (adjust based on your auth requirements)
-- For now, allow all operations (you can restrict later)
CREATE POLICY "Allow all operations on pois" ON homolog.pois
  FOR ALL USING (true);

-- Create function to update updated_at timestamp
CREATE OR REPLACE FUNCTION homolog.update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Create trigger to automatically update updated_at
CREATE TRIGGER update_pois_updated_at
  BEFORE UPDATE ON homolog.pois
  FOR EACH ROW
  EXECUTE FUNCTION homolog.update_updated_at_column();

-- Create function to automatically set is_complete flag
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

-- Create trigger to automatically set completeness flags
CREATE TRIGGER set_poi_completeness_trigger
  BEFORE INSERT OR UPDATE ON homolog.pois
  FOR EACH ROW
  EXECUTE FUNCTION homolog.set_poi_completeness();

-- Create view for statistics
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

-- Create function to get POIs with pagination
CREATE OR REPLACE FUNCTION homolog.get_pois_paginated(
  page_limit INTEGER DEFAULT 50,
  page_offset INTEGER DEFAULT 0,
  search_term TEXT DEFAULT NULL,
  city_filter TEXT DEFAULT NULL,
  state_filter TEXT DEFAULT NULL,
  category_filter TEXT DEFAULT NULL,
  only_complete BOOLEAN DEFAULT NULL
)
RETURNS TABLE (
  id INTEGER,
  name TEXT,
  city TEXT,
  state TEXT,
  category TEXT,
  lat DECIMAL(10,8),
  lon DECIMAL(11,8),
  is_complete BOOLEAN,
  has_nominatim_data BOOLEAN,
  source_file TEXT,
  created_at TIMESTAMP WITH TIME ZONE,
  total_count BIGINT
) AS $$
BEGIN
  RETURN QUERY
  WITH filtered_pois AS (
    SELECT p.*, COUNT(*) OVER() as total_count
    FROM homolog.pois p
    WHERE 
      (search_term IS NULL OR 
       p.name ILIKE '%' || search_term || '%' OR
       p.city ILIKE '%' || search_term || '%' OR
       p.state ILIKE '%' || search_term || '%')
      AND (city_filter IS NULL OR p.city = city_filter)
      AND (state_filter IS NULL OR p.state = state_filter)
      AND (category_filter IS NULL OR p.category = category_filter)
      AND (only_complete IS NULL OR p.is_complete = only_complete)
  )
  SELECT 
    fp.id,
    fp.name,
    fp.city,
    fp.state,
    fp.category,
    fp.lat,
    fp.lon,
    fp.is_complete,
    fp.has_nominatim_data,
    fp.source_file,
    fp.created_at,
    fp.total_count
  FROM filtered_pois fp
  ORDER BY fp.created_at DESC
  LIMIT page_limit
  OFFSET page_offset;
END;
$$ LANGUAGE plpgsql;

-- Grant necessary permissions
GRANT USAGE ON SCHEMA homolog TO authenticated;
GRANT ALL ON TABLE homolog.pois TO authenticated;
GRANT USAGE, SELECT ON SEQUENCE homolog.pois_id_seq TO authenticated;
GRANT SELECT ON TABLE homolog.pois_stats TO authenticated;
GRANT EXECUTE ON FUNCTION homolog.get_pois_paginated TO authenticated;

-- Insert sample data for testing (optional)
-- INSERT INTO homolog.pois (name, city, state, lat, lon, source_file, category) VALUES
-- ('Praça da Sé', 'São Paulo', 'SP', -23.5505, -46.6333, 'test_file.geojson', 'tourism=attraction'),
-- ('Cristo Redentor', 'Rio de Janeiro', 'RJ', -22.9519, -43.2105, 'test_file.geojson', 'tourism=attraction');

COMMENT ON TABLE homolog.pois IS 'OSM POIs imported from various file formats';
COMMENT ON COLUMN homolog.pois.is_complete IS 'Indicates if POI has name, city, and state';
COMMENT ON COLUMN homolog.pois.has_nominatim_data IS 'Indicates if POI was enriched with Nominatim data';
COMMENT ON COLUMN homolog.pois.processing_status IS 'Current processing status of the POI';
COMMENT ON COLUMN homolog.pois.osm_properties IS 'Additional OSM properties stored as JSON';
