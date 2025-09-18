-- Update the pois_in_polygon function to use ST_Intersects instead of ST_Within
-- This ensures POIs on polygon boundaries are included
-- Use SECURITY DEFINER to bypass RLS for this function
CREATE OR REPLACE FUNCTION core.pois_in_polygon(wkt_polygon text)
RETURNS TABLE(attraction_id uuid) AS $$
BEGIN
  RETURN QUERY
    SELECT ac.attraction_id
    FROM core.attraction_coordinate ac
    WHERE ST_Intersects(
      ST_SetSRID(ST_MakePoint(ac.longitude, ac.latitude), 4326),
      ST_GeomFromText(wkt_polygon, 4326)
    );
END;
$$ LANGUAGE plpgsql STABLE SECURITY DEFINER; 