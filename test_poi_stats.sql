-- Test POI Statistics
-- Check if the RPC is calculating stats correctly

-- Test 1: Direct count from attractions table
SELECT 
  COUNT(*) as total_count,
  COUNT(*) FILTER (WHERE approved = true) as approved_count,
  COUNT(*) FILTER (WHERE approved = false) as pending_count
FROM core.attractions;

-- Test 2: Check if RPC is working
SELECT * FROM core.cms_search_pois(
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
  limit_count := 1,
  offset_count := 0,
  fetch_all := TRUE
) LIMIT 1;
