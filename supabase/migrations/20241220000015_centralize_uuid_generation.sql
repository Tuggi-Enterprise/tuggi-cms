-- Centralize UUID generation in database
-- This ensures all data sources generate consistent UUIDs

-- Step 1: Create function to auto-generate UUID for POIs
CREATE OR REPLACE FUNCTION homolog.generate_poi_uuid_auto()
RETURNS TRIGGER AS $$
BEGIN
  -- Generate UUID only if not provided
  IF NEW.uuid_id IS NULL THEN
    -- Generate UUID based on OSM data only (coordinates are in coordinates table)
    -- Use 0,0 as default coordinates since lat/lon are in coordinates table
    NEW.uuid_id = homolog.generate_poi_uuid(
      NEW.osm_id,
      NEW.osm_type,
      NEW.name,
      0, -- Default lat (coordinates are in coordinates table)
      0  -- Default lon (coordinates are in coordinates table)
    );
  END IF;
  
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Step 2: Create trigger to auto-generate UUID on INSERT
DROP TRIGGER IF EXISTS generate_poi_uuid_trigger ON homolog.pois;
CREATE TRIGGER generate_poi_uuid_trigger
  BEFORE INSERT ON homolog.pois
  FOR EACH ROW
  EXECUTE FUNCTION homolog.generate_poi_uuid_auto();

-- Step 3: Create function to validate UUID consistency
CREATE OR REPLACE FUNCTION homolog.validate_poi_uuid()
RETURNS TRIGGER AS $$
DECLARE
  expected_uuid UUID;
BEGIN
  -- Calculate expected UUID based on OSM data (coordinates are in coordinates table)
  expected_uuid = homolog.generate_poi_uuid(
    NEW.osm_id,
    NEW.osm_type,
    NEW.name,
    0, -- Default lat (coordinates are in coordinates table)
    0  -- Default lon (coordinates are in coordinates table)
  );
  
  -- Validate that provided UUID matches expected UUID
  IF NEW.uuid_id IS NOT NULL AND NEW.uuid_id != expected_uuid THEN
    RAISE EXCEPTION 'UUID mismatch: provided % does not match expected % for OSM data osm_id=%, osm_type=%, name=%', 
      NEW.uuid_id, expected_uuid, NEW.osm_id, NEW.osm_type, NEW.name;
  END IF;
  
  -- Set correct UUID
  NEW.uuid_id = expected_uuid;
  
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Step 4: Create trigger to validate UUID on INSERT/UPDATE
DROP TRIGGER IF EXISTS validate_poi_uuid_trigger ON homolog.pois;
CREATE TRIGGER validate_poi_uuid_trigger
  BEFORE INSERT OR UPDATE ON homolog.pois
  FOR EACH ROW
  EXECUTE FUNCTION homolog.validate_poi_uuid();

-- Step 5: Grant permissions
GRANT EXECUTE ON FUNCTION homolog.generate_poi_uuid_auto() TO authenticated;
GRANT EXECUTE ON FUNCTION homolog.generate_poi_uuid_auto() TO service_role;
GRANT EXECUTE ON FUNCTION homolog.validate_poi_uuid() TO authenticated;
GRANT EXECUTE ON FUNCTION homolog.validate_poi_uuid() TO service_role;

-- Step 6: Add comments
COMMENT ON FUNCTION homolog.generate_poi_uuid_auto() IS 'Auto-generates UUID for POIs based on OSM data';
COMMENT ON FUNCTION homolog.validate_poi_uuid() IS 'Validates and ensures UUID consistency for POIs';
COMMENT ON TRIGGER generate_poi_uuid_trigger ON homolog.pois IS 'Auto-generates UUID on POI insert';
COMMENT ON TRIGGER validate_poi_uuid_trigger ON homolog.pois IS 'Validates UUID consistency on POI insert/update';
