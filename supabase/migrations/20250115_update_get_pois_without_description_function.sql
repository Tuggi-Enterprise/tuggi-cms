-- Update the get_pois_without_description function to support state and city filters
-- This allows for more precise filtering when looking for POIs without descriptions

CREATE OR REPLACE FUNCTION core.get_pois_without_description(
  p_country TEXT,
  p_language TEXT,
  p_limit INTEGER DEFAULT 50,
  p_state TEXT DEFAULT NULL,
  p_city TEXT DEFAULT NULL
) RETURNS TABLE (
  id UUID,
  name TEXT,
  city TEXT,
  state TEXT,
  country TEXT
) AS $$
BEGIN
  RETURN QUERY
  SELECT a.id, a.name, a.city, a.state, a.country
  FROM core.attractions a
  WHERE a.country = p_country
    AND (p_state IS NULL OR a.state = p_state)
    AND (p_city IS NULL OR a.city = p_city)
    AND NOT EXISTS (
      SELECT 1 
      FROM core.attraction_descriptions ad 
      WHERE ad.attraction_id = a.id 
        AND ad.language = p_language
    )
    AND a.approved = false  -- Include only unapproved POIs
  ORDER BY a.name
  LIMIT p_limit;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Grant execute permission
GRANT EXECUTE ON FUNCTION core.get_pois_without_description(TEXT, TEXT, INTEGER, TEXT, TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION core.get_pois_without_description(TEXT, TEXT, INTEGER, TEXT, TEXT) TO service_role;

-- Add comment
COMMENT ON FUNCTION core.get_pois_without_description(TEXT, TEXT, INTEGER, TEXT, TEXT) IS 
'Returns unapproved POIs that do not have any description for the specified language, with optional state and city filtering';
