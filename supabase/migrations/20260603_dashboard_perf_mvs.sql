-- ============================================================================
-- Otimização da dashboard — MVs do output GLOBAL das RPCs mais lentas.
-- Aplicar MANUALMENTE no SQL editor.
--
-- Truque: a MV é definida a partir do OUTPUT da própria função no caso global
-- (sem JWT → effective_owner_id NULL). Assim não duplicamos a lógica em SQL.
-- A dashboard lê a MV no caso admin/global (hot path) e cai na RPC live só
-- quando há owner específico (cliente).
--
--   dashboard_user_analytics(NULL): 12 subqueries live sobre drive.* (~416ms)
--   dashboard_country_stats(NULL):  GROUP BY país sobre mv_geographic (~522ms)
-- ============================================================================

-- WITH DATA roda as funções (~1s). Subir o timeout só para a criação:
SET statement_timeout = '120s';

-- ----------------------------------------------------------------------------
-- #2 — User analytics (global). 1 linha.
-- ----------------------------------------------------------------------------
DROP MATERIALIZED VIEW IF EXISTS core.mv_user_analytics_global CASCADE;
CREATE MATERIALIZED VIEW core.mv_user_analytics_global AS
  SELECT 1 AS id, t.* FROM core.dashboard_user_analytics(NULL) t
WITH DATA;
CREATE UNIQUE INDEX IF NOT EXISTS idx_mv_user_analytics_global
  ON core.mv_user_analytics_global (id);
GRANT SELECT ON core.mv_user_analytics_global TO authenticated, service_role;

-- ----------------------------------------------------------------------------
-- #3 — Country stats (global). 1 linha por país.
-- ----------------------------------------------------------------------------
DROP MATERIALIZED VIEW IF EXISTS core.mv_country_stats CASCADE;
CREATE MATERIALIZED VIEW core.mv_country_stats AS
  SELECT * FROM core.dashboard_country_stats(NULL)
WITH DATA;
CREATE UNIQUE INDEX IF NOT EXISTS idx_mv_country_stats_country
  ON core.mv_country_stats (country);
GRANT SELECT ON core.mv_country_stats TO authenticated, service_role;

-- ----------------------------------------------------------------------------
-- Refresh dedicado (cron). Re-roda as funções pesadas em background.
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION core.refresh_dashboard_mvs()
RETURNS void LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
  REFRESH MATERIALIZED VIEW CONCURRENTLY core.mv_user_analytics_global;
  REFRESH MATERIALIZED VIEW CONCURRENTLY core.mv_country_stats;
END;
$$;

-- Agendamento sugerido (pg_cron) — métricas de dashboard toleram defasagem:
--   SELECT cron.schedule('refresh_dashboard_mvs', '*/10 * * * *',
--                        $$ SELECT core.refresh_dashboard_mvs(); $$);
-- Popular agora:
--   SELECT core.refresh_dashboard_mvs();

NOTIFY pgrst, 'reload schema';
