-- Create a function to test POI counting
CREATE OR REPLACE FUNCTION test_poi_count()
RETURNS TABLE(
  total_pois bigint,
  pois_with_coords bigint,
  pois_without_audit bigint
)
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  RETURN QUERY
  SELECT 
    (SELECT COUNT(*) FROM core.attractions) as total_pois,
    (SELECT COUNT(*) FROM core.attractions a 
     INNER JOIN core.attraction_coordinate ac ON a.id = ac.attraction_id) as pois_with_coords,
    (SELECT COUNT(*) FROM core.attractions 
     WHERE city_correction_audit IS NULL) as pois_without_audit;
END;
$$;
