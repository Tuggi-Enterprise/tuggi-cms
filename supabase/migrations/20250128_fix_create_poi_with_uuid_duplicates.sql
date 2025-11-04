-- Fix create_poi_with_uuid to prevent duplicates
-- Uses osm_id + osm_type + name as unique identifier (no coordinates)
-- Created: 2025-01-28

-- Step 1: We'll use PostgreSQL's native md5() function instead of pgcrypto
-- This avoids dependency on pgcrypto extension which may not be available

-- Step 1b: Drop existing function if it exists (with all possible signatures), then create simplified UUID generation function
-- Use DO block to drop all variations safely
DO $$
DECLARE
  func_record RECORD;
BEGIN
  -- Drop all variations of generate_poi_uuid_simple
  FOR func_record IN 
    SELECT oid::regprocedure as func_name
    FROM pg_proc
    WHERE proname = 'generate_poi_uuid_simple'
    AND pronamespace = (SELECT oid FROM pg_namespace WHERE nspname = 'homolog')
  LOOP
    EXECUTE 'DROP FUNCTION IF EXISTS ' || func_record.func_name || ' CASCADE';
  END LOOP;
END $$;

CREATE OR REPLACE FUNCTION homolog.generate_poi_uuid_simple(
  osm_id_val BIGINT,
  osm_type_val TEXT,
  name_val TEXT
) RETURNS UUID AS $$
DECLARE
  input_string TEXT;
  hash_hex TEXT;
  namespace_uuid TEXT := '6ba7b810-9dad-11d1-80b4-00c04fd430c8'; -- DNS namespace
  combined_string TEXT;
  md5_hash TEXT;
  result_uuid TEXT;
  variant_char CHAR;
BEGIN
  -- Create deterministic UUID based on OSM ID, type and name only
  -- This ensures the same POI always gets the same UUID regardless of coordinates
  -- Using MD5 hash (native PostgreSQL) to create deterministic UUID v3-like format
  
  input_string := CONCAT(
    'osm:', 
    COALESCE(osm_id_val::TEXT, '0'), ':', 
    COALESCE(osm_type_val, 'unknown'), ':', 
    COALESCE(name_val, 'Unnamed POI')
  );
  
  -- Combine namespace UUID and input string, then hash with MD5
  combined_string := namespace_uuid || ':' || input_string;
  md5_hash := md5(combined_string);
  
  -- Convert MD5 hash (32 hex chars) to UUID v3/v5 format
  -- UUID format: xxxxxxxx-xxxx-Mxxx-Nxxx-xxxxxxxxxxxx
  -- M = version (3 for MD5, 5 for SHA-1) - we'll use 3
  -- N = variant bits (8, 9, A, or B) - bits 12-13 must be 10
  variant_char := substring(md5_hash, 17, 1);
  
  -- Set variant bits: ensure first hex digit is 8, 9, A, or B
  -- This is done by ensuring bits 12-13 are 10
  IF variant_char NOT IN ('8', '9', 'a', 'b', 'A', 'B') THEN
    -- Force to 8, 9, A, or B by setting bit 12 to 1
    variant_char := CASE 
      WHEN variant_char IN ('0', '1', '2', '3') THEN '8'
      WHEN variant_char IN ('4', '5', '6', '7') THEN '9'
      WHEN variant_char IN ('c', 'C', 'd', 'D') THEN 'a'
      ELSE 'b'
    END;
  END IF;
  
  -- Format as UUID v3 (MD5-based)
  result_uuid := 
    substring(md5_hash, 1, 8) || '-' ||
    substring(md5_hash, 9, 4) || '-' ||
    '3' || substring(md5_hash, 14, 3) || '-' ||
    variant_char || substring(md5_hash, 18, 3) || '-' ||
    substring(md5_hash, 21, 12);
  
  RETURN result_uuid::UUID;
