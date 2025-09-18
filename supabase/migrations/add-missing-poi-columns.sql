-- Add Missing Columns for POI Importer
-- This script adds the columns that the POI importer code expects but are missing from the table

-- ===========================================
-- ADD MISSING COLUMNS TO ATTRACTIONS TABLE
-- ===========================================

-- Add formatted_address column (this is what's causing the current error)
ALTER TABLE core.attractions 
ADD COLUMN IF NOT EXISTS formatted_address text;

-- Add website column (used by POI importer)
ALTER TABLE core.attractions 
ADD COLUMN IF NOT EXISTS website text;

-- Add opening_hours column (used by POI importer)
ALTER TABLE core.attractions 
ADD COLUMN IF NOT EXISTS opening_hours jsonb;

-- Add google_types column (used by POI importer for place types)
ALTER TABLE core.attractions 
ADD COLUMN IF NOT EXISTS google_types text[];

-- Add user_ratings_total column (for rating count from Google Places)
ALTER TABLE core.attractions 
ADD COLUMN IF NOT EXISTS user_ratings_total integer;

-- Add state column (used by POI importer for address parsing)
ALTER TABLE core.attractions 
ADD COLUMN IF NOT EXISTS state text;

-- ===========================================
-- ADD INDEXES FOR PERFORMANCE
-- ===========================================

-- Index for website searches
CREATE INDEX IF NOT EXISTS idx_attractions_website ON core.attractions(website);

-- Index for google_types searches  
CREATE INDEX IF NOT EXISTS idx_attractions_google_types ON core.attractions USING GIN(google_types);

-- Index for user_ratings_total sorting
CREATE INDEX IF NOT EXISTS idx_attractions_user_ratings_total ON core.attractions(user_ratings_total DESC);

-- ===========================================
-- UPDATE RECREATION SCRIPT COMMENT
-- ===========================================

COMMENT ON TABLE core.attractions IS 'Enhanced attractions table with full Google Places API integration and POI importer support';

-- ===========================================
-- VERIFY COLUMNS EXIST
-- ===========================================

SELECT 
  column_name, 
  data_type, 
  is_nullable,
  column_default
FROM information_schema.columns 
WHERE table_schema = 'core' 
  AND table_name = 'attractions'
  AND column_name IN ('formatted_address', 'website', 'opening_hours', 'google_types', 'user_ratings_total', 'state')
ORDER BY column_name;

SELECT 'POI Importer columns added successfully!' as status; 