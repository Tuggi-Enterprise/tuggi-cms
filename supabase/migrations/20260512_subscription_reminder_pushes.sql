-- Migration: Subscription expiry reminder pushes (12h + 1h ahead)
-- Date: 2026-05-12
-- Description:
--   Adds two time-window-based reminders for users whose subscription is
--   about to end:
--     - 12h before expiration ("Restam 12h do seu Premium")
--     - 1h before expiration  ("Premium expira em 1h")
--
--   Complements the existing `drive.check_expiring_premium_users()` which
--   only fires once on the day-of expiration. Together they cover trials
--   (24h windows) where the day-of cron arrives too late, and they give
--   paid subscriptions a softer landing.
--
--   Single function `drive.check_subscription_reminders()` walks the two
--   windows on every hourly tick. Idempotency is keyed on
--   `(user_id, subscription_end_date, reminder_type)` so each window is
--   sent at most once per subscription cycle, even if the cron retries.

CREATE OR REPLACE FUNCTION drive.check_subscription_reminders()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_user RECORD;
  v_free_tier_id UUID := '984a7cd3-c937-4218-842a-9c5fdf824f25';
  v_title TEXT;
  v_body TEXT;
  v_count_12h INTEGER := 0;
  v_count_1h INTEGER := 0;
  v_reminder_type TEXT;
  v_data JSONB;
