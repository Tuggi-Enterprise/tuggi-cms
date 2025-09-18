-- Create Attraction Trigger Points Table
-- This script creates the table for managing trigger points for POI narration activation

-- ===========================================
-- CREATE TRIGGER POINTS TABLE
-- ===========================================

CREATE TABLE IF NOT EXISTS core.attraction_trigger_points (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  attraction_id uuid NOT NULL REFERENCES core.attractions(id) ON DELETE CASCADE,
  location geography(Point, 4326) NOT NULL,
  radius_meters integer DEFAULT 30 CHECK (radius_meters > 0),
  expected_bearing real CHECK (expected_bearing >= 0 AND expected_bearing <= 360),
  bearing_threshold real DEFAULT 30 CHECK (bearing_threshold >= 0 AND bearing_threshold <= 180),
  type text DEFAULT 'primary' CHECK (type IN ('primary', 'fallback', 'entry', 'exit', 'approach', 'custom')),
  priority integer DEFAULT 1 CHECK (priority >= 1),
  custom_description_id uuid REFERENCES core.attraction_description(id) ON DELETE SET NULL,
  is_active boolean DEFAULT true,
  created_at timestamp with time zone DEFAULT now(),
  updated_at timestamp with time zone DEFAULT now(),
  created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL
);

-- ===========================================
-- CREATE INDEXES FOR PERFORMANCE
-- ===========================================

-- Index for attraction lookups
CREATE INDEX IF NOT EXISTS idx_trigger_points_attraction_id 
ON core.attraction_trigger_points(attraction_id);

-- Spatial index for location-based queries
CREATE INDEX IF NOT EXISTS idx_trigger_points_location 
ON core.attraction_trigger_points USING GIST (location);

-- Index for type and priority queries
CREATE INDEX IF NOT EXISTS idx_trigger_points_type_priority 
ON core.attraction_trigger_points(type, priority);

-- Index for active trigger points
CREATE INDEX IF NOT EXISTS idx_trigger_points_active 
ON core.attraction_trigger_points(is_active) WHERE is_active = true;

-- Composite index for efficient trigger point queries
CREATE INDEX IF NOT EXISTS idx_trigger_points_attraction_active_priority 
ON core.attraction_trigger_points(attraction_id, is_active, priority);

-- ===========================================
-- ENABLE ROW LEVEL SECURITY
-- ===========================================

ALTER TABLE core.attraction_trigger_points ENABLE ROW LEVEL SECURITY;

-- ===========================================
-- CREATE RLS POLICIES
-- ===========================================

-- Allow authenticated users to read all trigger points
CREATE POLICY "Authenticated users can read trigger points" 
ON core.attraction_trigger_points FOR SELECT 
TO authenticated 
USING (true);

-- Allow authenticated users to insert trigger points
CREATE POLICY "Authenticated users can insert trigger points" 
ON core.attraction_trigger_points FOR INSERT 
TO authenticated 
WITH CHECK (true);

-- Allow authenticated users to update trigger points
CREATE POLICY "Authenticated users can update trigger points" 
ON core.attraction_trigger_points FOR UPDATE 
TO authenticated 
USING (true)
WITH CHECK (true);

-- Allow authenticated users to delete trigger points
CREATE POLICY "Authenticated users can delete trigger points" 
ON core.attraction_trigger_points FOR DELETE 
TO authenticated 
USING (true);

-- Service role full access
CREATE POLICY "Service role can manage trigger points" 
ON core.attraction_trigger_points FOR ALL 
TO service_role 
USING (true)
WITH CHECK (true);

-- ===========================================
-- GRANT PERMISSIONS
-- ===========================================

-- Grant permissions to authenticated users
GRANT SELECT, INSERT, UPDATE, DELETE ON core.attraction_trigger_points TO authenticated;

-- Grant full permissions to service role
GRANT ALL ON core.attraction_trigger_points TO service_role;

-- ===========================================
-- CREATE TRIGGER FOR UPDATED_AT
-- ===========================================

-- Create or replace the trigger function if it doesn't exist
CREATE OR REPLACE FUNCTION core.handle_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Add trigger for automatic updated_at timestamp
CREATE TRIGGER handle_updated_at 
    BEFORE UPDATE ON core.attraction_trigger_points 
    FOR EACH ROW EXECUTE FUNCTION core.handle_updated_at();

