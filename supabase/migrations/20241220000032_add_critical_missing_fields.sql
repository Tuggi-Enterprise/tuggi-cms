-- Add critical and important missing fields from OSM data
-- Based on frequency analysis of tourism.geojson

-- Critical fields (high frequency + high importance)
ALTER TABLE homolog.pois ADD COLUMN IF NOT EXISTS opening_hours TEXT;
ALTER TABLE homolog.pois ADD COLUMN IF NOT EXISTS wikidata TEXT;
ALTER TABLE homolog.pois ADD COLUMN IF NOT EXISTS wikipedia TEXT;
ALTER TABLE homolog.pois ADD COLUMN IF NOT EXISTS amenity TEXT;

-- Important fields (medium frequency + high/medium importance)
ALTER TABLE homolog.pois ADD COLUMN IF NOT EXISTS building TEXT;
ALTER TABLE homolog.pois ADD COLUMN IF NOT EXISTS artwork_type TEXT;
ALTER TABLE homolog.pois ADD COLUMN IF NOT EXISTS information TEXT;

-- Add comments for documentation
COMMENT ON COLUMN homolog.pois.opening_hours IS 'Opening hours in OSM format (e.g., Mo-Fr 08:00-17:00)';
COMMENT ON COLUMN homolog.pois.wikidata IS 'Wikidata ID for structured data (e.g., Q210722)';
COMMENT ON COLUMN homolog.pois.wikipedia IS 'Wikipedia page reference (e.g., pt:Pão de Açúcar)';
COMMENT ON COLUMN homolog.pois.amenity IS 'Type of amenity (restaurant, hospital, school, etc.)';
COMMENT ON COLUMN homolog.pois.building IS 'Type of building (yes, house, commercial, etc.)';
COMMENT ON COLUMN homolog.pois.artwork_type IS 'Type of artwork (statue, mural, sculpture, etc.)';
COMMENT ON COLUMN homolog.pois.information IS 'Type of tourist information (office, board, guidepost, etc.)';

-- Create indexes for frequently queried fields
CREATE INDEX IF NOT EXISTS idx_homolog_pois_opening_hours ON homolog.pois (opening_hours) WHERE opening_hours IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_homolog_pois_wikidata ON homolog.pois (wikidata) WHERE wikidata IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_homolog_pois_amenity ON homolog.pois (amenity) WHERE amenity IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_homolog_pois_building ON homolog.pois (building) WHERE building IS NOT NULL;
