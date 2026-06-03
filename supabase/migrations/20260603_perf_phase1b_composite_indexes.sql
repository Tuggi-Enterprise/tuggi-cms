-- ============================================================================
-- FASE 1b — Índices COMPOSTOS (coluna de filtro + created_at + id).
-- Aplicar MANUALMENTE no SQL editor. Um CREATE INDEX CONCURRENTLY por vez.
--
-- Por quê: a lista filtra por uma coluna (country/city/...) e ordena por
-- created_at DESC. Sem composto, o planner ou caminha o índice de created_at
-- (lento quando o filtro é esparso entre os recentes — ex.: country=Brasil) ou
-- materializa o conjunto inteiro (lento quando o filtro é a maioria — ex.:
-- country=United States). O composto (filtro, created_at DESC, id DESC) entrega
-- os top-N já filtrados E ordenados direto do índice — rápido nos DOIS extremos.
-- ============================================================================

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_attractions_country_created
  ON core.attractions (country, created_at DESC, id DESC) WHERE country IS NOT NULL;

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_attractions_state_created
  ON core.attractions (state, created_at DESC, id DESC) WHERE state IS NOT NULL;

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_attractions_city_created
  ON core.attractions (city, created_at DESC, id DESC) WHERE city IS NOT NULL;

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_attractions_category_created
  ON core.attractions (category, created_at DESC, id DESC) WHERE category IS NOT NULL;

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_attractions_approved_created
  ON core.attractions (approved, created_at DESC, id DESC);

-- Estes compostos tornam redundantes os índices simples de filtro da Fase 1
-- (idx_attractions_country/state/city/category), que cobriam só a coluna de
-- filtro sem o sort. Depois de validar a performance, dá pra DROPá-los (DDL
-- manual) para reduzir overhead de escrita:
--   DROP INDEX CONCURRENTLY IF EXISTS core.idx_attractions_country;
--   DROP INDEX CONCURRENTLY IF EXISTS core.idx_attractions_state;
--   DROP INDEX CONCURRENTLY IF EXISTS core.idx_attractions_city;
--   DROP INDEX CONCURRENTLY IF EXISTS core.idx_attractions_category;

ANALYZE core.attractions;
