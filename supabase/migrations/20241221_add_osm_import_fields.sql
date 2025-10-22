-- Add OSM Import Fields and File Management
-- Migration: 20241221_add_osm_import_fields.sql

-- ===========================================
-- ADD OSM FIELDS TO ATTRACTIONS TABLE
-- ===========================================

-- Add osm_type column (osm_id already exists as text)
ALTER TABLE core.attractions 
ADD COLUMN IF NOT EXISTS osm_type text CHECK (osm_type IN ('node', 'way', 'relation'));

-- Add composite unique constraint for OSM ID + Type
CREATE UNIQUE INDEX IF NOT EXISTS idx_attractions_osm_composite 
ON core.attractions(osm_type, osm_id) 
WHERE osm_type IS NOT NULL AND osm_id IS NOT NULL;

-- ===========================================
-- OSM IMPORT BATCHES TABLE
-- ===========================================

CREATE TABLE IF NOT EXISTS core.osm_import_batches (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  source_file text NOT NULL,
  file_type text CHECK (file_type IN ('pbf', 'geojson')),
  filter_config jsonb,
  total_processed integer DEFAULT 0,
  successful_imports integer DEFAULT 0,
  skipped_duplicates integer DEFAULT 0,
  failed_count integer DEFAULT 0,
  processing_time_ms integer,
  created_at timestamptz DEFAULT now(),
  created_by uuid REFERENCES core.cms_users(id),
  metadata jsonb,
  status text DEFAULT 'pending' CHECK (status IN ('pending', 'processing', 'completed', 'failed', 'rolled_back'))
);

-- ===========================================
-- OSM FILES TRACKING TABLE
-- ===========================================

CREATE TABLE IF NOT EXISTS core.osm_files (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  
  -- File info
  filename text NOT NULL,
  original_filename text,
  file_path text NOT NULL UNIQUE,
  file_type text CHECK (file_type IN ('pbf', 'geojson')),
  file_size_bytes bigint,
  
  -- Classification
  source_type text CHECK (source_type IN ('raw', 'processed', 'uploaded')),
  category text, -- 'tourism', 'historic', etc.
  region text,   -- 'sp', 'rj', 'brasil', etc.
  
  -- Processing metadata
  feature_count integer,
  bounding_box jsonb, -- {north, south, east, west}
  tags_summary jsonb, -- count per OSM tag
  
  -- Status
  status text DEFAULT 'available' CHECK (status IN ('available', 'processing', 'error', 'archived')),
  error_message text,
  
  -- Audit
  created_at timestamptz DEFAULT now(),
  created_by uuid REFERENCES core.cms_users(id),
  last_accessed_at timestamptz,
  access_count integer DEFAULT 0,
  
  -- Relations
  processed_from_id uuid REFERENCES core.osm_files(id), -- if derived from another file
  import_batches_count integer DEFAULT 0
);

-- ===========================================
-- INDEXES FOR PERFORMANCE
-- ===========================================

-- OSM Import Batches indexes
CREATE INDEX IF NOT EXISTS idx_osm_import_batches_status ON core.osm_import_batches(status);
CREATE INDEX IF NOT EXISTS idx_osm_import_batches_created_at ON core.osm_import_batches(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_osm_import_batches_created_by ON core.osm_import_batches(created_by);

-- OSM Files indexes
CREATE INDEX IF NOT EXISTS idx_osm_files_type ON core.osm_files(file_type);
CREATE INDEX IF NOT EXISTS idx_osm_files_source_type ON core.osm_files(source_type);
CREATE INDEX IF NOT EXISTS idx_osm_files_category ON core.osm_files(category);
CREATE INDEX IF NOT EXISTS idx_osm_files_status ON core.osm_files(status);
CREATE INDEX IF NOT EXISTS idx_osm_files_created_at ON core.osm_files(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_osm_files_created_by ON core.osm_files(created_by);

-- ===========================================
-- COMMENTS
-- ===========================================

COMMENT ON TABLE core.osm_import_batches IS 'Tracks OSM data import operations and their results';
COMMENT ON TABLE core.osm_files IS 'Tracks all OSM files (PBF/GeoJSON) with metadata and processing status';
COMMENT ON COLUMN core.attractions.osm_type IS 'OSM element type: node, way, or relation';
COMMENT ON COLUMN core.attractions.osm_id IS 'OSM element ID (text format for composite uniqueness)';
