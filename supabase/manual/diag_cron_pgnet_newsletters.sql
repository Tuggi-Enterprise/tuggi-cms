-- ============================================================================
-- FIX CRON #2: newsletters (jobid 41) — http() síncrono → net.http_post async
-- ~1,7% do tempo do banco. Mesmo padrão da de notifications.
-- Drop-in: CREATE OR REPLACE mantém o jobid 41 funcionando.
-- ============================================================================

CREATE OR REPLACE FUNCTION marketing.trigger_process_scheduled_newsletters()
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'marketing', 'public', 'extensions', 'net'
AS $function$
DECLARE
  v_url text;
  v_key text;
BEGIN
  SELECT TRIM(decrypted_secret) INTO v_url
  FROM vault.decrypted_secrets WHERE name = 'SUPABASE_URL' LIMIT 1;

  SELECT TRIM(decrypted_secret) INTO v_key
  FROM vault.decrypted_secrets WHERE name = 'SERVICE_ROLE_KEY' LIMIT 1;

  IF v_url IS NULL OR v_key IS NULL THEN
    RAISE WARNING 'Skipping newsletter trigger: SUPABASE_URL ou SERVICE_ROLE_KEY ausentes no Vault.';
    RETURN;
  END IF;

  v_url := rtrim(v_url, '/') || '/functions/v1/send-newsletter/process-scheduled';

  -- Assíncrono — não bloqueia o worker do cron
  PERFORM net.http_post(
    url     := v_url,
    body    := '{}'::jsonb,
    headers := jsonb_build_object(
      'apikey',        v_key,
      'Authorization', 'Bearer ' || v_key,
      'Content-Type',  'application/json'
    )
  );
END;
$function$;

-- Verificação:
--   SELECT jobid, jobname, active FROM cron.job WHERE jobid = 41;
--   SELECT id, status_code, created FROM net._http_response ORDER BY created DESC LIMIT 5;
