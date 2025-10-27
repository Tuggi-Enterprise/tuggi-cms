-- Create RPC function to create POI with UUID generation
-- This is better than triggers because we have full control

-- Drop existing function first to avoid conflicts
DROP FUNCTION IF EXISTS homolog.create_poi_with_uuid CASCADE;

CREATE OR REPLACE FUNCTION homolog.create_poi_with_uuid(
  -- Required parameters first
  p_name TEXT,
  p_city TEXT,
  p_state TEXT,
  p_category TEXT,
  p_osm_id BIGINT,
  p_osm_type TEXT,
  p_source_file TEXT,
  p_lat DECIMAL(10,8),
  p_lon DECIMAL(11,8),
  -- Optional parameters with defaults
  p_country TEXT DEFAULT 'Brazil',
  p_place_id BIGINT DEFAULT NULL,
  p_formatted_address TEXT DEFAULT NULL,
  p_importance DECIMAL(5,2) DEFAULT NULL,
  p_source_type TEXT DEFAULT 'osm',
  p_is_complete BOOLEAN DEFAULT FALSE,
  p_has_nominatim_data BOOLEAN DEFAULT FALSE,
  p_processing_status TEXT DEFAULT 'completed',
  p_osm_properties JSONB DEFAULT NULL,
  p_approved BOOLEAN DEFAULT FALSE,
  p_osm_geometry TEXT DEFAULT NULL,
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
  p_wheelchair_accessible TEXT DEFAULT NULL,
  p_wheelchair_toilets TEXT DEFAULT NULL,
  p_accessibility_notes TEXT DEFAULT NULL,
  p_height_m DECIMAL(8,2) DEFAULT NULL,
  p_elevation_m DECIMAL(8,2) DEFAULT NULL,
  p_building_material TEXT DEFAULT NULL,
  p_building_colour TEXT DEFAULT NULL,
  p_roof_colour TEXT DEFAULT NULL,
  p_architectural_style TEXT DEFAULT NULL,
  p_historic_period TEXT DEFAULT NULL,
  p_landmark_type TEXT DEFAULT NULL,
  p_architect TEXT DEFAULT NULL,
  p_construction_status TEXT DEFAULT NULL,
  p_start_date TEXT DEFAULT NULL,
  p_heritage_status TEXT DEFAULT NULL,
  p_unesco_status TEXT DEFAULT NULL,
  p_unesco_inscription_date TEXT DEFAULT NULL,
  p_unesco_reference TEXT DEFAULT NULL,
  p_landmark_level INTEGER DEFAULT NULL,
  p_importance_level TEXT DEFAULT NULL,
  p_museum_type TEXT DEFAULT NULL,
  p_museum_collection TEXT DEFAULT NULL,
  p_museum_audience TEXT DEFAULT NULL,
  p_museum_education TEXT DEFAULT NULL,
  p_leisure_type TEXT DEFAULT NULL,
  p_natural_type TEXT DEFAULT NULL,
  p_natural_water TEXT DEFAULT NULL,
  p_sport_facilities TEXT DEFAULT NULL,
  p_leisure_playground TEXT DEFAULT NULL,
  p_monument_type TEXT DEFAULT NULL,
  p_monument_event TEXT DEFAULT NULL,
  p_monument_person TEXT DEFAULT NULL,
  p_parking_capacity TEXT DEFAULT NULL,
  p_public_transport TEXT DEFAULT NULL,
  p_access_points TEXT DEFAULT NULL,
  p_entrance_fee TEXT DEFAULT NULL,
  p_urban_density TEXT DEFAULT NULL,
  p_noise_level TEXT DEFAULT NULL,
  p_air_quality TEXT DEFAULT NULL,
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
  p_coordinate_data JSONB DEFAULT NULL
) RETURNS TABLE(
  poi_uuid_id UUID,
  success BOOLEAN,
  message TEXT
) AS $$
DECLARE
  generated_uuid UUID;
  poi_result RECORD;
  coord_result RECORD;
