-- Migration: Update attraction_image table schema
-- This adds the missing columns that the store-poi-images Edge Function needs

-- Add missing columns to attraction_image table
ALTER TABLE core.attraction_image 
ADD COLUMN IF NOT EXISTS storage_path text null,
ADD COLUMN IF NOT EXISTS photo_reference text null;

-- Create indexes for better performance
CREATE INDEX IF NOT EXISTS idx_attraction_image_photo_reference 
ON core.attraction_image USING btree (photo_reference) TABLESPACE pg_default;

CREATE INDEX IF NOT EXISTS idx_attraction_image_storage_path 
ON core.attraction_image USING btree (storage_path) TABLESPACE pg_default;

-- Add comment to document the schema
COMMENT ON TABLE core.attraction_image IS 'Stores image references for attractions, including both Supabase Storage URLs and Google Places photo references';
COMMENT ON COLUMN core.attraction_image.image_url IS 'Public URL of the image (Supabase Storage or external)';
COMMENT ON COLUMN core.attraction_image.storage_path IS 'Path within Supabase Storage bucket';
COMMENT ON COLUMN core.attraction_image.photo_reference IS 'Google Places API photo reference for fallback';
