-- Fix get_pois_paginated to include primary_category
-- This migration fixes the RPC function to return primary_category field

DROP FUNCTION IF EXISTS homolog.get_pois_paginated CASCADE;

CREATE OR REPLACE FUNCTION homolog.get_pois_paginated(
  category_filter TEXT DEFAULT NULL,
  city_filter TEXT DEFAULT NULL,
  only_complete BOOLEAN DEFAULT FALSE,
  page_limit INTEGER DEFAULT 50,
  page_offset INTEGER DEFAULT 0,
  search_term TEXT DEFAULT NULL,
  state_filter TEXT DEFAULT NULL
)
RETURNS TABLE (
  uuid_id UUID,
  name TEXT,
  city TEXT,
  state TEXT,
  country TEXT,
  category TEXT,
  primary_category TEXT,
  lat DECIMAL(10,8),
  lon DECIMAL(11,8),
  osm_id BIGINT,
  osm_type TEXT,
  place_id BIGINT,
  formatted_address TEXT,
  importance DECIMAL(5,2),
  source_file TEXT,
  source_type TEXT,
  is_complete BOOLEAN,
  has_nominatim_data BOOLEAN,
  processing_status TEXT,
  created_at TIMESTAMP WITH TIME ZONE,
  updated_at TIMESTAMP WITH TIME ZONE,
  osm_properties JSONB,
  approved BOOLEAN,
  osm_geometry GEOGRAPHY
) AS $$
BEGIN
  RETURN QUERY
  SELECT 
    p.uuid_id,
    p.name,
    p.city,
    p.state,
    p.country,
    p.category,
    p.primary_category,
    p.lat,
    p.lon,
    p.osm_id,
    p.osm_type,
    p.place_id,
    p.formatted_address,
    p.importance,
    p.source_file,
    p.source_type,
    p.is_complete,
    p.has_nominatim_data,
    p.processing_status,
    p.created_at,
    p.updated_at,
    p.osm_properties,
    p.approved,
    p.osm_geometry
  FROM homolog.pois p
  WHERE 
    (category_filter IS NULL OR p.category = category_filter)
    AND (city_filter IS NULL OR p.city = city_filter)
    AND (state_filter IS NULL OR p.state = state_filter)
    AND (search_term IS NULL OR p.name ILIKE '%' || search_term || '%')
    AND (NOT only_complete OR p.is_complete = TRUE)
  ORDER BY p.created_at DESC
  LIMIT page_limit
  OFFSET page_offset;
END;
$$ LANGUAGE plpgsql;

-- Grant permissions
GRANT EXECUTE ON FUNCTION homolog.get_pois_paginated TO authenticated;
GRANT EXECUTE ON FUNCTION homolog.get_pois_paginated TO service_role;
GRANT EXECUTE ON FUNCTION homolog.get_pois_paginated TO anon;

