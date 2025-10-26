-- Complete POIs schema migration for homolog
-- Adds all missing fields from local SQLite database

-- Add missing basic information fields
ALTER TABLE homolog.pois ADD COLUMN IF NOT EXISTS description TEXT;
ALTER TABLE homolog.pois ADD COLUMN IF NOT EXISTS neighborhood TEXT;
ALTER TABLE homolog.pois ADD COLUMN IF NOT EXISTS street_name TEXT;
ALTER TABLE homolog.pois ADD COLUMN IF NOT EXISTS house_number TEXT;
ALTER TABLE homolog.pois ADD COLUMN IF NOT EXISTS postal_code TEXT;

-- Add categorization fields
ALTER TABLE homolog.pois ADD COLUMN IF NOT EXISTS primary_category TEXT;
ALTER TABLE homolog.pois ADD COLUMN IF NOT EXISTS primary_category_type TEXT;
ALTER TABLE homolog.pois ADD COLUMN IF NOT EXISTS categories JSONB; -- JSON array of categories

-- Add contact/operation fields
ALTER TABLE homolog.pois ADD COLUMN IF NOT EXISTS website TEXT;
ALTER TABLE homolog.pois ADD COLUMN IF NOT EXISTS contact_phone TEXT;
ALTER TABLE homolog.pois ADD COLUMN IF NOT EXISTS contact_email TEXT;
ALTER TABLE homolog.pois ADD COLUMN IF NOT EXISTS operator_name TEXT;

-- Add accessibility fields
ALTER TABLE homolog.pois ADD COLUMN IF NOT EXISTS wheelchair_accessible TEXT;
ALTER TABLE homolog.pois ADD COLUMN IF NOT EXISTS wheelchair_toilets TEXT;
ALTER TABLE homolog.pois ADD COLUMN IF NOT EXISTS accessibility_notes TEXT;

-- Add physical characteristics
ALTER TABLE homolog.pois ADD COLUMN IF NOT EXISTS height DECIMAL(8,2);
ALTER TABLE homolog.pois ADD COLUMN IF NOT EXISTS building_material TEXT;
ALTER TABLE homolog.pois ADD COLUMN IF NOT EXISTS building_colour TEXT;
ALTER TABLE homolog.pois ADD COLUMN IF NOT EXISTS roof_colour TEXT;
ALTER TABLE homolog.pois ADD COLUMN IF NOT EXISTS architectural_style TEXT;

-- Add historical/heritage fields
ALTER TABLE homolog.pois ADD COLUMN IF NOT EXISTS historic_period TEXT;
ALTER TABLE homolog.pois ADD COLUMN IF NOT EXISTS landmark_type TEXT;
ALTER TABLE homolog.pois ADD COLUMN IF NOT EXISTS architect TEXT;
ALTER TABLE homolog.pois ADD COLUMN IF NOT EXISTS construction_status TEXT;
ALTER TABLE homolog.pois ADD COLUMN IF NOT EXISTS start_date TEXT;
ALTER TABLE homolog.pois ADD COLUMN IF NOT EXISTS heritage_status TEXT;
ALTER TABLE homolog.pois ADD COLUMN IF NOT EXISTS unesco_status TEXT;
ALTER TABLE homolog.pois ADD COLUMN IF NOT EXISTS unesco_inscription_date TEXT;
ALTER TABLE homolog.pois ADD COLUMN IF NOT EXISTS unesco_reference TEXT;
ALTER TABLE homolog.pois ADD COLUMN IF NOT EXISTS landmark_level INTEGER;
ALTER TABLE homolog.pois ADD COLUMN IF NOT EXISTS importance_level TEXT;

-- Add type-specific fields
ALTER TABLE homolog.pois ADD COLUMN IF NOT EXISTS museum_type TEXT;
ALTER TABLE homolog.pois ADD COLUMN IF NOT EXISTS museum_collection TEXT;
ALTER TABLE homolog.pois ADD COLUMN IF NOT EXISTS museum_audience TEXT;
ALTER TABLE homolog.pois ADD COLUMN IF NOT EXISTS museum_education TEXT;
ALTER TABLE homolog.pois ADD COLUMN IF NOT EXISTS leisure_type TEXT;
ALTER TABLE homolog.pois ADD COLUMN IF NOT EXISTS natural_type TEXT;
ALTER TABLE homolog.pois ADD COLUMN IF NOT EXISTS natural_water TEXT;
ALTER TABLE homolog.pois ADD COLUMN IF NOT EXISTS sport_facilities TEXT;
ALTER TABLE homolog.pois ADD COLUMN IF NOT EXISTS leisure_playground TEXT;
ALTER TABLE homolog.pois ADD COLUMN IF NOT EXISTS monument_type TEXT;
ALTER TABLE homolog.pois ADD COLUMN IF NOT EXISTS monument_event TEXT;
ALTER TABLE homolog.pois ADD COLUMN IF NOT EXISTS monument_person TEXT;

