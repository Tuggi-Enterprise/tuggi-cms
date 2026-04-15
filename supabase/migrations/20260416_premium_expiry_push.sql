-- Migration: Premium Expiry Push Notification
-- Date: 2026-04-16
-- Description: Daily check for users whose premium subscription expires today.
--              Inserts a localized push notification into core.scheduled_notifications
--              for delivery at 10:00 AM local time. Reuses existing push infrastructure.

-- 1. FUNCTION: Identify expiring premium users and queue push notifications
CREATE OR REPLACE FUNCTION drive.check_expiring_premium_users()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_user RECORD;
  v_free_tier_id UUID := '984a7cd3-c937-4218-842a-9c5fdf824f25';
  v_title TEXT;
  v_body TEXT;
  v_scheduled_for TIMESTAMPTZ;
  v_count INTEGER := 0;
BEGIN
  RAISE NOTICE '[premium-expiry] Starting daily check for expiring premium users...';

  FOR v_user IN
    SELECT 
      p.id,
      COALESCE(p.nickname, 
        CASE 
          WHEN COALESCE(p.language, 'pt-br') IN ('pt-br', 'pt-pt', 'pt') THEN 'Viajante'
          WHEN COALESCE(p.language, 'pt-br') = 'es' THEN 'Viajero'
          WHEN COALESCE(p.language, 'pt-br') = 'it' THEN 'Viaggiatore'
          ELSE 'Traveler'
        END
      ) AS nickname,
      COALESCE(p.language, 'pt-br') AS language,
      COALESCE(p.timezone, 'UTC') AS timezone
    FROM drive.profiles p
    WHERE 
      -- Has a non-free premium tier
      p.subscription_tier_id IS NOT NULL
      AND p.subscription_tier_id != v_free_tier_id
      -- Subscription ends today (in the user's local timezone)
      AND p.subscription_end_date IS NOT NULL
      AND (p.subscription_end_date AT TIME ZONE COALESCE(p.timezone, 'UTC'))::date = CURRENT_DATE
      -- User accepts push notifications
      AND p.push_denied = false
      -- Idempotency: not already notified today for this type
      AND NOT EXISTS (
        SELECT 1 FROM core.scheduled_notifications sn
        WHERE sn.user_ids @> ARRAY[p.id]
          AND sn.data->>'type' = 'premium_expiry_warning'
          AND sn.created_at::date = CURRENT_DATE
      )
  LOOP
    -- Build i18n title (Option C: "Parceiro de Jornada")
    v_title := CASE 
      WHEN v_user.language IN ('pt-br', 'pt-pt', 'pt') THEN 'Queremos continuar com voce'
      WHEN v_user.language = 'es' THEN 'Queremos seguir contigo'
      WHEN v_user.language = 'it' THEN 'Vogliamo continuare con te'
      ELSE 'We want to keep going with you'
    END;

    -- Build i18n body (Option C: "Parceiro de Jornada")
    v_body := CASE 
      WHEN v_user.language IN ('pt-br', 'pt-pt', 'pt') THEN 
        format('%s, o Tuggi quer continuar te mostrando tudo o que os lugares ao seu redor tem pra contar. Seu acesso Premium termina hoje. Continue com a gente e nao perca nenhuma historia.', v_user.nickname)
      WHEN v_user.language = 'es' THEN 
        format('%s, Tuggi quiere seguir mostrandote todo lo que los lugares a tu alrededor tienen para contar. Tu acceso Premium termina hoy. Sigue con nosotros y no te pierdas ninguna historia.', v_user.nickname)
      WHEN v_user.language = 'it' THEN 
        format('%s, Tuggi vuole continuare a mostrarti tutto cio che i luoghi intorno a te hanno da raccontare. Il tuo accesso Premium scade oggi. Resta con noi e non perderti nessuna storia.', v_user.nickname)
      ELSE 
        format('%s, Tuggi wants to keep showing you everything the places around you have to say. Your Premium access ends today. Stay with us and don''t miss any story.', v_user.nickname)
    END;

    -- Calculate scheduled_for: 10:00 AM in the user's local timezone
    v_scheduled_for := (CURRENT_DATE || ' 10:00:00')::timestamp AT TIME ZONE v_user.timezone;

    -- If 10 AM local has already passed, schedule for NOW (deliver immediately)
    IF v_scheduled_for < NOW() THEN
      v_scheduled_for := NOW();
    END IF;

    -- Queue the notification
    INSERT INTO core.scheduled_notifications (
      type, title, body, user_ids, scheduled_for, status, priority, ttl, data
    ) VALUES (
      'user',
      v_title,
      v_body,
      ARRAY[v_user.id],
      v_scheduled_for,
      'pending',
      'high',
      86400,
      jsonb_build_object(
        'type', 'premium_expiry_warning',
        'target', 'subscription',
        'screen', 'tuggi://plans'
      )
    );

    v_count := v_count + 1;
  END LOOP;

  RAISE NOTICE '[premium-expiry] Queued % notifications for expiring premium users.', v_count;
END;
$$;

-- 2. CRON: Run daily at 06:00 UTC
-- This is early enough to prepare notifications before 10 AM in any timezone (earliest UTC-12)
SELECT cron.schedule(
  'premium-expiry-daily-check',
  '0 6 * * *',
  'SELECT drive.check_expiring_premium_users();'
);

-- 3. PERMISSIONS
GRANT EXECUTE ON FUNCTION drive.check_expiring_premium_users() TO service_role;
GRANT EXECUTE ON FUNCTION drive.check_expiring_premium_users() TO postgres;
