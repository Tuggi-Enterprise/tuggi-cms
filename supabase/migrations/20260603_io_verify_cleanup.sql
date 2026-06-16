-- ============================================================================
-- VERIFICAÇÃO do cleanup de índices (SOMENTE LEITURA). Rodar UMA query por vez.
-- ============================================================================

-- 1. RESUMO: nº de índices + tamanho total por tabela quente.
--    Esperado (depois do cleanup, aprox.):
--      attraction_trigger_points: ~25 → ~8 índices
--      attractions:               ~110 → ~50 índices
--      attraction_coordinate:     ~20 → ~9 índices
SELECT s.relname AS table_name,
       count(*) AS num_indexes,
       pg_size_pretty(sum(pg_relation_size(s.indexrelid))) AS total_index_size,
       pg_size_pretty(pg_table_size(('core.'||s.relname)::regclass)) AS table_size
FROM pg_stat_user_indexes s
WHERE s.schemaname = 'core'
  AND s.relname IN ('attractions','attraction_trigger_points','attraction_coordinate','attraction_descriptions')
GROUP BY s.relname
ORDER BY sum(pg_relation_size(s.indexrelid)) DESC;

-- 2. Os índices que dropamos AINDA existem? (deve voltar 0 linhas)
SELECT n.nspname AS schema, c.relname AS index_ainda_existe
FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
WHERE c.relkind = 'i' AND n.nspname = 'core'
  AND c.relname IN (
    'idx_trigger_points_spatial_walk','idx_trigger_points_spatial_car',
    'idx_trigger_points_active_location','idx_trigger_points_active_type_location_v2',
    'idx_trigger_points_location','idx_attraction_trigger_points_location_active',
    'idx_attraction_trigger_points_location_gist','idx_trigger_points_priority_location_v2',
    'idx_trigger_points_attraction_active_type_priority','idx_trigger_points_confidence',
    'idx_trigger_points_active_priority','idx_attraction_trigger_points_attraction_id_optimized',
    'idx_attractions_city_rating_optimized','idx_attractions_planner_optimize',
    'idx_attractions_name_gin_search','idx_attractions_destination_search',
    'idx_attraction_coordinate_boundary_geometry','idx_attraction_coordinate_geography_v2',
    'idx_attraction_coordinate_location_geography','idx_attraction_coordinate_lat_lng',
    'idx_attractions_is_notable','idx_attractions_importance_score'
  );

-- 3. Os ESSENCIAIS continuam lá? (deve listar TODOS os 8)
SELECT c.relname AS index_essencial_presente
FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
WHERE c.relkind = 'i' AND n.nspname = 'core'
  AND c.relname IN (
    'attractions_pkey','idx_trigger_points_attraction_id','idx_atp_location_active_gist',
    'idx_attraction_coordinate_attraction_id_optimized','idx_attractions_created_at_id',
    'idx_attractions_name_trgm','idx_attractions_country_created','idx_attraction_coordinate_viewport_v4'
  )
ORDER BY 1;

-- 4. Ainda há índices NÃO usados (idx_scan=0)? Lista o que sobrou.
--    Esperado sobrar SÓ: constraints UNIQUE (legítimas) e os índices novos do
--    cutover ainda pouco exercidos (state_created, etc.). Se aparecer algum
--    legado grande não-unique, é candidato a dropar também.
SELECT s.relname AS table_name, i.relname AS index_name,
       pg_size_pretty(pg_relation_size(i.oid)) AS size,
       CASE WHEN ix.indisunique THEN 'UNIQUE (manter)' ELSE 'btree (avaliar)' END AS tipo
FROM pg_stat_user_indexes s
JOIN pg_class i ON i.oid = s.indexrelid
JOIN pg_index ix ON ix.indexrelid = s.indexrelid
WHERE s.schemaname = 'core'
  AND s.relname IN ('attractions','attraction_trigger_points','attraction_coordinate','attraction_descriptions')
  AND s.idx_scan = 0
ORDER BY ix.indisunique ASC, pg_relation_size(i.oid) DESC;

-- 5. Índices duplicados restantes (mesma tabela + mesmas colunas). Deve estar limpo
--    (ou só pares unique↔índice esperados).
SELECT indrelid::regclass AS table_name, array_agg(indexrelid::regclass) AS duplicados
FROM pg_index
WHERE indrelid IN (
  'core.attractions'::regclass, 'core.attraction_trigger_points'::regclass,
  'core.attraction_coordinate'::regclass, 'core.attraction_descriptions'::regclass
)
GROUP BY indrelid, indkey
HAVING count(*) > 1;
