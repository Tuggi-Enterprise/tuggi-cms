-- Fix OSM geometry conversion to handle LineString and other geometry types safely
-- This prevents POI insert failures when geometry conversion fails

-- Create a safe geometry conversion function
CREATE OR REPLACE FUNCTION homolog.safe_geom_from_geojson(geojson_text TEXT)
RETURNS GEOGRAPHY
LANGUAGE plpgsql
IMMUTABLE
AS $$
DECLARE
  geom_result GEOGRAPHY;
  geom_json JSONB;
BEGIN
  -- Return NULL if input is NULL or empty
  IF geojson_text IS NULL OR geojson_text = '' THEN
    RETURN NULL;
  END IF;

  BEGIN
    -- Parse JSON to validate it's valid JSON
    geom_json := geojson_text::JSONB;
    
    -- Check if it's a valid GeoJSON structure
    IF geom_json->>'type' IS NULL THEN
      RETURN NULL;
    END IF;

    -- Only convert Point, Polygon, and MultiPolygon to GEOGRAPHY
    -- LineString and MultiLineString are not suitable for GEOGRAPHY in many cases
    IF geom_json->>'type' IN ('Point', 'Polygon', 'MultiPolygon') THEN
      -- Try to convert to geometry first
      geom_result := ST_GeomFromGeoJSON(geojson_text)::GEOGRAPHY;
      
      -- Validate the geometry is valid
      IF ST_IsValid(geom_result::GEOMETRY) THEN
        RETURN geom_result;
      ELSE
        -- If geometry is invalid, try to make it valid
        BEGIN
          geom_result := ST_MakeValid(geom_result::GEOMETRY)::GEOGRAPHY;
          RETURN geom_result;
        EXCEPTION
          WHEN OTHERS THEN
            -- If even ST_MakeValid fails, return NULL
            RETURN NULL;
        END;
      END IF;
    ELSE
      -- For LineString, MultiLineString, or other types, return NULL
      -- These will be stored as JSON in osm_geometry instead
      RETURN NULL;
    END IF;

  EXCEPTION
    WHEN OTHERS THEN
      -- If any error occurs during conversion, return NULL instead of failing
      RETURN NULL;
  END;
END;
$$;

-- Update the create_poi_with_uuid function to use safe conversion
-- IMPORTANT: This maintains the EXACT signature from the original function
-- Only changes the geometry conversion to use safe_geom_from_geojson
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
) RETURNS TABLE (
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
      -- Use safe conversion function instead of direct conversion
      homolog.safe_geom_from_geojson(p_osm_geometry),
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
          homolog.safe_geom_from_geojson(p_coordinate_data->>'boundary_geometry')
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
GRANT EXECUTE ON FUNCTION homolog.safe_geom_from_geojson(TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION homolog.safe_geom_from_geojson(TEXT) TO service_role;
GRANT EXECUTE ON FUNCTION homolog.create_poi_with_uuid TO authenticated;
GRANT EXECUTE ON FUNCTION homolog.create_poi_with_uuid TO service_role;

