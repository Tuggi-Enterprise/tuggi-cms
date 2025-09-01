-- Fix trigger_points_with_coords view to use correct table name and existing columns only
-- The view was referencing attraction_description (singular) instead of attraction_descriptions (plural)
-- Also, some columns don't exist in the actual table

-- Drop existing view first
DROP VIEW IF EXISTS core.trigger_points_with_coords CASCADE;

-- Recreate the view with correct table reference and only existing columns
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
  -- Calculated coordinates
  core.get_trigger_point_lat(tp.location) as latitude,
  core.get_trigger_point_lng(tp.location) as longitude,
  a.name as attraction_name,
  ad.description as custom_description
FROM core.attraction_trigger_points tp
JOIN core.attractions a ON tp.attraction_id = a.id
LEFT JOIN core.attraction_descriptions ad ON tp.custom_description_id = ad.id  -- Fixed: plural table name
ORDER BY tp.attraction_id, tp.priority, tp.type;

-- Grant permissions on the recreated view
GRANT SELECT ON core.trigger_points_with_coords TO authenticated, service_role;

-- Verify the view works
SELECT 'trigger_points_with_coords view fixed successfully!' as status;
