-- Fix get_pois_paginated function to remove lat/lon references

-- Drop existing function first to avoid conflicts
DROP FUNCTION IF EXISTS homolog.get_pois_paginated CASCADE;

-- Create corrected function without lat/lon
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
  neighborhood TEXT,
  street_name TEXT,
  house_number TEXT,
  postal_code TEXT,
  formatted_address TEXT,
  primary_category TEXT,
  primary_category_type TEXT,
  categories JSONB,
  category TEXT,
  osm_id BIGINT,
  osm_type TEXT,
  place_id BIGINT,
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
  osm_geometry GEOGRAPHY,
  
  -- Contact/Operation fields
  website TEXT,
  contact_phone TEXT,
  contact_email TEXT,
  operator_name TEXT,
  
  -- Accessibility fields
  wheelchair_accessible TEXT,
  wheelchair_toilets TEXT,
  accessibility_notes TEXT,
  
  -- Physical characteristics
  height DECIMAL(8,2),
  building_material TEXT,
  building_colour TEXT,
  roof_colour TEXT,
  architectural_style TEXT,
  
  -- Historical/Heritage fields
  historic_period TEXT,
  landmark_type TEXT,
  architect TEXT,
  construction_status TEXT,
  start_date TEXT,
  heritage_status TEXT,
  unesco_status TEXT,
  unesco_inscription_date TEXT,
  unesco_reference TEXT,
  landmark_level INTEGER,
  importance_level TEXT,
  
  -- Type-specific fields
  museum_type TEXT,
  museum_collection TEXT,
  museum_audience TEXT,
  museum_education TEXT,
  leisure_type TEXT,
  natural_type TEXT,
  natural_water TEXT,
  sport_facilities TEXT,
  leisure_playground TEXT,
  monument_type TEXT,
  monument_event TEXT,
  monument_person TEXT,
  
  -- Infrastructure fields
  parking_capacity TEXT,
  public_transport TEXT,
  access_points TEXT,
  entrance_fee TEXT,
  
  -- Environmental fields
  urban_density TEXT,
  noise_level TEXT,
  air_quality TEXT,
  shade_availability TEXT,
  
  -- Cultural fields
  cultural_significance TEXT,
  local_traditions TEXT,
  seasonal_attractions TEXT,
  
  -- Tourism flags
  is_historic BOOLEAN,
  is_touristic BOOLEAN,
  has_train BOOLEAN,
  has_ferry BOOLEAN,
  has_bus BOOLEAN,
  has_wheelchair_access BOOLEAN,
  has_water BOOLEAN,
  has_fishing BOOLEAN,
  has_playground BOOLEAN,
  is_building BOOLEAN,
  has_ruins BOOLEAN,
  
  -- Pagination metadata
  total_count BIGINT
) AS $$
DECLARE
  total_rows BIGINT;
BEGIN
  -- Calculate total rows for pagination metadata
  SELECT COUNT(*) INTO total_rows
  FROM homolog.pois p
  WHERE
    (category_filter IS NULL OR p.category ILIKE category_filter) AND
    (city_filter IS NULL OR p.city ILIKE city_filter) AND
    (state_filter IS NULL OR p.state ILIKE state_filter) AND
    (search_term IS NULL OR p.name ILIKE '%' || search_term || '%') AND
    (NOT only_complete OR p.is_complete = TRUE);

  RETURN QUERY
  SELECT
    p.uuid_id,
    p.name,
    p.city,
    p.state,
    p.country,
    p.neighborhood,
    p.street_name,
    p.house_number,
    p.postal_code,
    p.formatted_address,
    p.primary_category,
    p.primary_category_type,
    p.categories,
    p.category,
    p.osm_id,
    p.osm_type,
    p.place_id,
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
    p.osm_geometry,
    
    -- Contact/Operation fields
    p.website,
    p.contact_phone,
    p.contact_email,
    p.operator_name,
    
    -- Accessibility fields
    p.wheelchair_accessible,
    p.wheelchair_toilets,
    p.accessibility_notes,
    
    -- Physical characteristics
    p.height,
    p.building_material,
    p.building_colour,
    p.roof_colour,
    p.architectural_style,
    
    -- Historical/Heritage fields
    p.historic_period,
    p.landmark_type,
    p.architect,
    p.construction_status,
    p.start_date,
    p.heritage_status,
    p.unesco_status,
    p.unesco_inscription_date,
    p.unesco_reference,
    p.landmark_level,
    p.importance_level,
    
    -- Type-specific fields
    p.museum_type,
    p.museum_collection,
    p.museum_audience,
    p.museum_education,
    p.leisure_type,
    p.natural_type,
    p.natural_water,
    p.sport_facilities,
    p.leisure_playground,
    p.monument_type,
    p.monument_event,
    p.monument_person,
    
    -- Infrastructure fields
    p.parking_capacity,
    p.public_transport,
    p.access_points,
    p.entrance_fee,
    
    -- Environmental fields
    p.urban_density,
    p.noise_level,
    p.air_quality,
    p.shade_availability,
    
    -- Cultural fields
    p.cultural_significance,
    p.local_traditions,
    p.seasonal_attractions,
    
    -- Tourism flags
    p.is_historic,
    p.is_touristic,
    p.has_train,
    p.has_ferry,
    p.has_bus,
    p.has_wheelchair_access,
    p.has_water,
    p.has_fishing,
    p.has_playground,
    p.is_building,
    p.has_ruins,
    
    -- Pagination metadata
    total_rows AS total_count
  FROM homolog.pois p
  WHERE
    (category_filter IS NULL OR p.category ILIKE category_filter) AND
    (city_filter IS NULL OR p.city ILIKE city_filter) AND
    (state_filter IS NULL OR p.state ILIKE state_filter) AND
    (search_term IS NULL OR p.name ILIKE '%' || search_term || '%') AND
    (NOT only_complete OR p.is_complete = TRUE)
  ORDER BY p.created_at DESC
  LIMIT page_limit
  OFFSET page_offset;
END;
$$ LANGUAGE plpgsql;

-- Grant permissions on updated function
GRANT EXECUTE ON FUNCTION homolog.get_pois_paginated(TEXT, TEXT, BOOLEAN, INTEGER, INTEGER, TEXT, TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION homolog.get_pois_paginated(TEXT, TEXT, BOOLEAN, INTEGER, INTEGER, TEXT, TEXT) TO service_role;
GRANT EXECUTE ON FUNCTION homolog.get_pois_paginated(TEXT, TEXT, BOOLEAN, INTEGER, INTEGER, TEXT, TEXT) TO anon;
