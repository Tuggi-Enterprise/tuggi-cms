-- Fix UUID generation to use real coordinates instead of 0,0
-- This ensures each POI gets a unique UUID based on its actual location

-- Update the UUID generation function to use real coordinates
CREATE OR REPLACE FUNCTION homolog.generate_poi_uuid_with_coords(
  osm_id_val BIGINT,
  osm_type_val TEXT,
  name_val TEXT,
  lat_val DECIMAL(10,8),
  lon_val DECIMAL(11,8)
) RETURNS UUID AS $$
DECLARE
  hash_string TEXT;
  hash_result TEXT;
  uuid_string TEXT;
BEGIN
  -- Create deterministic UUID based on OSM data and coordinates
  hash_string := CONCAT(
    'osm:', osm_id_val, ':', osm_type_val, ':', 
    COALESCE(name_val, ''), ':', lat_val, ':', lon_val
  );
  
  -- Generate MD5 hash
  hash_result := md5(hash_string);
  
  -- Convert to UUID format
  uuid_string := CONCAT(
    SUBSTRING(hash_result, 1, 8), '-',
    SUBSTRING(hash_result, 9, 4), '-',
    SUBSTRING(hash_result, 13, 4), '-',
    SUBSTRING(hash_result, 17, 4), '-',
    SUBSTRING(hash_result, 21, 12)
  );
  
  RETURN uuid_string::UUID;
END;
$$ LANGUAGE plpgsql;

-- Update the auto-generation trigger to use coordinates sent directly
CREATE OR REPLACE FUNCTION homolog.generate_poi_uuid_auto()
RETURNS TRIGGER AS $$
DECLARE
  lat_val DECIMAL(10,8) := 0;
  lon_val DECIMAL(11,8) := 0;
BEGIN
  -- Generate UUID only if not provided
  IF NEW.uuid_id IS NULL THEN
    -- Use coordinates sent directly from the application
    lat_val := COALESCE(NEW.lat, 0);
    lon_val := COALESCE(NEW.lon, 0);
    
    NEW.uuid_id = homolog.generate_poi_uuid_with_coords(
      NEW.osm_id,
      NEW.osm_type,
      NEW.name,
      lat_val,
      lon_val
    );
  END IF;
  
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Update the validation function to use coordinates sent directly
CREATE OR REPLACE FUNCTION homolog.validate_poi_uuid()
RETURNS TRIGGER AS $$
DECLARE
  expected_uuid UUID;
  lat_val DECIMAL(10,8) := 0;
  lon_val DECIMAL(11,8) := 0;
BEGIN
  -- Use coordinates sent directly from the application
  lat_val := COALESCE(NEW.lat, 0);
  lon_val := COALESCE(NEW.lon, 0);
  
  -- Calculate expected UUID based on OSM data and real coordinates
  expected_uuid = homolog.generate_poi_uuid_with_coords(
    NEW.osm_id,
    NEW.osm_type,
    NEW.name,
    lat_val,
    lon_val
  );
  
  -- Validate that provided UUID matches expected UUID
  IF NEW.uuid_id IS NOT NULL AND NEW.uuid_id != expected_uuid THEN
    RAISE EXCEPTION 'UUID mismatch: provided % does not match expected % for OSM data osm_id=%, osm_type=%, name=%, lat=%, lon=%', 
      NEW.uuid_id, expected_uuid, NEW.osm_id, NEW.osm_type, NEW.name, lat_val, lon_val;
  END IF;
  
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Grant permissions
GRANT EXECUTE ON FUNCTION homolog.generate_poi_uuid_with_coords(BIGINT, TEXT, TEXT, DECIMAL, DECIMAL) TO authenticated;
GRANT EXECUTE ON FUNCTION homolog.generate_poi_uuid_with_coords(BIGINT, TEXT, TEXT, DECIMAL, DECIMAL) TO service_role;
GRANT EXECUTE ON FUNCTION homolog.generate_poi_uuid_auto() TO authenticated;
GRANT EXECUTE ON FUNCTION homolog.generate_poi_uuid_auto() TO service_role;
GRANT EXECUTE ON FUNCTION homolog.validate_poi_uuid() TO authenticated;
GRANT EXECUTE ON FUNCTION homolog.validate_poi_uuid() TO service_role;

-- Add comments
COMMENT ON FUNCTION homolog.generate_poi_uuid_with_coords(BIGINT, TEXT, TEXT, DECIMAL, DECIMAL) IS 'Generates deterministic UUID using real coordinates for uniqueness';
COMMENT ON FUNCTION homolog.generate_poi_uuid_auto() IS 'Auto-generates UUID for POIs using real coordinates';
COMMENT ON FUNCTION homolog.validate_poi_uuid() IS 'Validates UUID consistency using real coordinates';
