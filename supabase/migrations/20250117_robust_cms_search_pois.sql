-- ============================================================================
-- ROBUST CMS SEARCH POIS RPC
-- ============================================================================
-- Description: Production-ready RPC for POI search with comprehensive filtering
-- Author: Senior Database Engineer
-- Date: 2025-01-17
-- Version: 1.0
-- 
-- Features:
-- - Full text search across name, city, country
-- - Geographic filtering (country, state, city)
-- - Status filtering (approved/pending)
-- - Content filtering (descriptions, audio, groups, trigger points)
-- - Proper type casting to avoid PostgreSQL type mismatches
-- - Dynamic pagination with fetch_all support
-- - Statistics calculation
-- - Handles empty filter arrays gracefully
-- ============================================================================

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
  -- Basic POI data (all TEXT to avoid UUID issues)
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
  
  -- Coordinates (NUMERIC to match function signature)
  latitude NUMERIC,
  longitude NUMERIC,
  
  -- Related data as JSONB
  descriptions JSONB,
  trigger_points JSONB,
  group_membership JSONB,
  verification_data JSONB,
  
  -- Statistics
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
STABLE
AS $$
DECLARE
  where_clause TEXT := '';
  where_parts TEXT[] := '{}';
  stats_where_clause TEXT := '';
  final_query TEXT;
  stats_query TEXT;
  
  -- Statistics variables
  v_total_count BIGINT;
  v_approved_count BIGINT;
  v_pending_count BIGINT;
  v_with_description_count BIGINT;
  v_with_audio_count BIGINT;
  v_with_trigger_points_count BIGINT;
  v_complete_count BIGINT;
