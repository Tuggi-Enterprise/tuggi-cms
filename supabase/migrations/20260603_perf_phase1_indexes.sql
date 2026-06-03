-- ============================================================================
-- FASE 1 — Índices (quick win). Aplicar MANUALMENTE no SQL editor do Supabase.
--
-- ⚠️ CREATE INDEX CONCURRENTLY NÃO pode rodar dentro de transação.
--    Cole UM statement por vez (sem BEGIN/COMMIT). Cada um pega apenas
--    SHARE UPDATE EXCLUSIVE — NÃO bloqueia o backfill/migração em andamento.
--    Em tabela grande (attractions ~633k, trigger_points ~4,73M) cada índice
--    leva alguns minutos. Re-rodar o EXPLAIN da Fase 0 (0c) após cada um.
-- ============================================================================

-- 1.1 Sort por created_at + tiebreaker estável (offset E keyset determinísticos).
--     Substitui a necessidade de sort total no ORDER BY a.created_at DESC.
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_attractions_created_at_id
  ON core.attractions (created_at DESC, id DESC);

-- 1.2 Colunas de filtro usadas pelo RPC (country/state/city/category) + par de status.
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_attractions_country
  ON core.attractions (country) WHERE country IS NOT NULL;

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_attractions_state
  ON core.attractions (state) WHERE state IS NOT NULL;

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_attractions_city
  ON core.attractions (city) WHERE city IS NOT NULL;

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_attractions_category
  ON core.attractions (category) WHERE category IS NOT NULL;

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_attractions_approved_active
  ON core.attractions (approved, is_active);

-- 1.3 Trigram para busca por nome (resolve o ILIKE '%termo%', wildcard à esquerda).
--     A extensão pg_trgm já existe no projeto (usada em homolog.pois).
CREATE EXTENSION IF NOT EXISTS pg_trgm;   -- no-op se já existe (NÃO é concurrently)

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_attractions_name_trgm
  ON core.attractions USING gin (name gin_trgm_ops);

-- 1.4 FK das child tables.
-- ⚠️ JÁ CONFIRMADO no EXPLAIN da Fase 0 (0d) que estes índices JÁ EXISTEM:
--     - attraction_descriptions: idx_attraction_descriptions_attraction_lang (attraction_id, language)
--       → cobre lookups por attraction_id (coluna líder). NÃO criar o standalone (redundante).
--     - attraction_trigger_points: idx_trigger_points_attraction_id  → já existe.
-- Portanto, NÃO rodar estes dois:
--   -- CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_attraction_descriptions_attraction_id ...
--   -- CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_trigger_points_attraction_id ...
--
-- Só falta confirmar attraction_group_members (ver 0a). Criar SOMENTE se faltar:
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_attraction_group_members_attraction_id
  ON core.attraction_group_members (attraction_id);

-- 1.5 bbox do mapa: latitude/longitude usados com BETWEEN em /api/pois/map-bbox
--     e em cms_search_pois_map. Hoje só há GIST em boundary_geometry.
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_attraction_coordinate_lat_lng
  ON core.attraction_coordinate (latitude, longitude);

-- ----------------------------------------------------------------------------
-- Pós-aplicação: ANALYZE para o planner reconhecer os índices novos de imediato.
-- ----------------------------------------------------------------------------
ANALYZE core.attractions;
ANALYZE core.attraction_descriptions;
ANALYZE core.attraction_group_members;
ANALYZE core.attraction_coordinate;
