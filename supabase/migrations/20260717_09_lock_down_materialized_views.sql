-- ============================================================================
-- Migration: fechar as materialized views (0.4) — anon lê TODAS as 21
-- Date: 2026-07-17
--
-- O PROBLEMA
-- ----------
-- MATERIALIZED VIEWS NÃO SUPORTAM RLS no Postgres. Para elas, o GRANT é a ÚNICA
-- barreira — e as 21 MVs de core têm SELECT para `anon`:
--
--   SELECT count(*) FILTER (WHERE has_table_privilege('anon', c.oid,'SELECT'))
--     FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
--    WHERE n.nspname='core' AND c.relkind='m';
--   -- 21 de 21
--
-- Isto escapou da auditoria anterior: aquela varredura usou relkind='r' (tabelas) e
-- concluiu "0 tabelas sem RLS" — correto, mas MVs são relkind='m' e não entraram.
-- `mv_user_analytics_global` expõe total_users, mau_history, user_growth,
-- total_premium_users, upcoming_expirations — as métricas de negócio da plataforma,
-- legíveis com a chave pública do site.
--
-- POR QUE NÃO BASTA TROCAR A MV PELO RPC NO FRONTEND
-- --------------------------------------------------
-- A MV existe por PERFORMANCE (20260603_dashboard_perf_mvs.sql). O próprio
-- dashboard-service.ts:351 documenta: "caso global (admin) lê a MV (~50ms); com owner
-- específico, cai na RPC live". dashboard_user_analytics faz 12 subqueries sobre
-- drive.profiles/trail_trips_unified/poi_visits — trocar cegamente degradaria a Overview.
--
-- SOLUÇÃO: wrappers SECURITY DEFINER que validam admin e leem a MV. Mantêm os ~50ms e
-- fecham o acesso direto. O frontend troca .from('mv_...') por .rpc('..._global').
--
-- SEGURANÇA DE QUEM CONSOME (verificado por grep, não presumido):
--   - tuggi-drive-v2 (app):        NÃO lê MV alguma  → revogar não afeta
--   - tuggi-enterprise (landing):  NÃO lê MV alguma  → revogar não afeta
--   - tuggi-cms:                   lê 3, todas em dashboard-service.ts, só no branch admin
--   - RPCs SECURITY DEFINER que usam MV internamente rodam como owner (postgres) e NÃO
--     dependem do grant do caller → app segue funcionando.
--
-- ⚠️ APLICAR MANUALMENTE NO PAINEL. NUNCA DDL via CLI.
-- ⚠️ APLICAR JUNTO com o deploy do dashboard-service.ts (usa os wrappers). Aplicar o SQL
--    sozinho quebra a Overview do admin (permission denied nas MVs).
-- ============================================================================


-- ============================================================================
-- 1. WRAPPERS (preservam a performance da MV, exigem admin)
-- ============================================================================
CREATE OR REPLACE FUNCTION core.dashboard_user_analytics_global()
RETURNS TABLE (
  total_users bigint, active_users_30d bigint, total_trips bigint, total_km_driven numeric,
  total_poi_visits bigint, total_audio_plays bigint, avg_trip_duration text,
  trips_by_platform jsonb, mau_history jsonb, user_growth jsonb,
  total_premium_users bigint, upcoming_expirations jsonb
)
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path = core, public, extensions
AS $$
BEGIN
  IF NOT core.is_caller_platform_admin() THEN
    RAISE EXCEPTION 'forbidden: global analytics require platform admin'
      USING ERRCODE = '42501';
  END IF;
  RETURN QUERY
  SELECT m.total_users, m.active_users_30d, m.total_trips, m.total_km_driven,
         m.total_poi_visits, m.total_audio_plays, m.avg_trip_duration,
         m.trips_by_platform, m.mau_history, m.user_growth,
         m.total_premium_users, m.upcoming_expirations
    FROM core.mv_user_analytics_global m
   LIMIT 1;
END;
$$;

