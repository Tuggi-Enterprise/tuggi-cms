-- Migration: Fix City Correction Monitor Authentication with Vault (Improved)
-- Date: 2026-04-16
-- Purpose: Use both Authorization and apikey headers, and trim whitespaces.

CREATE OR REPLACE FUNCTION public.trigger_city_correction_monitor()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  response text;
  v_url text;
  v_key text;
BEGIN
  -- 1. Buscar e limpar a URL e a Service Role Key no Vault
  -- O TRIM remove espaços ou quebras de linha acidentais
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
     RAISE WARNING 'Segredos SUPABASE_URL ou SERVICE_ROLE_KEY não encontrados no Vault. Abortando monitor.';
     RETURN;
  END IF;

  -- 2. Chamar a Edge Function
  -- Enviamos tanto Authorization quanto apikey para garantir que o gateway do Supabase não barre.
  BEGIN
    SELECT content INTO response
    FROM http((
      'POST',
      v_url || '/functions/v1/city-correction-monitor',
      ARRAY[
        http_header('apikey', v_key),
        http_header('Authorization', 'Bearer ' || v_key),
        http_header('Content-Type', 'application/json')
      ],
      'application/json',
      '{}'
    ));
    
    RAISE NOTICE 'Monitor response: %', response;
  EXCEPTION WHEN OTHERS THEN
    RAISE WARNING 'Falha ao chamar City Correction Monitor via Vault: %', SQLERRM;
  END;
END;
$$;

-- Garantir permissões
GRANT EXECUTE ON FUNCTION public.trigger_city_correction_monitor() TO postgres;
GRANT EXECUTE ON FUNCTION public.trigger_city_correction_monitor() TO service_role;