EXCEPTION
  WHEN OTHERS THEN
    -- Fallback: simple hash-based UUID
    md5_hash := md5(input_string);
    variant_char := CASE 
      WHEN substring(md5_hash, 17, 1) IN ('0', '1', '2', '3') THEN '8'
      WHEN substring(md5_hash, 17, 1) IN ('4', '5', '6', '7') THEN '9'
      WHEN substring(md5_hash, 17, 1) IN ('c', 'C', 'd', 'D') THEN 'a'
      ELSE 'b'
    END;
    result_uuid := 
      substring(md5_hash, 1, 8) || '-' ||
      substring(md5_hash, 9, 4) || '-' ||
      '3' || substring(md5_hash, 14, 3) || '-' ||
      variant_char || substring(md5_hash, 18, 3) || '-' ||
      substring(md5_hash, 21, 12);
    RETURN result_uuid::UUID;
END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION homolog.generate_poi_uuid_simple IS 'Generates deterministic UUID using only osm_id + osm_type + name (no coordinates)';

-- Step 2: Replace create_poi_with_uuid function with duplicate prevention
DROP FUNCTION IF EXISTS homolog.create_poi_with_uuid CASCADE;

CREATE OR REPLACE FUNCTION homolog.create_poi_with_uuid(
  -- Core essential fields (20 parameters)
  p_name TEXT DEFAULT NULL,
  p_city TEXT DEFAULT NULL,
  p_state TEXT DEFAULT NULL,
  p_country TEXT DEFAULT 'Brazil',
  p_category TEXT DEFAULT NULL,
  p_osm_id BIGINT DEFAULT NULL,
  p_osm_type TEXT DEFAULT NULL,
  p_place_id BIGINT DEFAULT NULL,
  p_formatted_address TEXT DEFAULT NULL,
  p_importance DECIMAL(5,2) DEFAULT NULL,
  p_source_file TEXT DEFAULT NULL,
  p_source_type TEXT DEFAULT 'osm',
  p_is_complete BOOLEAN DEFAULT FALSE,
  p_has_nominatim_data BOOLEAN DEFAULT FALSE,
  p_processing_status TEXT DEFAULT 'completed',
  p_osm_properties JSONB DEFAULT NULL,
  p_approved BOOLEAN DEFAULT FALSE,
  p_osm_geometry TEXT DEFAULT NULL,
  p_lat DECIMAL(10,8) DEFAULT NULL,
  p_lon DECIMAL(11,8) DEFAULT NULL,
  
  -- Address fields (5 parameters)
  p_description TEXT DEFAULT NULL,
  p_neighborhood TEXT DEFAULT NULL,
  p_street_name TEXT DEFAULT NULL,
  p_house_number TEXT DEFAULT NULL,
  p_postal_code TEXT DEFAULT NULL,
  
  -- Category fields (3 parameters)
  p_primary_category TEXT DEFAULT NULL,
  p_primary_category_type TEXT DEFAULT NULL,
  p_categories JSONB DEFAULT NULL,
  
  -- Contact fields (4 parameters)
  p_website TEXT DEFAULT NULL,
  p_contact_phone TEXT DEFAULT NULL,
  p_contact_email TEXT DEFAULT NULL,
  p_operator_name TEXT DEFAULT NULL,
  
  -- Brand fields (3 parameters)
  p_brand TEXT DEFAULT NULL,
  p_brand_wikidata TEXT DEFAULT NULL,
  p_brand_wikipedia TEXT DEFAULT NULL,
  
  -- Internet fields (2 parameters)
  p_internet_access TEXT DEFAULT NULL,
  p_internet_access_fee TEXT DEFAULT NULL,
  
  -- Accessibility fields (3 parameters)
  p_wheelchair_accessible TEXT DEFAULT NULL,
  p_wheelchair_toilets TEXT DEFAULT NULL,
  p_accessibility_notes TEXT DEFAULT NULL,
  
  -- Physical characteristics (6 parameters)
  p_height_m DECIMAL(8,2) DEFAULT NULL,
  p_elevation_m DECIMAL(8,2) DEFAULT NULL,
  p_architectural_style TEXT DEFAULT NULL,
  p_building_material TEXT DEFAULT NULL,
  p_building_colour TEXT DEFAULT NULL,
  p_capacity INTEGER DEFAULT NULL,
  
  -- Historical/Heritage fields (10 parameters)
  p_historic_period TEXT DEFAULT NULL,
  p_heritage_status TEXT DEFAULT NULL,
  p_unesco_status TEXT DEFAULT NULL,
  p_unesco_inscription_date TEXT DEFAULT NULL,
  p_unesco_reference TEXT DEFAULT NULL,
  p_landmark_type TEXT DEFAULT NULL,
  p_landmark_level INTEGER DEFAULT NULL,
  p_architect TEXT DEFAULT NULL,
  p_construction_status TEXT DEFAULT NULL,
  p_start_date TEXT DEFAULT NULL,
  
  -- Type-specific fields (9 parameters)
  p_museum_type TEXT DEFAULT NULL,
  p_museum_collection TEXT DEFAULT NULL,
  p_museum_audience TEXT DEFAULT NULL,
  p_museum_education TEXT DEFAULT NULL,
  p_leisure_type TEXT DEFAULT NULL,
  p_monument_type TEXT DEFAULT NULL,
  p_monument_event TEXT DEFAULT NULL,
  p_monument_person TEXT DEFAULT NULL,
  p_natural_water TEXT DEFAULT NULL,
  
  -- Infrastructure fields (3 parameters)
  p_parking_capacity TEXT DEFAULT NULL,
  p_access_points TEXT DEFAULT NULL,
  p_entrance_fee TEXT DEFAULT NULL,
  
  -- Environmental fields (2 parameters)
  p_urban_density TEXT DEFAULT NULL,
  p_shade_availability TEXT DEFAULT NULL,
  
  -- Cultural fields (3 parameters)
  p_cultural_significance TEXT DEFAULT NULL,
  p_local_traditions TEXT DEFAULT NULL,
  p_seasonal_attractions TEXT DEFAULT NULL,
  
  -- Tourism flags (11 parameters)
  p_is_historic BOOLEAN DEFAULT FALSE,
  p_is_touristic BOOLEAN DEFAULT FALSE,
  p_has_train BOOLEAN DEFAULT FALSE,
  p_has_ferry BOOLEAN DEFAULT FALSE,
  p_has_bus BOOLEAN DEFAULT FALSE,
  p_has_wheelchair_access BOOLEAN DEFAULT FALSE,
  p_has_water BOOLEAN DEFAULT FALSE,
  p_has_fishing BOOLEAN DEFAULT FALSE,
  p_has_playground BOOLEAN DEFAULT FALSE,
  p_is_building BOOLEAN DEFAULT FALSE,
  p_has_ruins BOOLEAN DEFAULT FALSE,
  
  -- Critical missing fields (4 parameters)
  p_opening_hours TEXT DEFAULT NULL,
  p_wikidata TEXT DEFAULT NULL,
  p_wikipedia TEXT DEFAULT NULL,
  p_amenity TEXT DEFAULT NULL,
  
  -- Important missing fields (3 parameters)
  p_building TEXT DEFAULT NULL,
  p_artwork_type TEXT DEFAULT NULL,
  p_information TEXT DEFAULT NULL,
  
  -- PBF analysis fields (6 parameters)
  p_source TEXT DEFAULT NULL,
  p_natural_type TEXT DEFAULT NULL,
  p_landuse TEXT DEFAULT NULL,
  p_access TEXT DEFAULT NULL,
  p_ref TEXT DEFAULT NULL,
  p_type TEXT DEFAULT NULL,
  
  -- Coordinate data (1 parameter)
  p_coordinate_data JSONB DEFAULT NULL
) RETURNS TABLE(
  poi_uuid_id UUID,
  success BOOLEAN,
  message TEXT
) AS $$
DECLARE
  generated_uuid UUID;
  existing_uuid UUID;
  poi_result UUID;
  coord_result UUID; -- Changed from BIGINT to UUID since coordinates.id is now UUID
