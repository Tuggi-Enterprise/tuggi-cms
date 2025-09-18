-- Add image_source column to attractions table
-- This will track the source of the primary image for each attraction

ALTER TABLE core.attractions 
ADD COLUMN IF NOT EXISTS image_source text DEFAULT 'unknown';

-- Create index for better performance
CREATE INDEX IF NOT EXISTS idx_attractions_image_source 
ON core.attractions USING btree (image_source) TABLESPACE pg_default;

-- Add comment for documentation
COMMENT ON COLUMN core.attractions.image_source IS 'Source of the primary image: google_places, wikimedia_commons, or other';

-- Update existing records based on image_url patterns
UPDATE core.attractions 
SET image_source = 'google_places' 
WHERE image_url LIKE '%googleapis.com%' 
AND image_source = 'unknown';

UPDATE core.attractions 
SET image_source = 'wikimedia_commons' 
WHERE image_url LIKE '%commons.wikimedia.org%' 
AND image_source = 'unknown';

-- Update records that have photos_references (Google Places)
UPDATE core.attractions 
SET image_source = 'google_places' 
WHERE photos_references IS NOT NULL 
AND array_length(photos_references, 1) > 0
AND image_source = 'unknown';
