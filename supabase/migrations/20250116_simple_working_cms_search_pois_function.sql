-- Drop and recreate the cms_search_pois function with a much simpler approach
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
  thumbnail_url TEXT,
  approved BOOLEAN,
  created_at TIMESTAMPTZ,
  updated_at TIMESTAMPTZ,
  user_id TEXT,
  business_status TEXT,
  formatted_phone_number TEXT,
  user_ratings_total INTEGER,
  price_level INTEGER,
  is_premium BOOLEAN,
  website TEXT,
  vicinity TEXT,
  formatted_address TEXT,
  opening_hours JSONB,
  wheelchair_accessible BOOLEAN,
  heritage_status TEXT,
  architectural_style TEXT,
  landmark_type TEXT,
  unesco_status TEXT,
  cultural_significance TEXT,
  pov_quality_score NUMERIC,
  photogenic_score NUMERIC,
  accessibility_score NUMERIC,
  visibility_score NUMERIC,
  
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
BEGIN
  -- Build WHERE conditions
  IF search_term IS NOT NULL AND search_term != '' THEN
    where_conditions := array_append(where_conditions, 
      '(LOWER(a.name) LIKE LOWER(''%' || search_term || '%'') OR 
        LOWER(a.city) LIKE LOWER(''%' || search_term || '%'') OR 
        LOWER(a.country) LIKE LOWER(''%' || search_term || '%''))');
  END IF;
  
  IF status_filter != 'all' THEN
    IF status_filter = 'approved' THEN
      where_conditions := array_append(where_conditions, 'a.approved = true');
    ELSIF status_filter = 'pending' THEN
      where_conditions := array_append(where_conditions, 'a.approved = false');
    END IF;
  END IF;
  
  IF country_filter IS NOT NULL AND country_filter != '' THEN
    where_conditions := array_append(where_conditions, 'a.country = ''' || country_filter || '''');
  END IF;
  
  IF state_filter IS NOT NULL AND state_filter != '' THEN
    where_conditions := array_append(where_conditions, 'a.state = ''' || state_filter || '''');
  END IF;
  
  IF city_filter IS NOT NULL AND city_filter != '' THEN
    where_conditions := array_append(where_conditions, 'a.city = ''' || city_filter || '''');
  END IF;
  
  IF google_types_filter IS NOT NULL AND google_types_filter != '' THEN
    where_conditions := array_append(where_conditions, '''' || google_types_filter || ''' = ANY(a.google_types)');
  END IF;
  
  IF category_filter IS NOT NULL AND category_filter != '' THEN
    where_conditions := array_append(where_conditions, 'a.category = ''' || category_filter || '''');
  END IF;
  
  -- Content status filters
  IF content_status_filter = 'with_description' THEN
    where_conditions := array_append(where_conditions, 'EXISTS (SELECT 1 FROM core.attraction_descriptions ad WHERE ad.attraction_id = a.id AND ad.description IS NOT NULL AND ad.description != '''')');
  ELSIF content_status_filter = 'without_description' THEN
    where_conditions := array_append(where_conditions, 'NOT EXISTS (SELECT 1 FROM core.attraction_descriptions ad WHERE ad.attraction_id = a.id AND ad.description IS NOT NULL AND ad.description != '''')');
  ELSIF content_status_filter = 'with_audio' THEN
    where_conditions := array_append(where_conditions, 'EXISTS (SELECT 1 FROM core.attraction_descriptions ad WHERE ad.attraction_id = a.id AND ad.audio_url IS NOT NULL AND ad.audio_url != '''')');
  ELSIF content_status_filter = 'without_audio' THEN
    where_conditions := array_append(where_conditions, 'NOT EXISTS (SELECT 1 FROM core.attraction_descriptions ad WHERE ad.attraction_id = a.id AND ad.audio_url IS NOT NULL AND ad.audio_url != '''')');
  ELSIF content_status_filter = 'complete' THEN
    where_conditions := array_append(where_conditions, 
      'EXISTS (SELECT 1 FROM core.attraction_descriptions ad WHERE ad.attraction_id = a.id AND ad.description IS NOT NULL AND ad.description != '''' AND ad.audio_url IS NOT NULL AND ad.audio_url != '''')');
  END IF;
  
  -- Group status filters
  IF group_status_filter = 'grouped' THEN
    where_conditions := array_append(where_conditions, 'EXISTS (SELECT 1 FROM core.attraction_group_members agm WHERE agm.attraction_id = a.id)');
  ELSIF group_status_filter = 'ungrouped' THEN
    where_conditions := array_append(where_conditions, 'NOT EXISTS (SELECT 1 FROM core.attraction_group_members agm WHERE agm.attraction_id = a.id)');
  ELSIF group_status_filter = 'group_main' THEN
    where_conditions := array_append(where_conditions, 'EXISTS (SELECT 1 FROM core.attraction_group_members agm WHERE agm.attraction_id = a.id AND agm.group_role = ''main'')');
  ELSIF group_status_filter = 'group_member' THEN
    where_conditions := array_append(where_conditions, 'EXISTS (SELECT 1 FROM core.attraction_group_members agm WHERE agm.attraction_id = a.id AND agm.group_role = ''member'')');
  END IF;
  
  -- Score filters
  IF score_filter IS NOT NULL AND score_filter != '' THEN
    IF score_filter = 'high' THEN
      where_conditions := array_append(where_conditions, 
        'EXISTS (SELECT 1 FROM core.attraction_descriptions ad 
                 JOIN core.description_scores ds ON ad.id = ds.description_id 
                 WHERE ad.attraction_id = a.id AND ds.score_overall >= 0.8)');
    ELSIF score_filter = 'medium' THEN
      where_conditions := array_append(where_conditions, 
        'EXISTS (SELECT 1 FROM core.attraction_descriptions ad 
                 JOIN core.description_scores ds ON ad.id = ds.description_id 
                 WHERE ad.attraction_id = a.id AND ds.score_overall >= 0.5 AND ds.score_overall < 0.8)');
    ELSIF score_filter = 'low' THEN
      where_conditions := array_append(where_conditions, 
        'EXISTS (SELECT 1 FROM core.attraction_descriptions ad 
                 JOIN core.description_scores ds ON ad.id = ds.description_id 
                 WHERE ad.attraction_id = a.id AND ds.score_overall < 0.5)');
    ELSIF score_filter = 'no_score' THEN
      where_conditions := array_append(where_conditions, 
        'NOT EXISTS (SELECT 1 FROM core.attraction_descriptions ad 
                     JOIN core.description_scores ds ON ad.id = ds.description_id 
                     WHERE ad.attraction_id = a.id)');
    END IF;
  END IF;
  
  -- Trigger points filters
  IF trigger_points_filter = 'with_trigger_points' THEN
    where_conditions := array_append(where_conditions, 'EXISTS (SELECT 1 FROM core.attraction_trigger_points atp WHERE atp.attraction_id = a.id)');
  ELSIF trigger_points_filter = 'without_trigger_points' THEN
    where_conditions := array_append(where_conditions, 'NOT EXISTS (SELECT 1 FROM core.attraction_trigger_points atp WHERE atp.attraction_id = a.id)');
  END IF;
  
  -- Build the main query with a much simpler approach
  base_query := '
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
      a.thumbnail_url,
      a.approved,
      a.created_at,
      a.updated_at,
      a.user_id,
      a.business_status,
      a.formatted_phone_number,
      a.user_ratings_total,
      a.price_level,
      a.is_premium,
      a.website,
      a.vicinity,
      a.formatted_address,
      a.opening_hours,
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
      ac.latitude,
      ac.longitude,
      
      -- Descriptions with verification data
      COALESCE(
        (
          SELECT jsonb_agg(
            jsonb_build_object(
              ''id'', ad.id,
              ''language'', ad.language,
              ''description'', ad.description,
              ''audio_url'', ad.audio_url,
              ''verification_status'', ad.verification_status,
              ''last_verified_at'', ad.last_verified_at,
              ''is_original'', ad.is_original
            )
          )
          FROM core.attraction_descriptions ad 
          WHERE ad.attraction_id = a.id
        ), 
        ''[]''::jsonb
      ) as descriptions,
      
      -- Trigger points
      COALESCE(
        (
          SELECT jsonb_agg(
            jsonb_build_object(
              ''id'', atp.id,
              ''is_active'', atp.is_active
            )
          )
          FROM core.attraction_trigger_points atp 
          WHERE atp.attraction_id = a.id
        ),
        ''[]''::jsonb
      ) as trigger_points,
      
      -- Group membership
      COALESCE(
        (
          SELECT jsonb_agg(
            jsonb_build_object(
              ''group_id'', agm.group_id,
              ''group_role'', agm.group_role,
              ''group_name'', ag.name
            )
          )
          FROM core.attraction_group_members agm
          LEFT JOIN core.attraction_groups ag ON agm.group_id = ag.id
          WHERE agm.attraction_id = a.id
        ),
        ''[]''::jsonb
      ) as group_membership,
      
      -- Pre-processed verification data for original pt-br description
      (
        SELECT jsonb_build_object(
          ''verification_status'', ad_orig.verification_status,
          ''score'', ds_orig.score_overall,
          ''last_verified_at'', ad_orig.last_verified_at,
          ''is_original'', ad_orig.is_original,
          ''language'', ad_orig.language,
          ''description_id'', ad_orig.id
        )
        FROM core.attraction_descriptions ad_orig
        LEFT JOIN core.description_scores ds_orig ON ad_orig.id = ds_orig.description_id
        WHERE ad_orig.attraction_id = a.id 
          AND ad_orig.language = ''pt-br''
          AND ad_orig.is_original = true
        ORDER BY ds_orig.created_at DESC
        LIMIT 1
      ) as verification_data,
      
      -- Statistics (simplified - just basic counts)
      (SELECT COUNT(*) FROM core.attractions WHERE ' || array_to_string(where_conditions, ' AND ') || ') as total_count,
      (SELECT COUNT(*) FROM core.attractions WHERE ' || array_to_string(where_conditions, ' AND ') || ' AND approved = true) as approved_count,
      (SELECT COUNT(*) FROM core.attractions WHERE ' || array_to_string(where_conditions, ' AND ') || ' AND approved = false) as pending_count,
      (SELECT COUNT(*) FROM core.attractions a2 WHERE ' || array_to_string(where_conditions, ' AND ') || ' AND EXISTS (SELECT 1 FROM core.attraction_descriptions ad WHERE ad.attraction_id = a2.id AND ad.description IS NOT NULL AND ad.description != '''')) as with_description_count,
      (SELECT COUNT(*) FROM core.attractions a2 WHERE ' || array_to_string(where_conditions, ' AND ') || ' AND EXISTS (SELECT 1 FROM core.attraction_descriptions ad WHERE ad.attraction_id = a2.id AND ad.audio_url IS NOT NULL AND ad.audio_url != '''')) as with_audio_count,
      (SELECT COUNT(*) FROM core.attractions a2 WHERE ' || array_to_string(where_conditions, ' AND ') || ' AND EXISTS (SELECT 1 FROM core.attraction_trigger_points atp WHERE atp.attraction_id = a2.id)) as with_trigger_points_count,
      (SELECT COUNT(*) FROM core.attractions a2 WHERE ' || array_to_string(where_conditions, ' AND ') || ' AND EXISTS (SELECT 1 FROM core.attraction_descriptions ad WHERE ad.attraction_id = a2.id AND ad.description IS NOT NULL AND ad.description != '''' AND ad.audio_url IS NOT NULL AND ad.audio_url != '''')) as complete_count
      
    FROM core.attractions a
    LEFT JOIN core.attraction_coordinate ac ON a.id = ac.attraction_id
    WHERE ' || array_to_string(where_conditions, ' AND ') || '
    ' || order_clause;
  
  -- Add pagination if not fetching all
  IF NOT fetch_all THEN
    limit_clause := ' LIMIT ' || limit_count;
    offset_clause := ' OFFSET ' || offset_count;
    base_query := base_query || limit_clause || offset_clause;
  END IF;
  
  -- Execute the query and return results
  RETURN QUERY EXECUTE base_query;
END;
$$;

-- Grant permissions
GRANT EXECUTE ON FUNCTION core.cms_search_pois(
  TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, INTEGER, INTEGER, BOOLEAN
) TO authenticated;

GRANT EXECUTE ON FUNCTION core.cms_search_pois(
  TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, INTEGER, INTEGER, BOOLEAN
) TO service_role;

-- Add comment
COMMENT ON FUNCTION core.cms_search_pois(
  TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, INTEGER, INTEGER, BOOLEAN
) IS 'Efficiently searches POIs with all related data including verification information, trigger points, and statistics. Optimized for CMS interface with comprehensive filtering and pagination support.';