BEGIN
  -- Generate deterministic UUID using ONLY osm_id + osm_type + name (NO coordinates)
  -- This prevents duplicates when same POI has slightly different coordinates
  generated_uuid := homolog.generate_poi_uuid_simple(
    COALESCE(p_osm_id, 0),
    COALESCE(p_osm_type, 'unknown'),
    COALESCE(p_name, 'Unnamed POI')
  );
  
  -- Check if POI with this UUID already exists
  SELECT uuid_id INTO existing_uuid
  FROM homolog.pois
  WHERE uuid_id = generated_uuid;
  
  -- If exists, return existing UUID (prevent duplicate)
  IF existing_uuid IS NOT NULL THEN
    RETURN QUERY SELECT existing_uuid, true, 'POI already exists (duplicate prevented)'::TEXT;
    RETURN;
  END IF;
  
  -- Initialize poi_result to NULL
  poi_result := NULL;
  
  -- Insert new POI with ON CONFLICT as additional safety
  -- Use a try-catch approach to ensure we always get a result
  BEGIN
    INSERT INTO homolog.pois (
    uuid_id, name, city, state, country, category, osm_id, osm_type, place_id,
    formatted_address, importance, source_file, source_type, is_complete,
    has_nominatim_data, processing_status, osm_properties, approved, osm_geometry,
    description, neighborhood, street_name, house_number, postal_code,
    primary_category, primary_category_type, categories,
    website, contact_phone, contact_email, operator_name,
    brand, brand_wikidata, brand_wikipedia,
    internet_access, internet_access_fee,
    wheelchair_accessible, wheelchair_toilets, accessibility_notes,
    height, architectural_style, building_material, building_colour,
    historic_period, heritage_status, unesco_status, unesco_inscription_date, unesco_reference,
    landmark_type, landmark_level, architect, construction_status, start_date,
    museum_type, museum_collection, museum_audience, museum_education,
    leisure_type, monument_type, monument_event, monument_person, natural_water,
    parking_capacity, access_points, entrance_fee,
    urban_density, shade_availability,
    cultural_significance, local_traditions, seasonal_attractions,
    is_historic, is_touristic, has_train, has_ferry, has_bus,
    has_wheelchair_access, has_water, has_fishing, has_playground, is_building, has_ruins,
    opening_hours, wikidata, wikipedia, amenity,
    building, artwork_type, information,
    source, natural_type, landuse, access, ref, type,
    lat, lon
  ) VALUES (
    generated_uuid, p_name, p_city, p_state, p_country, p_category, p_osm_id, p_osm_type, p_place_id,
    p_formatted_address, p_importance, p_source_file, p_source_type, p_is_complete,
    p_has_nominatim_data, p_processing_status, p_osm_properties, p_approved,
    CASE 
      WHEN p_osm_geometry IS NOT NULL THEN ST_GeomFromGeoJSON(p_osm_geometry)::GEOGRAPHY
      ELSE NULL 
    END,
    p_description, p_neighborhood, p_street_name, p_house_number, p_postal_code,
    p_primary_category, p_primary_category_type, p_categories,
    p_website, p_contact_phone, p_contact_email, p_operator_name,
    p_brand, p_brand_wikidata, p_brand_wikipedia,
    p_internet_access, p_internet_access_fee,
    p_wheelchair_accessible, p_wheelchair_toilets, p_accessibility_notes,
    p_height_m, p_architectural_style, p_building_material, p_building_colour,
    p_historic_period, p_heritage_status, p_unesco_status, p_unesco_inscription_date, p_unesco_reference,
    p_landmark_type, p_landmark_level, p_architect, p_construction_status, p_start_date,
    p_museum_type, p_museum_collection, p_museum_audience, p_museum_education,
    p_leisure_type, p_monument_type, p_monument_event, p_monument_person, p_natural_water,
    p_parking_capacity, p_access_points, p_entrance_fee,
    p_urban_density, p_shade_availability,
    p_cultural_significance, p_local_traditions, p_seasonal_attractions,
    p_is_historic, p_is_touristic, p_has_train, p_has_ferry, p_has_bus,
    p_has_wheelchair_access, p_has_water, p_has_fishing, p_has_playground, p_is_building, p_has_ruins,
    p_opening_hours, p_wikidata, p_wikipedia, p_amenity,
    p_building, p_artwork_type, p_information,
    p_source, p_natural_type, p_landuse, p_access, p_ref, p_type,
    p_lat, p_lon
    )
    ON CONFLICT (uuid_id) DO NOTHING
    RETURNING uuid_id INTO poi_result;
    
    -- If INSERT was skipped due to conflict, get existing UUID
    IF poi_result IS NULL THEN
      SELECT uuid_id INTO poi_result
      FROM homolog.pois
      WHERE uuid_id = generated_uuid;
    END IF;
  EXCEPTION
    WHEN OTHERS THEN
      -- If insert fails, try to get existing UUID
      RAISE WARNING 'Error during POI insert: %', SQLERRM;
      SELECT uuid_id INTO poi_result
      FROM homolog.pois
      WHERE uuid_id = generated_uuid;
  END;
  
  -- Insert coordinates if provided and POI was created
  IF p_coordinate_data IS NOT NULL AND poi_result IS NOT NULL THEN
    INSERT INTO homolog.coordinates (
      poi_uuid_id, latitude, longitude, elevation_m, boundary_type, boundary_source,
      show_in_map, boundary_geometry
    ) VALUES (
      poi_result,
      (p_coordinate_data->>'latitude')::DECIMAL(10,8),
      (p_coordinate_data->>'longitude')::DECIMAL(11,8),
      (p_coordinate_data->>'elevation_m')::INTEGER,
      COALESCE(p_coordinate_data->>'boundary_type', 'point'),
      COALESCE(p_coordinate_data->>'boundary_source', 'osm'),
      COALESCE((p_coordinate_data->>'show_in_map')::BOOLEAN, true),
      CASE 
        WHEN p_coordinate_data->>'boundary_geometry' IS NOT NULL THEN 
          ST_GeomFromGeoJSON(p_coordinate_data->>'boundary_geometry')::GEOGRAPHY
        WHEN (p_coordinate_data->>'latitude') IS NOT NULL AND (p_coordinate_data->>'longitude') IS NOT NULL THEN
          -- Create a Point geometry from lat/lon if boundary_geometry not provided
          ST_SetSRID(ST_MakePoint(
            (p_coordinate_data->>'longitude')::DECIMAL(11,8),
            (p_coordinate_data->>'latitude')::DECIMAL(10,8)
          ), 4326)::GEOGRAPHY
        ELSE NULL
      END
    )
    ON CONFLICT ON CONSTRAINT coordinates_poi_uuid_unique DO UPDATE SET
      latitude = EXCLUDED.latitude,
      longitude = EXCLUDED.longitude,
      elevation_m = EXCLUDED.elevation_m,
      boundary_type = EXCLUDED.boundary_type,
      boundary_source = EXCLUDED.boundary_source,
      show_in_map = EXCLUDED.show_in_map,
      boundary_geometry = EXCLUDED.boundary_geometry,
      updated_at = NOW()
    RETURNING id INTO coord_result;
  END IF;
  
  -- Return success - ensure we always return something
  -- Critical: Always return at least one row, even if it's an error
  IF poi_result IS NOT NULL THEN
    RETURN QUERY SELECT poi_result, true, 'POI created successfully'::TEXT;
    RETURN; -- Ensure we exit here
  ELSE
    -- This should never happen, but handle it gracefully
    RAISE WARNING 'POI result is NULL after insert attempt for UUID: %', generated_uuid;
    RETURN QUERY SELECT generated_uuid, false, 'POI insert failed - result is NULL'::TEXT;
    RETURN; -- Ensure we exit here
  END IF;
  
