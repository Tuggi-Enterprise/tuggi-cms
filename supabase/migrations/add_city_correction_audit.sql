-- Add city correction audit field to attractions table
-- This migration adds support for tracking city corrections made by the city correction service

-- Add city_correction_audit JSONB column to store correction history
ALTER TABLE core.attractions 
ADD COLUMN IF NOT EXISTS city_correction_audit JSONB;

-- Create index for querying city correction audit data
CREATE INDEX IF NOT EXISTS idx_attractions_city_correction_audit 
ON core.attractions USING GIN (city_correction_audit);

-- Create index for finding POIs that haven't been processed yet
CREATE INDEX IF NOT EXISTS idx_attractions_city_correction_null 
ON core.attractions (id) 
WHERE city_correction_audit IS NULL;

-- Create index for finding POIs that need manual review
CREATE INDEX IF NOT EXISTS idx_attractions_city_correction_manual_review 
ON core.attractions (id) 
WHERE (city_correction_audit->>'needs_manual_review')::boolean = true;

-- Add comment explaining the audit structure
COMMENT ON COLUMN core.attractions.city_correction_audit IS 
'JSONB field storing city correction audit information including:
- original_city: Original city name before correction
- corrected_city: New city name after correction  
- suggested_city: Suggested city name for manual review
- confidence: Confidence score (0-100)
- source: Source of correction (nominatim, geonames, cross_validated)
- corrected_at: Timestamp of correction
- needs_manual_review: Boolean indicating if manual review is needed
- auto_corrected: Boolean indicating if correction was applied automatically
- raw_data: Raw response data from geocoding services
- reviewed_by: User ID who reviewed the correction (for manual reviews)
- manual_override: Boolean indicating if correction was manually overridden';

-- Create a view for easy querying of correction statistics
CREATE OR REPLACE VIEW core.city_correction_stats AS
SELECT 
  COUNT(*) as total_pois,
  COUNT(city_correction_audit) as processed_pois,
  COUNT(*) FILTER (WHERE (city_correction_audit->>'auto_corrected')::boolean = true) as auto_corrected,
  COUNT(*) FILTER (WHERE (city_correction_audit->>'needs_manual_review')::boolean = true) as needs_manual_review,
  COUNT(*) FILTER (WHERE city_correction_audit->>'reviewed_by' IS NOT NULL) as manually_reviewed,
  ROUND(AVG((city_correction_audit->>'confidence')::numeric), 2) as avg_confidence,
  COUNT(*) FILTER (WHERE city_correction_audit->>'source' = 'nominatim') as nominatim_corrections,
  COUNT(*) FILTER (WHERE city_correction_audit->>'source' = 'geonames') as geonames_corrections,
  COUNT(*) FILTER (WHERE city_correction_audit->>'source' = 'cross_validated') as cross_validated_corrections
FROM core.attractions;

-- Create a view for manual review queue
CREATE OR REPLACE VIEW core.city_correction_manual_review AS
SELECT 
  id,
  name,
  city as current_city,
  state,
  country,
  city_correction_audit->>'suggested_city' as suggested_city,
  (city_correction_audit->>'confidence')::numeric as confidence,
  city_correction_audit->>'source' as source,
  (city_correction_audit->>'created_at')::timestamp as suggested_at,
  city_correction_audit->>'raw_data' as raw_data
FROM core.attractions
WHERE (city_correction_audit->>'needs_manual_review')::boolean = true
  AND city_correction_audit->>'reviewed_by' IS NULL
ORDER BY (city_correction_audit->>'confidence')::numeric DESC;

-- Grant appropriate permissions
GRANT SELECT ON core.city_correction_stats TO authenticated;
GRANT SELECT ON core.city_correction_manual_review TO authenticated;
