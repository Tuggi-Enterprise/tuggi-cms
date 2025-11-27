-- Migration: Extend existing insert_coordinate_safe to support boundary geometry
-- Created: 2025-01-31
-- Purpose: Extend core.insert_coordinate_safe to also handle boundary_geometry updates

-- Extend existing function to support boundary geometry
CREATE OR REPLACE FUNCTION core.insert_coordinate_safe(
  p_attraction_id uuid,
  p_latitude double precision,
  p_longitude double precision,
  p_show_in_map boolean DEFAULT false,
  p_boundary_geometry_geojson text DEFAULT NULL,
  p_boundary_type text DEFAULT NULL,
  p_boundary_source text DEFAULT NULL,
  p_boundary_confidence numeric(3,2) DEFAULT NULL,
  p_boundary_area_m2 numeric(12,2) DEFAULT NULL,
  p_boundary_centroid_lat numeric(10,8) DEFAULT NULL,
  p_boundary_centroid_lng numeric(11,8) DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql
AS $$
DECLARE
  new_coordinate_id uuid;
  existing_coordinate_id uuid;
  boundary_geography geography;
BEGIN
  -- Verificar se já existe coordenada
  SELECT id INTO existing_coordinate_id
  FROM core.attraction_coordinate
  WHERE attraction_id = p_attraction_id
  LIMIT 1;
  
  -- Convert GeoJSON string to GEOGRAPHY if provided
  IF p_boundary_geometry_geojson IS NOT NULL AND p_boundary_geometry_geojson != '' THEN
    BEGIN
      boundary_geography := ST_GeomFromGeoJSON(p_boundary_geometry_geojson)::GEOGRAPHY;
    EXCEPTION
      WHEN OTHERS THEN
        RAISE EXCEPTION 'Invalid GeoJSON format: %', SQLERRM;
    END;
  ELSE
    boundary_geography := NULL;
  END IF;
  
  IF existing_coordinate_id IS NOT NULL THEN
    -- Atualizar coordenada existente (incluindo boundary se fornecido)
    UPDATE core.attraction_coordinate
    SET 
      latitude = p_latitude,
      longitude = p_longitude,
      show_in_map = p_show_in_map,
      updated_at = now(),
      -- Update boundary fields only if provided
      boundary_geometry = COALESCE(boundary_geography, boundary_geometry),
      boundary_type = COALESCE(p_boundary_type, boundary_type),
      boundary_source = COALESCE(p_boundary_source, boundary_source),
      boundary_confidence = COALESCE(p_boundary_confidence, boundary_confidence),
      boundary_area_m2 = COALESCE(p_boundary_area_m2, boundary_area_m2),
      boundary_centroid_lat = COALESCE(p_boundary_centroid_lat, boundary_centroid_lat),
      boundary_centroid_lng = COALESCE(p_boundary_centroid_lng, boundary_centroid_lng)
    WHERE id = existing_coordinate_id;
    
    RETURN existing_coordinate_id;
  ELSE
    -- Inserir nova coordenada (com boundary se fornecido)
    INSERT INTO core.attraction_coordinate (
      attraction_id,
      latitude,
      longitude,
      show_in_map,
      boundary_geometry,
      boundary_type,
      boundary_source,
      boundary_confidence,
      boundary_area_m2,
      boundary_centroid_lat,
      boundary_centroid_lng
    ) VALUES (
      p_attraction_id,
      p_latitude,
      p_longitude,
      p_show_in_map,
      boundary_geography,
      p_boundary_type,
      p_boundary_source,
      p_boundary_confidence,
      p_boundary_area_m2,
      p_boundary_centroid_lat,
      p_boundary_centroid_lng
    ) RETURNING id INTO new_coordinate_id;
    
    RETURN new_coordinate_id;
  END IF;
END;
$$;

-- Function to safely convert GeoJSON to GEOGRAPHY (reusable helper)
CREATE OR REPLACE FUNCTION core.safe_geom_from_geojson(geojson_text TEXT)
RETURNS GEOGRAPHY
LANGUAGE plpgsql
IMMUTABLE
AS $$
DECLARE
  geom_result GEOGRAPHY;
  geom_json JSONB;
BEGIN
  -- Return NULL if input is NULL or empty
  IF geojson_text IS NULL OR geojson_text = '' OR TRIM(geojson_text) = '' THEN
    RETURN NULL;
  END IF;

  BEGIN
    -- Parse JSON to validate it's valid JSON
    geom_json := geojson_text::JSONB;
    
    -- Check if it's a valid GeoJSON structure
    IF geom_json->>'type' IS NULL THEN
      RAISE EXCEPTION 'Invalid GeoJSON: missing type field';
    END IF;

    -- Only convert Polygon and MultiPolygon to GEOGRAPHY for boundaries
    IF geom_json->>'type' IN ('Polygon', 'MultiPolygon') THEN
      -- Try to convert to geometry first
      geom_result := ST_GeomFromGeoJSON(geojson_text)::GEOGRAPHY;
      
      -- Validate the geometry is valid
      IF NOT ST_IsValid(geom_result::GEOMETRY) THEN
        -- If geometry is invalid, try to make it valid
        BEGIN
          geom_result := ST_MakeValid(geom_result::GEOMETRY)::GEOGRAPHY;
        EXCEPTION
          WHEN OTHERS THEN
            RAISE EXCEPTION 'Invalid geometry and ST_MakeValid failed: %', SQLERRM;
        END;
      END IF;
      
      RETURN geom_result;
    ELSE
      RAISE EXCEPTION 'Unsupported GeoJSON type for boundary: %. Only Polygon and MultiPolygon are supported.', geom_json->>'type';
    END IF;

  EXCEPTION
    WHEN OTHERS THEN
      -- Re-raise with more context
      RAISE EXCEPTION 'Failed to convert GeoJSON to GEOGRAPHY: %', SQLERRM;
  END;
END;
$$;

-- Function to update only boundary geometry (for cases where coordinate already exists)
-- Robust version with proper error handling and validation
CREATE OR REPLACE FUNCTION core.update_boundary_geometry(
  p_attraction_id uuid,
  p_geojson text,
  p_boundary_type text DEFAULT 'polygon',
  p_boundary_source text DEFAULT 'manual',
  p_boundary_confidence numeric(3,2) DEFAULT 1.0,
  p_boundary_area_m2 numeric(12,2) DEFAULT NULL,
  p_boundary_centroid_lat numeric(10,8) DEFAULT NULL,
  p_boundary_centroid_lng numeric(11,8) DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql
AS $$
DECLARE
  coordinate_id uuid;
  boundary_geography geography;
  rows_affected integer;
BEGIN
  -- Validate attraction_id
  IF p_attraction_id IS NULL THEN
    RAISE EXCEPTION 'attraction_id cannot be NULL';
  END IF;

  -- Check if coordinate exists for this attraction
  SELECT id INTO coordinate_id
  FROM core.attraction_coordinate
  WHERE attraction_id = p_attraction_id
  LIMIT 1;
  
  IF coordinate_id IS NULL THEN
    RAISE EXCEPTION 'Coordinate record not found for attraction_id: %', p_attraction_id;
  END IF;
  
  -- Convert GeoJSON string to GEOGRAPHY using safe conversion
  IF p_geojson IS NOT NULL AND p_geojson != '' AND TRIM(p_geojson) != '' THEN
    boundary_geography := core.safe_geom_from_geojson(p_geojson);
  ELSE
    boundary_geography := NULL;
  END IF;
  
  -- Validate boundary_confidence range if provided
  IF p_boundary_confidence IS NOT NULL AND (p_boundary_confidence < 0 OR p_boundary_confidence > 1) THEN
    RAISE EXCEPTION 'boundary_confidence must be between 0 and 1, got: %', p_boundary_confidence;
  END IF;
  
  -- Update boundary fields
  UPDATE core.attraction_coordinate
  SET
    boundary_geometry = boundary_geography,
    boundary_type = p_boundary_type,
    boundary_source = p_boundary_source,
    boundary_confidence = p_boundary_confidence,
    boundary_area_m2 = p_boundary_area_m2,
    boundary_centroid_lat = p_boundary_centroid_lat,
    boundary_centroid_lng = p_boundary_centroid_lng,
    updated_at = NOW()
  WHERE id = coordinate_id;
  
  -- Verify the update was successful (GET DIAGNOSTICS works after UPDATE)
  GET DIAGNOSTICS rows_affected = ROW_COUNT;
  IF rows_affected = 0 THEN
    RAISE EXCEPTION 'Failed to update coordinate record with id: % (no rows affected)', coordinate_id;
  END IF;
  
  RETURN coordinate_id;
EXCEPTION
  WHEN OTHERS THEN
    -- Log the error and re-raise with context
    RAISE EXCEPTION 'Error updating boundary geometry for attraction_id %: %', p_attraction_id, SQLERRM;
END;
$$;

-- Grant permissions
GRANT EXECUTE ON FUNCTION core.safe_geom_from_geojson TO authenticated;
GRANT EXECUTE ON FUNCTION core.safe_geom_from_geojson TO service_role;
GRANT EXECUTE ON FUNCTION core.update_boundary_geometry TO authenticated;
GRANT EXECUTE ON FUNCTION core.update_boundary_geometry TO service_role;

-- Function to get boundary geometry as GeoJSON
CREATE OR REPLACE FUNCTION core.get_boundary_geometry(
  p_attraction_id uuid
)
RETURNS text
LANGUAGE plpgsql
AS $$
DECLARE
  boundary_geojson text;
BEGIN
  SELECT ST_AsGeoJSON(boundary_geometry::geometry)::text
  INTO boundary_geojson
  FROM core.attraction_coordinate
  WHERE attraction_id = p_attraction_id
    AND boundary_geometry IS NOT NULL
  LIMIT 1;
  
  RETURN boundary_geojson;
END;
$$;

-- Grant permissions
GRANT EXECUTE ON FUNCTION core.get_boundary_geometry TO authenticated;
GRANT EXECUTE ON FUNCTION core.get_boundary_geometry TO service_role;

-- Update comment for extended function
COMMENT ON FUNCTION core.insert_coordinate_safe IS 'Função segura para inserir/atualizar coordenadas sem duplicatas. Agora suporta boundary_geometry opcional.';

-- Add comments
COMMENT ON FUNCTION core.safe_geom_from_geojson IS 'Safely converts GeoJSON text to GEOGRAPHY type with validation and error handling. Supports Polygon and MultiPolygon types.';
COMMENT ON FUNCTION core.update_boundary_geometry IS 'Updates only boundary geometry for an existing POI coordinate, converting GeoJSON to GEOGRAPHY type. Robust error handling ensures it never fails silently.';
COMMENT ON FUNCTION core.get_boundary_geometry IS 'Retrieves boundary geometry as GeoJSON string for a POI coordinate';

