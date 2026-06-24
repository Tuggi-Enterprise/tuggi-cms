-- ============================================
-- Migration: partner-flow notifications, fully in the DB (reliable)
-- Date: 2026-06-24
-- Description:
--   The Next.js approval/rejection side-effects depend on the CMS runtime env +
--   deploy and were NOT firing (no Resend approval emails, no notification_logs).
--   The registration team-alert already works because it's a DB trigger (Vault +
--   pg_net). So we move ALL partner notifications into the DB, where they fire on
--   the actual data change regardless of which app/route made it.
--
--   Localized (pt/en/es/fr/it): both the email (send-transactional) and the push
--   (firebase-push-notification) render from the shared i18n by the user's
--   profiles.language. Each step of the flow notifies the registrant:
--     INSERT  status=pending   -> team alert + user "received" email + push
--     UPDATE  -> approved       -> Pro grant (guarded) + user "approved" email + push
--     UPDATE  -> rejected       -> user "rejected" email + push (with reason)
--
--   The app user_id is recovered from the synthetic client email
--   (<user_id>@partner.tuggi.app) that register_partner_v1 writes, so no RPC
--   change is needed. Everything is wrapped in exception guards — a delivery
--   failure can never break registration/approval.
-- ============================================

-- ---------- helper: dispatch one user's email + push for an event ----------
CREATE OR REPLACE FUNCTION core.dispatch_partner_user_notification(
  p_event       text,   -- 'received' | 'approved' | 'rejected'
  p_user_id     uuid,
  p_client_name text,
  p_client_type text,
  p_reason      text DEFAULT NULL
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_url    text;
  v_key    text;
  v_lang   text;
  v_email  text;
  v_status text;
BEGIN
  IF p_user_id IS NULL THEN RETURN; END IF;

  SELECT TRIM(decrypted_secret) INTO v_url
  FROM vault.decrypted_secrets WHERE name = 'SUPABASE_URL' LIMIT 1;
  SELECT TRIM(decrypted_secret) INTO v_key
  FROM vault.decrypted_secrets WHERE name = 'SERVICE_ROLE_KEY' LIMIT 1;
  IF v_url IS NULL OR v_key IS NULL THEN
    RAISE NOTICE 'partner notification skipped: secrets missing';
    RETURN;
  END IF;

  SELECT language INTO v_lang FROM drive.profiles WHERE id = p_user_id;
  SELECT email    INTO v_email FROM auth.users    WHERE id = p_user_id;

  v_status := CASE p_event
                WHEN 'approved' THEN 'approved'
                WHEN 'rejected' THEN 'rejected'
                ELSE 'pending'
              END;

  -- Email (only if we have a real, deliverable address).
  IF v_email IS NOT NULL AND v_email NOT LIKE '%@partner.tuggi.app' THEN
    PERFORM net.http_post(
      url := rtrim(v_url, '/') || '/functions/v1/send-transactional/send',
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'Authorization', 'Bearer ' || v_key,
        'apikey', v_key
      ),
      body := jsonb_build_object(
        'type', 'partner_' || p_event,
        'to',   v_email,
        'lang', v_lang,
        'data', jsonb_build_object(
          'partner_name', p_client_name,
          'client_type',  p_client_type,
          'reason',       p_reason,
          'app_url',      'https://tuggi.app'
        )
      )
    );
  END IF;

  -- Push (localized via template + lang; EF resolves the user's tokens).
  PERFORM net.http_post(
    url := rtrim(v_url, '/') || '/functions/v1/firebase-push-notification/send',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || v_key,
      'apikey', v_key
    ),
    body := jsonb_build_object(
      'type',     'user',
      'userIds',  jsonb_build_array(p_user_id),
      'template', p_event,
      'lang',     v_lang,
      'priority', 'high',
      'data',     jsonb_build_object(
        'deeplink', 'tuggi://partner-status',
        'status',   v_status
      )
    )
  );
END;
$$;

-- ---------- INSERT: team alert + registrant "received" email + push ----------
CREATE OR REPLACE FUNCTION core.notify_team_new_partner()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_url      text;
  v_key      text;
  v_user_id  uuid;
