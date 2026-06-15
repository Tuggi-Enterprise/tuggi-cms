-- ============================================================================
-- 20260615 — Fix do filtro de country da /pois (cms_get_countries dava 500)
-- ============================================================================
-- Dois problemas latentes, expostos quando o PostgREST recarregou o schema
-- (NOTIFY pgrst das migrations desta data):
--
--   1) Existiam DUAS core.cms_get_countries: a versão correta com
--      (p_category text DEFAULT NULL) (migration 20260303, usada pelo front em
--      lib/core/location-service.ts) e uma órfã SEM args criada manualmente.
--      O PostgREST não conseguia desambiguar -> 500 (PGRST203).
--
--   2) Resolvida a ambiguidade, a função rodava mas o caminho p_category=NULL
--      (todos os países) fazia GROUP BY country sobre ~865k linhas de attractions
--      usando um índice largo (country,city,approved) -> ~7,9s -> 57014 timeout.
--
-- Ambos JÁ APLICADOS no painel. Idempotente.
-- ============================================================================

-- 1) Remover a função órfã sem argumentos (a versão (p_category) é a correta)
DROP FUNCTION IF EXISTS core.cms_get_countries();

-- 2) Índice estreito só em country -> index-only scan compacto.
--    Mede: 7.883ms -> 2.727ms; chamada real da RPC ~0,7s.
--    (CONCURRENTLY não roda em transação de migration; aplicado avulso no painel)
CREATE INDEX IF NOT EXISTS idx_attractions_country_only
  ON core.attractions (country)
  WHERE country IS NOT NULL AND country <> '';

NOTIFY pgrst, 'reload schema';