BEGIN
  RAISE NOTICE '[sub-reminders] Sweeping 12h / 1h windows at %', NOW();

  -- ============================================================
  -- WINDOW 1 — ~12h before expiration
  -- Picks subs whose end_date lands in [now + 11.5h, now + 12.5h)
  -- ============================================================
  FOR v_user IN
    SELECT
      p.id,
      p.subscription_end_date,
      p.subscription_provider,
      COALESCE(p.nickname,
        CASE
          WHEN COALESCE(p.language, 'pt-br') IN ('pt-br', 'pt-pt', 'pt') THEN 'Viajante'
          WHEN COALESCE(p.language, 'pt-br') = 'es' THEN 'Viajero'
          WHEN COALESCE(p.language, 'pt-br') = 'it' THEN 'Viaggiatore'
          ELSE 'Traveler'
        END
      ) AS nickname,
      COALESCE(p.language, 'pt-br') AS language
    FROM drive.profiles p
    WHERE
      p.subscription_tier_id IS NOT NULL
      AND p.subscription_tier_id <> v_free_tier_id
      AND p.subscription_end_date IS NOT NULL
      AND p.subscription_end_date >= NOW() + INTERVAL '11 hours 30 minutes'
      AND p.subscription_end_date <  NOW() + INTERVAL '12 hours 30 minutes'
      AND p.push_denied = false
      AND NOT EXISTS (
        SELECT 1 FROM core.scheduled_notifications sn
        WHERE sn.user_ids @> ARRAY[p.id]
          AND sn.data->>'type' = 'subscription_reminder_12h'
          AND sn.data->>'subscription_end_date' = p.subscription_end_date::text
      )
  LOOP
    v_title := CASE
      WHEN v_user.language IN ('pt-br', 'pt-pt', 'pt') THEN 'Restam 12h do seu Premium'
      WHEN v_user.language = 'es' THEN 'Quedan 12h de tu Premium'
      WHEN v_user.language = 'it' THEN 'Mancano 12h al tuo Premium'
      ELSE '12h left on your Premium'
    END;

    v_body := CASE
      WHEN v_user.language IN ('pt-br', 'pt-pt', 'pt') THEN
        format('%s, ainda da tempo de explorar mais umas historias antes do Premium acabar.', v_user.nickname)
      WHEN v_user.language = 'es' THEN
        format('%s, aun hay tiempo para escuchar mas historias antes de que el Premium termine.', v_user.nickname)
      WHEN v_user.language = 'it' THEN
        format('%s, c''e ancora tempo per ascoltare altre storie prima che il Premium finisca.', v_user.nickname)
      ELSE
        format('%s, still time to explore a few more stories before Premium ends.', v_user.nickname)
    END;

    v_data := jsonb_build_object(
      'type', 'subscription_reminder_12h',
      'target', 'subscription',
      'screen', 'tuggi://plans',
      'subscription_end_date', v_user.subscription_end_date::text,
      'subscription_provider', COALESCE(v_user.subscription_provider, '')
    );

    INSERT INTO core.scheduled_notifications (
      type, title, body, user_ids, scheduled_for, status, priority, ttl, data
    ) VALUES (
      'user', v_title, v_body, ARRAY[v_user.id], NOW(), 'pending', 'normal', 43200, v_data
    );

    v_count_12h := v_count_12h + 1;
  END LOOP;

  -- ============================================================
  -- WINDOW 2 — ~1h before expiration
  -- Picks subs whose end_date lands in [now + 30min, now + 90min)
  -- ============================================================
  FOR v_user IN
    SELECT
      p.id,
      p.subscription_end_date,
      p.subscription_provider,
      COALESCE(p.nickname,
        CASE
          WHEN COALESCE(p.language, 'pt-br') IN ('pt-br', 'pt-pt', 'pt') THEN 'Viajante'
          WHEN COALESCE(p.language, 'pt-br') = 'es' THEN 'Viajero'
          WHEN COALESCE(p.language, 'pt-br') = 'it' THEN 'Viaggiatore'
          ELSE 'Traveler'
        END
      ) AS nickname,
      COALESCE(p.language, 'pt-br') AS language
    FROM drive.profiles p
    WHERE
      p.subscription_tier_id IS NOT NULL
      AND p.subscription_tier_id <> v_free_tier_id
      AND p.subscription_end_date IS NOT NULL
      AND p.subscription_end_date >= NOW() + INTERVAL '30 minutes'
      AND p.subscription_end_date <  NOW() + INTERVAL '90 minutes'
      AND p.push_denied = false
      AND NOT EXISTS (
        SELECT 1 FROM core.scheduled_notifications sn
        WHERE sn.user_ids @> ARRAY[p.id]
          AND sn.data->>'type' = 'subscription_reminder_1h'
          AND sn.data->>'subscription_end_date' = p.subscription_end_date::text
      )
  LOOP
    v_title := CASE
      WHEN v_user.language IN ('pt-br', 'pt-pt', 'pt') THEN 'Premium expira em 1h'
      WHEN v_user.language = 'es' THEN 'Premium expira en 1h'
      WHEN v_user.language = 'it' THEN 'Premium scade tra 1h'
      ELSE 'Premium expires in 1h'
    END;

    v_body := CASE
      WHEN v_user.language IN ('pt-br', 'pt-pt', 'pt') THEN
        format('%s, ultima chance de garantir acesso ilimitado antes do Premium acabar.', v_user.nickname)
      WHEN v_user.language = 'es' THEN
        format('%s, ultima oportunidad para mantener el acceso ilimitado antes de que el Premium termine.', v_user.nickname)
      WHEN v_user.language = 'it' THEN
        format('%s, ultima possibilita per mantenere accesso illimitato prima che il Premium scada.', v_user.nickname)
      ELSE
        format('%s, last chance to keep unlimited access before Premium ends.', v_user.nickname)
    END;

    v_data := jsonb_build_object(
      'type', 'subscription_reminder_1h',
      'target', 'subscription',
      'screen', 'tuggi://plans',
      'subscription_end_date', v_user.subscription_end_date::text,
      'subscription_provider', COALESCE(v_user.subscription_provider, '')
    );

    INSERT INTO core.scheduled_notifications (
      type, title, body, user_ids, scheduled_for, status, priority, ttl, data
    ) VALUES (
      'user', v_title, v_body, ARRAY[v_user.id], NOW(), 'pending', 'high', 3600, v_data
    );

    v_count_1h := v_count_1h + 1;
  END LOOP;

  RAISE NOTICE '[sub-reminders] Queued: 12h=% / 1h=%', v_count_12h, v_count_1h;
END;
$$;

COMMENT ON FUNCTION drive.check_subscription_reminders IS
  'Hourly sweep: queues 12h-before and 1h-before push reminders for users whose paid/trial Premium is about to expire. Idempotent per (user, end_date, reminder_type).';

-- Schedule hourly at minute 0
DO $cron_block$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') THEN
    BEGIN
      PERFORM cron.unschedule('subscription-reminders-hourly');
    EXCEPTION WHEN OTHERS THEN
      NULL;
    END;

    PERFORM cron.schedule(
      'subscription-reminders-hourly',
      '0 * * * *',
      'SELECT drive.check_subscription_reminders();'
    );

    RAISE NOTICE '[sub-reminders] Cron scheduled: hourly at :00';
  ELSE
    RAISE NOTICE '[sub-reminders] pg_cron not available; manual invocation required.';
  END IF;
END $cron_block$;

GRANT EXECUTE ON FUNCTION drive.check_subscription_reminders() TO service_role;
GRANT EXECUTE ON FUNCTION drive.check_subscription_reminders() TO postgres;
