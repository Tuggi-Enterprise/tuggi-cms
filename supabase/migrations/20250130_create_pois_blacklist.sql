-- Create POI blacklist table in homolog schema
-- This table stores POIs that were deleted and should not be imported again

CREATE TABLE IF NOT EXISTS homolog.pois_blacklist (
  -- Primary key
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  
  -- POI identification (by UUID if available)
  poi_uuid_id UUID,
  
  -- OSM identification (for matching future imports)
  osm_id BIGINT,
  osm_type TEXT,
  
  -- POI basic information (for reference)
  name TEXT,
  city TEXT,
  state TEXT,
  country TEXT,
  category TEXT,
  primary_category TEXT,
  
  -- Exclusion metadata
  reason TEXT DEFAULT 'user_deleted', -- 'user_deleted', 'duplicate', 'invalid', etc.
  excluded_by TEXT DEFAULT 'user', -- 'user', 'system', 'admin'
  excluded_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  
  -- Additional metadata (JSONB for flexibility)
  metadata JSONB,
  
  -- Source file where this POI was originally imported from
  source_file TEXT,
  
  -- Timestamps
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Create indexes for fast lookups
CREATE INDEX IF NOT EXISTS idx_pois_blacklist_poi_uuid ON homolog.pois_blacklist(poi_uuid_id) WHERE poi_uuid_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_pois_blacklist_osm ON homolog.pois_blacklist(osm_id, osm_type) WHERE osm_id IS NOT NULL AND osm_type IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_pois_blacklist_name ON homolog.pois_blacklist(name) WHERE name IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_pois_blacklist_excluded_at ON homolog.pois_blacklist(excluded_at);
CREATE INDEX IF NOT EXISTS idx_pois_blacklist_reason ON homolog.pois_blacklist(reason);

-- Composite index for common queries
CREATE INDEX IF NOT EXISTS idx_pois_blacklist_osm_lookup ON homolog.pois_blacklist(osm_type, osm_id) WHERE osm_type IS NOT NULL AND osm_id IS NOT NULL;

-- UNIQUE constraint to prevent duplicate blacklist entries by OSM ID
-- This ensures the same POI (identified by osm_id + osm_type) can only be blacklisted once
CREATE UNIQUE INDEX IF NOT EXISTS idx_pois_blacklist_osm_unique 
ON homolog.pois_blacklist(osm_id, osm_type) 
WHERE osm_id IS NOT NULL AND osm_type IS NOT NULL;

-- UNIQUE constraint for UUID-based blacklist entries
-- This ensures the same POI (identified by UUID) can only be blacklisted once
CREATE UNIQUE INDEX IF NOT EXISTS idx_pois_blacklist_uuid_unique 
ON homolog.pois_blacklist(poi_uuid_id) 
WHERE poi_uuid_id IS NOT NULL;

-- Enable Row Level Security
ALTER TABLE homolog.pois_blacklist ENABLE ROW LEVEL SECURITY;

-- Create RLS policies
CREATE POLICY "Allow all operations on pois_blacklist" ON homolog.pois_blacklist
  FOR ALL USING (true);

-- Grant permissions
GRANT ALL ON TABLE homolog.pois_blacklist TO authenticated;
GRANT ALL ON TABLE homolog.pois_blacklist TO service_role;
GRANT SELECT ON TABLE homolog.pois_blacklist TO anon;

-- Add comments
COMMENT ON TABLE homolog.pois_blacklist IS 'Blacklist of POIs that were deleted and should not be imported again';
COMMENT ON COLUMN homolog.pois_blacklist.poi_uuid_id IS 'UUID of the POI that was deleted (if available)';
COMMENT ON COLUMN homolog.pois_blacklist.osm_id IS 'OSM ID for matching future imports';
COMMENT ON COLUMN homolog.pois_blacklist.osm_type IS 'OSM type (node, way, relation)';
COMMENT ON COLUMN homolog.pois_blacklist.reason IS 'Reason for blacklisting: user_deleted, duplicate, invalid, etc.';
COMMENT ON COLUMN homolog.pois_blacklist.metadata IS 'Additional metadata stored as JSON';

-- Create function to check if a POI is blacklisted by OSM ID
CREATE OR REPLACE FUNCTION homolog.is_poi_blacklisted(
  p_osm_id BIGINT,
  p_osm_type TEXT
) RETURNS BOOLEAN AS $$
BEGIN
  RETURN EXISTS (
    SELECT 1 FROM homolog.pois_blacklist
    WHERE osm_id = p_osm_id
      AND osm_type = p_osm_type
  );
END;
$$ LANGUAGE plpgsql STABLE;

-- Create function to check if a POI is blacklisted by UUID
CREATE OR REPLACE FUNCTION homolog.is_poi_blacklisted_by_uuid(
  p_uuid_id UUID
) RETURNS BOOLEAN AS $$
BEGIN
  RETURN EXISTS (
    SELECT 1 FROM homolog.pois_blacklist
    WHERE poi_uuid_id = p_uuid_id
  );
END;
$$ LANGUAGE plpgsql STABLE;

-- Grant execute permissions on functions
GRANT EXECUTE ON FUNCTION homolog.is_poi_blacklisted TO authenticated;
GRANT EXECUTE ON FUNCTION homolog.is_poi_blacklisted TO service_role;
GRANT EXECUTE ON FUNCTION homolog.is_poi_blacklisted TO anon;

GRANT EXECUTE ON FUNCTION homolog.is_poi_blacklisted_by_uuid TO authenticated;
GRANT EXECUTE ON FUNCTION homolog.is_poi_blacklisted_by_uuid TO service_role;
GRANT EXECUTE ON FUNCTION homolog.is_poi_blacklisted_by_uuid TO anon;