BEGIN
  -- Generate UUID using real coordinates
  generated_uuid := homolog.generate_poi_uuid_with_coords(
    p_osm_id,
    p_osm_type,
    p_name,
    p_lat,
    p_lon
  );
  
  -- Insert POI
  INSERT INTO homolog.pois (
    uuid_id, name, city, state, country, category, osm_id, osm_type, place_id,
    formatted_address, importance, source_file, source_type, is_complete,
    has_nominatim_data, processing_status, osm_properties, approved, osm_geometry,
    description, neighborhood, street_name, house_number, postal_code,
    primary_category, primary_category_type, categories, website, contact_phone,
    contact_email, operator_name, wheelchair_accessible, wheelchair_toilets,
    accessibility_notes, height_m, elevation_m, building_material, building_colour, roof_colour,
    architectural_style, historic_period, landmark_type, architect, construction_status,
    start_date, heritage_status, unesco_status, unesco_inscription_date, unesco_reference,
    landmark_level, importance_level, museum_type, museum_collection, museum_audience,
    museum_education, leisure_type, natural_type, natural_water, sport_facilities,
    leisure_playground, monument_type, monument_event, monument_person, parking_capacity,
    public_transport, access_points, entrance_fee, urban_density, noise_level,
    air_quality, shade_availability, cultural_significance, local_traditions,
    seasonal_attractions, is_historic, is_touristic, has_train, has_ferry, has_bus,
    has_wheelchair_access, has_water, has_fishing, has_playground, is_building, has_ruins
  ) VALUES (
    generated_uuid, p_name, p_city, p_state, p_country, p_category, p_osm_id, p_osm_type, p_place_id,
    p_formatted_address, p_importance, p_source_file, p_source_type, p_is_complete,
    p_has_nominatim_data, p_processing_status, p_osm_properties, p_approved, 
    CASE 
      WHEN p_osm_geometry IS NOT NULL THEN ST_GeomFromGeoJSON(p_osm_geometry)::GEOGRAPHY
      ELSE NULL 
    END,
    p_description, p_neighborhood, p_street_name, p_house_number, p_postal_code,
    p_primary_category, p_primary_category_type, p_categories, p_website, p_contact_phone,
    p_contact_email, p_operator_name, p_wheelchair_accessible, p_wheelchair_toilets,
    p_accessibility_notes, p_height_m, p_elevation_m, p_building_material, p_building_colour, p_roof_colour,
    p_architectural_style, p_historic_period, p_landmark_type, p_architect, p_construction_status,
    p_start_date, p_heritage_status, p_unesco_status, p_unesco_inscription_date, p_unesco_reference,
    p_landmark_level, p_importance_level, p_museum_type, p_museum_collection, p_museum_audience,
    p_museum_education, p_leisure_type, p_natural_type, p_natural_water, p_sport_facilities,
    p_leisure_playground, p_monument_type, p_monument_event, p_monument_person, p_parking_capacity,
    p_public_transport, p_access_points, p_entrance_fee, p_urban_density, p_noise_level,
    p_air_quality, p_shade_availability, p_cultural_significance, p_local_traditions,
    p_seasonal_attractions, p_is_historic, p_is_touristic, p_has_train, p_has_ferry, p_has_bus,
    p_has_wheelchair_access, p_has_water, p_has_fishing, p_has_playground, p_is_building, p_has_ruins
  ) RETURNING uuid_id INTO poi_result;
  
  -- Insert coordinates if provided
  IF p_coordinate_data IS NOT NULL THEN
    INSERT INTO homolog.coordinates (
      poi_uuid_id, latitude, longitude, elevation_m, boundary_type, boundary_source,
      show_in_map, boundary_geometry
    ) VALUES (
      generated_uuid,
      (p_coordinate_data->>'latitude')::DECIMAL(10,8),
      (p_coordinate_data->>'longitude')::DECIMAL(11,8),
      (p_coordinate_data->>'elevation_m')::INTEGER,
      COALESCE(p_coordinate_data->>'boundary_type', 'point'),
      COALESCE(p_coordinate_data->>'boundary_source', 'osm'),
      COALESCE((p_coordinate_data->>'show_in_map')::BOOLEAN, true),
      p_coordinate_data->>'boundary_geometry'
    ) RETURNING id INTO coord_result;
  END IF;
  
  -- Return success
  RETURN QUERY SELECT generated_uuid, true, 'POI created successfully';
  
EXCEPTION WHEN OTHERS THEN
  -- Return error
  RETURN QUERY SELECT NULL::UUID, false, SQLERRM;
END;
$$ LANGUAGE plpgsql;

-- Grant permissions
GRANT EXECUTE ON FUNCTION homolog.create_poi_with_uuid TO authenticated;
GRANT EXECUTE ON FUNCTION homolog.create_poi_with_uuid TO service_role;

-- Add comment
COMMENT ON FUNCTION homolog.create_poi_with_uuid IS 'Creates POI with UUID generation and coordinates in a single transaction';
