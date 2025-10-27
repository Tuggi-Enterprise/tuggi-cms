-- UUID generation using only native PostgreSQL functions
-- This works without any external extensions

-- Step 1: Create UUID generation function using only native PostgreSQL
CREATE OR REPLACE FUNCTION homolog.generate_poi_uuid_native(
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
  
  -- Generate MD5 hash (native PostgreSQL function)
  hash_result := md5(hash_string);
  
  -- Convert to UUID format (version 5 style)
  -- Format: xxxxxxxx-xxxx-5xxx-xxxx-xxxxxxxxxxxx
  uuid_string := CONCAT(
    substring(hash_result, 1, 8), '-',
    substring(hash_result, 9, 4), '-',
    '5', substring(hash_result, 14, 3), '-',
    -- Set variant bits (10xx)
    'a', substring(hash_result, 18, 3), '-',
    substring(hash_result, 21, 12)
  );
  
  RETURN uuid_string::UUID;
END;
$$ LANGUAGE plpgsql;

-- Step 2: Update auto-generation function
CREATE OR REPLACE FUNCTION homolog.generate_poi_uuid_auto()
RETURNS TRIGGER AS $$
BEGIN
  -- Generate UUID only if not provided
  IF NEW.uuid_id IS NULL THEN
    NEW.uuid_id = homolog.generate_poi_uuid_native(
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

-- Step 3: Update validation function
CREATE OR REPLACE FUNCTION homolog.validate_poi_uuid()
RETURNS TRIGGER AS $$
DECLARE
  expected_uuid UUID;
BEGIN
  expected_uuid = homolog.generate_poi_uuid_native(
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
GRANT EXECUTE ON FUNCTION homolog.generate_poi_uuid_native(BIGINT, TEXT, TEXT, DECIMAL, DECIMAL) TO authenticated;
GRANT EXECUTE ON FUNCTION homolog.generate_poi_uuid_native(BIGINT, TEXT, TEXT, DECIMAL, DECIMAL) TO service_role;

-- Step 5: Add comments
COMMENT ON FUNCTION homolog.generate_poi_uuid_native(BIGINT, TEXT, TEXT, DECIMAL, DECIMAL) IS 'Generates deterministic UUID using only native PostgreSQL MD5 function';
