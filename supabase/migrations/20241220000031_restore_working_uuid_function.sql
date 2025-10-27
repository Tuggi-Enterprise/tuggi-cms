-- Restore the working UUID generation function that was working before
-- This uses only native PostgreSQL MD5 function

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

-- Grant permissions
GRANT EXECUTE ON FUNCTION homolog.generate_poi_uuid_with_coords(BIGINT, TEXT, TEXT, DECIMAL, DECIMAL) TO authenticated;
GRANT EXECUTE ON FUNCTION homolog.generate_poi_uuid_with_coords(BIGINT, TEXT, TEXT, DECIMAL, DECIMAL) TO service_role;
