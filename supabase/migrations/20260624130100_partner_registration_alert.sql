-- ============================================
-- Migration: Team alert email on new partner registration
-- Date: 2026-06-24
-- Description:
--   AFTER INSERT trigger on core.clients that, for app-originated partner
--   registrations (status='pending', metadata.source='app_partner_registration'),
--   fires the send-transactional Edge Function (type='partner_new') to email the
--   team.
--
--   Uses the project's established pattern: secrets from Vault
--   (vault.decrypted_secrets: SUPABASE_URL / SERVICE_ROLE_KEY) + net.http_post
--   (pg_net), which is ASYNC / fire-and-forget — it does NOT block or delay the
--   registration insert (a synchronous http() would). The whole body is also
--   wrapped in an exception guard, so a missing secret, missing extension, or any
--   error can NEVER abort the registration.
-- ============================================

CREATE OR REPLACE FUNCTION core.notify_team_new_partner()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_url text;
  v_key text;
BEGIN
  -- Best-effort: never break registration.
  BEGIN
    -- Only app-originated pending registrations.
    IF NEW.status <> 'pending'
       OR COALESCE(NEW.metadata->>'source', '') <> 'app_partner_registration' THEN
      RETURN NEW;
    END IF;

    SELECT TRIM(decrypted_secret) INTO v_url
    FROM vault.decrypted_secrets WHERE name = 'SUPABASE_URL' LIMIT 1;
    SELECT TRIM(decrypted_secret) INTO v_key
    FROM vault.decrypted_secrets WHERE name = 'SERVICE_ROLE_KEY' LIMIT 1;

    IF v_url IS NULL OR v_key IS NULL THEN
      RAISE NOTICE 'partner alert skipped: SUPABASE_URL/SERVICE_ROLE_KEY missing in Vault';
      RETURN NEW;
    END IF;

    -- Async (pg_net) — enqueues the call and returns immediately.
    PERFORM net.http_post(
      url := rtrim(v_url, '/') || '/functions/v1/send-transactional/send',
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'Authorization', 'Bearer ' || v_key,
        'apikey', v_key
      ),
      body := jsonb_build_object(
        'type', 'partner_new',
        'data', jsonb_build_object(
          'partner_name', NEW.name,
          'client_type',  NEW.client_type,
          'email',        COALESCE(NEW.metadata->>'contact_email', NEW.email),
          'city',         NEW.city
        )
      )
    );
  EXCEPTION WHEN OTHERS THEN
    -- Swallow everything (missing secret/extension, enqueue error, …).
    RAISE WARNING 'partner_new alert skipped (non-fatal): %', SQLERRM;
  END;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trigger_notify_team_new_partner ON core.clients;
CREATE TRIGGER trigger_notify_team_new_partner
  AFTER INSERT ON core.clients
  FOR EACH ROW
  EXECUTE FUNCTION core.notify_team_new_partner();
