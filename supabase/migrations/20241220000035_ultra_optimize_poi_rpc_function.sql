-- Ultra-optimize POI RPC function to stay under 100 parameters
-- Move most fields to JSONB parameters

-- Drop existing function first to avoid conflicts
DROP FUNCTION IF EXISTS homolog.create_poi_with_uuid CASCADE;

CREATE OR REPLACE FUNCTION homolog.create_poi_with_uuid(
  -- Core essential fields only (20 parameters)
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
  
  -- All other fields as JSONB (79 parameters)
  p_address_fields JSONB DEFAULT NULL,
  p_contact_fields JSONB DEFAULT NULL,
  p_brand_fields JSONB DEFAULT NULL,
  p_internet_fields JSONB DEFAULT NULL,
  p_accessibility_fields JSONB DEFAULT NULL,
  p_physical_fields JSONB DEFAULT NULL,
  p_historical_fields JSONB DEFAULT NULL,
  p_type_specific_fields JSONB DEFAULT NULL,
  p_infrastructure_fields JSONB DEFAULT NULL,
  p_environmental_fields JSONB DEFAULT NULL,
  p_cultural_fields JSONB DEFAULT NULL,
  p_tourism_flags JSONB DEFAULT NULL,
  p_critical_fields JSONB DEFAULT NULL,
  p_important_fields JSONB DEFAULT NULL,
  p_pbf_fields JSONB DEFAULT NULL,
  p_additional_fields JSONB DEFAULT NULL,
  p_coordinate_data JSONB DEFAULT NULL
) RETURNS TABLE(
  poi_uuid_id UUID,
  success BOOLEAN,
  message TEXT
) AS $$
DECLARE
  generated_uuid UUID;
  poi_result UUID;
  coord_result BIGINT;
  address_data JSONB;
  contact_data JSONB;
  brand_data JSONB;
  internet_data JSONB;
  accessibility_data JSONB;
  physical_data JSONB;
  historical_data JSONB;
  type_specific_data JSONB;
  infrastructure_data JSONB;
  environmental_data JSONB;
  cultural_data JSONB;
  tourism_flags_data JSONB;
  critical_data JSONB;
  important_data JSONB;
  pbf_data JSONB;
  additional_data JSONB;
