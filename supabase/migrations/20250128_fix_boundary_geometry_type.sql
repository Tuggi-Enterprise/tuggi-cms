-- Fix boundary_geometry column type from TEXT to GEOGRAPHY
-- This migration fixes the type mismatch that prevents POI imports

-- Step 1: Check current column type and convert if needed
DO $$
BEGIN
  -- Check if column exists and is TEXT type
  IF EXISTS (
    SELECT 1 
    FROM information_schema.columns 
    WHERE table_schema = 'homolog' 
    AND table_name = 'coordinates' 
    AND column_name = 'boundary_geometry'
    AND data_type = 'text'
  ) THEN
    -- Column is TEXT, need to convert to GEOGRAPHY
    RAISE NOTICE 'Converting boundary_geometry from TEXT to GEOGRAPHY';
    
    -- Add new GEOGRAPHY column
    ALTER TABLE homolog.coordinates 
    ADD COLUMN IF NOT EXISTS boundary_geometry_new GEOGRAPHY;

    -- Convert existing TEXT data to GEOGRAPHY (if any exists)
    UPDATE homolog.coordinates
    SET boundary_geometry_new = 
      CASE 
        WHEN boundary_geometry IS NOT NULL AND boundary_geometry::text != '' THEN
          ST_GeomFromGeoJSON(boundary_geometry::text)::GEOGRAPHY
        ELSE NULL
      END
    WHERE boundary_geometry IS NOT NULL AND boundary_geometry_new IS NULL;

    -- Drop old TEXT column
    ALTER TABLE homolog.coordinates DROP COLUMN IF EXISTS boundary_geometry;

    -- Rename new column to original name
    ALTER TABLE homolog.coordinates RENAME COLUMN boundary_geometry_new TO boundary_geometry;
    
    RAISE NOTICE 'Conversion completed successfully';
  ELSE
    -- Check if it's already GEOGRAPHY
    IF EXISTS (
      SELECT 1 
      FROM information_schema.columns 
      WHERE table_schema = 'homolog' 
      AND table_name = 'coordinates' 
      AND column_name = 'boundary_geometry'
      AND udt_name = 'geography'
    ) THEN
      RAISE NOTICE 'Column is already GEOGRAPHY type, no conversion needed';
    ELSE
      RAISE NOTICE 'Column boundary_geometry does not exist, will be created as GEOGRAPHY';
    END IF;
  END IF;
END $$;

-- Step 5: Recreate GIST index for GEOGRAPHY type
DROP INDEX IF EXISTS homolog.idx_coordinates_boundary_geometry;
CREATE INDEX IF NOT EXISTS idx_coordinates_boundary_geometry 
ON homolog.coordinates USING GIST (boundary_geometry) 
WHERE boundary_geometry IS NOT NULL;

-- Step 6: Update view to convert GEOGRAPHY back to GeoJSON TEXT for API compatibility
CREATE OR REPLACE VIEW homolog.coordinates_with_pois AS
SELECT 
  c.id as coordinate_id,
  c.poi_uuid_id,
  c.latitude,
  c.longitude,
  c.elevation_m,
  c.distance_from_sao_paulo_km,
  c.distance_from_rio_km,
  CASE 
    WHEN c.boundary_geometry IS NOT NULL THEN ST_AsGeoJSON(c.boundary_geometry::geometry)::TEXT
    ELSE NULL
  END AS boundary_geometry,
  c.boundary_type,
  c.boundary_source,
  c.boundary_confidence,
  c.boundary_area_m2,
  c.boundary_centroid_lat,
  c.boundary_centroid_lng,
  c.show_in_map,
  c.created_at as coordinate_created_at,
  c.updated_at as coordinate_updated_at,
  p.uuid_id as poi_uuid,
  p.name as poi_name,
  p.city as poi_city,
  p.state as poi_state,
  p.country as poi_country,
  p.category as poi_category,
  c.latitude as poi_lat,
  c.longitude as poi_lon,
  p.approved as poi_approved
FROM homolog.coordinates c
LEFT JOIN homolog.pois p ON c.poi_uuid_id = p.uuid_id;

