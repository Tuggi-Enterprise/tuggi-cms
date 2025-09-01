-- Function to get POIs without description for a specific language
CREATE OR REPLACE FUNCTION core.get_pois_without_description(
  p_country TEXT,
  p_language TEXT,
  p_limit INTEGER DEFAULT 50
) RETURNS TABLE (
  id UUID,
  name TEXT,
  city TEXT,
  country TEXT
) AS $$
BEGIN
  RETURN QUERY
  SELECT a.id, a.name, a.city, a.country
  FROM core.attractions a
  WHERE a.country = p_country
    AND NOT EXISTS (
      SELECT 1 
      FROM core.attraction_descriptions ad 
      WHERE ad.attraction_id = a.id 
        AND ad.language = p_language
    )
    AND a.is_active = false  -- Include only inactive POIs
  ORDER BY a.name
  LIMIT p_limit;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Grant execute permission
GRANT EXECUTE ON FUNCTION core.get_pois_without_description(TEXT, TEXT, INTEGER) TO authenticated;
GRANT EXECUTE ON FUNCTION core.get_pois_without_description(TEXT, TEXT, INTEGER) TO service_role;

-- Add comment
COMMENT ON FUNCTION core.get_pois_without_description(TEXT, TEXT, INTEGER) IS 
'Returns inactive POIs that do not have any description for the specified language';
