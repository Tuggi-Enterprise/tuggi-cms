-- Add last_processed_at field to track when POIs were last processed
-- This helps filter out POIs that were processed but had no new TPs due to duplicates

ALTER TABLE core.attractions 
ADD COLUMN IF NOT EXISTS last_processed_at TIMESTAMP WITH TIME ZONE;

-- Add index for better query performance
CREATE INDEX IF NOT EXISTS idx_attractions_last_processed_at 
ON core.attractions(last_processed_at);

-- Add comment
COMMENT ON COLUMN core.attractions.last_processed_at IS 'Timestamp when this POI was last processed for trigger point generation, regardless of whether new TPs were created';

-- Update existing POIs that have trigger points to set a reasonable last_processed_at
-- This prevents them from appearing in "needs_update" filter
UPDATE core.attractions 
SET last_processed_at = (
  SELECT MAX(created_at) 
  FROM core.attraction_trigger_points 
  WHERE attraction_id = attractions.id
)
WHERE last_processed_at IS NULL 
  AND EXISTS (
    SELECT 1 
    FROM core.attraction_trigger_points 
    WHERE attraction_id = attractions.id
  );

-- Log the update
DO $$
DECLARE
  updated_count INTEGER;
BEGIN
  GET DIAGNOSTICS updated_count = ROW_COUNT;
  RAISE NOTICE 'Updated % POIs with last_processed_at based on existing trigger points', updated_count;
END $$;
