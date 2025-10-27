-- Migrate homolog schema to match production structure
-- This migration aligns homolog with core.attractions structure

-- Step 1: Add UUID extension if not exists
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- Step 2: Create function to generate deterministic UUID from OSM data
CREATE OR REPLACE FUNCTION homolog.generate_poi_uuid(
  osm_id_val BIGINT,
  osm_type_val TEXT,
  name_val TEXT,
  lat_val DECIMAL(10,8),
  lon_val DECIMAL(11,8)
) RETURNS UUID AS $$
BEGIN
  -- Create deterministic UUID based on OSM data
  -- This ensures the same POI always gets the same UUID
  RETURN uuid_generate_v5(
    '6ba7b810-9dad-11d1-80b4-00c04fd430c8'::uuid, -- DNS namespace
    CONCAT(
      'osm:', osm_id_val, ':', osm_type_val, ':', 
      COALESCE(name_val, ''), ':', lat_val, ':', lon_val
    )
  );
END;
$$ LANGUAGE plpgsql;

-- Step 3: Add UUID column to pois table
ALTER TABLE homolog.pois ADD COLUMN uuid_id UUID;

-- Step 4: Update coordinates table to reference UUID
ALTER TABLE homolog.coordinates ADD COLUMN poi_uuid_id UUID;

-- Step 5: Populate UUID references
UPDATE homolog.coordinates 
SET poi_uuid_id = p.uuid_id 
FROM homolog.pois p 
WHERE homolog.coordinates.poi_id = p.id;

-- Step 6: Create unique constraint on uuid_id first
ALTER TABLE homolog.pois ADD CONSTRAINT pois_uuid_id_unique UNIQUE (uuid_id);

-- Step 7: Add foreign key constraint for UUID
ALTER TABLE homolog.coordinates 
ADD CONSTRAINT coordinates_poi_uuid_fkey 
FOREIGN KEY (poi_uuid_id) REFERENCES homolog.pois(uuid_id) ON DELETE CASCADE;

-- Step 8: Add only essential fields
ALTER TABLE homolog.pois ADD COLUMN IF NOT EXISTS approved BOOLEAN DEFAULT FALSE;

-- Step 9: Add geometry column for spatial data
ALTER TABLE homolog.pois ADD COLUMN IF NOT EXISTS osm_geometry GEOGRAPHY;

-- Step 10: Create indexes for new fields
CREATE INDEX IF NOT EXISTS idx_homolog_pois_approved ON homolog.pois(approved);
CREATE INDEX IF NOT EXISTS idx_homolog_pois_geometry ON homolog.pois USING GIST(osm_geometry);

-- Step 11: Update coordinates table indexes
CREATE INDEX IF NOT EXISTS idx_homolog_coordinates_poi_uuid ON homolog.coordinates(poi_uuid_id);

-- Step 12: Add constraints (simplified)
-- No additional constraints needed for approved field

-- Step 13: Grant permissions
GRANT ALL ON TABLE homolog.pois TO authenticated;
GRANT ALL ON TABLE homolog.pois TO service_role;
GRANT SELECT ON TABLE homolog.pois TO anon;

GRANT ALL ON TABLE homolog.coordinates TO authenticated;
GRANT ALL ON TABLE homolog.coordinates TO service_role;
GRANT SELECT ON TABLE homolog.coordinates TO anon;

-- Step 14: Add comments
COMMENT ON COLUMN homolog.pois.uuid_id IS 'Deterministic UUID based on OSM data to prevent duplicates';
COMMENT ON COLUMN homolog.pois.approved IS 'Whether POI is approved for public display';
COMMENT ON COLUMN homolog.pois.osm_geometry IS 'Spatial geometry data for mapping';
