-- ============================================================================
-- FIX CRON: trocar http() SÍNCRONO por net.http_post() ASSÍNCRONO (pg_net)
-- Remove ~10% do tempo do banco (Postgres parado esperando a Edge Function).
-- Drop-in: CREATE OR REPLACE mantém o jobid 21 do cron funcionando.
--
-- Trade-off: fire-and-forget — não dá mais pra ler o status HTTP inline.
-- A resposta fica em net._http_response (request_id). O log de erro real
-- passa a ser responsabilidade da própria Edge Function.
-- ============================================================================

CREATE OR REPLACE FUNCTION core.trigger_process_scheduled_notifications()
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'core', 'public', 'extensions', 'net'
AS $function$
DECLARE
  v_url text;
  v_key text;
BEGIN
  -- 1. Credenciais no Vault (mesmo padrão de antes)
  SELECT TRIM(decrypted_secret) INTO v_url
  FROM vault.decrypted_secrets WHERE name = 'SUPABASE_URL' LIMIT 1;

  SELECT TRIM(decrypted_secret) INTO v_key
  FROM vault.decrypted_secrets WHERE name = 'SERVICE_ROLE_KEY' LIMIT 1;

  IF v_url IS NULL OR v_key IS NULL THEN
    RAISE WARNING 'Falha ao disparar push: SUPABASE_URL ou SERVICE_ROLE_KEY ausentes no Vault.';
    RETURN;
  END IF;

  v_url := rtrim(v_url, '/') || '/functions/v1/firebase-push-notification/process-scheduled';

  -- 2. Chamada ASSÍNCRONA — retorna na hora, não bloqueia o worker do cron
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

-- ── Verificação (rodar depois) ─────────────────────────────────────────────
-- Confirma que o job continua ativo:
--   SELECT jobid, jobname, schedule, active FROM cron.job WHERE jobid = 21;
-- Ver respostas recentes das chamadas async (status 200 esperado):
--   SELECT id, status_code, created FROM net._http_response ORDER BY created DESC LIMIT 5;

-- ── Mesmo padrão para newsletters (jobid 41), se quiser aplicar junto ──────
-- A marketing.trigger_process_scheduled_newsletters() tem a MESMA estrutura
-- http() síncrona. Posso gerar o rewrite dela também — me avise.
