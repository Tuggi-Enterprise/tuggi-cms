-- Migration: Fix Crawl-and-Index Cron Job Auth and Types (Robust Version)
-- Date: 2026-04-16
-- Purpose: Fix net.http_post argument types and use Vault for secrets with safe unscheduling.

DO $$
DECLARE
  v_url text;
  v_key text;
  v_job_exists boolean;
BEGIN
  -- 1. Buscar dados no Vault
  SELECT TRIM(decrypted_secret) INTO v_url FROM vault.decrypted_secrets WHERE name = 'SUPABASE_URL' LIMIT 1;
  SELECT TRIM(decrypted_secret) INTO v_key FROM vault.decrypted_secrets WHERE name = 'SERVICE_ROLE_KEY' LIMIT 1;

  IF v_url IS NOT NULL AND v_key IS NOT NULL THEN
    
    -- 2. Verificar se o job existe antes de remover
    SELECT EXISTS (
      SELECT 1 FROM cron.job WHERE jobname = 'crawl-and-index-job'
    ) INTO v_job_exists;

    IF v_job_exists THEN
      PERFORM cron.unschedule('crawl-and-index-job');
    END IF;

    -- 3. Agenda o novo job com os tipos corretos (JSONB)
    PERFORM cron.schedule(
      'crawl-and-index-job',
      '*/30 * * * *', -- Exemplo: A cada 30 minutos (ajuste conforme necessário)
      format(
        'SELECT net.http_post(
          url := %L,
          headers := %L::jsonb,
          body := %L::jsonb
        );',
        v_url || '/functions/v1/crawl-and-index',
        jsonb_build_object(
          'Content-Type', 'application/json',
          'Authorization', 'Bearer ' || v_key,
          'apikey', v_key
        ),
        '{"batch_size": 5}'::jsonb
      )
    );
    
    RAISE NOTICE 'Cron job crawl-and-index-job agendado com sucesso.';
  ELSE
    RAISE WARNING 'Não foi possível agendar o job: URL ou Key ausentes no Vault.';
  END IF;
END $$;
