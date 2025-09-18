-- Spatial validation functions for city-state validation in core schema

-- Function to check if a city geometry is within a state geometry
CREATE OR REPLACE FUNCTION core.st_within_check(city_geom geometry, state_geom geometry)
RETURNS boolean
LANGUAGE sql
STABLE
AS $$
  SELECT ST_Within(city_geom, state_geom);
$$;

-- Function to get centroid coordinates from geometry
CREATE OR REPLACE FUNCTION core.st_centroid_coords(geom_input geometry)
RETURNS json
LANGUAGE sql
STABLE
AS $$
  SELECT json_build_object(
    'lat', ST_Y(ST_Centroid(geom_input)),
    'lng', ST_X(ST_Centroid(geom_input))
  );
$$;

-- Function to convert geometry to GeoJSON and extract coordinates
CREATE OR REPLACE FUNCTION core.st_geom_to_coords(geom_input geometry)
RETURNS json
LANGUAGE plpgsql
STABLE
AS $$
DECLARE
  geojson_result json;
  coords_result json;
  geom_type text;
  exterior_ring geometry;
BEGIN
  -- Get GeoJSON
  geojson_result := ST_AsGeoJSON(geom_input)::json;
  
  -- Get geometry type
  geom_type := ST_GeometryType(geom_input);
  
  -- Extract coordinates based on geometry type
  IF geom_type = 'ST_Polygon' THEN
    exterior_ring := ST_ExteriorRing(geom_input);
    SELECT json_agg(json_build_object('lat', ST_Y((dump).geom), 'lng', ST_X((dump).geom)))
    INTO coords_result
    FROM ST_DumpPoints(exterior_ring) AS dump;
    
  ELSIF geom_type = 'ST_MultiPolygon' THEN
    -- Get first polygon from multipolygon
    exterior_ring := ST_ExteriorRing(ST_GeometryN(geom_input, 1));
    SELECT json_agg(json_build_object('lat', ST_Y((dump).geom), 'lng', ST_X((dump).geom)))
    INTO coords_result
    FROM ST_DumpPoints(exterior_ring) AS dump;
    
  ELSE
    coords_result := NULL;
  END IF;
  
  RETURN json_build_object(
    'geojson', geojson_result,
    'coordinates', coords_result
  );
END;
$$;

-- Grant execute permissions
GRANT EXECUTE ON FUNCTION core.st_within_check(geometry, geometry) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION core.st_centroid_coords(geometry) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION core.st_geom_to_coords(geometry) TO anon, authenticated;