-- Add infrastructure fields
ALTER TABLE homolog.pois ADD COLUMN IF NOT EXISTS parking_capacity TEXT;
ALTER TABLE homolog.pois ADD COLUMN IF NOT EXISTS public_transport TEXT;
ALTER TABLE homolog.pois ADD COLUMN IF NOT EXISTS access_points TEXT;
ALTER TABLE homolog.pois ADD COLUMN IF NOT EXISTS entrance_fee TEXT;

-- Add environmental fields
ALTER TABLE homolog.pois ADD COLUMN IF NOT EXISTS urban_density TEXT;
ALTER TABLE homolog.pois ADD COLUMN IF NOT EXISTS noise_level TEXT;
ALTER TABLE homolog.pois ADD COLUMN IF NOT EXISTS air_quality TEXT;
ALTER TABLE homolog.pois ADD COLUMN IF NOT EXISTS shade_availability TEXT;

-- Add cultural fields
ALTER TABLE homolog.pois ADD COLUMN IF NOT EXISTS cultural_significance TEXT;
ALTER TABLE homolog.pois ADD COLUMN IF NOT EXISTS local_traditions TEXT;
ALTER TABLE homolog.pois ADD COLUMN IF NOT EXISTS seasonal_attractions TEXT;

-- Add tourism flags (boolean fields)
ALTER TABLE homolog.pois ADD COLUMN IF NOT EXISTS is_historic BOOLEAN DEFAULT FALSE;
ALTER TABLE homolog.pois ADD COLUMN IF NOT EXISTS is_touristic BOOLEAN DEFAULT FALSE;
ALTER TABLE homolog.pois ADD COLUMN IF NOT EXISTS has_train BOOLEAN DEFAULT FALSE;
ALTER TABLE homolog.pois ADD COLUMN IF NOT EXISTS has_ferry BOOLEAN DEFAULT FALSE;
ALTER TABLE homolog.pois ADD COLUMN IF NOT EXISTS has_bus BOOLEAN DEFAULT FALSE;
ALTER TABLE homolog.pois ADD COLUMN IF NOT EXISTS has_wheelchair_access BOOLEAN DEFAULT FALSE;
ALTER TABLE homolog.pois ADD COLUMN IF NOT EXISTS has_water BOOLEAN DEFAULT FALSE;
ALTER TABLE homolog.pois ADD COLUMN IF NOT EXISTS has_fishing BOOLEAN DEFAULT FALSE;
ALTER TABLE homolog.pois ADD COLUMN IF NOT EXISTS has_playground BOOLEAN DEFAULT FALSE;
ALTER TABLE homolog.pois ADD COLUMN IF NOT EXISTS is_building BOOLEAN DEFAULT FALSE;
ALTER TABLE homolog.pois ADD COLUMN IF NOT EXISTS has_ruins BOOLEAN DEFAULT FALSE;

-- Create indexes for new fields that might be frequently queried
CREATE INDEX IF NOT EXISTS idx_homolog_pois_primary_category ON homolog.pois(primary_category);
CREATE INDEX IF NOT EXISTS idx_homolog_pois_website ON homolog.pois(website) WHERE website IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_homolog_pois_heritage_status ON homolog.pois(heritage_status) WHERE heritage_status IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_homolog_pois_unesco_status ON homolog.pois(unesco_status) WHERE unesco_status IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_homolog_pois_is_historic ON homolog.pois(is_historic);
CREATE INDEX IF NOT EXISTS idx_homolog_pois_is_touristic ON homolog.pois(is_touristic);
CREATE INDEX IF NOT EXISTS idx_homolog_pois_has_wheelchair_access ON homolog.pois(has_wheelchair_access);