-- Step 7: Update get_coordinates_paginated function to convert GEOGRAPHY to TEXT
-- Drop existing function first to avoid type mismatch error
DROP FUNCTION IF EXISTS homolog.get_coordinates_paginated(UUID, INTEGER, INTEGER) CASCADE;

CREATE OR REPLACE FUNCTION homolog.get_coordinates_paginated(
  poi_uuid_filter UUID DEFAULT NULL,
  page_limit INTEGER DEFAULT 50,
  page_offset INTEGER DEFAULT 0
)
RETURNS TABLE (
  id UUID,
  poi_uuid_id UUID,
  latitude DECIMAL(10,8),
  longitude DECIMAL(11,8),
  elevation_m INTEGER,
  distance_from_sao_paulo_km DECIMAL(8,2),
  distance_from_rio_km DECIMAL(8,2),
  boundary_geometry TEXT,
  boundary_type TEXT,
  boundary_source TEXT,
  boundary_confidence DECIMAL(3,2),
  boundary_area_m2 DECIMAL(12,2),
  boundary_centroid_lat DECIMAL(10,8),
  boundary_centroid_lng DECIMAL(11,8),
  show_in_map BOOLEAN,
  created_at TIMESTAMP WITH TIME ZONE,
  updated_at TIMESTAMP WITH TIME ZONE,
  total_count BIGINT
) AS $$
DECLARE
  total_rows BIGINT;
BEGIN
  -- Calculate total rows for pagination metadata
  SELECT COUNT(*) INTO total_rows
  FROM homolog.coordinates c
  WHERE (poi_uuid_filter IS NULL OR c.poi_uuid_id = poi_uuid_filter);

  RETURN QUERY
  SELECT 
    c.id,
    c.poi_uuid_id,
    c.latitude,
    c.longitude,
    c.elevation_m,
    c.distance_from_sao_paulo_km,
    c.distance_from_rio_km,
    CASE 
      WHEN c.boundary_geometry IS NOT NULL THEN ST_AsGeoJSON(c.boundary_geometry::geometry)::TEXT
      ELSE NULL
    END AS boundary_geometry,
    c.boundary_type,
    c.boundary_source,
    c.boundary_confidence,
    c.boundary_area_m2,
    c.boundary_centroid_lat,
    c.boundary_centroid_lng,
    c.show_in_map,
    c.created_at,
    c.updated_at,
    total_rows AS total_count
  FROM homolog.coordinates c
  WHERE 
    (poi_uuid_filter IS NULL OR c.poi_uuid_id = poi_uuid_filter)
  ORDER BY c.created_at DESC
  LIMIT page_limit
  OFFSET page_offset;
END;
$$ LANGUAGE plpgsql;

-- Step 8: Recreate create_poi_with_uuid function to ensure it uses GEOGRAPHY type correctly
-- First ensure generate_poi_uuid_simple exists
CREATE OR REPLACE FUNCTION homolog.generate_poi_uuid_simple(
  osm_id_val BIGINT,
  osm_type_val TEXT,
  name_val TEXT
) RETURNS UUID AS $$
DECLARE
  input_string TEXT;
  namespace_uuid TEXT := '6ba7b810-9dad-11d1-80b4-00c04fd430c8';
  combined_string TEXT;
  md5_hash TEXT;
  result_uuid TEXT;
  variant_char CHAR;
BEGIN
  input_string := CONCAT('osm:', COALESCE(osm_id_val::TEXT, '0'), ':', COALESCE(osm_type_val, 'unknown'), ':', COALESCE(name_val, 'Unnamed POI'));
  combined_string := namespace_uuid || ':' || input_string;
  md5_hash := md5(combined_string);
  variant_char := substring(md5_hash, 17, 1);
  IF variant_char NOT IN ('8', '9', 'a', 'b', 'A', 'B') THEN
    variant_char := CASE 
      WHEN variant_char IN ('0', '1', '2', '3') THEN '8'
      WHEN variant_char IN ('4', '5', '6', '7') THEN '9'
      WHEN variant_char IN ('c', 'C', 'd', 'D') THEN 'a'
      ELSE 'b'
    END;
  END IF;
  result_uuid := substring(md5_hash, 1, 8) || '-' || substring(md5_hash, 9, 4) || '-' || '3' || substring(md5_hash, 14, 3) || '-' || variant_char || substring(md5_hash, 18, 3) || '-' || substring(md5_hash, 21, 12);
  RETURN result_uuid::UUID;
