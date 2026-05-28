-- ============================================
-- Migration: Coupon-attributed Premium expiry push
-- Date: 2026-05-28
-- Description: Sibling of drive.check_expiring_premium_users(). Identifies
--              users whose Premium expires today AND was granted by an
--              in-house coupon (drive.coupon_redemptions), then queues a
--              push notification that names the owner ("Your gift from
--              Neymar ends today"). Runs 30 minutes earlier than the
--              generic check so it wins the shared idempotency guard on
--              data.type='premium_expiry_warning' — coupon users get the
--              warm attribution copy, everyone else falls through to the
--              existing generic flow.
-- ============================================

CREATE OR REPLACE FUNCTION drive.check_expiring_coupon_premium_users()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = drive, core, public
AS $$
DECLARE
  v_user RECORD;
  v_free_tier_id UUID := '984a7cd3-c937-4218-842a-9c5fdf824f25';
  v_title TEXT;
  v_body TEXT;
  v_scheduled_for TIMESTAMPTZ;
  v_owner_name TEXT;
  v_count INTEGER := 0;
BEGIN
  RAISE NOTICE '[coupon-expiry] Starting daily check for expiring coupon-attributed premium users...';

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
      COALESCE(p.timezone, 'UTC') AS timezone,
      -- Most recent coupon redemption snapshot — covers cases where a
      -- user redeemed multiple codes; we attribute the latest gift.
      (
        SELECT cr.owner_name_snapshot
        FROM drive.coupon_redemptions cr
        WHERE cr.user_id = p.id
          AND cr.owner_name_snapshot IS NOT NULL
        ORDER BY cr.redeemed_at DESC
        LIMIT 1
      ) AS owner_name
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
      -- Coupon-attributed: the active Premium came from a coupon redemption
      AND p.subscription_provider = 'coupon'
      -- Idempotency: not already notified today for ANY premium expiry flavour
      -- (shares the namespace with drive.check_expiring_premium_users so the
      --  generic function naturally skips users we handled here)
      AND NOT EXISTS (
        SELECT 1 FROM core.scheduled_notifications sn
        WHERE sn.user_ids @> ARRAY[p.id]
          AND sn.data->>'type' = 'premium_expiry_warning'
          AND sn.created_at::date = CURRENT_DATE
      )
  LOOP
    -- Belt-and-braces: if for any reason no owner snapshot is found
    -- (race, manual edit, etc.) skip and let the generic function fire
    -- the non-attributed copy at 06:00 UTC.
    IF v_user.owner_name IS NULL OR TRIM(v_user.owner_name) = '' THEN
      CONTINUE;
    END IF;

    v_owner_name := v_user.owner_name;

    -- Localized title — owner attribution as the hook
    v_title := CASE
      WHEN v_user.language IN ('pt-br', 'pt-pt', 'pt') THEN
        format('Seu presente do %s acaba hoje 🧡', v_owner_name)
      WHEN v_user.language = 'es' THEN
        format('Tu regalo de %s termina hoy 🧡', v_owner_name)
      WHEN v_user.language = 'it' THEN
        format('Il regalo di %s scade oggi 🧡', v_owner_name)
      ELSE
        format('Your gift from %s ends today 🧡', v_owner_name)
    END;

    -- Localized body — warm nudge, no hard sell
    v_body := CASE
      WHEN v_user.language IN ('pt-br', 'pt-pt', 'pt') THEN
        format(
          '%s, hoje terminam seus dias de Tuggi Premium presenteados por %s. Continue ouvindo as historias dos lugares ao seu redor.',
          v_user.nickname, v_owner_name
        )
      WHEN v_user.language = 'es' THEN
        format(
          '%s, hoy terminan tus dias de Tuggi Premium regalados por %s. Sigue escuchando las historias de los lugares a tu alrededor.',
          v_user.nickname, v_owner_name
        )
      WHEN v_user.language = 'it' THEN
        format(
          '%s, oggi finiscono i tuoi giorni di Tuggi Premium offerti da %s. Continua ad ascoltare le storie dei luoghi intorno a te.',
          v_user.nickname, v_owner_name
        )
      ELSE
        format(
          '%s, your days of Tuggi Premium gifted by %s end today. Keep listening to the stories of the places around you.',
          v_user.nickname, v_owner_name
        )
    END;

    -- Schedule for 10:00 AM local; if past, fire immediately
    v_scheduled_for := (CURRENT_DATE || ' 10:00:00')::timestamp AT TIME ZONE v_user.timezone;
    IF v_scheduled_for < NOW() THEN
      v_scheduled_for := NOW();
    END IF;

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
        'flavour', 'coupon_owner_attributed',
        'owner_name', v_owner_name,
        'target', 'subscription',
        'screen', 'tuggi://plans'
      )
    );

    v_count := v_count + 1;
  END LOOP;

  RAISE NOTICE '[coupon-expiry] Queued % attributed expiry notifications.', v_count;
END;
$$;

-- Cron: 05:30 UTC daily (30 minutes before the generic check at 06:00 UTC).
-- The shared idempotency guard on data.type='premium_expiry_warning' means
-- the generic function will skip users we already queued — no
-- double-notification, no further coordination needed.
SELECT cron.schedule(
  'coupon-expiry-daily-check',
  '30 5 * * *',
  'SELECT drive.check_expiring_coupon_premium_users();'
);

GRANT EXECUTE ON FUNCTION drive.check_expiring_coupon_premium_users() TO service_role;
GRANT EXECUTE ON FUNCTION drive.check_expiring_coupon_premium_users() TO postgres;
