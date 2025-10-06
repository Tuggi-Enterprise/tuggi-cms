-- Teste do RPC para United States
SELECT * FROM core.cms_search_pois(
  search_term := NULL,
  status_filter := 'all',
  country_filter := 'United States',
  state_filter := NULL,
  city_filter := NULL,
  google_types_filter := NULL,
  category_filter := NULL,
  content_status_filter := NULL,
  group_status_filter := NULL,
  score_filter := NULL,
  trigger_points_filter := NULL,
  limit_count := 10,
  offset_count := 0,
  fetch_all := FALSE
);