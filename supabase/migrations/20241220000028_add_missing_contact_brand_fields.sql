-- Add missing contact, brand, and internet access fields to homolog.pois
-- These fields were identified as being available in OSM data but not being saved

-- Add contact fields
ALTER TABLE homolog.pois ADD COLUMN IF NOT EXISTS contact_fax TEXT;
ALTER TABLE homolog.pois ADD COLUMN IF NOT EXISTS brand TEXT;
ALTER TABLE homolog.pois ADD COLUMN IF NOT EXISTS brand_wikidata TEXT;
ALTER TABLE homolog.pois ADD COLUMN IF NOT EXISTS brand_wikipedia TEXT;

-- Add internet access fields
ALTER TABLE homolog.pois ADD COLUMN IF NOT EXISTS internet_access TEXT;
ALTER TABLE homolog.pois ADD COLUMN IF NOT EXISTS internet_access_fee TEXT;

-- Add comments for documentation
COMMENT ON COLUMN homolog.pois.contact_fax IS 'Fax number from OSM contact:fax tag';
COMMENT ON COLUMN homolog.pois.brand IS 'Brand name from OSM brand tag';
COMMENT ON COLUMN homolog.pois.brand_wikidata IS 'Wikidata ID from OSM brand:wikidata tag';
COMMENT ON COLUMN homolog.pois.brand_wikipedia IS 'Wikipedia page from OSM brand:wikipedia tag';
COMMENT ON COLUMN homolog.pois.internet_access IS 'Internet access availability from OSM internet_access tag';
COMMENT ON COLUMN homolog.pois.internet_access_fee IS 'Internet access fee from OSM internet_access:fee tag';

-- Grant permissions
GRANT SELECT, INSERT, UPDATE ON homolog.pois TO authenticated;
GRANT SELECT, INSERT, UPDATE ON homolog.pois TO service_role;
GRANT SELECT ON homolog.pois TO anon;
