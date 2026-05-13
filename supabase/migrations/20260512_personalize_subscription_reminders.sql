-- Migration: Personalize subscription reminder pushes with POI counts
-- Date: 2026-05-12
-- Description:
--   Extends `drive.check_subscription_reminders()` (Phase 8) so the 12h
--   and 1h pushes mention the actual number of stories the user heard
--   during the trial / current period, with a graceful fallback for
--   users with zero `poi_visits` in the last 24h.
--
--   Specificity is the single biggest CTR lever for retention pushes
--   (industry benchmarks show 30-60% lift). The day-of `10:00 local`
--   push (`check_expiring_premium_users`) intentionally keeps its
--   relational tone and is NOT changed here.
--
--   Localized in pt / en / es / it.

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
  v_pois_heard INTEGER;
  v_data JSONB;
BEGIN
  RAISE NOTICE '[sub-reminders] Sweeping 12h / 1h windows at %', NOW();

  -- ============================================================
  -- WINDOW 1 — ~12h before expiration
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
    -- How many stories has this user heard in the last 24h?
    SELECT COUNT(*) INTO v_pois_heard
    FROM drive.poi_visits
    WHERE user_id = v_user.id
      AND visit_timestamp >= NOW() - INTERVAL '24 hours';

    IF v_pois_heard > 0 THEN
      -- Specific: anchor on what they already heard
      v_title := CASE
        WHEN v_user.language IN ('pt-br', 'pt-pt', 'pt') THEN
          format('%s historias em 24h. Restam 12h.', v_pois_heard)
        WHEN v_user.language = 'es' THEN
          format('%s historias en 24h. Quedan 12h.', v_pois_heard)
        WHEN v_user.language = 'it' THEN
          format('%s storie in 24h. Restano 12h.', v_pois_heard)
        ELSE
          format('%s stories in 24h. 12h left.', v_pois_heard)
      END;
      v_body := CASE
        WHEN v_user.language IN ('pt-br', 'pt-pt', 'pt') THEN
          format('%s, ainda da tempo de ouvir mais antes do Premium acabar.', v_user.nickname)
        WHEN v_user.language = 'es' THEN
          format('%s, aun hay tiempo para escuchar mas antes de que el Premium termine.', v_user.nickname)
        WHEN v_user.language = 'it' THEN
          format('%s, c''e ancora tempo per ascoltarne altre prima che il Premium finisca.', v_user.nickname)
        ELSE
          format('%s, still time to hear more before Premium ends.', v_user.nickname)
      END;
    ELSE
      -- Fallback: outcome framing, no shame
      v_title := CASE
        WHEN v_user.language IN ('pt-br', 'pt-pt', 'pt') THEN 'Restam 12h do seu Premium'
        WHEN v_user.language = 'es' THEN 'Quedan 12h de tu Premium'
        WHEN v_user.language = 'it' THEN 'Mancano 12h al tuo Premium'
        ELSE '12h left on your Premium'
      END;
      v_body := CASE
        WHEN v_user.language IN ('pt-br', 'pt-pt', 'pt') THEN
          format('%s, saia que o Tuggi comeca sozinho quando voce passa por algo interessante.', v_user.nickname)
        WHEN v_user.language = 'es' THEN
          format('%s, sal que Tuggi empieza solo cuando pasas por algo interesante.', v_user.nickname)
        WHEN v_user.language = 'it' THEN
          format('%s, esci che Tuggi parte da solo quando passi vicino a qualcosa di interessante.', v_user.nickname)
        ELSE
          format('%s, head out — Tuggi starts on its own when you pass something worth hearing.', v_user.nickname)
      END;
    END IF;

    v_data := jsonb_build_object(
      'type', 'subscription_reminder_12h',
      'target', 'subscription',
      'screen', 'tuggi://plans',
      'subscription_end_date', v_user.subscription_end_date::text,
      'subscription_provider', COALESCE(v_user.subscription_provider, ''),
      'pois_heard_24h', v_pois_heard
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
    SELECT COUNT(*) INTO v_pois_heard
    FROM drive.poi_visits
    WHERE user_id = v_user.id
      AND visit_timestamp >= NOW() - INTERVAL '24 hours';

    IF v_pois_heard > 0 THEN
      v_title := CASE
        WHEN v_user.language IN ('pt-br', 'pt-pt', 'pt') THEN 'Em 1h voce volta pros 5 audios/dia'
        WHEN v_user.language = 'es' THEN 'En 1h vuelves a 5 audios/dia'
        WHEN v_user.language = 'it' THEN 'Tra 1h torni a 5 audio/giorno'
        ELSE 'In 1h you go back to 5 audios/day'
      END;
      v_body := CASE
        WHEN v_user.language IN ('pt-br', 'pt-pt', 'pt') THEN
          format('%s, ja foram %s historias. Mantenha Premium pra continuar sem limite.', v_user.nickname, v_pois_heard)
        WHEN v_user.language = 'es' THEN
          format('%s, ya fueron %s historias. Mantene Premium para seguir sin limite.', v_user.nickname, v_pois_heard)
        WHEN v_user.language = 'it' THEN
          format('%s, gia %s storie ascoltate. Mantieni Premium per continuare senza limiti.', v_user.nickname, v_pois_heard)
        ELSE
          format('%s, %s stories so far. Keep Premium to keep going without limits.', v_user.nickname, v_pois_heard)
      END;
    ELSE
      v_title := CASE
        WHEN v_user.language IN ('pt-br', 'pt-pt', 'pt') THEN 'Em 1h voce volta pros 5 audios/dia'
        WHEN v_user.language = 'es' THEN 'En 1h vuelves a 5 audios/dia'
        WHEN v_user.language = 'it' THEN 'Tra 1h torni a 5 audio/giorno'
        ELSE 'In 1h you go back to 5 audios/day'
      END;
      v_body := CASE
        WHEN v_user.language IN ('pt-br', 'pt-pt', 'pt') THEN
          format('%s, ainda da tempo de ouvir sua primeira historia sem limite.', v_user.nickname)
        WHEN v_user.language = 'es' THEN
          format('%s, aun hay tiempo para escuchar tu primera historia sin limite.', v_user.nickname)
        WHEN v_user.language = 'it' THEN
          format('%s, c''e ancora tempo per ascoltare la tua prima storia senza limiti.', v_user.nickname)
        ELSE
          format('%s, still time to hear your first story without limits.', v_user.nickname)
      END;
    END IF;

    v_data := jsonb_build_object(
      'type', 'subscription_reminder_1h',
      'target', 'subscription',
      'screen', 'tuggi://plans',
      'subscription_end_date', v_user.subscription_end_date::text,
      'subscription_provider', COALESCE(v_user.subscription_provider, ''),
      'pois_heard_24h', v_pois_heard
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

GRANT EXECUTE ON FUNCTION drive.check_subscription_reminders() TO service_role;
GRANT EXECUTE ON FUNCTION drive.check_subscription_reminders() TO postgres;
