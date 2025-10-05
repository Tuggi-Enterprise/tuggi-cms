-- RPC final funcional para busca de POIs
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
  category TEXT,
  image_url TEXT,
  thumbnail_url TEXT,
  approved BOOLEAN,
  created_at TIMESTAMPTZ,
  updated_at TIMESTAMPTZ,
  user_id TEXT,
  user_ratings_total INTEGER,
  is_premium BOOLEAN,
  website TEXT,
  vicinity TEXT,
  formatted_address TEXT,
  wheelchair_accessible BOOLEAN,
  heritage_status TEXT,
  architectural_style TEXT,
  landmark_type TEXT,
  unesco_status TEXT,
  cultural_significance TEXT,
  pov_quality_score NUMERIC(5,2),
  photogenic_score NUMERIC(5,2),
  accessibility_score NUMERIC(5,2),
  visibility_score NUMERIC(5,2),
  latitude DOUBLE PRECISION,
  longitude DOUBLE PRECISION,
  descriptions JSONB,
  trigger_points JSONB,
  group_membership JSONB,
  verification_data JSONB,
  total_count INTEGER,
  approved_count INTEGER,
  pending_count INTEGER,
  with_description_count INTEGER,
  with_audio_count INTEGER,
  with_trigger_points_count INTEGER,
  complete_count INTEGER
)
LANGUAGE plpgsql
AS $$
DECLARE
  where_conditions TEXT[] := ARRAY[]::TEXT[];
  filter_clause TEXT := '';
BEGIN
  -- Build WHERE conditions
  IF search_term IS NOT NULL AND search_term != '' THEN
    where_conditions := array_append(where_conditions, format('(a.name ILIKE %L OR a.city ILIKE %L OR a.country ILIKE %L)', '%' || search_term || '%', '%' || search_term || '%', '%' || search_term || '%'));
  END IF;

  -- Status filter
  IF status_filter IS NOT NULL AND status_filter != 'all' THEN
    IF status_filter = 'approved' THEN
      where_conditions := array_append(where_conditions, 'a.approved = TRUE');
    ELSIF status_filter = 'pending' THEN
      where_conditions := array_append(where_conditions, 'a.approved = FALSE');
    END IF;
  END IF;

  -- Country filter
  IF country_filter IS NOT NULL AND country_filter != '' THEN
    where_conditions := array_append(where_conditions, format('a.country = %L', country_filter));
  END IF;

  -- State filter
  IF state_filter IS NOT NULL AND state_filter != '' THEN
    where_conditions := array_append(where_conditions, format('a.state = %L', state_filter));
  END IF;

  -- City filter
  IF city_filter IS NOT NULL AND city_filter != '' THEN
    where_conditions := array_append(where_conditions, format('a.city = %L', city_filter));
  END IF;

  -- Build final WHERE clause
  IF array_length(where_conditions, 1) > 0 THEN
    filter_clause := ' WHERE ' || array_to_string(where_conditions, ' AND ');
  END IF;

  -- Execute the query
  RETURN QUERY
  EXECUTE format('
    SELECT 
      a.id::TEXT,
      a.name,
      a.city,
      a.state,
      a.country,
      a.google_place_id,
      a.category,
      a.image_url,
      a.thumbnail_url,
      a.approved,
      a.created_at,
      a.updated_at,
      a.user_id::TEXT,
      a.user_ratings_total,
      a.is_premium,
      a.website,
      a.vicinity,
      a.formatted_address,
      a.wheelchair_accessible,
      a.heritage_status,
      a.architectural_style,
      a.landmark_type,
      a.unesco_status,
      a.cultural_significance,
      a.pov_quality_score,
      a.photogenic_score,
      a.accessibility_score,
      a.visibility_score,
      COALESCE(ac.latitude, 0.0) as latitude,
      COALESCE(ac.longitude, 0.0) as longitude,
      ''[]''::jsonb as descriptions,
      ''[]''::jsonb as trigger_points,
      ''[]''::jsonb as group_membership,
      ''{}''::jsonb as verification_data,
      0 as total_count,
      0 as approved_count,
      0 as pending_count,
      0 as with_description_count,
      0 as with_audio_count,
      0 as with_trigger_points_count,
      0 as complete_count
    FROM core.attractions a
    LEFT JOIN core.attraction_coordinate ac ON a.id = ac.attraction_id
    %s
    LIMIT %s
    OFFSET %s
  ', filter_clause, limit_count, offset_count);
END;
$$;
