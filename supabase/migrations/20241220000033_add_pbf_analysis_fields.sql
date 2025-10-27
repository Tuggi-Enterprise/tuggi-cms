-- Add important fields identified from PBF analysis
-- Based on frequency analysis of sudeste-251012.osm.pbf

-- Critical fields (high frequency + high importance)
ALTER TABLE homolog.pois ADD COLUMN IF NOT EXISTS source TEXT;
ALTER TABLE homolog.pois ADD COLUMN IF NOT EXISTS natural_type TEXT; -- natural is reserved
ALTER TABLE homolog.pois ADD COLUMN IF NOT EXISTS landuse TEXT;
ALTER TABLE homolog.pois ADD COLUMN IF NOT EXISTS access TEXT;
ALTER TABLE homolog.pois ADD COLUMN IF NOT EXISTS ref TEXT;
ALTER TABLE homolog.pois ADD COLUMN IF NOT EXISTS type TEXT;

-- Contact and social media fields
ALTER TABLE homolog.pois ADD COLUMN IF NOT EXISTS contact_phone_alt TEXT; -- contact:phone
ALTER TABLE homolog.pois ADD COLUMN IF NOT EXISTS contact_mobile TEXT; -- contact:mobile
ALTER TABLE homolog.pois ADD COLUMN IF NOT EXISTS contact_website_alt TEXT; -- contact:website
ALTER TABLE homolog.pois ADD COLUMN IF NOT EXISTS contact_email_alt TEXT; -- contact:email
ALTER TABLE homolog.pois ADD COLUMN IF NOT EXISTS contact_facebook TEXT; -- contact:facebook
ALTER TABLE homolog.pois ADD COLUMN IF NOT EXISTS contact_instagram TEXT; -- contact:instagram
ALTER TABLE homolog.pois ADD COLUMN IF NOT EXISTS contact_whatsapp TEXT; -- contact:whatsapp
ALTER TABLE homolog.pois ADD COLUMN IF NOT EXISTS contact_twitter TEXT; -- contact:twitter
ALTER TABLE homolog.pois ADD COLUMN IF NOT EXISTS contact_youtube TEXT; -- contact:youtube

-- Payment and service fields
ALTER TABLE homolog.pois ADD COLUMN IF NOT EXISTS fee TEXT;
ALTER TABLE homolog.pois ADD COLUMN IF NOT EXISTS payment_credit_cards TEXT;
ALTER TABLE homolog.pois ADD COLUMN IF NOT EXISTS payment_cash TEXT;
ALTER TABLE homolog.pois ADD COLUMN IF NOT EXISTS payment_visa TEXT;
ALTER TABLE homolog.pois ADD COLUMN IF NOT EXISTS payment_mastercard TEXT;

-- Capacity and characteristics fields
ALTER TABLE homolog.pois ADD COLUMN IF NOT EXISTS rooms INTEGER;
ALTER TABLE homolog.pois ADD COLUMN IF NOT EXISTS air_conditioning TEXT;
ALTER TABLE homolog.pois ADD COLUMN IF NOT EXISTS smoking TEXT;
ALTER TABLE homolog.pois ADD COLUMN IF NOT EXISTS capacity INTEGER;
ALTER TABLE homolog.pois ADD COLUMN IF NOT EXISTS pets_allowed TEXT;

-- Additional important fields from PBF analysis
ALTER TABLE homolog.pois ADD COLUMN IF NOT EXISTS surface TEXT;
ALTER TABLE homolog.pois ADD COLUMN IF NOT EXISTS waterway TEXT;
ALTER TABLE homolog.pois ADD COLUMN IF NOT EXISTS power TEXT;
ALTER TABLE homolog.pois ADD COLUMN IF NOT EXISTS lanes INTEGER;
ALTER TABLE homolog.pois ADD COLUMN IF NOT EXISTS maxspeed INTEGER;
ALTER TABLE homolog.pois ADD COLUMN IF NOT EXISTS intermittent TEXT;
ALTER TABLE homolog.pois ADD COLUMN IF NOT EXISTS layer INTEGER;
ALTER TABLE homolog.pois ADD COLUMN IF NOT EXISTS leisure TEXT;
ALTER TABLE homolog.pois ADD COLUMN IF NOT EXISTS lit TEXT;
ALTER TABLE homolog.pois ADD COLUMN IF NOT EXISTS service TEXT;
ALTER TABLE homolog.pois ADD COLUMN IF NOT EXISTS barrier TEXT;
ALTER TABLE homolog.pois ADD COLUMN IF NOT EXISTS alt_name TEXT;
ALTER TABLE homolog.pois ADD COLUMN IF NOT EXISTS public_transport TEXT;
ALTER TABLE homolog.pois ADD COLUMN IF NOT EXISTS tunnel TEXT;
ALTER TABLE homolog.pois ADD COLUMN IF NOT EXISTS bus TEXT;
ALTER TABLE homolog.pois ADD COLUMN IF NOT EXISTS place TEXT;
ALTER TABLE homolog.pois ADD COLUMN IF NOT EXISTS man_made TEXT;
ALTER TABLE homolog.pois ADD COLUMN IF NOT EXISTS source_name TEXT;
ALTER TABLE homolog.pois ADD COLUMN IF NOT EXISTS trees TEXT;
ALTER TABLE homolog.pois ADD COLUMN IF NOT EXISTS bridge TEXT;
ALTER TABLE homolog.pois ADD COLUMN IF NOT EXISTS shop TEXT;

-- Add comments for documentation
COMMENT ON COLUMN homolog.pois.source IS 'Source of OSM data (survey, import, Bing, etc.)';
COMMENT ON COLUMN homolog.pois.natural_type IS 'Type of natural element (peak, beach, forest, water)';
COMMENT ON COLUMN homolog.pois.landuse IS 'Type of land use (residential, commercial, industrial)';
COMMENT ON COLUMN homolog.pois.access IS 'Access type (yes, no, private, customers)';
COMMENT ON COLUMN homolog.pois.ref IS 'Reference code (BR-101, A1, 123)';
COMMENT ON COLUMN homolog.pois.type IS 'Specific type (multipolygon, boundary, route)';
COMMENT ON COLUMN homolog.pois.rooms IS 'Number of rooms (for hotels, hostels)';
COMMENT ON COLUMN homolog.pois.capacity IS 'Capacity in persons';
COMMENT ON COLUMN homolog.pois.fee IS 'Fee information (yes, no, amount)';
COMMENT ON COLUMN homolog.pois.pets_allowed IS 'Pets allowed (yes, no, dogs, cats)';

-- Create indexes for frequently queried fields
CREATE INDEX IF NOT EXISTS idx_homolog_pois_source ON homolog.pois (source) WHERE source IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_homolog_pois_natural_type ON homolog.pois (natural_type) WHERE natural_type IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_homolog_pois_landuse ON homolog.pois (landuse) WHERE landuse IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_homolog_pois_access ON homolog.pois (access) WHERE access IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_homolog_pois_rooms ON homolog.pois (rooms) WHERE rooms IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_homolog_pois_capacity ON homolog.pois (capacity) WHERE capacity IS NOT NULL;
