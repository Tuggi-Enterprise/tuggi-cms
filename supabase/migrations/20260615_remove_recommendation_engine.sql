-- ============================================================================
-- 20260615 — Remoção do motor de "sugestões personalizadas / recomendações"
-- ============================================================================
-- Subsistema morto: a drive-v2 nunca chama (usa get_nearby_pois_complete +
-- trigger points). CMS/EF/FOMO também não. Único toque era manutenção (crons
-- 14-17) + uma função de teste, mantendo scores que ninguém consome.
--
-- ✅ ZERO mudança de código (confirmado: nenhuma referência em CMS/drive-v2/EF).
-- É 100% DB-side. Aplicar no SQL Editor.
--
-- Footprint:
--   • Trigger ativo trigger_update_poi_scores_on_visit_analytics em
--     drive.poi_visit_analytics (a tabela analytics CONTINUA; só o trigger sai).
--   • 1 tabela: drive.poi_scores_precomputed (recommendations_cache já não existe).
--   • ~22 funções (motor + manutenção/tooling).
--   • 4 crons: daily-maintenance, cache-cleanup, weekly-optimization, popular-pois-update.
-- ============================================================================

-- ── 1. Trigger na tabela ATIVA poi_visit_analytics (remover primeiro) ────────
DROP TRIGGER IF EXISTS trigger_update_poi_scores_on_visit_analytics ON drive.poi_visit_analytics;

-- ── 2. Desagendar os crons de manutenção do motor ───────────────────────────
SELECT cron.unschedule('daily-maintenance');
SELECT cron.unschedule('cache-cleanup');
SELECT cron.unschedule('weekly-optimization');
SELECT cron.unschedule('popular-pois-update');

-- ── 3. Funções (motor + manutenção + tooling) ───────────────────────────────
DROP FUNCTION IF EXISTS drive.calculate_poi_base_scores(uuid);
DROP FUNCTION IF EXISTS drive.calculate_poi_quality_score(uuid);
DROP FUNCTION IF EXISTS drive.calculate_poi_score_simple(uuid);
DROP FUNCTION IF EXISTS drive.get_companionship_aware_suggestions(uuid, double precision, double precision, text, real, integer);
DROP FUNCTION IF EXISTS drive.get_personalized_suggestions(uuid, double precision, double precision, real, integer);
DROP FUNCTION IF EXISTS drive.get_personalized_suggestions_enhanced(uuid, double precision, double precision, real, integer);
DROP FUNCTION IF EXISTS drive.get_personalized_suggestions_enhanced(uuid, double precision, double precision, real, integer, text[]);
DROP FUNCTION IF EXISTS drive.get_personalized_suggestions_enhanced_v2(uuid, double precision, double precision, real, integer, timestamp with time zone, boolean, text[]);
DROP FUNCTION IF EXISTS drive.get_personalized_suggestions_performance_optimized(uuid, double precision, double precision, real, integer, timestamp with time zone, boolean, text[]);
DROP FUNCTION IF EXISTS drive.get_recommendation_system_health();
DROP FUNCTION IF EXISTS drive.get_recommendations_with_cache(uuid, double precision, double precision, real, integer, timestamp with time zone, boolean, text[]);
DROP FUNCTION IF EXISTS drive.get_simple_suggestions(uuid, double precision, double precision, real, integer);
DROP FUNCTION IF EXISTS drive.initialize_recommendation_system();
DROP FUNCTION IF EXISTS drive.optimize_recommendation_system();
DROP FUNCTION IF EXISTS drive.test_recommendation_performance(uuid, double precision, double precision, real);
DROP FUNCTION IF EXISTS drive.trigger_update_poi_scores();
DROP FUNCTION IF EXISTS drive.update_poi_base_scores(uuid);
DROP FUNCTION IF EXISTS drive.update_poi_scores_batch(uuid[], integer);
DROP FUNCTION IF EXISTS drive.cleanup_expired_cache();
DROP FUNCTION IF EXISTS drive.daily_maintenance();
DROP FUNCTION IF EXISTS drive.get_maintenance_commands();
DROP FUNCTION IF EXISTS drive.setup_manual_maintenance();

-- ── 4. Tabela (FK própria p/ attractions sai junto; nada referencia ela) ────
DROP TABLE IF EXISTS drive.poi_scores_precomputed;

NOTIFY pgrst, 'reload schema';

-- ── Verificação ─────────────────────────────────────────────────────────────
-- Sobrou alguma função do motor?
--   SELECT proname FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
--   WHERE n.nspname='drive' AND proname ~* 'recommend|suggestion|poi_score|calculate_poi|maintenance';
-- Crons removidos?
--   SELECT jobname FROM cron.job WHERE jobname IN
--     ('daily-maintenance','cache-cleanup','weekly-optimization','popular-pois-update');
-- poi_visit_analytics continua recebendo writes normalmente (app não muda).
