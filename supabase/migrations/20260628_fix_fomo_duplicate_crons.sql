-- ============================================================================
-- FOMO push duplicado — remove crons redundantes
-- ----------------------------------------------------------------------------
-- Diagnóstico (cron.job + marketing.notification_logs):
--   Havia DOIS pares de crons FOMO ativos, disparando no mesmo minuto:
--     • fomo-hourly-push-orchestrator (0 * * * *) → drive.trigger_fomo_orchestrator()
--     • invoke-daily-fomo-orchestrator (0 * * * *) → core.trigger_daily_fomo_orchestrator()
--   Ambas as funções fazem POST para a MESMA Edge Function
--   (/functions/v1/daily-gamification-orchestrator). Como rodam em paralelo, as
--   duas leem os candidatos com `notified_at IS NULL` ANTES de qualquer uma
--   marcar `notified_at` → corrida → cada usuário recebe 2 pushes (logs com
--   sent_at a 0–1s de diferença, no minuto 0).
--   Mesmo problema no refresh de stats (fomo-daily-stats-refresh vs
--   refresh-daily-fomo-stats — ambos chamam drive.refresh_daily_fomo_stats()).
--
-- Os jobs canônicos vêm da migration 20260408_fomo_automation_crons.sql
-- (fomo-hourly-push-orchestrator / fomo-daily-stats-refresh). Os pares antigos
-- (invoke-daily-fomo-orchestrator / refresh-daily-fomo-stats) foram criados
-- manualmente no painel e nunca removidos. Aqui removemos os duplicados,
-- mantendo APENAS o par da migration.
--
-- ⚠️  Rodar manualmente no SQL editor do painel.
-- ============================================================================

DO $$
BEGIN
  -- Orchestrator duplicado (mesma EF que fomo-hourly-push-orchestrator)
  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'invoke-daily-fomo-orchestrator') THEN
    PERFORM cron.unschedule('invoke-daily-fomo-orchestrator');
    RAISE NOTICE 'Removido cron duplicado: invoke-daily-fomo-orchestrator';
  END IF;

  -- Refresh de stats duplicado (mesma função que fomo-daily-stats-refresh)
  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'refresh-daily-fomo-stats') THEN
    PERFORM cron.unschedule('refresh-daily-fomo-stats');
    RAISE NOTICE 'Removido cron duplicado: refresh-daily-fomo-stats';
  END IF;
END $$;

-- Conferência: deve restar SÓ o par canônico (fomo-hourly-push-orchestrator,
-- fomo-daily-stats-refresh).
-- SELECT jobname, schedule, command FROM cron.job
--   WHERE jobname ILIKE '%fomo%' ORDER BY jobname;
