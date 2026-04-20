-- Migration: Fix FOMO Orchestrator & City Correction Monitor to use Vault
-- Date: 2026-04-20
-- Purpose: Replace deprecated app.settings with Supabase Vault secrets.
-- Follows the same pattern as 20260416_fix_notifications_auth_vault.sql

-- ============================================================
-- 1. FIX: drive.trigger_fomo_orchestrator()
-- Error: "unrecognized configuration parameter app.settings.supabase_anon_key"
-- ============================================================
CREATE OR REPLACE FUNCTION drive.trigger_fomo_orchestrator()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  response_status integer;
  response_content text;
  v_url text;
  v_key text;
BEGIN
  -- 1. Buscar credenciais no Vault (padrão Tuggi)
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
    RAISE WARNING 'FOMO Orchestrator: SUPABASE_URL ou SERVICE_ROLE_KEY não encontrados no Vault. Abortando.';
    RETURN;
  END IF;

  -- 2. Chamar a Edge Function
  BEGIN
    SELECT status, content INTO response_status, response_content
    FROM http((
      'POST',
      rtrim(v_url, '/') || '/functions/v1/daily-gamification-orchestrator',
      ARRAY[
        http_header('apikey', v_key),
        http_header('Authorization', 'Bearer ' || v_key),
        http_header('Content-Type', 'application/json')
      ],
      'application/json',
      '{}'
    ));

    IF response_status >= 400 THEN
      RAISE WARNING 'FOMO Orchestrator Failed. Status: %, Content: %', response_status, response_content;
    ELSE
      RAISE NOTICE 'FOMO Orchestrator success. Status: %, Response: %', response_status, response_content;
    END IF;
  EXCEPTION WHEN OTHERS THEN
    RAISE WARNING 'Failed to call FOMO Orchestrator: %', SQLERRM;
  END;
END;
$$;

-- Permissões
GRANT EXECUTE ON FUNCTION drive.trigger_fomo_orchestrator() TO service_role;
GRANT EXECUTE ON FUNCTION drive.trigger_fomo_orchestrator() TO postgres;

-- ============================================================
-- 2. FIX: city-correction-monitor trigger (from 20250111_setup_cron_monitor.sql)
-- Also uses deprecated app.settings pattern
-- ============================================================
CREATE OR REPLACE FUNCTION core.trigger_city_correction_monitor()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  response_status integer;
  response_content text;
  v_url text;
  v_key text;
BEGIN
  -- 1. Buscar credenciais no Vault (padrão Tuggi)
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
    RAISE WARNING 'City Correction Monitor: SUPABASE_URL ou SERVICE_ROLE_KEY não encontrados no Vault. Abortando.';
    RETURN;
  END IF;

  -- 2. Chamar a Edge Function
  BEGIN
    SELECT status, content INTO response_status, response_content
    FROM http((
      'POST',
      rtrim(v_url, '/') || '/functions/v1/city-correction-monitor',
      ARRAY[
        http_header('apikey', v_key),
        http_header('Authorization', 'Bearer ' || v_key),
        http_header('Content-Type', 'application/json')
      ],
      'application/json',
      '{}'
    ));

    IF response_status >= 400 THEN
      RAISE WARNING 'City Correction Monitor Failed. Status: %, Content: %', response_status, response_content;
    ELSE
      RAISE NOTICE 'City Correction Monitor success. Status: %, Response: %', response_status, response_content;
    END IF;
  EXCEPTION WHEN OTHERS THEN
    RAISE WARNING 'Failed to call City Correction Monitor: %', SQLERRM;
  END;
END;
$$;

-- Permissões
GRANT EXECUTE ON FUNCTION core.trigger_city_correction_monitor() TO service_role;
GRANT EXECUTE ON FUNCTION core.trigger_city_correction_monitor() TO postgres;
