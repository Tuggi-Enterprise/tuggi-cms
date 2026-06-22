-- ============================================================================
-- Autovacuum tuning — tabelas geo write-heavy do caminho de leitura do app
-- ============================================================================
-- ⚠️ RODAR MANUALMENTE no painel SQL do Supabase. NÃO aplicar via CLI.
--    (Os ALTER TABLE abaixo são transação-safe e rodam no editor. O VACUUM do
--     passo final NÃO roda no editor — ver nota.)
--
-- PROBLEMA (provado): get_nearby_pois_complete / get_pois_by_cone_triggers dão
-- statement_timeout intermitente (57014) MESMO com raio pequeno. Causa = a tabela
-- é write-heavy (crawler/ingest) → o visibility map fica stale (~27% all-visible)
-- → o Index-Only Scan cai no heap → I/O aleatório a frio → timeout.
-- Doc oficial: um index-only scan só pula o heap se o bit all-visible (VM) estiver
-- setado; o VM só fica fresco se o autovacuum processar a tabela com frequência.
--   https://www.postgresql.org/docs/current/indexes-index-only-scans.html
--   https://www.cybertec-postgresql.com/en/tuning-autovacuum-postgresql/
--
-- ESTRATÉGIA: autovacuum é um daemon CONTÍNUO (não se roda à mão). Configuramos
-- limiares por tabela UMA vez; ele se reativa sozinho conforme a tabela cresce.
--   - scale_factor BAIXO + threshold ABSOLUTO → cadência previsível mesmo a 10MM+
--     (scale_factor puro "afrouxa" o gatilho à medida que a tabela cresce).
--   - O gatilho de INSERT (PG13+) é o crítico para ingest: é ele que faz o VACUUM
--     marcar páginas recém-inseridas como all-visible → conserta index-only scans.
--   - cost_limit maior por tabela → o vacuum faz mais trabalho por rodada e
--     acompanha o ritmo de escrita (monitorar impacto de I/O no restante da carga).
-- Valores abaixo são PONTOS DE PARTIDA — ajustar pela taxa real de escrita
-- (monitorar com a query no fim: n_dead_tup, last_autovacuum, autovacuum_count).
-- ============================================================================

-- 1) core.attractions (a maior; UPDATE de aprovação/derivação + INSERT de ingest)
ALTER TABLE core.attractions SET (
  autovacuum_vacuum_scale_factor   = 0.02,   -- dead-tuples: vacuum a ~2% de churn
  autovacuum_vacuum_threshold      = 2000,   -- + piso absoluto (não afrouxa ao crescer)
  autovacuum_vacuum_insert_scale_factor = 0.02,  -- INSERT (PG13+): mantém VM fresco
  autovacuum_vacuum_insert_threshold    = 2000,
  autovacuum_analyze_scale_factor  = 0.02,   -- estatísticas frescas p/ bons planos
  autovacuum_analyze_threshold     = 2000,
  autovacuum_vacuum_cost_limit     = 2000    -- vacuum mais ágil na tabela grande
);

-- 2) core.attraction_coordinate (geometria/geography — alvo dos ST_DWithin/KNN)
ALTER TABLE core.attraction_coordinate SET (
  autovacuum_vacuum_scale_factor   = 0.02,
  autovacuum_vacuum_threshold      = 2000,
  autovacuum_vacuum_insert_scale_factor = 0.02,
  autovacuum_vacuum_insert_threshold    = 2000,
  autovacuum_analyze_scale_factor  = 0.02,
  autovacuum_analyze_threshold     = 2000,
  autovacuum_vacuum_cost_limit     = 2000
);

-- 3) core.attraction_trigger_points (scan GiST do cone; muito INSERT no ingest)
ALTER TABLE core.attraction_trigger_points SET (
  autovacuum_vacuum_scale_factor   = 0.02,
  autovacuum_vacuum_threshold      = 2000,
  autovacuum_vacuum_insert_scale_factor = 0.02,
  autovacuum_vacuum_insert_threshold    = 2000,
  autovacuum_analyze_scale_factor  = 0.02,
  autovacuum_analyze_threshold     = 2000,
  autovacuum_vacuum_cost_limit     = 2000
);

-- 4) core.attraction_descriptions (LATERAL de áudio por-POI)
ALTER TABLE core.attraction_descriptions SET (
  autovacuum_vacuum_scale_factor   = 0.02,
  autovacuum_vacuum_threshold      = 2000,
  autovacuum_vacuum_insert_scale_factor = 0.02,
  autovacuum_vacuum_insert_threshold    = 2000,
  autovacuum_analyze_scale_factor  = 0.02,
  autovacuum_analyze_threshold     = 2000,
  autovacuum_vacuum_cost_limit     = 2000
);

-- ----------------------------------------------------------------------------
-- PASSO ÚNICO (refresca o VM + estatísticas AGORA, sem esperar o daemon).
-- ⚠️ VACUUM não roda dentro de transação → NÃO funciona no editor SQL do Supabase
--    (ele envolve tudo em transação). Rodar via psql/conexão direta, uma vez:
--
--    VACUUM (ANALYZE) core.attractions;
--    VACUUM (ANALYZE) core.attraction_coordinate;
--    VACUUM (ANALYZE) core.attraction_trigger_points;
--    VACUUM (ANALYZE) core.attraction_descriptions;
--
-- Se não der p/ rodar agora, o autovacuum alcança sozinho dentro de 1 ciclo.
-- BOA PRÁTICA: o pipeline do crawler deve rodar VACUUM (ANALYZE) na tabela
-- afetada ao fim de cada lote grande de ingest (autovacuum reage com atraso).
-- ----------------------------------------------------------------------------

-- ----------------------------------------------------------------------------
-- MONITORAMENTO (rodar de tempos em tempos p/ confirmar que o daemon acompanha;
-- se n_dead_tup cresce sem last_autovacuum recente → afrouxar mais os limiares
-- ou subir autovacuum_max_workers / baixar autovacuum_vacuum_cost_delay global).
-- ----------------------------------------------------------------------------
-- SELECT relname,
--        n_live_tup, n_dead_tup,
--        round(100.0 * n_dead_tup / NULLIF(n_live_tup + n_dead_tup, 0), 1) AS dead_pct,
--        n_ins_since_vacuum,
--        last_autovacuum, last_autoanalyze,
--        autovacuum_count, autoanalyze_count
-- FROM pg_stat_user_tables
-- WHERE schemaname = 'core'
--   AND relname IN ('attractions','attraction_coordinate',
--                   'attraction_trigger_points','attraction_descriptions')
-- ORDER BY n_dead_tup DESC;
--
-- Confirmar que os index-only scans pararam de bater no heap (heap_fetches baixo):
-- EXPLAIN (ANALYZE, BUFFERS) <a query de nearby aqui>;
-- ============================================================================
