-- ============================================================================
-- Taxonomia canônica de categorias de POI — core.attractions
-- ============================================================================
-- ⚠️  RODAR MANUALMENTE no painel SQL do Supabase. NÃO aplicar via CLI.
--     (regra do projeto: nunca DDL via CLI — DROP/CREATE/ALTER só no painel)
--
-- Contexto: a maioria dos POIs sobe com `primary_category` nulo/genérico. O
-- backfill (scripts/backfill-poi-categories.ts) e o pipeline de ingestão passam
-- a gravar uma categoria específica canônica em `primary_category` + o macro-grupo
-- em `category_group`, e a flag de relevância em `is_notable` / `importance_score`.
-- Estas colunas são ADITIVAS — nada é removido ou renomeado.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. COLUNAS NOVAS (aditivas, idempotentes)
-- ----------------------------------------------------------------------------
ALTER TABLE core.attractions
  ADD COLUMN IF NOT EXISTS category_group   text,                       -- macro-grupo (9 valores)
  ADD COLUMN IF NOT EXISTS is_notable       boolean NOT NULL DEFAULT false, -- histórico/importante
  ADD COLUMN IF NOT EXISTS importance_score smallint;                   -- 0..100, nulo até backfill

COMMENT ON COLUMN core.attractions.category_group   IS 'Macro-grupo: nature/water/parks/culture/religious/civic/leisure/infrastructure/lodging/place';
COMMENT ON COLUMN core.attractions.is_notable       IS 'Tem referência externa forte / heritage / importância nacional (importance_score >= 30)';
COMMENT ON COLUMN core.attractions.importance_score IS 'Relevância combinada 0..100 (wiki/heritage/unesco/landmark/historic)';

-- ----------------------------------------------------------------------------
-- 2. CHECK do macro-grupo (9 valores). Separado da coluna para poder evoluir.
-- ----------------------------------------------------------------------------
-- 10 macro-grupos (inclui 'parks', separado de leisure/nature). Drop+recreate
-- torna idempotente mesmo se uma versão anterior (9 grupos) já tiver sido aplicada.
ALTER TABLE core.attractions DROP CONSTRAINT IF EXISTS chk_attractions_category_group;
ALTER TABLE core.attractions
  ADD CONSTRAINT chk_attractions_category_group CHECK (
    category_group IS NULL OR category_group IN (
      'nature', 'water', 'parks', 'culture', 'religious', 'civic',
      'leisure', 'infrastructure', 'lodging', 'place'
    )
  );

-- ----------------------------------------------------------------------------
-- 3. ÍNDICES (filtros do importador/dashboards)
-- ----------------------------------------------------------------------------
CREATE INDEX IF NOT EXISTS idx_attractions_category_group
  ON core.attractions (category_group);
CREATE INDEX IF NOT EXISTS idx_attractions_primary_category
  ON core.attractions (primary_category);
CREATE INDEX IF NOT EXISTS idx_attractions_is_notable
  ON core.attractions (is_notable) WHERE is_notable = true;
CREATE INDEX IF NOT EXISTS idx_attractions_importance_score
  ON core.attractions (importance_score DESC);

-- ----------------------------------------------------------------------------
-- 4. (Opcional) Expor as colunas novas via PostgREST. O schema `core` já é
--    exposto; reload do schema cache para o REST enxergar as colunas:
-- ----------------------------------------------------------------------------
NOTIFY pgrst, 'reload schema';