BEGIN
  -- ============================================================================
  -- STEP 1: BUILD WHERE CONDITIONS
  -- ============================================================================
  
  -- Search term filter (name, city, country)
  IF search_term IS NOT NULL AND search_term != '' THEN
    where_parts := array_append(where_parts, format(
      '(LOWER(a.name) LIKE LOWER(%L) OR LOWER(a.city) LIKE LOWER(%L) OR LOWER(a.country) LIKE LOWER(%L))',
      '%' || search_term || '%',
      '%' || search_term || '%',
      '%' || search_term || '%'
    ));
  END IF;
  
  -- Status filter
  IF status_filter IS NOT NULL AND status_filter != 'all' THEN
    IF status_filter = 'approved' THEN
      where_parts := array_append(where_parts, 'a.approved = true');
    ELSIF status_filter = 'pending' THEN
      where_parts := array_append(where_parts, 'a.approved = false');
    END IF;
  END IF;
  
  -- Geographic filters
  IF country_filter IS NOT NULL AND country_filter != '' THEN
    where_parts := array_append(where_parts, format('a.country = %L', country_filter));
  END IF;
  
  IF state_filter IS NOT NULL AND state_filter != '' THEN
    where_parts := array_append(where_parts, format('a.state = %L', state_filter));
  END IF;
  
  IF city_filter IS NOT NULL AND city_filter != '' THEN
    where_parts := array_append(where_parts, format('a.city = %L', city_filter));
  END IF;
  
  -- Google types filter
  IF google_types_filter IS NOT NULL AND google_types_filter != '' THEN
    where_parts := array_append(where_parts, format('%L = ANY(a.google_types)', google_types_filter));
  END IF;
  
  -- Category filter
  IF category_filter IS NOT NULL AND category_filter != '' THEN
    where_parts := array_append(where_parts, format('a.category = %L', category_filter));
  END IF;
  
  -- Content status filters (descriptions & audio)
  IF content_status_filter IS NOT NULL AND content_status_filter != 'all' THEN
    CASE content_status_filter
      WHEN 'with_description' THEN
        where_parts := array_append(where_parts, 
          'EXISTS (SELECT 1 FROM core.attraction_descriptions ad WHERE ad.attraction_id = a.id AND ad.description IS NOT NULL AND ad.description != '''')');
      WHEN 'without_description' THEN
        where_parts := array_append(where_parts, 
          'NOT EXISTS (SELECT 1 FROM core.attraction_descriptions ad WHERE ad.attraction_id = a.id AND ad.description IS NOT NULL AND ad.description != '''')');
      WHEN 'with_audio' THEN
        where_parts := array_append(where_parts, 
          'EXISTS (SELECT 1 FROM core.attraction_descriptions ad WHERE ad.attraction_id = a.id AND ad.audio_url IS NOT NULL AND ad.audio_url != '''')');
      WHEN 'without_audio' THEN
        where_parts := array_append(where_parts, 
          'NOT EXISTS (SELECT 1 FROM core.attraction_descriptions ad WHERE ad.attraction_id = a.id AND ad.audio_url IS NOT NULL AND ad.audio_url != '''')');
      WHEN 'complete' THEN
        where_parts := array_append(where_parts, 
          'EXISTS (SELECT 1 FROM core.attraction_descriptions ad WHERE ad.attraction_id = a.id AND ad.description IS NOT NULL AND ad.description != '''' AND ad.audio_url IS NOT NULL AND ad.audio_url != '''')');
      ELSE
        NULL;
    END CASE;
  END IF;
  
  -- Group status filters
  IF group_status_filter IS NOT NULL AND group_status_filter != 'all' THEN
    CASE group_status_filter
      WHEN 'grouped' THEN
        where_parts := array_append(where_parts, 
          'EXISTS (SELECT 1 FROM core.attraction_group_members agm WHERE agm.attraction_id = a.id)');
      WHEN 'ungrouped' THEN
        where_parts := array_append(where_parts, 
          'NOT EXISTS (SELECT 1 FROM core.attraction_group_members agm WHERE agm.attraction_id = a.id)');
      WHEN 'group_main' THEN
        where_parts := array_append(where_parts, 
          'EXISTS (SELECT 1 FROM core.attraction_group_members agm WHERE agm.attraction_id = a.id AND agm.group_role = ''main'')');
      WHEN 'group_member' THEN
        where_parts := array_append(where_parts, 
          'EXISTS (SELECT 1 FROM core.attraction_group_members agm WHERE agm.attraction_id = a.id AND agm.group_role = ''member'')');
      ELSE
        NULL;
    END CASE;
  END IF;
  
  -- Score filters
  IF score_filter IS NOT NULL AND score_filter != '' AND score_filter != 'all' THEN
    CASE score_filter
      WHEN 'high' THEN
        where_parts := array_append(where_parts, 
          'EXISTS (SELECT 1 FROM core.attraction_descriptions ad JOIN core.description_scores ds ON ad.id = ds.description_id WHERE ad.attraction_id = a.id AND ds.score_overall >= 0.8)');
      WHEN 'medium' THEN
        where_parts := array_append(where_parts, 
          'EXISTS (SELECT 1 FROM core.attraction_descriptions ad JOIN core.description_scores ds ON ad.id = ds.description_id WHERE ad.attraction_id = a.id AND ds.score_overall >= 0.5 AND ds.score_overall < 0.8)');
      WHEN 'low' THEN
        where_parts := array_append(where_parts, 
          'EXISTS (SELECT 1 FROM core.attraction_descriptions ad JOIN core.description_scores ds ON ad.id = ds.description_id WHERE ad.attraction_id = a.id AND ds.score_overall < 0.5)');
      WHEN 'no_score' THEN
        where_parts := array_append(where_parts, 
          'NOT EXISTS (SELECT 1 FROM core.attraction_descriptions ad JOIN core.description_scores ds ON ad.id = ds.description_id WHERE ad.attraction_id = a.id)');
      ELSE
        NULL;
    END CASE;
  END IF;
  
  -- Trigger points filters
  IF trigger_points_filter IS NOT NULL AND trigger_points_filter != 'all' THEN
    CASE trigger_points_filter
      WHEN 'with_trigger_points' THEN
        where_parts := array_append(where_parts, 
          'EXISTS (SELECT 1 FROM core.attraction_trigger_points atp WHERE atp.attraction_id = a.id)');
      WHEN 'without_trigger_points' THEN
        where_parts := array_append(where_parts, 
          'NOT EXISTS (SELECT 1 FROM core.attraction_trigger_points atp WHERE atp.attraction_id = a.id)');
      ELSE
        NULL;
    END CASE;
  END IF;
  
  -- ============================================================================
  -- STEP 2: BUILD FINAL WHERE CLAUSE
  -- ============================================================================
  
  IF array_length(where_parts, 1) > 0 THEN
    where_clause := 'WHERE ' || array_to_string(where_parts, ' AND ');
    stats_where_clause := where_clause;
  ELSE
    where_clause := '';
    stats_where_clause := '';
  END IF;
  
  -- ============================================================================
  -- STEP 3: CALCULATE STATISTICS (only once, more efficient)
  -- ============================================================================
  
  stats_query := format('
    SELECT 
      COUNT(*) as total,
      COUNT(*) FILTER (WHERE a.approved = true) as approved,
      COUNT(*) FILTER (WHERE a.approved = false) as pending,
      COUNT(*) FILTER (WHERE EXISTS (
        SELECT 1 FROM core.attraction_descriptions ad 
        WHERE ad.attraction_id = a.id 
        AND ad.description IS NOT NULL 
        AND ad.description != ''''
      )) as with_description,
      COUNT(*) FILTER (WHERE EXISTS (
        SELECT 1 FROM core.attraction_descriptions ad 
        WHERE ad.attraction_id = a.id 
        AND ad.audio_url IS NOT NULL 
        AND ad.audio_url != ''''
      )) as with_audio,
      COUNT(*) FILTER (WHERE EXISTS (
        SELECT 1 FROM core.attraction_trigger_points atp 
        WHERE atp.attraction_id = a.id
      )) as with_trigger_points,
      COUNT(*) FILTER (WHERE EXISTS (
        SELECT 1 FROM core.attraction_descriptions ad 
        WHERE ad.attraction_id = a.id 
        AND ad.description IS NOT NULL 
        AND ad.description != ''''
        AND ad.audio_url IS NOT NULL 
        AND ad.audio_url != ''''
      )) as complete
    FROM core.attractions a
    %s
  ', stats_where_clause);
  
  EXECUTE stats_query INTO 
    v_total_count, 
    v_approved_count, 
    v_pending_count, 
    v_with_description_count, 
    v_with_audio_count, 
    v_with_trigger_points_count, 
    v_complete_count;
  
  -- ============================================================================
  -- STEP 4: BUILD AND EXECUTE MAIN QUERY
  -- ============================================================================
  
  final_query := format('
    SELECT DISTINCT ON (a.id)
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
      COALESCE(ac.latitude, 0)::NUMERIC as latitude,
      COALESCE(ac.longitude, 0)::NUMERIC as longitude,
      
      -- Descriptions with verification data
      COALESCE((
        SELECT jsonb_agg(jsonb_build_object(
          ''id'', ad.id,
          ''language'', ad.language,
          ''description'', ad.description,
          ''audio_url'', ad.audio_url,
          ''verification_status'', ad.verification_status,
          ''last_verified_at'', ad.last_verified_at,
          ''is_original'', ad.is_original
        ))
        FROM core.attraction_descriptions ad 
        WHERE ad.attraction_id = a.id
      ), ''[]''::jsonb) as descriptions,
      
      -- Trigger points
      COALESCE((
        SELECT jsonb_agg(jsonb_build_object(
          ''id'', atp.id,
          ''is_active'', atp.is_active
        ))
        FROM core.attraction_trigger_points atp 
        WHERE atp.attraction_id = a.id
      ), ''[]''::jsonb) as trigger_points,
      
      -- Group membership
      COALESCE((
        SELECT jsonb_agg(jsonb_build_object(
          ''group_id'', agm.group_id,
          ''group_role'', agm.group_role,
          ''group_name'', ag.name
        ))
        FROM core.attraction_group_members agm
        LEFT JOIN core.attraction_groups ag ON agm.group_id = ag.id
        WHERE agm.attraction_id = a.id
      ), ''[]''::jsonb) as group_membership,
      
      -- Verification data (original pt-br description)
      (
        SELECT jsonb_build_object(
          ''verification_status'', ad_orig.verification_status,
          ''score'', ds_orig.score_overall,
          ''last_verified_at'', ad_orig.last_verified_at,
          ''is_original'', ad_orig.is_original,
          ''language'', ad_orig.language,
          ''subscores'', ds_orig.subscores,
          ''flags'', ds_orig.flags,
          ''description_id'', ad_orig.id
        )
        FROM core.attraction_descriptions ad_orig
        LEFT JOIN LATERAL (
          SELECT * FROM core.description_scores ds
          WHERE ds.description_id = ad_orig.id
          ORDER BY ds.created_at DESC
          LIMIT 1
        ) ds_orig ON true
        WHERE ad_orig.attraction_id = a.id 
          AND ad_orig.language = ''pt-br''
          AND ad_orig.is_original = true
        LIMIT 1
      ) as verification_data,
      
      -- Statistics (same for all rows)
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
    ORDER BY a.id, ac.created_at ASC NULLS LAST
    %s
  ',
  v_total_count,
  v_approved_count,
  v_pending_count,
  v_with_description_count,
  v_with_audio_count,
  v_with_trigger_points_count,
  v_complete_count,
  where_clause,
  CASE 
    WHEN fetch_all THEN ''
    ELSE format('LIMIT %s OFFSET %s', limit_count, offset_count)
  END
  );
  
  -- Execute and return results
  RETURN QUERY EXECUTE final_query;
END;
$$;

-- ============================================================================
-- GRANT PERMISSIONS
-- ============================================================================

GRANT EXECUTE ON FUNCTION core.cms_search_pois(
  TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, INTEGER, INTEGER, BOOLEAN
) TO authenticated;

GRANT EXECUTE ON FUNCTION core.cms_search_pois(
  TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, INTEGER, INTEGER, BOOLEAN
) TO service_role;

-- ============================================================================
-- FUNCTION COMMENT
-- ============================================================================

COMMENT ON FUNCTION core.cms_search_pois(
  TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, INTEGER, INTEGER, BOOLEAN
) IS 'Production-ready POI search with comprehensive filtering, proper type handling, and statistics calculation. Supports fetch_all for map views.';

-- ============================================================================
-- END OF FILE
-- ============================================================================