BEGIN
  -- Generate deterministic UUID
  generated_uuid := homolog.generate_poi_uuid_with_coords(
    COALESCE(p_osm_id, 0),
    COALESCE(p_osm_type, 'unknown'),
    COALESCE(p_name, 'Unnamed POI'),
    COALESCE(p_lat, 0.0),
    COALESCE(p_lon, 0.0)
  );

  -- Extract data from JSONB parameters
  address_data := COALESCE(p_address_fields, '{}'::JSONB);
  contact_data := COALESCE(p_contact_fields, '{}'::JSONB);
  brand_data := COALESCE(p_brand_fields, '{}'::JSONB);
  internet_data := COALESCE(p_internet_fields, '{}'::JSONB);
  accessibility_data := COALESCE(p_accessibility_fields, '{}'::JSONB);
  physical_data := COALESCE(p_physical_fields, '{}'::JSONB);
  historical_data := COALESCE(p_historical_fields, '{}'::JSONB);
  type_specific_data := COALESCE(p_type_specific_fields, '{}'::JSONB);
  infrastructure_data := COALESCE(p_infrastructure_fields, '{}'::JSONB);
  environmental_data := COALESCE(p_environmental_fields, '{}'::JSONB);
  cultural_data := COALESCE(p_cultural_fields, '{}'::JSONB);
  tourism_flags_data := COALESCE(p_tourism_flags, '{}'::JSONB);
  critical_data := COALESCE(p_critical_fields, '{}'::JSONB);
  important_data := COALESCE(p_important_fields, '{}'::JSONB);
  pbf_data := COALESCE(p_pbf_fields, '{}'::JSONB);
  additional_data := COALESCE(p_additional_fields, '{}'::JSONB);
  
  -- Insert POI
  INSERT INTO homolog.pois (
    uuid_id, name, city, state, country, category, osm_id, osm_type, place_id,
    formatted_address, importance, source_file, source_type, is_complete,
    has_nominatim_data, processing_status, osm_properties, approved, 
    osm_geometry,
    -- Address fields
    description, neighborhood, street_name, house_number, postal_code,
    primary_category, primary_category_type, categories,
    -- Contact fields
    website, contact_phone, contact_email, contact_fax, operator_name,
    -- Brand fields
    brand, brand_wikidata, brand_wikipedia,
    -- Internet access
    internet_access, internet_access_fee,
    -- Accessibility
    wheelchair_accessible, wheelchair_toilets, accessibility_notes,
    -- Physical characteristics
    height_m, elevation_m, building_material, building_colour, roof_colour, architectural_style,
    -- Historical/Heritage
    historic_period, landmark_type, architect, construction_status, start_date,
    heritage_status, unesco_status, unesco_inscription_date, unesco_reference,
    landmark_level, importance_level,
    -- Type-specific fields
    museum_type, museum_collection, museum_audience, museum_education,
    leisure_type, natural_water, sport_facilities, leisure_playground,
    monument_type, monument_event, monument_person,
    -- Infrastructure
    parking_capacity, access_points, entrance_fee,
    -- Environmental
    urban_density, noise_level, air_quality, shade_availability,
    -- Cultural
    cultural_significance, local_traditions, seasonal_attractions,
    -- Tourism flags
    is_historic, is_touristic, has_train, has_ferry, has_bus,
    has_wheelchair_access, has_water, has_fishing, has_playground, is_building, has_ruins,
    -- Critical missing fields
    opening_hours, wikidata, wikipedia, amenity,
    -- Important missing fields
    building, artwork_type, information,
    -- PBF analysis fields
    source, natural_type, landuse, access, ref, type,
    -- Additional fields from JSONB
    contact_phone_alt, contact_mobile, contact_website_alt, contact_email_alt,
    rooms, air_conditioning, smoking, capacity, pets_allowed,
    surface, waterway, power, lanes, maxspeed, intermittent, layer, leisure, lit, service,
    barrier, alt_name, tunnel, bus, place, man_made, source_name,
    trees, bridge, shop
  ) VALUES (
    generated_uuid, p_name, p_city, p_state, p_country, p_category, p_osm_id, p_osm_type, p_place_id,
    p_formatted_address, p_importance, p_source_file, p_source_type, p_is_complete,
    p_has_nominatim_data, p_processing_status, p_osm_properties, p_approved, 
    CASE 
      WHEN p_osm_geometry IS NOT NULL THEN ST_GeomFromGeoJSON(p_osm_geometry)::GEOGRAPHY
      ELSE NULL 
    END,
    -- Address fields
    address_data->>'description', address_data->>'neighborhood', address_data->>'street_name', 
    address_data->>'house_number', address_data->>'postal_code',
    address_data->>'primary_category', address_data->>'primary_category_type', address_data->'categories',
    -- Contact fields
    contact_data->>'website', contact_data->>'contact_phone', contact_data->>'contact_email', 
    contact_data->>'contact_fax', contact_data->>'operator_name',
    -- Brand fields
    brand_data->>'brand', brand_data->>'brand_wikidata', brand_data->>'brand_wikipedia',
    -- Internet access
    internet_data->>'internet_access', internet_data->>'internet_access_fee',
    -- Accessibility
    accessibility_data->>'wheelchair_accessible', accessibility_data->>'wheelchair_toilets', 
    accessibility_data->>'accessibility_notes',
    -- Physical characteristics
    (physical_data->>'height_m')::DECIMAL(8,2), (physical_data->>'elevation_m')::DECIMAL(8,2),
    physical_data->>'building_material', physical_data->>'building_colour', physical_data->>'roof_colour', 
    physical_data->>'architectural_style',
    -- Historical/Heritage
    historical_data->>'historic_period', historical_data->>'landmark_type', historical_data->>'architect', 
    historical_data->>'construction_status', historical_data->>'start_date',
    historical_data->>'heritage_status', historical_data->>'unesco_status', historical_data->>'unesco_inscription_date', 
    historical_data->>'unesco_reference',
    (historical_data->>'landmark_level')::INTEGER, historical_data->>'importance_level',
    -- Type-specific fields
    type_specific_data->>'museum_type', type_specific_data->>'museum_collection', 
    type_specific_data->>'museum_audience', type_specific_data->>'museum_education',
    type_specific_data->>'leisure_type', type_specific_data->>'natural_water', 
    type_specific_data->>'sport_facilities', type_specific_data->>'leisure_playground',
    type_specific_data->>'monument_type', type_specific_data->>'monument_event', type_specific_data->>'monument_person',
    -- Infrastructure
    infrastructure_data->>'parking_capacity', infrastructure_data->>'access_points', infrastructure_data->>'entrance_fee',
    -- Environmental
    environmental_data->>'urban_density', environmental_data->>'noise_level', 
    environmental_data->>'air_quality', environmental_data->>'shade_availability',
    -- Cultural
    cultural_data->>'cultural_significance', cultural_data->>'local_traditions', cultural_data->>'seasonal_attractions',
    -- Tourism flags
    (tourism_flags_data->>'is_historic')::BOOLEAN, (tourism_flags_data->>'is_touristic')::BOOLEAN, 
    (tourism_flags_data->>'has_train')::BOOLEAN, (tourism_flags_data->>'has_ferry')::BOOLEAN, (tourism_flags_data->>'has_bus')::BOOLEAN,
    (tourism_flags_data->>'has_wheelchair_access')::BOOLEAN, (tourism_flags_data->>'has_water')::BOOLEAN, 
    (tourism_flags_data->>'has_fishing')::BOOLEAN, (tourism_flags_data->>'has_playground')::BOOLEAN, 
    (tourism_flags_data->>'is_building')::BOOLEAN, (tourism_flags_data->>'has_ruins')::BOOLEAN,
    -- Critical missing fields
    critical_data->>'opening_hours', critical_data->>'wikidata', critical_data->>'wikipedia', critical_data->>'amenity',
    -- Important missing fields
    important_data->>'building', important_data->>'artwork_type', important_data->>'information',
    -- PBF analysis fields
    pbf_data->>'source', pbf_data->>'natural_type', pbf_data->>'landuse', pbf_data->>'access', 
    pbf_data->>'ref', pbf_data->>'type',
    -- Additional fields from JSONB
    additional_data->>'contact_phone_alt', additional_data->>'contact_mobile', additional_data->>'contact_website_alt', 
    additional_data->>'contact_email_alt',
    (additional_data->>'rooms')::INTEGER, additional_data->>'air_conditioning', additional_data->>'smoking', 
    (additional_data->>'capacity')::INTEGER, additional_data->>'pets_allowed',
    additional_data->>'surface', additional_data->>'waterway', additional_data->>'power', 
    (additional_data->>'lanes')::INTEGER, (additional_data->>'maxspeed')::INTEGER, additional_data->>'intermittent', 
    (additional_data->>'layer')::INTEGER, additional_data->>'leisure', additional_data->>'lit', additional_data->>'service',
    additional_data->>'barrier', additional_data->>'alt_name', additional_data->>'tunnel', additional_data->>'bus', 
    additional_data->>'place', additional_data->>'man_made', additional_data->>'source_name',
    additional_data->>'trees', additional_data->>'bridge', additional_data->>'shop'
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
  RETURN QUERY SELECT poi_result, true, 'POI created successfully';
  
EXCEPTION
  WHEN OTHERS THEN
    -- Return error
    RETURN QUERY SELECT NULL::UUID, false, SQLERRM;
END;
$$ LANGUAGE plpgsql;

-- Grant permissions
GRANT EXECUTE ON FUNCTION homolog.create_poi_with_uuid TO authenticated;
GRANT EXECUTE ON FUNCTION homolog.create_poi_with_uuid TO service_role;
