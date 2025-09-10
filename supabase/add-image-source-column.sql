-- Add image_source column to attraction_image table
-- This will track whether the image came from Google Places, Wikimedia Commons, or other sources

ALTER TABLE core.attraction_image 
ADD COLUMN IF NOT EXISTS image_source text DEFAULT 'unknown';

-- Create index for better performance
CREATE INDEX IF NOT EXISTS idx_attraction_image_source 
ON core.attraction_image USING btree (image_source) TABLESPACE pg_default;

-- Add comment for documentation
COMMENT ON COLUMN core.attraction_image.image_source IS 'Source of the image: google_places, wikimedia_commons, or other';

-- Update existing records to have proper source
UPDATE core.attraction_image 
SET image_source = 'google_places' 
WHERE photo_reference IS NOT NULL 
AND image_source = 'unknown';

-- Update records with Wikimedia Commons URLs
UPDATE core.attraction_image 
SET image_source = 'wikimedia_commons' 
WHERE image_url LIKE '%commons.wikimedia.org%' 
AND image_source = 'unknown';
