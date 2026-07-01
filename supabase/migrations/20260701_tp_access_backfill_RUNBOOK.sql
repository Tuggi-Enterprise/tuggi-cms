-- ============================================================================
-- RUNBOOK (OPERACIONAL — NÃO é migration automática)
-- Backfill de core.attraction_trigger_points.access: 'both' -> 'car' (~15MM linhas)
-- ============================================================================
--
-- Por quê: hoje TODAS as linhas leem 'both' (default antigo). Para o modo WALK
-- ser conservador (default drive), os TPs não curados precisam virar 'car'.
-- Nada foi curado p/ walk ainda, então todo 'both' atual é default indevido.
--
-- Semântica pós-backfill: esses TPs deixam de disparar no WALK — é o desejado.
-- Não afeta usuários atuais (WALK ainda não está live; app atrás de feature flag OFF).
--
-- ⚠️ EXECUTAR MANUALMENTE via psql (fora da transação da migration), fora de pico.
-- ⚠️ ORDEM:
--    1) Rodar a migration 20260701_tp_access_default_drive.sql (DDL) primeiro.
--    2) PAUSAR o cron de refresh do read-model (o backfill bumpa updated_at de
--       ~15MM linhas e o refresh incremental por watermark tentaria reagregar tudo).
--         SELECT cron.unschedule('<job_name_do_refresh_app_poi_read>');
--       (achar o nome: SELECT jobid, jobname, schedule, command FROM cron.job
--        WHERE command ILIKE '%refresh_app_poi_read%';)
--    3) Rodar o backfill em lotes (abaixo).
--    4) VACUUM (ANALYZE) core.attraction_trigger_points;
--    5) UM full rebuild controlado: SELECT core.refresh_app_poi_read(true);
--    6) RE-AGENDAR o cron de refresh.
--
-- Observações de gatilhos: os AFTER INSERT (training/learning) NÃO disparam em
-- UPDATE (ok). Os BEFORE UPDATE (handle_updated_at, update_trigger_point_status)
-- são baratos. Único efeito colateral relevante do UPDATE é o bump de updated_at.
-- ============================================================================

-- ---- Backfill em lotes por range de PK (Postgres não aceita UPDATE ... LIMIT) ----
-- Roda via psql. Ajuste batch_size conforme carga/observação de locks.
-- Idempotente: só toca linhas ainda em 'both'.

DO $$
DECLARE
  batch_size int := 50000;
  affected   int;
  total_done bigint := 0;
BEGIN
  LOOP
    WITH cte AS (
      SELECT id
      FROM core.attraction_trigger_points
      WHERE access = 'both'
      LIMIT batch_size
      FOR UPDATE SKIP LOCKED
    )
    UPDATE core.attraction_trigger_points t
      SET access = 'car'
      FROM cte
      WHERE t.id = cte.id;

    GET DIAGNOSTICS affected = ROW_COUNT;
    total_done := total_done + affected;
    RAISE NOTICE 'backfill access: % linhas neste lote (acumulado %)', affected, total_done;

    EXIT WHEN affected = 0;
    COMMIT;                 -- libera locks entre lotes (requer rodar via psql, não dentro de txn)
    PERFORM pg_sleep(0.2);  -- respiro entre lotes
  END LOOP;
END $$;

-- ---- Verificação ----
-- SELECT access, count(*) FROM core.attraction_trigger_points GROUP BY access;
--   -> esperado: 'car' = maioria; 'both' = só os curados manualmente (0 no 1º run).

-- ---- Pós-backfill ----
-- VACUUM (ANALYZE) core.attraction_trigger_points;
-- SELECT core.refresh_app_poi_read(true);
-- (re-agendar o cron do refresh)
