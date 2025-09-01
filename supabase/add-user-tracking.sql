-- Add user tracking for trigger points updates
-- This script adds updated_by column and triggers for automatic tracking

-- ===========================================
-- ADD UPDATED_BY COLUMN
-- ===========================================

-- Add updated_by column if it doesn't exist
ALTER TABLE core.attraction_trigger_points 
ADD COLUMN IF NOT EXISTS updated_by uuid REFERENCES auth.users(id) ON DELETE SET NULL;

-- Add comment for the new column
COMMENT ON COLUMN core.attraction_trigger_points.updated_by IS 'User who last updated this trigger point';

-- ===========================================
-- CREATE TRIGGER FOR AUTOMATIC UPDATES
-- ===========================================

-- Function to automatically update updated_at and updated_by on trigger point changes
CREATE OR REPLACE FUNCTION core.update_trigger_point_metadata()
RETURNS trigger AS $$
BEGIN
    -- Always update the timestamp
    NEW.updated_at = now();
    
    -- If this is an update (not insert), try to get current user
    IF TG_OP = 'UPDATE' THEN
        -- Try to get current user from auth.uid() if available
        BEGIN
            NEW.updated_by = auth.uid();
        EXCEPTION
            WHEN others THEN
                -- If auth.uid() fails (e.g., service role), keep existing updated_by
                NEW.updated_by = COALESCE(NEW.updated_by, OLD.updated_by);
        END;
    END IF;
    
    RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Create trigger to call the function on updates
DROP TRIGGER IF EXISTS trigger_update_metadata ON core.attraction_trigger_points;
CREATE TRIGGER trigger_update_metadata
    BEFORE UPDATE ON core.attraction_trigger_points
    FOR EACH ROW
    EXECUTE FUNCTION core.update_trigger_point_metadata();

-- ===========================================
-- UPDATE VIEW TO INCLUDE USER TRACKING
-- ===========================================

-- Drop existing view first
DROP VIEW IF EXISTS core.trigger_points_with_coords CASCADE;

-- Recreate the view with user tracking fields
CREATE VIEW core.trigger_points_with_coords AS
SELECT 
  tp.id,
  tp.attraction_id,
  tp.radius_meters,
  tp.expected_bearing,
  tp.bearing_threshold,
  tp.type,
  tp.priority,
  tp.custom_description_id,
  tp.is_active,
  tp.direction,
  tp.created_at,
  tp.updated_at,
  tp.created_by,
  tp.updated_by,
  -- Calculated coordinates
  core.get_trigger_point_lat(tp.location) as latitude,
  core.get_trigger_point_lng(tp.location) as longitude,
  a.name as attraction_name,
  ad.description as custom_description,
  -- User information
  creator.email as created_by_email,
  updater.email as updated_by_email
FROM core.attraction_trigger_points tp
JOIN core.attractions a ON tp.attraction_id = a.id
LEFT JOIN core.attraction_descriptions ad ON tp.custom_description_id = ad.id
LEFT JOIN auth.users creator ON tp.created_by = creator.id
LEFT JOIN auth.users updater ON tp.updated_by = updater.id
ORDER BY tp.attraction_id, tp.priority, tp.type;

-- Grant permissions on the recreated view
GRANT SELECT ON core.trigger_points_with_coords TO authenticated, service_role;

-- ===========================================
-- ADD INDEX FOR USER TRACKING
-- ===========================================

-- Index for updated_by lookups
CREATE INDEX IF NOT EXISTS idx_trigger_points_updated_by 
ON core.attraction_trigger_points(updated_by);

-- Composite index for user activity tracking
CREATE INDEX IF NOT EXISTS idx_trigger_points_user_activity 
ON core.attraction_trigger_points(updated_by, updated_at) 
WHERE updated_by IS NOT NULL;

-- ===========================================
-- VERIFICATION
-- ===========================================

-- Verify the new column exists
SELECT 
  column_name, 
  data_type, 
  is_nullable,
  column_default
FROM information_schema.columns 
WHERE table_schema = 'core' 
  AND table_name = 'attraction_trigger_points'
  AND column_name IN ('updated_by', 'created_by', 'updated_at')
ORDER BY column_name;

SELECT 'User tracking for trigger points added successfully!' as status;