EXCEPTION
  WHEN OTHERS THEN
    -- Return error with full details for debugging
    -- Always return at least one row, even on error
    RAISE WARNING 'Error in create_poi_with_uuid: %', SQLERRM;
    RETURN QUERY SELECT COALESCE(generated_uuid, '00000000-0000-0000-0000-000000000000'::UUID), false, 
      ('Error: ' || SQLERRM)::TEXT;
    RETURN; -- Ensure we exit here
END;
$$ LANGUAGE plpgsql;

-- Grant permissions
GRANT EXECUTE ON FUNCTION homolog.create_poi_with_uuid TO authenticated;
GRANT EXECUTE ON FUNCTION homolog.create_poi_with_uuid TO service_role;
GRANT EXECUTE ON FUNCTION homolog.generate_poi_uuid_simple TO authenticated;
GRANT EXECUTE ON FUNCTION homolog.generate_poi_uuid_simple TO service_role;

-- Comments
COMMENT ON FUNCTION homolog.create_poi_with_uuid IS 'Creates POI with UUID based on osm_id + osm_type + name (no coordinates). Prevents duplicates by checking existing UUID before insert.';
COMMENT ON FUNCTION homolog.generate_poi_uuid_simple IS 'Generates deterministic UUID using only osm_id + osm_type + name (coordinates not used to prevent duplicates)';

