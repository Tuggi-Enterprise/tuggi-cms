-- Simple RPC for POI search with proper types
DROP FUNCTION IF EXISTS core.cms_search_pois(
  TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, INTEGER, INTEGER, BOOLEAN
);

CREATE OR REPLACE FUNCTION core.cms_search_pois(
  search_term TEXT DEFAULT NULL,
  status_filter TEXT DEFAULT 'all',
  country_filter TEXT DEFAULT NULL,
  state_filter TEXT DEFAULT NULL,
  city_filter TEXT DEFAULT NULL,
  google_types_filter TEXT DEFAULT NULL,
  category_filter TEXT DEFAULT NULL,
  content_status_filter TEXT DEFAULT NULL,
  group_status_filter TEXT DEFAULT NULL,
  score_filter TEXT DEFAULT NULL,
  trigger_points_filter TEXT DEFAULT NULL,
  limit_count INTEGER DEFAULT 1000,
  offset_count INTEGER DEFAULT 0,
  fetch_all BOOLEAN DEFAULT FALSE
)
RETURNS TABLE (
  id TEXT,
  name TEXT,
  city TEXT,
  state TEXT,
  country TEXT,
  google_place_id TEXT,
  google_types TEXT[],
  category TEXT,
  rating NUMERIC,
  image_url TEXT,
  approved BOOLEAN,
  created_at TIMESTAMPTZ,
  updated_at TIMESTAMPTZ,
  user_id TEXT,
  business_status TEXT,
  formatted_phone_number TEXT,
  latitude NUMERIC,
  longitude NUMERIC,
  descriptions JSONB,
  trigger_points JSONB,
  group_membership JSONB,
  verification_data JSONB,
  total_count BIGINT,
  approved_count BIGINT,
  pending_count BIGINT,
  with_description_count BIGINT,
  with_audio_count BIGINT,
  with_trigger_points_count BIGINT,
  complete_count BIGINT
)
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  where_conditions TEXT[] := '{}';
  final_limit INTEGER;
  final_offset INTEGER;
BEGIN
  -- Build WHERE conditions
  IF search_term IS NOT NULL AND search_term != '' THEN
    where_conditions := array_append(where_conditions, 
      format('(LOWER(a.name) LIKE LOWER(''%%%s%%'') OR LOWER(a.city) LIKE LOWER(''%%%s%%'') OR LOWER(a.country) LIKE LOWER(''%%%s%%''))', 
      search_term, search_term, search_term));
  END IF;
  
  IF status_filter != 'all' THEN
    IF status_filter = 'approved' THEN
      where_conditions := array_append(where_conditions, 'a.approved = true');
    ELSIF status_filter = 'pending' THEN
      where_conditions := array_append(where_conditions, 'a.approved = false');
    END IF;
  END IF;
  
  IF country_filter IS NOT NULL AND country_filter != '' THEN
    where_conditions := array_append(where_conditions, format('a.country = %L', country_filter));
  END IF;
  
  IF state_filter IS NOT NULL AND state_filter != '' THEN
    where_conditions := array_append(where_conditions, format('a.state = %L', state_filter));
  END IF;
  
  IF city_filter IS NOT NULL AND city_filter != '' THEN
    where_conditions := array_append(where_conditions, format('a.city = %L', city_filter));
  END IF;
  
  IF google_types_filter IS NOT NULL AND google_types_filter != '' THEN
    where_conditions := array_append(where_conditions, format('%L = ANY(a.google_types)', google_types_filter));
  END IF;
  
  IF category_filter IS NOT NULL AND category_filter != '' THEN
    where_conditions := array_append(where_conditions, format('a.category = %L', category_filter));
  END IF;
  
  -- Set pagination - if fetch_all is true, get all records
  IF fetch_all THEN
    final_limit := NULL;
    final_offset := 0;
  ELSE
    final_limit := limit_count;
    final_offset := offset_count;
  END IF;
  
  -- Return query with proper pagination
  RETURN QUERY
  WITH filtered_attractions AS (
    SELECT 
      a.id,
      a.name,
      a.city,
      a.state,
      a.country,
      a.google_place_id,
      a.google_types,
      a.category,
      a.rating,
      a.image_url,
      a.approved,
      a.created_at,
      a.updated_at,
      a.user_id,
      a.business_status,
      a.formatted_phone_number,
      ac.latitude,
      ac.longitude
    FROM core.attractions a
    LEFT JOIN core.attraction_coordinate ac ON a.id = ac.attraction_id
    WHERE 
      (search_term IS NULL OR search_term = '' OR LOWER(a.name) LIKE LOWER('%' || search_term || '%') 
           OR LOWER(a.city) LIKE LOWER('%' || search_term || '%')
           OR LOWER(a.country) LIKE LOWER('%' || search_term || '%'))
      AND (status_filter = 'all' OR (status_filter = 'approved' AND a.approved = true) 
           OR (status_filter = 'pending' AND a.approved = false))
      AND (country_filter IS NULL OR country_filter = '' OR a.country = country_filter)
      AND (state_filter IS NULL OR state_filter = '' OR a.state = state_filter)
      AND (city_filter IS NULL OR city_filter = '' OR a.city = city_filter)
      AND (google_types_filter IS NULL OR google_types_filter = '' OR google_types_filter = ANY(a.google_types))
      AND (category_filter IS NULL OR category_filter = '' OR a.category = category_filter)
    ORDER BY a.created_at DESC
    LIMIT CASE WHEN fetch_all THEN NULL ELSE final_limit END
    OFFSET final_offset
  ),
  stats AS (
    SELECT 
      COUNT(*) as total,
      COUNT(*) FILTER (WHERE fa.approved = true) as approved,
      COUNT(*) FILTER (WHERE fa.approved = false) as pending,
      0::BIGINT as with_desc,
      0::BIGINT as with_audio,
      0::BIGINT as with_trigger,
      0::BIGINT as complete
    FROM filtered_attractions fa
  )
  SELECT 
    fa.id::TEXT,
    fa.name,
    fa.city,
    fa.state,
    fa.country,
    fa.google_place_id,
    fa.google_types,
    fa.category,
    fa.rating,
    fa.image_url,
    fa.approved,
    fa.created_at,
    fa.updated_at,
    fa.user_id::TEXT,
    fa.business_status,
    fa.formatted_phone_number,
    fa.latitude::NUMERIC,
    fa.longitude::NUMERIC,
    '[]'::JSONB as descriptions,
    '[]'::JSONB as trigger_points,
    '[]'::JSONB as group_membership,
    NULL::JSONB as verification_data,
    s.total,
    s.approved,
    s.pending,
    s.with_desc,
    s.with_audio,
    s.with_trigger,
    s.complete
  FROM filtered_attractions fa
  CROSS JOIN stats s;
END;
$$;

-- Grant permissions
GRANT EXECUTE ON FUNCTION core.cms_search_pois(
  TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, INTEGER, INTEGER, BOOLEAN
) TO authenticated;

GRANT EXECUTE ON FUNCTION core.cms_search_pois(
  TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, INTEGER, INTEGER, BOOLEAN
) TO service_role;

