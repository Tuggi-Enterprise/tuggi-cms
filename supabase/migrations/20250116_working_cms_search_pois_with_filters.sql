-- Versão funcional do RPC com filtros implementados
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

  -- Coordinates
  latitude DOUBLE PRECISION,
  longitude DOUBLE PRECISION,

  -- Descriptions
  descriptions JSONB,

  -- Trigger points
  trigger_points JSONB,

  -- Group membership
  group_membership JSONB,

  -- Verification data for original pt-BR description
  verification_data JSONB,

  -- Counts
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
  query_text TEXT;
  where_conditions TEXT[] := ARRAY[]::TEXT[];
  filter_clause TEXT;
  order_clause TEXT;
  limit_offset_clause TEXT;
  total_pois_count INTEGER;
  approved_pois_count INTEGER;
  pending_pois_count INTEGER;
  with_description_pois_count INTEGER;
  with_audio_pois_count INTEGER;
  with_trigger_points_pois_count INTEGER;
  complete_pois_count INTEGER;
BEGIN
  -- 1. Build WHERE conditions
  IF search_term IS NOT NULL AND search_term != '' THEN
    where_conditions := array_append(where_conditions, format('(a.name ILIKE %L OR a.city ILIKE %L OR a.country ILIKE %L)', '%' || search_term || '%', '%' || search_term || '%', '%' || search_term || '%'));
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

  IF google_types_filter IS NOT NULL AND google_types_filter != '' THEN
    where_conditions := array_append(where_conditions, format('%L = ANY(a.google_types)', google_types_filter));
  END IF;

  IF category_filter IS NOT NULL AND category_filter != '' THEN
    where_conditions := array_append(where_conditions, format('a.category = %L', category_filter));
  END IF;

  IF content_status_filter IS NOT NULL AND content_status_filter != 'all' THEN
    IF content_status_filter = 'with_description' THEN
      where_conditions := array_append(where_conditions, 'EXISTS (SELECT 1 FROM core.attraction_descriptions ad WHERE ad.attraction_id = a.id AND ad.description IS NOT NULL AND ad.description != '''')');
    ELSIF content_status_filter = 'missing_description' THEN
      where_conditions := array_append(where_conditions, 'NOT EXISTS (SELECT 1 FROM core.attraction_descriptions ad WHERE ad.attraction_id = a.id AND ad.description IS NOT NULL AND ad.description != '''')');
    ELSIF content_status_filter = 'with_audio' THEN
      where_conditions := array_append(where_conditions, 'EXISTS (SELECT 1 FROM core.attraction_descriptions ad WHERE ad.attraction_id = a.id AND ad.audio_url IS NOT NULL AND ad.audio_url != '''')');
    ELSIF content_status_filter = 'missing_audio' THEN
      where_conditions := array_append(where_conditions, 'NOT EXISTS (SELECT 1 FROM core.attraction_descriptions ad WHERE ad.attraction_id = a.id AND ad.audio_url IS NOT NULL AND ad.audio_url != '''')');
    ELSIF content_status_filter = 'complete' THEN
      where_conditions := array_append(where_conditions, 'EXISTS (SELECT 1 FROM core.attraction_descriptions ad WHERE ad.attraction_id = a.id AND ad.description IS NOT NULL AND ad.description != '''' AND ad.audio_url IS NOT NULL AND ad.audio_url != '''')');
    END IF;
  END IF;

  IF group_status_filter IS NOT NULL AND group_status_filter != 'all' THEN
    IF group_status_filter = 'grouped' THEN
      where_conditions := array_append(where_conditions, 'EXISTS (SELECT 1 FROM core.attraction_group_members agm WHERE agm.attraction_id = a.id)');
    ELSIF group_status_filter = 'ungrouped' THEN
      where_conditions := array_append(where_conditions, 'NOT EXISTS (SELECT 1 FROM core.attraction_group_members agm WHERE agm.attraction_id = a.id)');
    ELSIF group_status_filter = 'group_main' THEN
      where_conditions := array_append(where_conditions, 'EXISTS (SELECT 1 FROM core.attraction_group_members agm WHERE agm.attraction_id = a.id AND agm.group_role = ''main'')');
    ELSIF group_status_filter = 'group_member' THEN
      where_conditions := array_append(where_conditions, 'EXISTS (SELECT 1 FROM core.attraction_group_members agm WHERE agm.attraction_id = a.id AND agm.group_role = ''member'')');
    END IF;
  END IF;

  IF score_filter IS NOT NULL AND score_filter != 'all' THEN
    IF score_filter = 'no_score' THEN
      where_conditions := array_append(where_conditions, 'a.last_verification_score IS NULL');
    ELSIF score_filter = 'low_score' THEN
      where_conditions := array_append(where_conditions, 'a.last_verification_score < 50');
    ELSIF score_filter = 'high_score' THEN
      where_conditions := array_append(where_conditions, 'a.last_verification_score >= 75');
    END IF;
  END IF;

  IF trigger_points_filter IS NOT NULL AND trigger_points_filter != 'all' THEN
    IF trigger_points_filter = 'with_trigger_points' THEN
      where_conditions := array_append(where_conditions, 'EXISTS (SELECT 1 FROM core.attraction_trigger_points atp WHERE atp.attraction_id = a.id)');
    ELSIF trigger_points_filter = 'without_trigger_points' THEN
      where_conditions := array_append(where_conditions, 'NOT EXISTS (SELECT 1 FROM core.attraction_trigger_points atp WHERE atp.attraction_id = a.id)');
    END IF;
  END IF;

  IF array_length(where_conditions, 1) > 0 THEN
    filter_clause := ' WHERE ' || array_to_string(where_conditions, ' AND ');
  ELSE
    filter_clause := '';
  END IF;

  -- 2. Calculate counts if fetch_all is true
  IF fetch_all THEN
    EXECUTE format('SELECT COUNT(*) FROM core.attractions a %s', filter_clause) INTO total_pois_count;
    EXECUTE format('SELECT COUNT(*) FROM core.attractions a %s AND a.approved = TRUE', filter_clause) INTO approved_pois_count;
    EXECUTE format('SELECT COUNT(*) FROM core.attractions a %s AND a.approved = FALSE', filter_clause) INTO pending_pois_count;
    EXECUTE format('SELECT COUNT(*) FROM core.attractions a %s AND EXISTS (SELECT 1 FROM core.attraction_descriptions ad WHERE ad.attraction_id = a.id AND ad.description IS NOT NULL AND ad.description != '''')', filter_clause) INTO with_description_pois_count;
    EXECUTE format('SELECT COUNT(*) FROM core.attractions a %s AND EXISTS (SELECT 1 FROM core.attraction_descriptions ad WHERE ad.attraction_id = a.id AND ad.audio_url IS NOT NULL AND ad.audio_url != '''')', filter_clause) INTO with_audio_pois_count;
    EXECUTE format('SELECT COUNT(*) FROM core.attractions a %s AND EXISTS (SELECT 1 FROM core.attraction_trigger_points atp WHERE atp.attraction_id = a.id)', filter_clause) INTO with_trigger_points_pois_count;
    EXECUTE format('SELECT COUNT(*) FROM core.attractions a %s AND EXISTS (SELECT 1 FROM core.attraction_descriptions ad WHERE ad.attraction_id = a.id AND ad.description IS NOT NULL AND ad.description != '''' AND ad.audio_url IS NOT NULL AND ad.audio_url != '''')', filter_clause) INTO complete_pois_count;
  ELSE
    total_pois_count := 0; -- Not applicable for paginated results
    approved_pois_count := 0;
    pending_pois_count := 0;
    with_description_pois_count := 0;
    with_audio_pois_count := 0;
    with_trigger_points_pois_count := 0;
    complete_pois_count := 0;
  END IF;

  -- 3. Build ORDER BY and LIMIT/OFFSET clauses
  order_clause := ' ORDER BY a.created_at DESC';
  limit_offset_clause := format(' LIMIT %s OFFSET %s', limit_count, offset_count);

  -- 4. Construct and execute the main query
  -- Debug: Log the filter clause
  RAISE NOTICE 'Filter clause: %', filter_clause;
  
  query_text := '
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
              ''is_original'', ad.is_original,
              ''description_scores'', (
                  SELECT jsonb_agg(
                      jsonb_build_object(
                          ''score_overall'', ds.score_overall,
                          ''subscores'', ds.subscores,
                          ''flags'', ds.flags,
                          ''created_at'', ds.created_at
                      )
                  )
                  FROM core.description_scores ds
                  WHERE ds.description_id = ad.id
              )
            )
          )
          FROM core.attraction_descriptions ad
          WHERE ad.attraction_id = a.id
        ),
        ''[]''::jsonb
      ) AS descriptions,

      -- Trigger points
      COALESCE(
        (
          SELECT jsonb_agg(
            jsonb_build_object(
              ''id'', atp.id,
              ''is_active'', atp.is_active,
              ''type'', atp.type,
              ''name'', atp.name
            )
          )
          FROM core.attraction_trigger_points atp
          WHERE atp.attraction_id = a.id
        ),
        ''[]''::jsonb
      ) AS trigger_points,

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
          JOIN core.attraction_groups ag ON agm.group_id = ag.id
          WHERE agm.attraction_id = a.id
        ),
        ''[]''::jsonb
      ) AS group_membership,

      -- Verification data for original pt-BR description
      (
        SELECT
          jsonb_build_object(
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
        LEFT JOIN core.description_scores ds_orig ON ad_orig.id = ds_orig.description_id
        WHERE ad_orig.attraction_id = a.id
          AND ad_orig.language = ''pt-BR''
          AND ad_orig.is_original = true
        ORDER BY ds_orig.created_at DESC
        LIMIT 1
      ) as verification_data,

      -- Counts básicos (sem filtros complexos)
      ' || total_pois_count || ',
      ' || approved_pois_count || ',
      ' || pending_pois_count || ',
      ' || with_description_pois_count || ',
      ' || with_audio_pois_count || ',
      ' || with_trigger_points_pois_count || ',
      ' || complete_pois_count || '
    FROM
      core.attractions a
    LEFT JOIN
      core.attraction_coordinate ac ON a.id = ac.attraction_id
    ' || filter_clause || '
    ' || order_clause || '
    ' || limit_offset_clause;

  RETURN QUERY EXECUTE query_text;
END;
$$;