-- Add comments for documentation
COMMENT ON COLUMN homolog.pois.description IS 'Detailed description of the POI';
COMMENT ON COLUMN homolog.pois.neighborhood IS 'Neighborhood or district name';
COMMENT ON COLUMN homolog.pois.street_name IS 'Street name';
COMMENT ON COLUMN homolog.pois.house_number IS 'House or building number';
COMMENT ON COLUMN homolog.pois.postal_code IS 'Postal/ZIP code';
COMMENT ON COLUMN homolog.pois.primary_category IS 'Primary category classification';
COMMENT ON COLUMN homolog.pois.primary_category_type IS 'Type of primary category';
COMMENT ON COLUMN homolog.pois.categories IS 'JSON array of all categories';
COMMENT ON COLUMN homolog.pois.website IS 'Official website URL';
COMMENT ON COLUMN homolog.pois.contact_phone IS 'Contact phone number';
COMMENT ON COLUMN homolog.pois.contact_email IS 'Contact email address';
COMMENT ON COLUMN homolog.pois.operator_name IS 'Name of the operator/owner';
COMMENT ON COLUMN homolog.pois.wheelchair_accessible IS 'Wheelchair accessibility information';
COMMENT ON COLUMN homolog.pois.wheelchair_toilets IS 'Wheelchair accessible toilets';
COMMENT ON COLUMN homolog.pois.accessibility_notes IS 'Additional accessibility information';
COMMENT ON COLUMN homolog.pois.height IS 'Height in meters';
COMMENT ON COLUMN homolog.pois.building_material IS 'Primary building material';
COMMENT ON COLUMN homolog.pois.building_colour IS 'Building color';
COMMENT ON COLUMN homolog.pois.roof_colour IS 'Roof color';
COMMENT ON COLUMN homolog.pois.architectural_style IS 'Architectural style';
COMMENT ON COLUMN homolog.pois.historic_period IS 'Historical period';
COMMENT ON COLUMN homolog.pois.landmark_type IS 'Type of landmark';
COMMENT ON COLUMN homolog.pois.architect IS 'Architect name';
COMMENT ON COLUMN homolog.pois.construction_status IS 'Construction status';
COMMENT ON COLUMN homolog.pois.start_date IS 'Start/construction date';
COMMENT ON COLUMN homolog.pois.heritage_status IS 'Heritage protection status';
COMMENT ON COLUMN homolog.pois.unesco_status IS 'UNESCO World Heritage status';
COMMENT ON COLUMN homolog.pois.unesco_inscription_date IS 'UNESCO inscription date';
COMMENT ON COLUMN homolog.pois.unesco_reference IS 'UNESCO reference number';
COMMENT ON COLUMN homolog.pois.landmark_level IS 'Landmark importance level (1-5)';
COMMENT ON COLUMN homolog.pois.importance_level IS 'General importance level';
COMMENT ON COLUMN homolog.pois.museum_type IS 'Type of museum';
COMMENT ON COLUMN homolog.pois.museum_collection IS 'Museum collection focus';
COMMENT ON COLUMN homolog.pois.museum_audience IS 'Target audience';
COMMENT ON COLUMN homolog.pois.museum_education IS 'Educational programs';
COMMENT ON COLUMN homolog.pois.leisure_type IS 'Type of leisure facility';
COMMENT ON COLUMN homolog.pois.natural_type IS 'Type of natural feature';
COMMENT ON COLUMN homolog.pois.natural_water IS 'Water-related natural features';
COMMENT ON COLUMN homolog.pois.sport_facilities IS 'Available sports facilities';
COMMENT ON COLUMN homolog.pois.leisure_playground IS 'Playground facilities';
COMMENT ON COLUMN homolog.pois.monument_type IS 'Type of monument';
COMMENT ON COLUMN homolog.pois.monument_event IS 'Event commemorated';
COMMENT ON COLUMN homolog.pois.monument_person IS 'Person commemorated';
COMMENT ON COLUMN homolog.pois.parking_capacity IS 'Parking capacity information';
COMMENT ON COLUMN homolog.pois.public_transport IS 'Public transport access';
COMMENT ON COLUMN homolog.pois.access_points IS 'Access points information';
COMMENT ON COLUMN homolog.pois.entrance_fee IS 'Entrance fee information';
COMMENT ON COLUMN homolog.pois.urban_density IS 'Urban density level';
COMMENT ON COLUMN homolog.pois.noise_level IS 'Noise level assessment';
COMMENT ON COLUMN homolog.pois.air_quality IS 'Air quality assessment';
COMMENT ON COLUMN homolog.pois.shade_availability IS 'Shade availability';
COMMENT ON COLUMN homolog.pois.cultural_significance IS 'Cultural significance description';
COMMENT ON COLUMN homolog.pois.local_traditions IS 'Local traditions information';
COMMENT ON COLUMN homolog.pois.seasonal_attractions IS 'Seasonal attractions information';
COMMENT ON COLUMN homolog.pois.is_historic IS 'Is this a historic site?';
COMMENT ON COLUMN homolog.pois.is_touristic IS 'Is this a tourist attraction?';
COMMENT ON COLUMN homolog.pois.has_train IS 'Has train access?';
COMMENT ON COLUMN homolog.pois.has_ferry IS 'Has ferry access?';
COMMENT ON COLUMN homolog.pois.has_bus IS 'Has bus access?';
COMMENT ON COLUMN homolog.pois.has_wheelchair_access IS 'Has wheelchair access?';
COMMENT ON COLUMN homolog.pois.has_water IS 'Has water features?';
COMMENT ON COLUMN homolog.pois.has_fishing IS 'Has fishing facilities?';
COMMENT ON COLUMN homolog.pois.has_playground IS 'Has playground?';
COMMENT ON COLUMN homolog.pois.is_building IS 'Is this a building?';
COMMENT ON COLUMN homolog.pois.has_ruins IS 'Has ruins?';

-- Grant permissions on updated table
GRANT ALL ON TABLE homolog.pois TO authenticated;
GRANT ALL ON TABLE homolog.pois TO service_role;
GRANT SELECT ON TABLE homolog.pois TO anon;
