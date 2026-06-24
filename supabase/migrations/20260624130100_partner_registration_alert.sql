-- ============================================
-- Migration: Team alert email on new partner registration
-- Date: 2026-06-24
-- Description:
--   AFTER INSERT trigger on core.clients that, for app-originated partner
--   registrations (status='pending', metadata.source='app_partner_registration'),
--   calls the send-transactional Edge Function (type='partner_new') to email the
--   team. Mirrors the existing http() + core.project_settings pattern used by the
--   notification system (20260216). Never blocks the insert (errors are warnings).
--
--   Requires core.project_settings to hold 'supabase_url' and 'service_role_key'
--   (same as the push cron). Alternatively this can be replaced by a Supabase
--   Database Webhook on core.clients INSERT → send-transactional.
-- ============================================

CREATE OR REPLACE FUNCTION core.notify_team_new_partner()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_url text;
  v_key text;
  response_status integer;
  response_content text;
BEGIN
  -- Only app-originated pending registrations.
  IF NEW.status <> 'pending'
     OR COALESCE(NEW.metadata->>'source', '') <> 'app_partner_registration' THEN
    RETURN NEW;
  END IF;

  SELECT value INTO v_url FROM core.project_settings WHERE key = 'supabase_url';
  SELECT value INTO v_key FROM core.project_settings WHERE key = 'service_role_key';
  IF v_url IS NULL OR v_key IS NULL THEN
    RAISE NOTICE 'partner alert skipped: core.project_settings missing supabase_url/service_role_key';
    RETURN NEW;
  END IF;

  v_url := rtrim(v_url, '/') || '/functions/v1/send-transactional/send';

  BEGIN
    SELECT status, content INTO response_status, response_content
    FROM http((
      'POST',
      v_url,
      ARRAY[
        http_header('Authorization', 'Bearer ' || v_key),
        http_header('Content-Type', 'application/json')
      ],
      'application/json',
      jsonb_build_object(
        'type', 'partner_new',
        'data', jsonb_build_object(
          'partner_name', NEW.name,
          'client_type',  NEW.client_type,
          'email',        NEW.email,
          'city',         NEW.city
        )
      )::text
    ));
    IF response_status >= 400 THEN
      RAISE WARNING 'partner_new alert email failed. Status %, Content %', response_status, response_content;
    END IF;
  EXCEPTION WHEN OTHERS THEN
    RAISE WARNING 'partner_new alert email exception: %', SQLERRM;
  END;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trigger_notify_team_new_partner ON core.clients;
CREATE TRIGGER trigger_notify_team_new_partner
  AFTER INSERT ON core.clients
  FOR EACH ROW
  EXECUTE FUNCTION core.notify_team_new_partner();