BEGIN
  BEGIN
    IF NEW.status <> 'pending'
       OR COALESCE(NEW.metadata->>'source', '') <> 'app_partner_registration' THEN
      RETURN NEW;
    END IF;

    SELECT TRIM(decrypted_secret) INTO v_url
    FROM vault.decrypted_secrets WHERE name = 'SUPABASE_URL' LIMIT 1;
    SELECT TRIM(decrypted_secret) INTO v_key
    FROM vault.decrypted_secrets WHERE name = 'SERVICE_ROLE_KEY' LIMIT 1;
    IF v_url IS NULL OR v_key IS NULL THEN
      RAISE NOTICE 'partner alert skipped: secrets missing';
      RETURN NEW;
    END IF;

    -- 1) Team alert (internal, pt).
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

    -- 2) Registrant confirmation (email + push), recovered from the synthetic
    --    client email <user_id>@partner.tuggi.app.
    IF NEW.email LIKE '%@partner.tuggi.app' THEN
      BEGIN
        v_user_id := split_part(NEW.email, '@', 1)::uuid;
      EXCEPTION WHEN OTHERS THEN
        v_user_id := NULL;
      END;
      PERFORM core.dispatch_partner_user_notification(
        'received', v_user_id, NEW.name, NEW.client_type, NULL
      );
    END IF;
  EXCEPTION WHEN OTHERS THEN
    RAISE WARNING 'partner registration notifications skipped (non-fatal): %', SQLERRM;
  END;

  RETURN NEW;
END;
$$;

-- ---------- UPDATE: approval grant + approved/rejected email + push ----------
CREATE OR REPLACE FUNCTION core.notify_partner_status_change()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_event     text;
  v_pro_tier  uuid;
  v_uid       uuid;
  v_provider  text;
  v_end       timestamptz;
  v_paid      boolean;
BEGIN
  -- Only act on app-originated partners, on an actual status transition.
  IF COALESCE(NEW.metadata->>'source', '') <> 'app_partner_registration'
     OR NEW.status IS NOT DISTINCT FROM OLD.status THEN
    RETURN NEW;
  END IF;

  IF NEW.status = 'approved' THEN
    v_event := 'approved';
  ELSIF NEW.status = 'rejected' THEN
    v_event := 'rejected';
  ELSE
    RETURN NEW;
  END IF;

  BEGIN
    -- On approval: grant the Pro comp (90d) to every linked app user, unless they
    -- already hold an active PAID subscription.
    IF v_event = 'approved' THEN
      SELECT id INTO v_pro_tier FROM drive.subscription_tiers WHERE name = 'pro' LIMIT 1;
    END IF;

    FOR v_uid IN
      SELECT id FROM drive.profiles WHERE client_id = NEW.id
    LOOP
      IF v_event = 'approved' AND v_pro_tier IS NOT NULL THEN
        SELECT subscription_provider, subscription_end_date
          INTO v_provider, v_end
          FROM drive.profiles WHERE id = v_uid;
        v_paid := v_provider IN ('apple','google','stripe','revenuecat')
                  AND (v_end IS NULL OR v_end > now());

        IF NOT COALESCE(v_paid, false) THEN
          UPDATE drive.profiles SET
            subscription_tier_id     = v_pro_tier,
            subscription_provider    = 'admin',
            subscription_start_date  = now(),
            subscription_end_date    = now() + interval '90 days',
            subscription_granted_by  = NEW.approved_by,
            updated_at               = now()
          WHERE id = v_uid;
        END IF;
      END IF;

      PERFORM core.dispatch_partner_user_notification(
        v_event, v_uid, NEW.name, NEW.client_type,
        CASE WHEN v_event = 'rejected' THEN NEW.rejection_reason ELSE NULL END
      );
    END LOOP;
  EXCEPTION WHEN OTHERS THEN
    RAISE WARNING 'partner status-change effects skipped (non-fatal): %', SQLERRM;
  END;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trigger_notify_partner_status_change ON core.clients;
CREATE TRIGGER trigger_notify_partner_status_change
  AFTER UPDATE OF status ON core.clients
  FOR EACH ROW
  EXECUTE FUNCTION core.notify_partner_status_change();
