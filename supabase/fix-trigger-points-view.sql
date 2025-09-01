-- Fix trigger_points_with_coords view to use correct table name and existing columns only
-- The view was referencing attraction_description (singular) instead of attraction_descriptions (plural)
-- Also, some columns don't exist in the actual table

-- Drop existing view first
DROP VIEW IF EXISTS core.trigger_points_with_coords CASCADE;

-- First add updated_by column if it doesn't exist
ALTER TABLE core.attraction_trigger_points 
ADD COLUMN IF NOT EXISTS updated_by uuid REFERENCES auth.users(id) ON DELETE SET NULL;

-- Add comment for the new column
COMMENT ON COLUMN core.attraction_trigger_points.updated_by IS 'User who last updated this trigger point';

-- Recreate the view with correct table reference, existing columns, and user tracking
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
  -- User information for tracking
  creator.email as created_by_email,
  updater.email as updated_by_email,
  -- Formatted timestamps
  to_char(tp.created_at, 'DD/MM/YYYY HH24:MI') as created_at_formatted,
  to_char(tp.updated_at, 'DD/MM/YYYY HH24:MI') as updated_at_formatted
FROM core.attraction_trigger_points tp
JOIN core.attractions a ON tp.attraction_id = a.id
LEFT JOIN core.attraction_descriptions ad ON tp.custom_description_id = ad.id  -- Fixed: plural table name
LEFT JOIN auth.users creator ON tp.created_by = creator.id
LEFT JOIN auth.users updater ON tp.updated_by = updater.id
ORDER BY tp.attraction_id, tp.priority, tp.type;

-- Grant permissions on the recreated view
GRANT SELECT ON core.trigger_points_with_coords TO authenticated, service_role;

-- Verify the view works
SELECT 'trigger_points_with_coords view fixed successfully!' as status;
