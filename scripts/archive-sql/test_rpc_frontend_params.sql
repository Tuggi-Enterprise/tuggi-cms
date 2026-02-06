-- Teste do RPC com exatamente os mesmos parâmetros do frontend
SELECT * FROM core.cms_search_pois(
  search_term := NULL,
  status_filter := 'all',
  country_filter := 'United States',
  state_filter := NULL,
  city_filter := NULL,
  google_types_filter := NULL,
  category_filter := NULL,
  content_status_filter := 'all',
  group_status_filter := 'all',
  score_filter := 'all',
  trigger_points_filter := 'all',
  limit_count := 100,
  offset_count := 0,
  fetch_all := FALSE
);
