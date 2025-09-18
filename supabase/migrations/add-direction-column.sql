-- Add direction column to attraction_trigger_points table
-- This column supports simplified direction input for trigger points

-- ===========================================
-- ADD DIRECTION COLUMN
-- ===========================================

ALTER TABLE core.attraction_trigger_points 
ADD COLUMN IF NOT EXISTS direction text CHECK (direction IN ('front', 'right', 'left', 'back'));

-- ===========================================
-- ADD COLUMN COMMENT
-- ===========================================

COMMENT ON COLUMN core.attraction_trigger_points.direction IS 'Simplified direction for POI narration (front, right, left, back). Used for directional audio cues like "To your right..."';

-- ===========================================
-- UPDATE VIEW TO INCLUDE DIRECTION
-- ===========================================

-- Drop the existing view first to avoid column conflicts
DROP VIEW IF EXISTS core.trigger_points_with_coords;

-- Recreate the view with the new direction column
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
  core.get_trigger_point_lat(tp.location) as latitude,
  core.get_trigger_point_lng(tp.location) as longitude,
  a.name as attraction_name,
  ad.description as custom_description
FROM core.attraction_trigger_points tp
JOIN core.attractions a ON tp.attraction_id = a.id
LEFT JOIN core.attraction_descriptions ad ON tp.custom_description_id = ad.id
ORDER BY tp.attraction_id, tp.priority, tp.type;

-- Grant permissions on the recreated view
GRANT SELECT ON core.trigger_points_with_coords TO authenticated, service_role;

-- ===========================================
-- VERIFY COLUMN ADDITION
-- ===========================================

SELECT 
  column_name, 
  data_type, 
  is_nullable,
  column_default
FROM information_schema.columns 
WHERE table_schema = 'core' 
  AND table_name = 'attraction_trigger_points'
  AND column_name = 'direction';

-- ===========================================
-- TEST VALID VALUES
-- ===========================================

-- The following INSERT would work (testing valid values)
-- INSERT INTO core.attraction_trigger_points (attraction_id, location, direction) 
-- VALUES ('test-uuid', ST_SetSRID(ST_MakePoint(-122.4194, 37.7749), 4326)::geography, 'front');

-- The following INSERT would fail (testing invalid values)
-- INSERT INTO core.attraction_trigger_points (attraction_id, location, direction) 
-- VALUES ('test-uuid', ST_SetSRID(ST_MakePoint(-122.4194, 37.7749), 4326)::geography, 'invalid');

SELECT 'Direction column added successfully!' as status; 