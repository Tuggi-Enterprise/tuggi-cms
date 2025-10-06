-- ============================================================================
-- MAP OPTIMIZED POI SEARCH RPC
-- ============================================================================
-- Description: Lightweight RPC specifically for map view
-- Returns only essential data needed for map markers
-- Optimized for speed and minimal payload
-- ============================================================================

DROP FUNCTION IF EXISTS core.cms_search_pois_map(
  TEXT, TEXT, TEXT, TEXT, TEXT, INTEGER, INTEGER
);

CREATE OR REPLACE FUNCTION core.cms_search_pois_map(
  country_filter TEXT DEFAULT NULL,
  state_filter TEXT DEFAULT NULL,
  city_filter TEXT DEFAULT NULL,
  status_filter TEXT DEFAULT 'all',
  search_term TEXT DEFAULT NULL,
  limit_count INTEGER DEFAULT 5000,
  offset_count INTEGER DEFAULT 0
)
RETURNS TABLE (
  id TEXT,
  name TEXT,
  city TEXT,
  state TEXT,
  country TEXT,
  latitude NUMERIC,
  longitude NUMERIC,
  approved BOOLEAN,
  rating NUMERIC,
  image_url TEXT,
  formatted_address TEXT,
  user_ratings_total INTEGER,
  google_types TEXT[]
)
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  RETURN QUERY
  SELECT DISTINCT ON (a.id)
    a.id::TEXT,
    a.name,
    a.city,
    a.state,
    a.country,
    COALESCE(ac.latitude, 0)::NUMERIC as latitude,
    COALESCE(ac.longitude, 0)::NUMERIC as longitude,
    a.approved,
    a.rating,
    a.image_url,
    a.formatted_address,
    a.user_ratings_total,
    a.google_types
  FROM core.attractions a
  LEFT JOIN core.attraction_coordinate ac ON a.id = ac.attraction_id
  WHERE
    -- Geographic filters
    (country_filter IS NULL OR country_filter = '' OR a.country = country_filter)
    AND (state_filter IS NULL OR state_filter = '' OR a.state = state_filter)
    AND (city_filter IS NULL OR city_filter = '' OR a.city = city_filter)
    -- Status filter
    AND (
      status_filter = 'all' 
      OR (status_filter = 'approved' AND a.approved = TRUE)
      OR (status_filter = 'pending' AND a.approved = FALSE)
    )
    -- Search filter
    AND (
      search_term IS NULL 
      OR search_term = ''
      OR LOWER(a.name) LIKE LOWER('%' || search_term || '%')
      OR LOWER(a.city) LIKE LOWER('%' || search_term || '%')
      OR LOWER(a.country) LIKE LOWER('%' || search_term || '%')
    )
    -- Only POIs with coordinates
    AND ac.latitude IS NOT NULL
    AND ac.longitude IS NOT NULL
  ORDER BY a.id, ac.created_at ASC NULLS LAST
  LIMIT limit_count
  OFFSET offset_count;
END;
$$;

-- Grant permissions
GRANT EXECUTE ON FUNCTION core.cms_search_pois_map(
  TEXT, TEXT, TEXT, TEXT, TEXT, INTEGER, INTEGER
) TO authenticated;

GRANT EXECUTE ON FUNCTION core.cms_search_pois_map(
  TEXT, TEXT, TEXT, TEXT, TEXT, INTEGER, INTEGER
) TO service_role;

-- Add comment
COMMENT ON FUNCTION core.cms_search_pois_map(
  TEXT, TEXT, TEXT, TEXT, TEXT, INTEGER, INTEGER
) IS 'Lightweight RPC for map view - returns only essential POI data with coordinates for fast rendering';

