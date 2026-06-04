-- ============================================================================
-- DIAGNÓSTICO de Disk I/O (SOMENTE LEITURA). Rodar no SQL editor e colar a saída.
-- ============================================================================

-- A. Top statements por I/O total (precisa da extensão pg_stat_statements).
SELECT substring(regexp_replace(query, '\s+', ' ', 'g'), 1, 100) AS query,
       calls,
       shared_blks_read  AS reads,
       shared_blks_written AS writes,
       shared_blks_dirtied AS dirtied,
       round((shared_blks_read+shared_blks_written)/GREATEST(calls,1)) AS io_per_call
FROM pg_stat_statements
ORDER BY (shared_blks_read + shared_blks_written) DESC
LIMIT 25;

-- B. Índices de core.attractions: uso (idx_scan=0 ⇒ candidato a DROP) + tamanho.
SELECT i.relname AS index_name,
       s.idx_scan AS scans,
       pg_size_pretty(pg_relation_size(i.oid)) AS size
FROM pg_stat_user_indexes s
JOIN pg_class i ON i.oid = s.indexrelid
WHERE s.schemaname = 'core' AND s.relname = 'attractions'
ORDER BY s.idx_scan ASC, pg_relation_size(i.oid) DESC;

-- C. Mesmo, para as outras tabelas quentes.
SELECT s.relname AS table_name, i.relname AS index_name, s.idx_scan AS scans,
       pg_size_pretty(pg_relation_size(i.oid)) AS size
FROM pg_stat_user_indexes s
JOIN pg_class i ON i.oid = s.indexrelid
WHERE s.schemaname = 'core'
  AND s.relname IN ('attraction_trigger_points','attraction_coordinate','attraction_descriptions')
ORDER BY s.relname, s.idx_scan ASC;

-- D. Bloat / dead tuples / autovacuum (write pressure + leituras infladas).
SELECT relname, n_live_tup, n_dead_tup,
       round(100*n_dead_tup/GREATEST(n_live_tup+n_dead_tup,1)) AS dead_pct,
       last_autovacuum, autovacuum_count, n_tup_upd, n_tup_hot_upd
FROM pg_stat_user_tables
WHERE schemaname IN ('core','homolog','drive')
ORDER BY n_dead_tup DESC
LIMIT 15;

-- E. Índices duplicados (mesma tabela + mesmas colunas).
SELECT indrelid::regclass AS table_name, array_agg(indexrelid::regclass) AS duplicate_indexes
FROM pg_index
GROUP BY indrelid, indkey
HAVING count(*) > 1;

-- F. FKs sem índice (causam leitura extra em join/update/delete).
SELECT conrelid::regclass AS table_name, conname AS fk, a.attname AS column
FROM pg_constraint c
JOIN pg_attribute a ON a.attrelid = c.conrelid AND a.attnum = ANY(c.conkey)
WHERE c.contype = 'f'
  AND connamespace = 'core'::regnamespace
  AND NOT EXISTS (
    SELECT 1 FROM pg_index i
    WHERE i.indrelid = c.conrelid AND a.attnum = ANY(i.indkey)
  )
ORDER BY 1;
