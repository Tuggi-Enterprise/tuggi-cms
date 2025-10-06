-- Create a separate RPC for POI statistics
CREATE OR REPLACE FUNCTION core.cms_get_poi_stats(
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
  trigger_points_filter TEXT DEFAULT NULL
)
RETURNS TABLE (
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
  filter_clause TEXT := '';
BEGIN
  -- Build WHERE conditions (same logic as main RPC)
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
  
  -- Build final WHERE clause
  IF array_length(where_conditions, 1) > 0 THEN
    filter_clause := ' WHERE ' || array_to_string(where_conditions, ' AND ');
  END IF;
  
  -- Execute the statistics query
  RETURN QUERY EXECUTE format('
    SELECT 
      (SELECT COUNT(*) FROM core.attractions a %s) as total_count,
      (SELECT COUNT(*) FROM core.attractions a %s AND a.approved = true) as approved_count,
      (SELECT COUNT(*) FROM core.attractions a %s AND a.approved = false) as pending_count,
      (SELECT COUNT(*) FROM core.attractions a %s AND EXISTS (SELECT 1 FROM core.attraction_descriptions ad WHERE ad.attraction_id = a.id AND ad.description IS NOT NULL AND ad.description != '''')) as with_description_count,
      (SELECT COUNT(*) FROM core.attractions a %s AND EXISTS (SELECT 1 FROM core.attraction_descriptions ad WHERE ad.attraction_id = a.id AND ad.audio_url IS NOT NULL AND ad.audio_url != '''')) as with_audio_count,
      (SELECT COUNT(*) FROM core.attractions a %s AND EXISTS (SELECT 1 FROM core.attraction_trigger_points atp WHERE atp.attraction_id = a.id)) as with_trigger_points_count,
      (SELECT COUNT(*) FROM core.attractions a %s AND EXISTS (SELECT 1 FROM core.attraction_descriptions ad WHERE ad.attraction_id = a.id AND ad.description IS NOT NULL AND ad.description != '''' AND ad.audio_url IS NOT NULL AND ad.audio_url != '''')) as complete_count
  ', filter_clause, filter_clause, filter_clause, filter_clause, filter_clause, filter_clause, filter_clause);
END;
$$;

-- Grant permissions
GRANT EXECUTE ON FUNCTION core.cms_get_poi_stats(
  TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT
) TO authenticated;

GRANT EXECUTE ON FUNCTION core.cms_get_poi_stats(
  TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT
) TO service_role;
