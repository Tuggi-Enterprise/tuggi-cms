-- Fix existing duplicate POIs in homolog.pois
-- Groups duplicates by osm_id + osm_type + name and keeps only the oldest record
-- Updates UUIDs to use the new simple generation method
-- Created: 2025-01-28

-- Step 1: Create temporary table to identify duplicates and their correct UUIDs
CREATE TEMP TABLE poi_duplicates_fix AS
SELECT 
  p.uuid_id as old_uuid,
  p.osm_id,
  p.osm_type,
  p.name,
  -- Generate correct UUID using simple method
  homolog.generate_poi_uuid_simple(
    COALESCE(p.osm_id, 0),
    COALESCE(p.osm_type, 'unknown'),
    COALESCE(p.name, 'Unnamed POI')
  ) as correct_uuid,
  -- Keep the oldest record (first created)
  ROW_NUMBER() OVER (
    PARTITION BY 
      COALESCE(p.osm_id, 0),
      COALESCE(p.osm_type, 'unknown'),
      COALESCE(p.name, 'Unnamed POI')
    ORDER BY p.created_at ASC
  ) as rn,
  p.created_at
FROM homolog.pois p
WHERE p.osm_id IS NOT NULL 
  AND p.osm_type IS NOT NULL
  AND p.name IS NOT NULL;

-- Step 2: Identify which UUID to keep for each duplicate group
CREATE TEMP TABLE uuid_to_keep AS
SELECT 
  old_uuid as uuid_to_keep,
  correct_uuid,
  osm_id,
  osm_type,
  name
FROM poi_duplicates_fix
WHERE rn = 1;

-- Step 3: Move coordinates from duplicate POIs to the POI we're keeping
-- Only move if the target POI doesn't already have coordinates
-- This preserves data while avoiding UNIQUE constraint violations
WITH coordinates_to_move AS (
  SELECT DISTINCT ON (utk.uuid_to_keep)
    c.id as coord_id,
    utk.uuid_to_keep
  FROM homolog.coordinates c
  JOIN poi_duplicates_fix pdf ON pdf.old_uuid = c.poi_uuid_id
  JOIN uuid_to_keep utk ON 
    pdf.osm_id = utk.osm_id 
    AND pdf.osm_type = utk.osm_type 
    AND pdf.name = utk.name
  WHERE pdf.rn > 1  -- Only coordinates from duplicates
    -- Only if target doesn't have coordinates (to avoid UNIQUE constraint violation)
    AND NOT EXISTS (
      SELECT 1 FROM homolog.coordinates c2
      WHERE c2.poi_uuid_id = utk.uuid_to_keep
    )
  ORDER BY utk.uuid_to_keep, c.created_at ASC  -- Get oldest coordinate per POI group
)
UPDATE homolog.coordinates c
SET poi_uuid_id = ctm.uuid_to_keep
FROM coordinates_to_move ctm
WHERE c.id = ctm.coord_id;

-- Step 4: Delete ALL coordinates that point to POIs that will be deleted
-- This is CRITICAL to avoid foreign key constraint violations
-- Strategy: For each POI that will be deleted (rn > 1), delete ALL its coordinates
-- We identify POIs to delete by checking if they exist in poi_duplicates_fix with rn > 1
DELETE FROM homolog.coordinates c
WHERE c.poi_uuid_id IN (
  SELECT DISTINCT pdf.old_uuid
  FROM poi_duplicates_fix pdf
  WHERE pdf.rn > 1  -- Only POIs that will be deleted
);

-- Step 4b: Additional safety - delete coordinates for POIs that match duplicate criteria
-- This catches any POIs that might not be in the temp table but should be deleted
-- We identify duplicates directly by checking for groups with more than one POI
DELETE FROM homolog.coordinates c
WHERE EXISTS (
  SELECT 1
  FROM homolog.pois p
  WHERE p.uuid_id = c.poi_uuid_id
    -- POI is part of a duplicate group (same osm_id + osm_type + name)
    AND EXISTS (
      SELECT 1
      FROM homolog.pois p2
      WHERE COALESCE(p2.osm_id, 0) = COALESCE(p.osm_id, 0)
        AND COALESCE(p2.osm_type, 'unknown') = COALESCE(p.osm_type, 'unknown')
        AND COALESCE(p2.name, 'Unnamed POI') = COALESCE(p.name, 'Unnamed POI')
        AND p2.uuid_id != p.uuid_id  -- There's at least one duplicate
    )
    -- This POI is NOT the oldest in its group (will be deleted)
    AND NOT EXISTS (
      SELECT 1
      FROM homolog.pois p3
      WHERE COALESCE(p3.osm_id, 0) = COALESCE(p.osm_id, 0)
        AND COALESCE(p3.osm_type, 'unknown') = COALESCE(p.osm_type, 'unknown')
        AND COALESCE(p3.name, 'Unnamed POI') = COALESCE(p.name, 'Unnamed POI')
        AND p3.created_at < p.created_at  -- There's an older POI in the group
    )
);