END;
$$ LANGUAGE plpgsql;

-- Now recreate create_poi_with_uuid function with correct GEOGRAPHY handling
DROP FUNCTION IF EXISTS homolog.create_poi_with_uuid CASCADE;

CREATE OR REPLACE FUNCTION homolog.create_poi_with_uuid(
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
  p_description TEXT DEFAULT NULL,
  p_neighborhood TEXT DEFAULT NULL,
  p_street_name TEXT DEFAULT NULL,
  p_house_number TEXT DEFAULT NULL,
  p_postal_code TEXT DEFAULT NULL,
  p_primary_category TEXT DEFAULT NULL,
  p_primary_category_type TEXT DEFAULT NULL,
  p_categories JSONB DEFAULT NULL,
  p_website TEXT DEFAULT NULL,
  p_contact_phone TEXT DEFAULT NULL,
  p_contact_email TEXT DEFAULT NULL,
  p_operator_name TEXT DEFAULT NULL,
  p_brand TEXT DEFAULT NULL,
  p_brand_wikidata TEXT DEFAULT NULL,
  p_brand_wikipedia TEXT DEFAULT NULL,
  p_internet_access TEXT DEFAULT NULL,
  p_internet_access_fee TEXT DEFAULT NULL,
  p_wheelchair_accessible TEXT DEFAULT NULL,
  p_wheelchair_toilets TEXT DEFAULT NULL,
  p_accessibility_notes TEXT DEFAULT NULL,
  p_height_m DECIMAL(8,2) DEFAULT NULL,
  p_elevation_m DECIMAL(8,2) DEFAULT NULL,
  p_architectural_style TEXT DEFAULT NULL,
  p_building_material TEXT DEFAULT NULL,
  p_building_colour TEXT DEFAULT NULL,
  p_capacity INTEGER DEFAULT NULL,
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
  p_museum_type TEXT DEFAULT NULL,
  p_museum_collection TEXT DEFAULT NULL,
  p_museum_audience TEXT DEFAULT NULL,
  p_museum_education TEXT DEFAULT NULL,
  p_leisure_type TEXT DEFAULT NULL,
  p_monument_type TEXT DEFAULT NULL,
  p_monument_event TEXT DEFAULT NULL,
  p_monument_person TEXT DEFAULT NULL,
  p_natural_water TEXT DEFAULT NULL,
  p_parking_capacity TEXT DEFAULT NULL,
  p_access_points TEXT DEFAULT NULL,
  p_entrance_fee TEXT DEFAULT NULL,
  p_urban_density TEXT DEFAULT NULL,
  p_shade_availability TEXT DEFAULT NULL,
  p_cultural_significance TEXT DEFAULT NULL,
  p_local_traditions TEXT DEFAULT NULL,
  p_seasonal_attractions TEXT DEFAULT NULL,
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
  p_opening_hours TEXT DEFAULT NULL,
  p_wikidata TEXT DEFAULT NULL,
  p_wikipedia TEXT DEFAULT NULL,
  p_amenity TEXT DEFAULT NULL,
  p_building TEXT DEFAULT NULL,
  p_artwork_type TEXT DEFAULT NULL,
  p_information TEXT DEFAULT NULL,
  p_source TEXT DEFAULT NULL,
  p_natural_type TEXT DEFAULT NULL,
  p_landuse TEXT DEFAULT NULL,
  p_access TEXT DEFAULT NULL,
  p_ref TEXT DEFAULT NULL,
  p_type TEXT DEFAULT NULL,
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
  coord_result UUID;
BEGIN
  generated_uuid := homolog.generate_poi_uuid_simple(COALESCE(p_osm_id, 0), COALESCE(p_osm_type, 'unknown'), COALESCE(p_name, 'Unnamed POI'));
  SELECT uuid_id INTO existing_uuid FROM homolog.pois WHERE uuid_id = generated_uuid;
  IF existing_uuid IS NOT NULL THEN
    RETURN QUERY SELECT existing_uuid, true, 'POI already exists (duplicate prevented)'::TEXT;
    RETURN;
  END IF;
  poi_result := NULL;
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
      CASE WHEN p_osm_geometry IS NOT NULL THEN ST_GeomFromGeoJSON(p_osm_geometry)::GEOGRAPHY ELSE NULL END,
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
    IF poi_result IS NULL THEN
      SELECT uuid_id INTO poi_result FROM homolog.pois WHERE uuid_id = generated_uuid;
    END IF;
  EXCEPTION
    WHEN OTHERS THEN
      RAISE WARNING 'Error during POI insert: %', SQLERRM;
      SELECT uuid_id INTO poi_result FROM homolog.pois WHERE uuid_id = generated_uuid;
  END;
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
          ST_SetSRID(ST_MakePoint((p_coordinate_data->>'longitude')::DECIMAL(11,8), (p_coordinate_data->>'latitude')::DECIMAL(10,8)), 4326)::GEOGRAPHY
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
  IF poi_result IS NOT NULL THEN
    RETURN QUERY SELECT poi_result, true, 'POI created successfully'::TEXT;
    RETURN;
  ELSE
    RAISE WARNING 'POI result is NULL after insert attempt for UUID: %', generated_uuid;
    RETURN QUERY SELECT generated_uuid, false, 'POI insert failed - result is NULL'::TEXT;
    RETURN;
  END IF;
EXCEPTION
  WHEN OTHERS THEN
    RAISE WARNING 'Error in create_poi_with_uuid: %', SQLERRM;
    RETURN QUERY SELECT COALESCE(generated_uuid, '00000000-0000-0000-0000-000000000000'::UUID), false, ('Error: ' || SQLERRM)::TEXT;
    RETURN;
END;
$$ LANGUAGE plpgsql;

-- Grant permissions
GRANT EXECUTE ON FUNCTION homolog.create_poi_with_uuid TO authenticated;
GRANT EXECUTE ON FUNCTION homolog.create_poi_with_uuid TO service_role;
GRANT EXECUTE ON FUNCTION homolog.generate_poi_uuid_simple TO authenticated;
GRANT EXECUTE ON FUNCTION homolog.generate_poi_uuid_simple TO service_role;

-- Step 9: Fix upsert_coordinate function to resolve ambiguity
DROP FUNCTION IF EXISTS homolog.upsert_coordinate CASCADE;

CREATE OR REPLACE FUNCTION homolog.upsert_coordinate(
  p_poi_uuid_id UUID,
  p_latitude DECIMAL(10,8),
  p_longitude DECIMAL(11,8),
  p_id UUID DEFAULT gen_random_uuid(),
  p_elevation_m INTEGER DEFAULT NULL,
  p_distance_from_sao_paulo_km DECIMAL(8,2) DEFAULT NULL,
  p_distance_from_rio_km DECIMAL(8,2) DEFAULT NULL,
  p_boundary_geometry_geojson TEXT DEFAULT NULL,
  p_boundary_type TEXT DEFAULT 'point',
  p_boundary_source TEXT DEFAULT 'osm',
  p_boundary_confidence DECIMAL(3,2) DEFAULT NULL,
  p_boundary_area_m2 DECIMAL(12,2) DEFAULT NULL,
  p_boundary_centroid_lat DECIMAL(10,8) DEFAULT NULL,
  p_boundary_centroid_lng DECIMAL(11,8) DEFAULT NULL,
  p_show_in_map BOOLEAN DEFAULT true
) RETURNS TABLE (
  id UUID,
  poi_uuid_id UUID,
  latitude DECIMAL(10,8),
  longitude DECIMAL(11,8),
  elevation_m INTEGER,
  distance_from_sao_paulo_km DECIMAL(8,2),
  distance_from_rio_km DECIMAL(8,2),
  boundary_geometry TEXT,
  boundary_type TEXT,
  boundary_source TEXT,
  boundary_confidence DECIMAL(3,2),
  boundary_area_m2 DECIMAL(12,2),
  boundary_centroid_lat DECIMAL(10,8),
  boundary_centroid_lng DECIMAL(11,8),
  show_in_map BOOLEAN,
  created_at TIMESTAMP WITH TIME ZONE,
  updated_at TIMESTAMP WITH TIME ZONE
) AS $$
DECLARE
  boundary_geography GEOGRAPHY;
BEGIN
  -- Convert GeoJSON string to GEOGRAPHY if provided
  IF p_boundary_geometry_geojson IS NOT NULL THEN
    boundary_geography := ST_GeomFromGeoJSON(p_boundary_geometry_geojson)::GEOGRAPHY;
  ELSE
    boundary_geography := NULL;
  END IF;

  -- Upsert coordinate using constraint name to avoid ambiguity
  INSERT INTO homolog.coordinates (
    id,
    poi_uuid_id,
    latitude,
    longitude,
    elevation_m,
    distance_from_sao_paulo_km,
    distance_from_rio_km,
    boundary_geometry,
    boundary_type,
    boundary_source,
    boundary_confidence,
    boundary_area_m2,
    boundary_centroid_lat,
    boundary_centroid_lng,
    show_in_map
  ) VALUES (
    p_id,
    p_poi_uuid_id,
    p_latitude,
    p_longitude,
    p_elevation_m,
    p_distance_from_sao_paulo_km,
    p_distance_from_rio_km,
    boundary_geography,
    p_boundary_type,
    p_boundary_source,
    p_boundary_confidence,
    p_boundary_area_m2,
    p_boundary_centroid_lat,
    p_boundary_centroid_lng,
    p_show_in_map
  )
  ON CONFLICT ON CONSTRAINT coordinates_poi_uuid_unique DO UPDATE SET
    latitude = EXCLUDED.latitude,
    longitude = EXCLUDED.longitude,
    elevation_m = EXCLUDED.elevation_m,
    distance_from_sao_paulo_km = EXCLUDED.distance_from_sao_paulo_km,
    distance_from_rio_km = EXCLUDED.distance_from_rio_km,
    boundary_geometry = EXCLUDED.boundary_geometry,
    boundary_type = EXCLUDED.boundary_type,
    boundary_source = EXCLUDED.boundary_source,
    boundary_confidence = EXCLUDED.boundary_confidence,
    boundary_area_m2 = EXCLUDED.boundary_area_m2,
    boundary_centroid_lat = EXCLUDED.boundary_centroid_lat,
    boundary_centroid_lng = EXCLUDED.boundary_centroid_lng,
    show_in_map = EXCLUDED.show_in_map,
    updated_at = NOW();

  -- Return the inserted/updated record
  RETURN QUERY
  SELECT 
    c.id,
    c.poi_uuid_id,
    c.latitude,
    c.longitude,
    c.elevation_m,
    c.distance_from_sao_paulo_km,
    c.distance_from_rio_km,
    CASE 
      WHEN c.boundary_geometry IS NOT NULL THEN ST_AsGeoJSON(c.boundary_geometry::geometry)::TEXT
      ELSE NULL
    END AS boundary_geometry,
    c.boundary_type,
    c.boundary_source,
    c.boundary_confidence,
    c.boundary_area_m2,
    c.boundary_centroid_lat,
    c.boundary_centroid_lng,
    c.show_in_map,
    c.created_at,
    c.updated_at
  FROM homolog.coordinates c
  WHERE c.poi_uuid_id = p_poi_uuid_id;
END;
$$ LANGUAGE plpgsql;

-- Grant permissions
GRANT EXECUTE ON FUNCTION homolog.upsert_coordinate TO authenticated;
GRANT EXECUTE ON FUNCTION homolog.upsert_coordinate TO service_role;

-- Step 10: Update comments
COMMENT ON COLUMN homolog.coordinates.boundary_geometry IS 'PostGIS GEOGRAPHY type containing boundary geometry (converted from GeoJSON)';
COMMENT ON FUNCTION homolog.create_poi_with_uuid IS 'Creates POI with UUID based on osm_id + osm_type + name (no coordinates). Prevents duplicates by checking existing UUID before insert.';
COMMENT ON FUNCTION homolog.upsert_coordinate IS 'Upserts coordinate data with GEOGRAPHY conversion. Uses constraint name to avoid ambiguity.';