-- ===========================================
-- HELPER FUNCTIONS
-- ===========================================

-- Function to get latitude from geography point
CREATE OR REPLACE FUNCTION core.get_trigger_point_lat(point geography)
RETURNS real AS $$
BEGIN
    RETURN ST_Y(point::geometry);
END;
$$ LANGUAGE plpgsql IMMUTABLE;

-- Function to get longitude from geography point
CREATE OR REPLACE FUNCTION core.get_trigger_point_lng(point geography)
RETURNS real AS $$
BEGIN
    RETURN ST_X(point::geometry);
END;
$$ LANGUAGE plpgsql IMMUTABLE;

-- Function to create geography point from lat/lng
CREATE OR REPLACE FUNCTION core.create_trigger_point(lat real, lng real)
RETURNS geography AS $$
BEGIN
    RETURN ST_SetSRID(ST_MakePoint(lng, lat), 4326)::geography;
END;
$$ LANGUAGE plpgsql IMMUTABLE;

-- ===========================================
-- ADD TABLE COMMENT
-- ===========================================

COMMENT ON TABLE core.attraction_trigger_points IS 'Trigger points for POI narration activation in Tuggi Drive app. Each point defines a geofenced area where TTS should be activated.';

COMMENT ON COLUMN core.attraction_trigger_points.location IS 'Geography point (lat/lng) where the trigger activates';
COMMENT ON COLUMN core.attraction_trigger_points.radius_meters IS 'Activation radius in meters (must be > 0)';
COMMENT ON COLUMN core.attraction_trigger_points.expected_bearing IS 'Expected direction of travel in degrees (0-360), null if omnidirectional';
COMMENT ON COLUMN core.attraction_trigger_points.bearing_threshold IS 'Tolerance in degrees for bearing matching (0-180)';
COMMENT ON COLUMN core.attraction_trigger_points.type IS 'Type of trigger: primary, fallback, entry, exit, approach, custom';
COMMENT ON COLUMN core.attraction_trigger_points.priority IS 'Priority for trigger activation (1 = highest)';
COMMENT ON COLUMN core.attraction_trigger_points.custom_description_id IS 'Optional link to specific audio description';

-- ===========================================
-- CREATE VIEW FOR EASY QUERYING
-- ===========================================

CREATE OR REPLACE VIEW core.trigger_points_with_coords AS
SELECT 
  tp.*,
  core.get_trigger_point_lat(tp.location) as latitude,
  core.get_trigger_point_lng(tp.location) as longitude,
  a.name as attraction_name,
  ad.description as custom_description
FROM core.attraction_trigger_points tp
JOIN core.attractions a ON tp.attraction_id = a.id
LEFT JOIN core.attraction_description ad ON tp.custom_description_id = ad.id
ORDER BY tp.attraction_id, tp.priority, tp.type;

-- Grant permissions on the view
GRANT SELECT ON core.trigger_points_with_coords TO authenticated, service_role;

-- ===========================================
-- SAMPLE DATA (OPTIONAL)
-- ===========================================

-- Example trigger points for testing (uncomment to insert)
/*
INSERT INTO core.attraction_trigger_points (
  attraction_id, 
  location, 
  radius_meters, 
  expected_bearing, 
  bearing_threshold, 
  type, 
  priority
) VALUES 
-- Example data - replace with actual attraction IDs
-- ('existing-attraction-uuid', core.create_trigger_point(37.7749, -122.4194), 50, 45, 30, 'primary', 1),
-- ('existing-attraction-uuid', core.create_trigger_point(37.7750, -122.4195), 30, null, 30, 'fallback', 2);
*/

-- ===========================================
-- VERIFICATION
-- ===========================================

-- Verify table creation
SELECT 
  column_name, 
  data_type, 
  is_nullable,
  column_default
FROM information_schema.columns 
WHERE table_schema = 'core' 
  AND table_name = 'attraction_trigger_points'
ORDER BY ordinal_position;

-- Verify indexes
SELECT 
  indexname, 
  indexdef 
FROM pg_indexes 
WHERE tablename = 'attraction_trigger_points' 
  AND schemaname = 'core';

-- Verify policies
SELECT 
  policyname, 
  permissive, 
  roles, 
  cmd 
FROM pg_policies 
WHERE tablename = 'attraction_trigger_points';

SELECT 'Attraction trigger points table created successfully!' as status; 