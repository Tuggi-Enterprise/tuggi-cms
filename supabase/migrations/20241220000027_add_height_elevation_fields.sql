-- Add height and elevation fields to pois table
-- Simple KISS approach: just 2 fields for height and elevation

ALTER TABLE homolog.pois ADD COLUMN IF NOT EXISTS height_m DECIMAL(8,2);
ALTER TABLE homolog.pois ADD COLUMN IF NOT EXISTS elevation_m DECIMAL(8,2);

-- Add comments
COMMENT ON COLUMN homolog.pois.height_m IS 'Height of the POI in meters (from height, building:height, or building:levels)';
COMMENT ON COLUMN homolog.pois.elevation_m IS 'Elevation of the terrain in meters above sea level (from ele tag)';

-- Add indexes for performance
CREATE INDEX IF NOT EXISTS idx_homolog_pois_height ON homolog.pois(height_m) WHERE height_m IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_homolog_pois_elevation ON homolog.pois(elevation_m) WHERE elevation_m IS NOT NULL;
