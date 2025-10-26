-- Fix ROUND function in calculate_distances
-- The issue is that ROUND() with DECIMAL types needs explicit casting to NUMERIC

CREATE OR REPLACE FUNCTION homolog.calculate_distances(
  lat DECIMAL(10,8),
  lng DECIMAL(11,8)
)
RETURNS TABLE (
  distance_sao_paulo_km DECIMAL(8,2),
  distance_rio_km DECIMAL(8,2)
) AS $$
BEGIN
  RETURN QUERY
  SELECT 
    ROUND(
      (ST_Distance(
        ST_Point(lng, lat)::geography,
        ST_Point(-46.6333, -23.5505)::geography -- São Paulo coordinates
      ) / 1000)::NUMERIC, 2
    )::DECIMAL(8,2) as distance_sao_paulo_km,
    ROUND(
      (ST_Distance(
        ST_Point(lng, lat)::geography,
        ST_Point(-43.2105, -22.9519)::geography -- Rio de Janeiro coordinates
      ) / 1000)::NUMERIC, 2
    )::DECIMAL(8,2) as distance_rio_km;
END;
$$ LANGUAGE plpgsql;

-- Grant permissions
GRANT EXECUTE ON FUNCTION homolog.calculate_distances(DECIMAL, DECIMAL) TO authenticated;
GRANT EXECUTE ON FUNCTION homolog.calculate_distances(DECIMAL, DECIMAL) TO anon;
GRANT EXECUTE ON FUNCTION homolog.calculate_distances(DECIMAL, DECIMAL) TO service_role;
