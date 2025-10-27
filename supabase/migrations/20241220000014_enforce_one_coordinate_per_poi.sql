-- Enforce 1 POI = 1 Coordinate rule at database level
-- This ensures data integrity and prevents duplicate coordinates

-- Step 1: Add unique constraint on poi_uuid_id in coordinates table
-- This prevents multiple coordinates for the same POI
ALTER TABLE homolog.coordinates 
ADD CONSTRAINT coordinates_poi_uuid_unique UNIQUE (poi_uuid_id);

-- Step 2: Create a function to check if POI exists before inserting coordinates
CREATE OR REPLACE FUNCTION homolog.check_poi_exists(poi_uuid_param UUID)
RETURNS BOOLEAN AS $$
BEGIN
  RETURN EXISTS(SELECT 1 FROM homolog.pois WHERE uuid_id = poi_uuid_param);
END;
$$ LANGUAGE plpgsql;

-- Step 3: Create a function to prevent duplicate coordinates
CREATE OR REPLACE FUNCTION homolog.prevent_duplicate_coordinates()
RETURNS TRIGGER AS $$
BEGIN
  -- Check if POI exists
  IF NOT homolog.check_poi_exists(NEW.poi_uuid_id) THEN
    RAISE EXCEPTION 'Cannot insert coordinate: POI with UUID % does not exist', NEW.poi_uuid_id;
  END IF;
  
  -- Check if coordinate already exists for this POI
  IF EXISTS(SELECT 1 FROM homolog.coordinates WHERE poi_uuid_id = NEW.poi_uuid_id) THEN
    RAISE EXCEPTION 'Cannot insert coordinate: POI with UUID % already has a coordinate (1 POI = 1 Coordinate rule)', NEW.poi_uuid_id;
  END IF;
  
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Step 4: Create trigger to enforce the rule
DROP TRIGGER IF EXISTS prevent_duplicate_coordinates_trigger ON homolog.coordinates;
CREATE TRIGGER prevent_duplicate_coordinates_trigger
  BEFORE INSERT ON homolog.coordinates
  FOR EACH ROW
  EXECUTE FUNCTION homolog.prevent_duplicate_coordinates();

-- Step 5: Create a function to clean up orphaned coordinates
CREATE OR REPLACE FUNCTION homolog.cleanup_orphaned_coordinates()
RETURNS INTEGER AS $$
DECLARE
  deleted_count INTEGER;
BEGIN
  DELETE FROM homolog.coordinates 
  WHERE poi_uuid_id NOT IN (SELECT uuid_id FROM homolog.pois);
  
  GET DIAGNOSTICS deleted_count = ROW_COUNT;
  
  RETURN deleted_count;
END;
$$ LANGUAGE plpgsql;

-- Step 6: Grant permissions
GRANT EXECUTE ON FUNCTION homolog.check_poi_exists(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION homolog.check_poi_exists(UUID) TO service_role;
GRANT EXECUTE ON FUNCTION homolog.prevent_duplicate_coordinates() TO authenticated;
GRANT EXECUTE ON FUNCTION homolog.prevent_duplicate_coordinates() TO service_role;
GRANT EXECUTE ON FUNCTION homolog.cleanup_orphaned_coordinates() TO authenticated;
GRANT EXECUTE ON FUNCTION homolog.cleanup_orphaned_coordinates() TO service_role;

-- Step 7: Add comments
COMMENT ON CONSTRAINT coordinates_poi_uuid_unique ON homolog.coordinates IS 'Ensures 1 POI = 1 Coordinate rule';
COMMENT ON FUNCTION homolog.check_poi_exists(UUID) IS 'Checks if a POI exists before allowing coordinate insertion';
COMMENT ON FUNCTION homolog.prevent_duplicate_coordinates() IS 'Prevents duplicate coordinates for the same POI';
COMMENT ON FUNCTION homolog.cleanup_orphaned_coordinates() IS 'Removes coordinates that reference non-existent POIs';