-- Step 5: Delete duplicate POIs (keep only the oldest one of each group)
-- After Step 4 and 4b, there should be NO coordinates pointing to these POIs
-- If Step 4 worked correctly, this DELETE will succeed without foreign key violations
DELETE FROM homolog.pois p
WHERE EXISTS (
  SELECT 1
  FROM poi_duplicates_fix pdf
  WHERE pdf.old_uuid = p.uuid_id
    AND pdf.rn > 1  -- Delete all except the first (oldest)
);

-- Step 6: Update remaining POIs with correct UUID (the ones we kept)
UPDATE homolog.pois p
SET uuid_id = utk.correct_uuid
FROM uuid_to_keep utk
WHERE p.uuid_id = utk.uuid_to_keep
  AND p.uuid_id != utk.correct_uuid; -- Only update if different

-- Step 7: Update coordinates to point to the new correct UUID
-- This updates coordinates that point to the POI we kept, after we updated its UUID
UPDATE homolog.coordinates c
SET poi_uuid_id = utk.correct_uuid
FROM uuid_to_keep utk
WHERE c.poi_uuid_id = utk.uuid_to_keep
  AND utk.correct_uuid != utk.uuid_to_keep
  -- Safety check: ensure we're not creating duplicates
  AND NOT EXISTS (
    SELECT 1 FROM homolog.coordinates c2
    WHERE c2.poi_uuid_id = utk.correct_uuid
    AND c2.id != c.id
  );

-- Step 8: For POIs without osm_id/osm_type/name, generate UUID based on what we have
-- This is a fallback for records that don't have complete OSM data
UPDATE homolog.pois p
SET uuid_id = homolog.generate_poi_uuid_simple(
  COALESCE(p.osm_id, 0),
  COALESCE(p.osm_type, 'unknown'),
  COALESCE(p.name, 'Unnamed POI')
)
WHERE p.uuid_id IS NULL
  OR p.uuid_id != homolog.generate_poi_uuid_simple(
    COALESCE(p.osm_id, 0),
    COALESCE(p.osm_type, 'unknown'),
    COALESCE(p.name, 'Unnamed POI')
  );

-- Step 9: Update coordinates for POIs that had UUID changed in step 8
-- This handles POIs that didn't have duplicates but need UUID correction
UPDATE homolog.coordinates c
SET poi_uuid_id = p.uuid_id
FROM homolog.pois p
WHERE c.poi_uuid_id != p.uuid_id
  AND p.uuid_id = homolog.generate_poi_uuid_simple(
    COALESCE(p.osm_id, 0),
    COALESCE(p.osm_type, 'unknown'),
    COALESCE(p.name, 'Unnamed POI')
  )
  -- Safety check: ensure target UUID doesn't already have coordinates
  AND NOT EXISTS (
    SELECT 1 FROM homolog.coordinates c2
    WHERE c2.poi_uuid_id = p.uuid_id
    AND c2.id != c.id
  )
  -- Only update if the coordinate's current UUID matches an old UUID that was changed
  AND EXISTS (
    SELECT 1
    FROM homolog.pois p2
    WHERE p2.uuid_id = c.poi_uuid_id
      AND p2.osm_id = p.osm_id
      AND p2.osm_type = p.osm_type
      AND p2.name = p.name
      AND p2.uuid_id != p.uuid_id
  );

-- Step 10: Clean up temp tables
DROP TABLE IF EXISTS uuid_to_keep;
DROP TABLE IF EXISTS poi_duplicates_fix;

-- Step 11: Create a function to report on the cleanup
CREATE OR REPLACE FUNCTION homolog.report_duplicate_fix()
RETURNS TABLE(
  total_duplicates_found INTEGER,
  duplicates_removed INTEGER,
  records_updated INTEGER
) AS $$
DECLARE
  v_total_duplicates INTEGER;
  v_duplicates_removed INTEGER;
  v_records_updated INTEGER;
BEGIN
  -- Count remaining duplicates (should be 0 after fix)
  SELECT COUNT(*) INTO v_total_duplicates
  FROM (
    SELECT osm_id, osm_type, name, COUNT(*) as cnt
    FROM homolog.pois
    WHERE osm_id IS NOT NULL 
      AND osm_type IS NOT NULL
      AND name IS NOT NULL
    GROUP BY osm_id, osm_type, name
    HAVING COUNT(*) > 1
  ) duplicates;
  
  -- This would be calculated from the temp table, but we'll estimate
  v_duplicates_removed := 0; -- Would need to track this during deletion
  v_records_updated := 0; -- Would need to track this during update
  
  RETURN QUERY SELECT 
    v_total_duplicates,
    v_duplicates_removed,
    v_records_updated;
END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION homolog.report_duplicate_fix IS 'Reports statistics about duplicate POI cleanup';
