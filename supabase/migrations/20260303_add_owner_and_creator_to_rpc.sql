-- Migration: Add owner_id and created_by to cms_search_pois RPC returns and cleanup unused fields
-- Date: 2026-03-03

DROP FUNCTION IF EXISTS core.cms_search_pois(
  TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, INTEGER, INTEGER, BOOLEAN, UUID, TEXT
);

CREATE OR REPLACE FUNCTION core.cms_search_pois(
  search_term TEXT DEFAULT NULL,
  status_filter TEXT DEFAULT 'all',
  country_filter TEXT DEFAULT NULL,
  state_filter TEXT DEFAULT NULL,
  city_filter TEXT DEFAULT NULL,
  google_types_filter TEXT DEFAULT NULL,
  category_filter TEXT DEFAULT NULL,
  content_status_filter TEXT DEFAULT 'all',
  group_status_filter TEXT DEFAULT 'all',
  score_filter TEXT DEFAULT 'all',
  trigger_points_filter TEXT DEFAULT 'all',
  limit_count INTEGER DEFAULT 1000,
  offset_count INTEGER DEFAULT 0,
  fetch_all BOOLEAN DEFAULT FALSE,
  p_owner_id UUID DEFAULT NULL, -- Renamed from owner_id to avoid collision
  is_active_filter TEXT DEFAULT 'all'
)
RETURNS TABLE (
  id TEXT,
  name TEXT,
  city TEXT,
  state TEXT,
  country TEXT,
  category TEXT,
  approved BOOLEAN,
  is_active BOOLEAN,
  created_at TIMESTAMPTZ,
  updated_at TIMESTAMPTZ,
  user_id TEXT,
  owner_id UUID,
  created_by UUID,
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
  base_query TEXT;
  where_conditions TEXT[] := '{}';
  order_clause TEXT := 'ORDER BY a.created_at DESC';
  limit_clause TEXT := '';
  offset_clause TEXT := '';
  stats_query TEXT;
  stats_result RECORD;
  caller_cms_id UUID;
  is_admin BOOLEAN := FALSE;
BEGIN
  -- Resolve caller identity
  BEGIN
    caller_cms_id := (SELECT cu.id FROM core.cms_users cu WHERE cu.email = current_setting('request.jwt.claims.email', true));
    is_admin := EXISTS (
      SELECT 1 FROM core.cms_users cu
      WHERE cu.email = current_setting('request.jwt.claims.email', true) AND cu.role IN ('admin','super_admin')
    );
  EXCEPTION WHEN OTHERS THEN
    is_admin := TRUE;
  END;

  -- If not admin, restrict to caller's POIs
  IF NOT is_admin AND caller_cms_id IS NOT NULL THEN
    p_owner_id := caller_cms_id;
  END IF;

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

  IF category_filter IS NOT NULL AND category_filter != '' THEN
    where_conditions := array_append(where_conditions, format('a.category = %L', category_filter));
  END IF;

  IF p_owner_id IS NOT NULL THEN
    where_conditions := array_append(where_conditions, format('a.created_by = %L', p_owner_id));
  END IF;

  IF is_active_filter IS NOT NULL AND is_active_filter != 'all' THEN
    IF is_active_filter = 'active' THEN
      where_conditions := array_append(where_conditions, 'COALESCE(a.is_active, true) = TRUE');
    ELSIF is_active_filter = 'inactive' THEN
      where_conditions := array_append(where_conditions, 'COALESCE(a.is_active, true) = FALSE');
    END IF;
  END IF;

  -- Content Status Filter
  IF content_status_filter IS NOT NULL AND content_status_filter != 'all' THEN
    IF content_status_filter = 'missing_description' THEN
      where_conditions := array_append(where_conditions, 'NOT EXISTS (SELECT 1 FROM core.attraction_descriptions ad WHERE ad.attraction_id = a.id)');
    ELSIF content_status_filter = 'missing_audio' THEN
      where_conditions := array_append(where_conditions, 'NOT EXISTS (SELECT 1 FROM core.attraction_descriptions ad WHERE ad.attraction_id = a.id AND ad.audio_url IS NOT NULL AND ad.audio_url != '''')');
    ELSIF content_status_filter = 'complete' THEN
      where_conditions := array_append(where_conditions, 'a.approved = TRUE AND EXISTS (SELECT 1 FROM core.attraction_descriptions ad WHERE ad.attraction_id = a.id AND ad.audio_url IS NOT NULL AND ad.audio_url != '''')');
    END IF;
  END IF;

  -- Group Status Filter
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

  -- Trigger Points Filter
  IF trigger_points_filter IS NOT NULL AND trigger_points_filter != 'all' THEN
    IF trigger_points_filter = 'with_trigger_points' THEN
      where_conditions := array_append(where_conditions, 'EXISTS (SELECT 1 FROM core.attraction_trigger_points atp WHERE atp.attraction_id = a.id)');
    ELSIF trigger_points_filter = 'without_trigger_points' THEN
      where_conditions := array_append(where_conditions, 'NOT EXISTS (SELECT 1 FROM core.attraction_trigger_points atp WHERE atp.attraction_id = a.id)');
    END IF;
  END IF;

  -- Score Filter
  IF score_filter IS NOT NULL AND score_filter != 'all' THEN
    IF score_filter = 'no_score' THEN
      where_conditions := array_append(where_conditions, 'NOT EXISTS (SELECT 1 FROM core.attraction_descriptions ad WHERE ad.attraction_id = a.id AND ad.last_score_overall IS NOT NULL)');
    ELSIF score_filter = 'rejected' THEN
      where_conditions := array_append(where_conditions, 'EXISTS (SELECT 1 FROM core.attraction_descriptions ad WHERE ad.attraction_id = a.id AND ad.last_score_overall < 50)');
    ELSIF score_filter = 'pending' THEN
      where_conditions := array_append(where_conditions, 'EXISTS (SELECT 1 FROM core.attraction_descriptions ad WHERE ad.attraction_id = a.id AND ad.last_score_overall >= 50 AND ad.last_score_overall < 80)');
    ELSIF score_filter = 'approved' THEN
      where_conditions := array_append(where_conditions, 'EXISTS (SELECT 1 FROM core.attraction_descriptions ad WHERE ad.attraction_id = a.id AND ad.last_score_overall >= 80)');
    END IF;
  END IF;

  -- Build WHERE clause
  IF array_length(where_conditions, 1) > 0 THEN
    where_conditions := array_append(where_conditions, '1=1'); -- Placeholder
  END IF;

  -- Calculate statistics
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

  -- Build main query with relations
  base_query := format('
    SELECT 
      a.id::TEXT,
      a.name,
      a.city,
      a.state,
      a.country,
      a.category,
      a.approved,
      COALESCE(a.is_active, true) as is_active,
      a.created_at,
      a.updated_at,
      a.user_id::TEXT,
      a.owner_id,
      a.created_by,
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
            ''created_at'', ad.created_at,
            ''verification_status'', ad.verification_status,
            ''score_overall'', ad.last_score_overall
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
    %s
  ', 
    stats_result.total_count,
    stats_result.approved_count,
    stats_result.pending_count,
    stats_result.with_description_count,
    stats_result.with_audio_count,
    stats_result.with_trigger_points_count,
    stats_result.complete_count,
    CASE WHEN array_length(where_conditions, 1) > 0 THEN 'WHERE ' || array_to_string(where_conditions, ' AND ') ELSE '' END,
    order_clause
  );

  IF NOT fetch_all THEN
    limit_clause := format(' LIMIT %s', limit_count);
    offset_clause := format(' OFFSET %s', offset_count);
  END IF;

  RETURN QUERY EXECUTE base_query || limit_clause || offset_clause;
END;
$$;

GRANT EXECUTE ON FUNCTION core.cms_search_pois(
  TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, INTEGER, INTEGER, BOOLEAN, UUID, TEXT
) TO authenticated;
GRANT EXECUTE ON FUNCTION core.cms_search_pois(
  TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, INTEGER, INTEGER, BOOLEAN, UUID, TEXT
) TO service_role;
