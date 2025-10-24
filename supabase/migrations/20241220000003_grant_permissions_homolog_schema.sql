-- Grant permissions for homolog schema to authenticated users
-- This allows the frontend to access the homolog schema

-- Grant usage on schema homolog
GRANT USAGE ON SCHEMA homolog TO authenticated;
GRANT USAGE ON SCHEMA homolog TO anon;
GRANT USAGE ON SCHEMA homolog TO service_role;

-- Grant permissions on tables
GRANT ALL ON TABLE homolog.pois TO authenticated;
GRANT ALL ON TABLE homolog.pois TO anon;
GRANT ALL ON TABLE homolog.pois TO service_role;
GRANT ALL ON TABLE homolog.coordinates TO authenticated;
GRANT ALL ON TABLE homolog.coordinates TO anon;
GRANT ALL ON TABLE homolog.coordinates TO service_role;

-- Grant permissions on sequences
GRANT USAGE, SELECT ON SEQUENCE homolog.pois_id_seq TO authenticated;
GRANT USAGE, SELECT ON SEQUENCE homolog.pois_id_seq TO anon;
GRANT USAGE, SELECT ON SEQUENCE homolog.pois_id_seq TO service_role;
GRANT USAGE, SELECT ON SEQUENCE homolog.coordinates_id_seq TO authenticated;
GRANT USAGE, SELECT ON SEQUENCE homolog.coordinates_id_seq TO anon;
GRANT USAGE, SELECT ON SEQUENCE homolog.coordinates_id_seq TO service_role;

-- Grant permissions on views
GRANT SELECT ON homolog.pois_stats TO authenticated;
GRANT SELECT ON homolog.pois_stats TO anon;
GRANT SELECT ON homolog.pois_stats TO service_role;
GRANT SELECT ON homolog.coordinates_with_pois TO authenticated;
GRANT SELECT ON homolog.coordinates_with_pois TO anon;
GRANT SELECT ON homolog.coordinates_with_pois TO service_role;

-- Grant permissions on functions
GRANT EXECUTE ON FUNCTION homolog.get_pois_paginated TO authenticated;
GRANT EXECUTE ON FUNCTION homolog.get_pois_paginated TO anon;
GRANT EXECUTE ON FUNCTION homolog.get_pois_paginated TO service_role;
GRANT EXECUTE ON FUNCTION homolog.get_coordinates_paginated TO authenticated;
GRANT EXECUTE ON FUNCTION homolog.get_coordinates_paginated TO anon;
GRANT EXECUTE ON FUNCTION homolog.get_coordinates_paginated TO service_role;
GRANT EXECUTE ON FUNCTION homolog.get_coordinates_in_bounds TO authenticated;
GRANT EXECUTE ON FUNCTION homolog.get_coordinates_in_bounds TO anon;
GRANT EXECUTE ON FUNCTION homolog.get_coordinates_in_bounds TO service_role;
GRANT EXECUTE ON FUNCTION homolog.calculate_distances TO authenticated;
GRANT EXECUTE ON FUNCTION homolog.calculate_distances TO anon;
GRANT EXECUTE ON FUNCTION homolog.calculate_distances TO service_role;

-- Grant permissions on triggers (if needed)
GRANT EXECUTE ON FUNCTION homolog.update_updated_at_column TO authenticated;
GRANT EXECUTE ON FUNCTION homolog.update_updated_at_column TO anon;
GRANT EXECUTE ON FUNCTION homolog.update_coordinates_updated_at TO authenticated;
GRANT EXECUTE ON FUNCTION homolog.update_coordinates_updated_at TO anon;
GRANT EXECUTE ON FUNCTION homolog.set_poi_completeness TO authenticated;
GRANT EXECUTE ON FUNCTION homolog.set_poi_completeness TO anon;
GRANT EXECUTE ON FUNCTION homolog.auto_calculate_distances TO authenticated;
GRANT EXECUTE ON FUNCTION homolog.auto_calculate_distances TO anon;

-- Update RLS policies to allow access
-- Drop existing policies if they exist
DROP POLICY IF EXISTS "Allow all operations on pois for authenticated" ON homolog.pois;
DROP POLICY IF EXISTS "Allow all operations on coordinates for authenticated" ON homolog.coordinates;
DROP POLICY IF EXISTS "Allow read operations on pois for anon" ON homolog.pois;
DROP POLICY IF EXISTS "Allow read operations on coordinates for anon" ON homolog.coordinates;

-- Allow all operations for authenticated users
CREATE POLICY "Allow all operations on pois for authenticated" ON homolog.pois
  FOR ALL TO authenticated USING (true);

CREATE POLICY "Allow all operations on coordinates for authenticated" ON homolog.coordinates
  FOR ALL TO authenticated USING (true);

-- Allow read operations for anonymous users
CREATE POLICY "Allow read operations on pois for anon" ON homolog.pois
  FOR SELECT TO anon USING (true);

CREATE POLICY "Allow read operations on coordinates for anon" ON homolog.coordinates
  FOR SELECT TO anon USING (true);

-- Allow read operations on views for both authenticated and anonymous
-- Note: Views inherit permissions from underlying tables, but we can create policies if needed
-- CREATE POLICY "Allow read pois_stats for authenticated" ON homolog.pois_stats
--   FOR SELECT TO authenticated USING (true);

-- CREATE POLICY "Allow read pois_stats for anon" ON homolog.pois_stats
--   FOR SELECT TO anon USING (true);

-- CREATE POLICY "Allow read coordinates_with_pois for authenticated" ON homolog.coordinates_with_pois
--   FOR SELECT TO authenticated USING (true);

-- CREATE POLICY "Allow read coordinates_with_pois for anon" ON homolog.coordinates_with_pois
--   FOR SELECT TO anon USING (true);

-- Grant permissions on indexes (if needed)
-- Note: Index permissions are usually inherited from table permissions

-- Create a function to check if user has access to homolog schema
CREATE OR REPLACE FUNCTION homolog.check_schema_access()
RETURNS BOOLEAN AS $$
BEGIN
  -- This function can be used to verify access
  RETURN true;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Grant execute permission on the check function
GRANT EXECUTE ON FUNCTION homolog.check_schema_access TO authenticated;
GRANT EXECUTE ON FUNCTION homolog.check_schema_access TO anon;

-- Add comments for documentation
COMMENT ON SCHEMA homolog IS 'Schema for OSM POI data with full access for authenticated users and read access for anonymous users';
COMMENT ON FUNCTION homolog.check_schema_access IS 'Function to verify access to homolog schema';
