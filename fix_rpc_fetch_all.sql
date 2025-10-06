-- Fix the cms_search_pois RPC to properly handle fetch_all parameter
-- The current RPC is ignoring fetch_all and always applying limit_count

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
  -- Basic POI data
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
  
  -- Coordinates
  latitude NUMERIC,
  longitude NUMERIC,
  
  -- Descriptions with verification data
  descriptions JSONB,
  
  -- Trigger points
  trigger_points JSONB,
  
  -- Group membership
  group_membership JSONB,
  
  -- Verification data (pre-processed)
  verification_data JSONB,
  
  -- Counts for statistics
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
  base_query TEXT;
  where_conditions TEXT[] := '{}';
  order_clause TEXT := 'ORDER BY a.created_at DESC';
  limit_clause TEXT := '';
  offset_clause TEXT := '';
  stats_query TEXT;
  stats_result RECORD;
BEGIN
  -- Build WHERE conditions
  IF search_term IS NOT NULL AND search_term != '' THEN
    where_conditions := array_append(where_conditions, 
      format('(a.name ILIKE %L OR a.city ILIKE %L OR a.country ILIKE %L)', 
        '%' || search_term || '%', '%' || search_term || '%', '%' || search_term || '%'));
  END IF;

  IF status_filter IS NOT NULL AND status_filter != 'all' THEN
    IF status_filter = 'approved' THEN
      where_conditions := array_append(where_conditions, 'a.approved = TRUE');
    ELSIF status_filter = 'pending' THEN
      where_conditions := array_append(where_conditions, 'a.approved = FALSE');
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

  -- Build WHERE clause
  IF array_length(where_conditions, 1) > 0 THEN
    where_conditions := array_append(where_conditions, '1=1'); -- Always true for easier joining
  END IF;

  -- Calculate statistics first
  IF array_length(where_conditions, 1) > 0 THEN
    stats_query := format('
      SELECT 
        COUNT(*) as total_count,
        COUNT(*) FILTER (WHERE a.approved = true) as approved_count,
        COUNT(*) FILTER (WHERE a.approved = false) as pending_count,
        COUNT(*) FILTER (WHERE EXISTS (SELECT 1 FROM core.attraction_descriptions ad WHERE ad.attraction_id = a.id)) as with_description_count,
        COUNT(*) FILTER (WHERE EXISTS (SELECT 1 FROM core.attraction_descriptions ad WHERE ad.attraction_id = a.id AND ad.audio_url IS NOT NULL)) as with_audio_count,
        COUNT(*) FILTER (WHERE EXISTS (SELECT 1 FROM core.attraction_trigger_points atp WHERE atp.attraction_id = a.id)) as with_trigger_points_count,
        COUNT(*) FILTER (WHERE a.approved = true AND EXISTS (SELECT 1 FROM core.attraction_descriptions ad WHERE ad.attraction_id = a.id)) as complete_count
      FROM core.attractions a
      WHERE %s
    ', array_to_string(where_conditions, ' AND '));
  ELSE
    stats_query := '
      SELECT 
        COUNT(*) as total_count,
        COUNT(*) FILTER (WHERE a.approved = true) as approved_count,
        COUNT(*) FILTER (WHERE a.approved = false) as pending_count,
        COUNT(*) FILTER (WHERE EXISTS (SELECT 1 FROM core.attraction_descriptions ad WHERE ad.attraction_id = a.id)) as with_description_count,
        COUNT(*) FILTER (WHERE EXISTS (SELECT 1 FROM core.attraction_descriptions ad WHERE ad.attraction_id = a.id AND ad.audio_url IS NOT NULL)) as with_audio_count,
        COUNT(*) FILTER (WHERE EXISTS (SELECT 1 FROM core.attraction_trigger_points atp WHERE atp.attraction_id = a.id)) as with_trigger_points_count,
        COUNT(*) FILTER (WHERE a.approved = true AND EXISTS (SELECT 1 FROM core.attraction_descriptions ad WHERE ad.attraction_id = a.id)) as complete_count
      FROM core.attractions a
    ';
  END IF;

  EXECUTE stats_query INTO stats_result;

  -- Build main query
  IF array_length(where_conditions, 1) > 0 THEN
    base_query := format('
      SELECT 
        a.id::TEXT,
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
        a.user_id::TEXT,
        a.business_status,
        a.formatted_phone_number,
        ac.latitude::NUMERIC,
        ac.longitude::NUMERIC,
        COALESCE(
          (SELECT jsonb_agg(
            jsonb_build_object(
              ''id'', ad.id,
              ''language'', ad.language,
              ''description'', ad.description,
              ''audio_url'', ad.audio_url,
              ''created_at'', ad.created_at
            )
          ) FROM core.attraction_descriptions ad WHERE ad.attraction_id = a.id), 
          ''[]''::jsonb
        ) as descriptions,
        COALESCE(
          (SELECT jsonb_agg(
            jsonb_build_object(
              ''id'', atp.id,
              ''is_active'', atp.is_active,
              ''type'', atp.type
            )
          ) FROM core.attraction_trigger_points atp WHERE atp.attraction_id = a.id), 
          ''[]''::jsonb
        ) as trigger_points,
        COALESCE(
          (SELECT jsonb_agg(
            jsonb_build_object(
              ''group_id'', ag.id,
              ''group_name'', ag.name,
              ''role'', agm.group_role
            )
          ) FROM core.attraction_groups ag 
           JOIN core.attraction_group_members agm ON ag.id = agm.group_id 
           WHERE agm.attraction_id = a.id), 
          ''[]''::jsonb
        ) as group_membership,
        ''{}''::jsonb as verification_data,
        %L::BIGINT as total_count,
        %L::BIGINT as approved_count,
        %L::BIGINT as pending_count,
        %L::BIGINT as with_description_count,
        %L::BIGINT as with_audio_count,
        %L::BIGINT as with_trigger_points_count,
        %L::BIGINT as complete_count
      FROM core.attractions a
      LEFT JOIN core.attraction_coordinate ac ON a.id = ac.attraction_id
      WHERE %s
      %s
    ', 
      stats_result.total_count,
      stats_result.approved_count,
      stats_result.pending_count,
      stats_result.with_description_count,
      stats_result.with_audio_count,
      stats_result.with_trigger_points_count,
      stats_result.complete_count,
      array_to_string(where_conditions, ' AND '),
      order_clause
    );
  ELSE
    base_query := format('
      SELECT 
        a.id::TEXT,
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
        a.user_id::TEXT,
        a.business_status,
        a.formatted_phone_number,
        ac.latitude::NUMERIC,
        ac.longitude::NUMERIC,
        COALESCE(
          (SELECT jsonb_agg(
            jsonb_build_object(
              ''id'', ad.id,
              ''language'', ad.language,
              ''description'', ad.description,
              ''audio_url'', ad.audio_url,
              ''created_at'', ad.created_at
            )
          ) FROM core.attraction_descriptions ad WHERE ad.attraction_id = a.id), 
          ''[]''::jsonb
        ) as descriptions,
        COALESCE(
          (SELECT jsonb_agg(
            jsonb_build_object(
              ''id'', atp.id,
              ''is_active'', atp.is_active,
              ''type'', atp.type
            )
          ) FROM core.attraction_trigger_points atp WHERE atp.attraction_id = a.id), 
          ''[]''::jsonb
        ) as trigger_points,
        COALESCE(
          (SELECT jsonb_agg(
            jsonb_build_object(
              ''group_id'', ag.id,
              ''group_name'', ag.name,
              ''role'', agm.group_role
            )
          ) FROM core.attraction_groups ag 
           JOIN core.attraction_group_members agm ON ag.id = agm.group_id 
           WHERE agm.attraction_id = a.id), 
          ''[]''::jsonb
        ) as group_membership,
        ''{}''::jsonb as verification_data,
        %L::BIGINT as total_count,
        %L::BIGINT as approved_count,
        %L::BIGINT as pending_count,
        %L::BIGINT as with_description_count,
        %L::BIGINT as with_audio_count,
        %L::BIGINT as with_trigger_points_count,
        %L::BIGINT as complete_count
      FROM core.attractions a
      LEFT JOIN core.attraction_coordinate ac ON a.id = ac.attraction_id
      %s
    ', 
      stats_result.total_count,
      stats_result.approved_count,
      stats_result.pending_count,
      stats_result.with_description_count,
      stats_result.with_audio_count,
      stats_result.with_trigger_points_count,
      stats_result.complete_count,
      order_clause
    );
  END IF;

  -- CRITICAL FIX: Only add LIMIT and OFFSET if NOT fetching all
  IF NOT fetch_all THEN
    limit_clause := format(' LIMIT %s', limit_count);
    offset_clause := format(' OFFSET %s', offset_count);
  END IF;

  -- Execute the query
  RETURN QUERY EXECUTE base_query || limit_clause || offset_clause;
END;
$$;

-- Grant execute permission
GRANT EXECUTE ON FUNCTION core.cms_search_pois(
  TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, INTEGER, INTEGER, BOOLEAN
) TO authenticated;

-- Test the fixed function
SELECT COUNT(*) as test_fetch_all_true
FROM core.cms_search_pois(
  search_term := NULL,
  status_filter := 'all',
  country_filter := NULL,
  state_filter := NULL,
  city_filter := NULL,
  google_types_filter := NULL,
  category_filter := NULL,
  content_status_filter := NULL,
  group_status_filter := NULL,
  score_filter := NULL,
  trigger_points_filter := NULL,
  limit_count := 1000,
  offset_count := 0,
  fetch_all := TRUE
);
