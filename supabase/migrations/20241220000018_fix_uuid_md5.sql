-- Fix UUID generation using MD5 hash approach
-- This uses only native PostgreSQL functions

-- Step 1: Create a simple UUID generation function using MD5
CREATE OR REPLACE FUNCTION homolog.generate_poi_uuid_md5(
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
  -- Create hash string from OSM data
  hash_string := CONCAT(
    'osm:', osm_id_val, ':', osm_type_val, ':', 
    COALESCE(name_val, ''), ':', lat_val, ':', lon_val
  );
  
  -- Generate MD5 hash
  hash_result := md5(hash_string);
  
  -- Convert to UUID format (version 5 style)
  uuid_string := CONCAT(
    substring(hash_result, 1, 8), '-',
    substring(hash_result, 9, 4), '-',
    '5', substring(hash_result, 14, 3), '-',
    lpad((('x' || substring(hash_result, 17, 1))::bit(4) | '1000'::bit(4))::text, 1, '0'),
    substring(hash_result, 18, 3), '-',
    substring(hash_result, 21, 12)
  );
  
  RETURN uuid_string::UUID;
END;
$$ LANGUAGE plpgsql;

-- Step 2: Update the auto-generation function to use MD5
CREATE OR REPLACE FUNCTION homolog.generate_poi_uuid_auto()
RETURNS TRIGGER AS $$
BEGIN
  -- Generate UUID only if not provided
  IF NEW.uuid_id IS NULL THEN
    -- Generate UUID based on OSM data only (coordinates are in coordinates table)
    NEW.uuid_id = homolog.generate_poi_uuid_md5(
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

-- Step 3: Update the validation function to use MD5
CREATE OR REPLACE FUNCTION homolog.validate_poi_uuid()
RETURNS TRIGGER AS $$
DECLARE
  expected_uuid UUID;
BEGIN
  -- Calculate expected UUID based on OSM data (coordinates are in coordinates table)
  expected_uuid = homolog.generate_poi_uuid_md5(
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

-- Step 4: Grant permissions
GRANT EXECUTE ON FUNCTION homolog.generate_poi_uuid_md5(BIGINT, TEXT, TEXT, DECIMAL, DECIMAL) TO authenticated;
GRANT EXECUTE ON FUNCTION homolog.generate_poi_uuid_md5(BIGINT, TEXT, TEXT, DECIMAL, DECIMAL) TO service_role;

-- Step 5: Add comments
COMMENT ON FUNCTION homolog.generate_poi_uuid_md5(BIGINT, TEXT, TEXT, DECIMAL, DECIMAL) IS 'Generates deterministic UUID using MD5 hash approach';
