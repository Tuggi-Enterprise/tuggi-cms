-- Add temporary lat/lon fields to pois table for UUID generation
-- These fields will be used by triggers and then can be removed after processing

-- Add temporary coordinate fields
ALTER TABLE homolog.pois ADD COLUMN IF NOT EXISTS lat DECIMAL(10,8);
ALTER TABLE homolog.pois ADD COLUMN IF NOT EXISTS lon DECIMAL(11,8);

-- Add constraints for coordinate validation
ALTER TABLE homolog.pois ADD CONSTRAINT IF NOT EXISTS pois_lat_check_temp 
  CHECK (lat IS NULL OR (lat >= -90 AND lat <= 90));

ALTER TABLE homolog.pois ADD CONSTRAINT IF NOT EXISTS pois_lon_check_temp 
  CHECK (lon IS NULL OR (lon >= -180 AND lon <= 180));

-- Add indexes for performance
CREATE INDEX IF NOT EXISTS idx_pois_lat_lon_temp ON homolog.pois(lat, lon) WHERE lat IS NOT NULL AND lon IS NOT NULL;

-- Add comments
COMMENT ON COLUMN homolog.pois.lat IS 'Temporary latitude field for UUID generation - will be removed after processing';
COMMENT ON COLUMN homolog.pois.lon IS 'Temporary longitude field for UUID generation - will be removed after processing';
