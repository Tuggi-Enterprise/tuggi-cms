-- Remove UUID generation and validation triggers
-- These are not needed because the RPC function handles UUID generation

-- Drop existing triggers
DROP TRIGGER IF EXISTS validate_poi_uuid_trigger ON homolog.pois;
DROP TRIGGER IF EXISTS generate_poi_uuid_trigger ON homolog.pois;

-- Drop the functions used by these triggers (but keep the UUID generation function)
DROP FUNCTION IF EXISTS homolog.validate_poi_uuid();
DROP FUNCTION IF EXISTS homolog.generate_poi_uuid_auto();

-- Keep only the core UUID generation function that is used by the RPC
-- homolog.generate_poi_uuid_with_coords() - this is used by the RPC function

-- Add comment
COMMENT ON FUNCTION homolog.generate_poi_uuid_with_coords(BIGINT, TEXT, TEXT, DECIMAL, DECIMAL) IS 'Core UUID generation function - used by RPC create_poi_with_uuid';

