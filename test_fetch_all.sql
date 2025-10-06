-- Test fetch_all parameter directly - ALL TESTS IN ONE QUERY
-- This will help us verify if the RPC is working correctly

SELECT 
  (SELECT COUNT(*) FROM core.cms_search_pois(
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
  )) as total_returned_fetch_all_true,
  
  (SELECT COUNT(*) FROM core.cms_search_pois(
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
    fetch_all := FALSE
  )) as total_returned_fetch_all_false,
  
  (SELECT COUNT(*) FROM core.attractions) as total_in_database;
