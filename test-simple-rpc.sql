-- Teste simples da função RPC
-- Primeiro vamos testar uma versão muito básica

-- Teste 1: Verificar se a função existe
SELECT routine_name, routine_type 
FROM information_schema.routines 
WHERE routine_schema = 'core' 
AND routine_name = 'cms_search_pois';

-- Teste 2: Chamada básica da função
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
  limit_count := 5,
  offset_count := 0,
  fetch_all := FALSE
) LIMIT 1;
