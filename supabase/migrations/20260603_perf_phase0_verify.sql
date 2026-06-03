-- ============================================================================
-- FASE 0 — Verificação (SOMENTE LEITURA). Rodar no SQL editor do Supabase.
-- Não aplica DDL. Objetivo: transformar "verificar no vivo" em fato e capturar
-- o baseline de performance ANTES de criar índices/RPCs.
-- ============================================================================

-- 0a. Índice de FK nas child tables (a incógnita crítica do plano).
--     Se attraction_id NÃO aparecer indexado em attraction_descriptions /
--     attraction_group_members, os índices da Fase 1.4 viram prioridade #1.
SELECT tablename, indexname, indexdef
FROM pg_indexes
WHERE schemaname = 'core'
  AND tablename IN ('attraction_descriptions','attraction_group_members','attraction_trigger_points')
ORDER BY tablename, indexname;

-- 0b. Índices atuais de attractions (sanidade vs. o repositório).
SELECT indexname, indexdef
FROM pg_indexes
WHERE schemaname = 'core' AND tablename = 'attractions'
ORDER BY indexname;

-- 0c. Baseline do timeout. Timeout generoso só para conseguir medir o plano.
SET statement_timeout = '60s';

EXPLAIN (ANALYZE, BUFFERS)
SELECT * FROM core.cms_search_pois(
  NULL,'all',NULL,NULL,NULL,NULL,NULL,NULL,'all','all','all','all',20,0,false,NULL,'all'
);

-- 0d. O bloco de stats sozinho é o gargalo? (replica os COUNT(*) FILTER EXISTS)
EXPLAIN (ANALYZE, BUFFERS)
SELECT COUNT(*),
  COUNT(*) FILTER (WHERE EXISTS (SELECT 1 FROM core.attraction_descriptions ad WHERE ad.attraction_id = a.id)),
  COUNT(*) FILTER (WHERE EXISTS (SELECT 1 FROM core.attraction_trigger_points atp WHERE atp.attraction_id = a.id))
FROM core.attractions a;

RESET statement_timeout;

-- 0e. (opcional) Índices INVALID deixados por algum CREATE INDEX CONCURRENTLY que falhou.
SELECT n.nspname AS schema, c.relname AS index_name
FROM pg_index i
JOIN pg_class c ON c.oid = i.indexrelid
JOIN pg_namespace n ON n.oid = c.relnamespace
WHERE NOT i.indisvalid AND n.nspname IN ('core');
