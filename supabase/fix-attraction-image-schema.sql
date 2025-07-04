-- Fix attraction_image table schema for POI Importer
-- Add missing columns that the POI importer code expects

-- ===========================================
-- ADD MISSING COLUMNS TO ATTRACTION_IMAGE TABLE
-- ===========================================

-- Add storage_path column (used by POI importer for bucket paths)
ALTER TABLE core.attraction_image 
ADD COLUMN IF NOT EXISTS storage_path text;

-- Add photo_reference column (used by POI importer for Google photo references)
ALTER TABLE core.attraction_image 
ADD COLUMN IF NOT EXISTS photo_reference text;

-- Make image_url nullable (since POI importer may not have URL initially)
ALTER TABLE core.attraction_image 
ALTER COLUMN image_url DROP NOT NULL;

-- ===========================================
-- ADD INDEXES FOR PERFORMANCE
-- ===========================================

-- Index for photo_reference lookups
CREATE INDEX IF NOT EXISTS idx_attraction_image_photo_reference ON core.attraction_image(photo_reference);

-- Index for storage_path lookups
CREATE INDEX IF NOT EXISTS idx_attraction_image_storage_path ON core.attraction_image(storage_path);

-- ===========================================
-- UPDATE TABLE COMMENT
-- ===========================================

COMMENT ON TABLE core.attraction_image IS 'Attraction images with support for Google Places photo references and storage paths';

-- ===========================================
-- VERIFY SCHEMA UPDATE
-- ===========================================

SELECT 
  column_name, 
  data_type, 
  is_nullable,
  column_default
FROM information_schema.columns 
WHERE table_schema = 'core' 
  AND table_name = 'attraction_image'
ORDER BY column_name;

SELECT 'attraction_image schema updated successfully!' as status; 