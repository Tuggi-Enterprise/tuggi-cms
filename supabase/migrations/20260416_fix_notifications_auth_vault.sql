-- Migration: Fix Scheduled Notifications Auth with Vault
-- Date: 2026-04-16
-- Purpose: Update push notification trigger to use secrets from Supabase Vault instead of app.settings.

CREATE OR REPLACE FUNCTION core.trigger_process_scheduled_notifications()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_url text;
  v_key text;
  response_status integer;
  response_content text;
BEGIN
  -- 1. Buscar credenciais no Vault (Mesmo padrão do monitor)
  SELECT TRIM(decrypted_secret) INTO v_url 
  FROM vault.decrypted_secrets 
  WHERE name = 'SUPABASE_URL'
  LIMIT 1;

  SELECT TRIM(decrypted_secret) INTO v_key 
  FROM vault.decrypted_secrets 
  WHERE name = 'SERVICE_ROLE_KEY'
  LIMIT 1;

  -- Validação
  IF v_url IS NULL OR v_key IS NULL THEN
    RAISE WARNING 'Falha ao disparar push: SUPABASE_URL ou SERVICE_ROLE_KEY não encontrados no Vault.';
    RETURN;
  END IF;

  -- 2. Construir URL da Edge Function
  v_url := rtrim(v_url, '/') || '/functions/v1/firebase-push-notification/process-scheduled';

  -- 3. Chamar a Edge Function (Padrão Tuggi robusto)
  SELECT status, content INTO response_status, response_content
  FROM http((
    'POST',
    v_url,
    ARRAY[
      http_header('apikey', v_key),
      http_header('Authorization', 'Bearer ' || v_key),
      http_header('Content-Type', 'application/json')
    ],
    'application/json',
    '{}'
  ));
  
  IF response_status >= 400 THEN
    RAISE WARNING 'Scheduled Notification Job Failed. Status: %, Content: %', response_status, response_content;
  END IF;
END;
$$;

-- Garantir permissões de execução
GRANT EXECUTE ON FUNCTION core.trigger_process_scheduled_notifications() TO postgres;
GRANT EXECUTE ON FUNCTION core.trigger_process_scheduled_notifications() TO service_role;