COMMENT ON FUNCTION core.dashboard_user_analytics_global() IS
  'Overview global (admin) lendo mv_user_analytics_global (~50ms). Existe porque MV não tem RLS: o wrapper aplica o gate que a MV não consegue aplicar sozinha.';

CREATE OR REPLACE FUNCTION core.dashboard_country_stats_global()
RETURNS TABLE (country text, poi_count bigint, city_count bigint, approved_count bigint)
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path = core, public, extensions
AS $$
BEGIN
  IF NOT core.is_caller_platform_admin() THEN
    RAISE EXCEPTION 'forbidden: global country stats require platform admin'
      USING ERRCODE = '42501';
  END IF;
  RETURN QUERY SELECT m.country, m.poi_count, m.city_count, m.approved_count
                 FROM core.mv_country_stats m;
END;
$$;

REVOKE ALL ON FUNCTION core.dashboard_user_analytics_global() FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION core.dashboard_country_stats_global()  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION core.dashboard_user_analytics_global() TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION core.dashboard_country_stats_global()  TO authenticated, service_role;


-- ============================================================================
-- 2. REVOKE em TODAS as MVs de core e drive
-- ============================================================================
-- Faz o loop pelo catálogo em vez de listar 21 nomes à mão: uma MV nova esquecida
-- na lista continuaria aberta, e é assim que este tipo de buraco reaparece.
-- service_role mantém acesso (API routes); os wrappers acima são SECURITY DEFINER
-- e rodam como owner, então não dependem destes grants.
DO $$
DECLARE r record;
BEGIN
  FOR r IN
    SELECT n.nspname, c.relname
      FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
     WHERE c.relkind = 'm' AND n.nspname IN ('core', 'drive')
  LOOP
    EXECUTE format('REVOKE ALL ON %I.%I FROM PUBLIC, anon, authenticated', r.nspname, r.relname);
    EXECUTE format('GRANT SELECT ON %I.%I TO service_role', r.nspname, r.relname);
    RAISE NOTICE 'MV fechada: %.%', r.nspname, r.relname;
  END LOOP;
END $$;

-- Impede que MVs FUTURAS nasçam abertas (o mesmo mecanismo que abriu as funções:
-- ALTER DEFAULT PRIVILEGES ... GRANT ALL ON TABLES TO anon, authenticated).
ALTER DEFAULT PRIVILEGES IN SCHEMA core  REVOKE ALL ON TABLES FROM anon;
ALTER DEFAULT PRIVILEGES IN SCHEMA drive REVOKE ALL ON TABLES FROM anon;

NOTIFY pgrst, 'reload schema';


-- ============================================================================
-- VERIFICAÇÃO
-- ============================================================================
-- 1) Nenhuma MV alcançável por anon/authenticated:
--      SELECT n.nspname||'.'||c.relname AS mv,
--             has_table_privilege('anon', c.oid,'SELECT')          AS anon,
--             has_table_privilege('authenticated', c.oid,'SELECT') AS authed
--        FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
--       WHERE c.relkind='m' AND n.nspname IN ('core','drive')
--       ORDER BY 1;
--      -- anon e authed devem ser FALSE em todas
--
-- 2) O wrapper funciona (painel = sessão direta = admin):
--      SELECT total_users FROM core.dashboard_user_analytics_global();   -- 224
--      SELECT count(*) FROM core.dashboard_country_stats_global();
--
-- 3) ⚠️ REGRESSÃO A CONFERIR: a Overview do admin no browser (/dashboard) precisa continuar
--    carregando com os mesmos KPIs e sem erro. Se aparecer "permission denied for
--    materialized view", o deploy do dashboard-service.ts não subiu junto.
--
-- 4) ⚠️ ATENÇÃO À REFRESH: `REFRESH MATERIALIZED VIEW` exige ser DONO da MV — não é
--    afetado por estes REVOKEs. O cron refresh_dashboard_mvs (*/5) roda como postgres.
--    Confirmar que segue verde depois de aplicar:
--      SELECT jobname, status, return_message, start_time
--        FROM cron.job_run_details
--       WHERE jobname = 'refresh_dashboard_mvs'
--       ORDER BY start_time DESC LIMIT 5;
