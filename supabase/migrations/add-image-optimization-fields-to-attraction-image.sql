-- Add image optimization fields to attraction_image table
-- This migration adds fields to support the integrated image optimization system

-- Add thumbnail_url to attractions table for performance (denormalization)
ALTER TABLE core.attractions 
ADD COLUMN IF NOT EXISTS thumbnail_url text;

-- Create index for thumbnail_url in attractions
CREATE INDEX IF NOT EXISTS idx_attractions_thumbnail_url 
ON core.attractions USING btree (thumbnail_url) TABLESPACE pg_default;

-- Add comment for thumbnail_url in attractions
COMMENT ON COLUMN core.attractions.thumbnail_url IS 'URL of the thumbnail image (300x300) for performance - denormalized from attraction_image';

-- Add thumbnail URL field
ALTER TABLE core.attraction_image 
ADD COLUMN IF NOT EXISTS thumbnail_url text;

-- Add image optimization metadata
ALTER TABLE core.attraction_image 
ADD COLUMN IF NOT EXISTS image_optimization_data jsonb;

-- Add image processing status
ALTER TABLE core.attraction_image 
ADD COLUMN IF NOT EXISTS image_processing_status text DEFAULT 'pending';

-- Add image processing timestamps
ALTER TABLE core.attraction_image 
ADD COLUMN IF NOT EXISTS image_processed_at timestamp with time zone;

-- Add image dimensions
ALTER TABLE core.attraction_image 
ADD COLUMN IF NOT EXISTS image_width integer;
ALTER TABLE core.attraction_image 
ADD COLUMN IF NOT EXISTS image_height integer;

-- Add image file size
ALTER TABLE core.attraction_image 
ADD COLUMN IF NOT EXISTS image_file_size_bytes bigint;

-- Add image format
ALTER TABLE core.attraction_image 
ADD COLUMN IF NOT EXISTS image_format text;

-- Add image quality score
ALTER TABLE core.attraction_image 
ADD COLUMN IF NOT EXISTS image_quality_score numeric(5, 2);

-- Add image source (if not already exists)
ALTER TABLE core.attraction_image 
ADD COLUMN IF NOT EXISTS image_source text DEFAULT 'unknown';

-- Create indexes for performance
CREATE INDEX IF NOT EXISTS idx_attraction_image_thumbnail_url 
ON core.attraction_image USING btree (thumbnail_url) TABLESPACE pg_default;

CREATE INDEX IF NOT EXISTS idx_attraction_image_processing_status 
ON core.attraction_image USING btree (image_processing_status) TABLESPACE pg_default;

CREATE INDEX IF NOT EXISTS idx_attraction_image_processed_at 
ON core.attraction_image USING btree (image_processed_at) TABLESPACE pg_default;

CREATE INDEX IF NOT EXISTS idx_attraction_image_format 
ON core.attraction_image USING btree (image_format) TABLESPACE pg_default;

CREATE INDEX IF NOT EXISTS idx_attraction_image_source 
ON core.attraction_image USING btree (image_source) TABLESPACE pg_default;

-- Add comments for documentation
COMMENT ON COLUMN core.attraction_image.thumbnail_url IS 'URL of the optimized thumbnail image (300x300)';
COMMENT ON COLUMN core.attraction_image.image_optimization_data IS 'JSON metadata about image optimization (original size, optimized size, space saved, etc.)';
COMMENT ON COLUMN core.attraction_image.image_processing_status IS 'Status of image processing: pending, processing, completed, failed';
COMMENT ON COLUMN core.attraction_image.image_processed_at IS 'Timestamp when image was last processed/optimized';
COMMENT ON COLUMN core.attraction_image.image_width IS 'Width of the optimized image in pixels';
COMMENT ON COLUMN core.attraction_image.image_height IS 'Height of the optimized image in pixels';
COMMENT ON COLUMN core.attraction_image.image_file_size_bytes IS 'File size of the optimized image in bytes';
COMMENT ON COLUMN core.attraction_image.image_format IS 'Format of the optimized image (jpeg, png, webp)';
COMMENT ON COLUMN core.attraction_image.image_quality_score IS 'Quality score of the optimized image (0-100)';
COMMENT ON COLUMN core.attraction_image.image_source IS 'Source of the image: google_places, wikimedia_commons, or other';

-- Update existing records with default values
UPDATE core.attraction_image 
SET image_processing_status = 'completed'
WHERE image_url IS NOT NULL 
AND image_processing_status = 'pending';

-- Set image_processed_at for existing images
UPDATE core.attraction_image 
SET image_processed_at = created_at
WHERE image_url IS NOT NULL 
AND image_processed_at IS NULL;

-- Set image_source for existing images based on URL patterns
UPDATE core.attraction_image 
SET image_source = 'google_places'
WHERE image_url LIKE '%googleusercontent.com%' 
AND image_source = 'unknown';

UPDATE core.attraction_image 
SET image_source = 'wikimedia_commons'
WHERE image_url LIKE '%upload.wikimedia.org%' 
AND image_source = 'unknown';

UPDATE core.attraction_image 
SET image_source = 'supabase'
WHERE image_url LIKE '%supabase.co%' 
AND image_source = 'unknown';
