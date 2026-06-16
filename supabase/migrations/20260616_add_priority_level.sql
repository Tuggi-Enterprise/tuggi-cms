-- ============================================================================
-- priority_level (1 Padrão Tuggi · 2 Complementar · 3 Adicional) — core.attractions
-- ============================================================================
-- ⚠️ RODAR MANUALMENTE no painel SQL do Supabase. NÃO aplicar via CLI.
--
-- Segmentação curada (separada da taxonomia) usada para:
--   (a) FILTRO no app — nível 1 sempre; user liga/desliga 2 e 3.
--   (b) PRIORIDADE de disparo em concorrência — menor número = maior prioridade.
-- É campo manual no cadastro (DetailsTab) E auto-derivável (abaixo + pipeline).
-- Regra em sincronia com lib/shared/poi-taxonomy.ts (priorityLevel/LEVEL_*_CATEGORIES).
-- ============================================================================

-- 1) COLUNA (default 3; sem índice — baixa cardinalidade, filtro secundário pós-geo)
ALTER TABLE core.attractions
  ADD COLUMN IF NOT EXISTS priority_level smallint NOT NULL DEFAULT 3
  CHECK (priority_level IN (1,2,3));

-- 2) AUTO-DERIVAÇÃO RETROATIVA.
--    ⚠️ O mass UPDATE em 880k estoura statement_timeout, e a procedure abaixo (lotes+COMMIT)
--    NÃO roda no editor SQL do Supabase (ele envolve o CALL em transação → erro 2D000
--    "invalid transaction termination"). A derivação foi feita via:
--        npx tsx --env-file=.env scripts/backfill-priority-level.ts
--    (batched via .in('id',chunk), idempotente, retry — mesma regra do SSOT e do CASE abaixo).
--    Resultado: nível 1 = 199.344 (22,8%) · nível 2 = 67.932 (7,8%) · nível 3 = 605.431 (69,4%).
--    A procedure fica como referência (rodável em psql direto, fora do editor).

CREATE OR REPLACE PROCEDURE core.backfill_priority_level(p_batch int DEFAULT 10000)
LANGUAGE plpgsql AS $$
DECLARE n int;
BEGIN
  -- NÍVEL 1 (Padrão Tuggi): promoção por importância/histórico + categorias-marco
  LOOP
    WITH cte AS (
      SELECT id FROM core.attractions
      WHERE priority_level IS DISTINCT FROM 1 AND (
            category = 'geofence'
         OR importance_score >= 40
         OR is_historic = true
         OR (heritage_status IS NOT NULL AND heritage_status NOT IN ('none','no'))
         OR (unesco_status  IS NOT NULL AND unesco_status  NOT IN ('none','no'))
         OR primary_category IN ('museum','monument','memorial','historic_site','archaeological_site',
            'cathedral','monastery','mosque','temple','synagogue','viewpoint','waterfall','volcano',
            'glacier','canyon','cave','beach','lighthouse'))
      LIMIT p_batch
    )
    UPDATE core.attractions a SET priority_level = 1 FROM cte WHERE a.id = cte.id;
    GET DIAGNOSTICS n = ROW_COUNT;
    COMMIT;
    EXIT WHEN n = 0;
  END LOOP;

  -- NÍVEL 2 (Complementar): só os que ficaram no default 3 e estão nas categorias nível 2
  LOOP
    WITH cte AS (
      SELECT id FROM core.attractions
      WHERE priority_level = 3
        AND primary_category IN ('artwork','gallery','theatre','library','bridge','tower','windmill',
            'stadium','zoo','amusement_park','marketplace','fountain','attraction','cemetery','pier')
      LIMIT p_batch
    )
    UPDATE core.attractions a SET priority_level = 2 FROM cte WHERE a.id = cte.id;
    GET DIAGNOSTICS n = ROW_COUNT;
    COMMIT;
    EXIT WHEN n = 0;
  END LOOP;
END $$;

-- Executar (autocommit). Pode rodar de novo com segurança (idempotente).
CALL core.backfill_priority_level(10000);

-- (opcional, depois de concluído) DROP PROCEDURE core.backfill_priority_level(int);

COMMENT ON COLUMN core.attractions.priority_level IS
  '1 Padrão Tuggi (imperdíveis, sempre no app) · 2 Complementar · 3 Adicional. Filtro + prioridade de disparo. Curadoria manual prevalece.';
