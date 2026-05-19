-- Migration: Region waitlist (CRO Phase 9)
-- Date: 2026-05-12
-- Description:
--   Conversion fallback for users who land in areas with no nearby POIs.
--   Instead of losing them after onboarding, we capture a per-user
--   waitlist entry tied to a (lat, lng, country) and notify them with
--   a push the first time a POI appears within 10 km of their pin.
--
--   Single row per user (UNIQUE on user_id) — updating overwrites the
--   pin if they ever opt in from a new location. `notified_at` flips
--   the first time the notification fires; the cron skips notified
--   entries forever after, so users don't get repeated nudges.
--
--   Lives in the `drive` schema (per-user data). The cron function
--   joins against `core.attractions` for the spatial check and queues
--   into `core.scheduled_notifications` via the existing pipeline.

-- ============================================
-- 1. Table
-- ============================================
CREATE TABLE IF NOT EXISTS drive.region_waitlist (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  latitude DOUBLE PRECISION NOT NULL,
  longitude DOUBLE PRECISION NOT NULL,
  country TEXT,
  language TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  notified_at TIMESTAMPTZ,
  UNIQUE(user_id)
);

CREATE INDEX IF NOT EXISTS idx_region_waitlist_pending
  ON drive.region_waitlist(notified_at)
  WHERE notified_at IS NULL;

COMMENT ON TABLE drive.region_waitlist IS
  'Per-user pin captured when a user lands in an area with no nearby POIs. Cron fires a one-shot push when POIs appear within 10km.';

ALTER TABLE drive.region_waitlist ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users manage their own waitlist row" ON drive.region_waitlist;
CREATE POLICY "Users manage their own waitlist row"
  ON drive.region_waitlist
  FOR ALL
  USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "Service role manages waitlist" ON drive.region_waitlist;
CREATE POLICY "Service role manages waitlist"
  ON drive.region_waitlist
  FOR ALL
  USING (auth.role() = 'service_role');

GRANT SELECT, INSERT, UPDATE, DELETE ON drive.region_waitlist TO authenticated;
GRANT ALL ON drive.region_waitlist TO service_role;

-- ============================================
-- 2. RPC: opt-in (called from the app)
-- ============================================
CREATE OR REPLACE FUNCTION drive.opt_into_region_waitlist(
  p_latitude DOUBLE PRECISION,
  p_longitude DOUBLE PRECISION,
  p_country TEXT DEFAULT NULL,
  p_language TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, drive
AS $$
DECLARE
  v_user_id UUID;
BEGIN
  v_user_id := auth.uid();
  IF v_user_id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'reason', 'unauthenticated');
  END IF;

  IF p_latitude IS NULL OR p_longitude IS NULL THEN
    RETURN jsonb_build_object('success', false, 'reason', 'invalid_coordinates');
  END IF;

  INSERT INTO drive.region_waitlist (user_id, latitude, longitude, country, language)
  VALUES (v_user_id, p_latitude, p_longitude, p_country, p_language)
  ON CONFLICT (user_id) DO UPDATE
  SET latitude = EXCLUDED.latitude,
      longitude = EXCLUDED.longitude,
      country = COALESCE(EXCLUDED.country, drive.region_waitlist.country),
      language = COALESCE(EXCLUDED.language, drive.region_waitlist.language),
      created_at = NOW(),
      notified_at = NULL;

  RETURN jsonb_build_object('success', true);
END;
$$;

GRANT EXECUTE ON FUNCTION drive.opt_into_region_waitlist(DOUBLE PRECISION, DOUBLE PRECISION, TEXT, TEXT) TO authenticated;

-- ============================================
-- 3. Cron function: detect new POIs near waitlists and notify
-- ============================================
CREATE OR REPLACE FUNCTION drive.check_new_pois_for_waitlist()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, drive, core
AS $$
DECLARE
  v_entry RECORD;
  v_poi_count INTEGER;
  v_title TEXT;
  v_body TEXT;
  v_lang TEXT;
  v_count INTEGER := 0;
  v_radius_meters DOUBLE PRECISION := 10000.0; -- 10 km
BEGIN
  RAISE NOTICE '[region-waitlist] Sweeping pending waitlists at %', NOW();

  FOR v_entry IN
    SELECT
      w.id,
      w.user_id,
      w.latitude,
      w.longitude,
      COALESCE(w.language, p.language, 'pt-br') AS language,
      COALESCE(p.nickname,
        CASE
          WHEN COALESCE(w.language, p.language, 'pt-br') IN ('pt-br', 'pt-pt', 'pt') THEN 'Viajante'
          WHEN COALESCE(w.language, p.language, 'pt-br') = 'es' THEN 'Viajero'
          WHEN COALESCE(w.language, p.language, 'pt-br') = 'it' THEN 'Viaggiatore'
          ELSE 'Traveler'
        END
      ) AS nickname
    FROM drive.region_waitlist w
    JOIN drive.profiles p ON p.id = w.user_id
    WHERE w.notified_at IS NULL
      AND p.push_denied = false
  LOOP
    -- Count approved POIs within radius
    SELECT COUNT(*)
    INTO v_poi_count
    FROM core.attractions a
    JOIN core.attraction_coordinate ac ON ac.attraction_id = a.id
    WHERE a.approved = true
      AND ST_DWithin(
        ST_SetSRID(ST_MakePoint(ac.longitude, ac.latitude), 4326)::geography,
        ST_SetSRID(ST_MakePoint(v_entry.longitude, v_entry.latitude), 4326)::geography,
        v_radius_meters
      );

    IF v_poi_count > 0 THEN
      v_lang := v_entry.language;

      v_title := CASE
        WHEN v_lang IN ('pt-br', 'pt-pt', 'pt') THEN 'O Tuggi chegou na sua regiao'
        WHEN v_lang = 'es' THEN 'Tuggi llego a tu region'
        WHEN v_lang = 'it' THEN 'Tuggi e arrivato nella tua zona'
        ELSE 'Tuggi just arrived in your area'
      END;

      v_body := CASE
        WHEN v_lang IN ('pt-br', 'pt-pt', 'pt') THEN
          format('%s, ja temos %s historias por aqui. Saia que o Tuggi te conta no trajeto.', v_entry.nickname, v_poi_count)
        WHEN v_lang = 'es' THEN
          format('%s, ya tenemos %s historias por aqui. Sal que Tuggi te las cuenta en el camino.', v_entry.nickname, v_poi_count)
        WHEN v_lang = 'it' THEN
          format('%s, abbiamo gia %s storie qui intorno. Esci e Tuggi te le racconta lungo il percorso.', v_entry.nickname, v_poi_count)
        ELSE
          format('%s, %s stories around here already. Head out — Tuggi will tell them on your way.', v_entry.nickname, v_poi_count)
      END;

      INSERT INTO core.scheduled_notifications (
        type, title, body, user_ids, scheduled_for, status, priority, ttl, data
      ) VALUES (
        'user',
        v_title,
        v_body,
        ARRAY[v_entry.user_id],
        NOW(),
        'pending',
        'normal',
        86400,
        jsonb_build_object(
          'type', 'region_waitlist_arrived',
          'target', 'discovery',
          'screen', 'tuggi://map',
          'poi_count_nearby', v_poi_count
        )
      );

      UPDATE drive.region_waitlist
      SET notified_at = NOW()
      WHERE id = v_entry.id;

      v_count := v_count + 1;
    END IF;
  END LOOP;

  RAISE NOTICE '[region-waitlist] Notified % users of newly-covered regions', v_count;
END;
$$;

COMMENT ON FUNCTION drive.check_new_pois_for_waitlist IS
  'Daily sweep: for each pending waitlist pin, queue a push when >=1 approved POI now exists within 10km. Marks notified_at so each user is notified at most once.';

-- ============================================
-- 4. Cron schedule (daily at 09:00 UTC)
-- ============================================
DO $cron_block$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') THEN
    BEGIN
      PERFORM cron.unschedule('region-waitlist-daily-check');
    EXCEPTION WHEN OTHERS THEN
      NULL;
    END;

    PERFORM cron.schedule(
      'region-waitlist-daily-check',
      '0 9 * * *',
      'SELECT drive.check_new_pois_for_waitlist();'
    );

    RAISE NOTICE '[region-waitlist] Cron scheduled: daily at 09:00 UTC';
  ELSE
    RAISE NOTICE '[region-waitlist] pg_cron not available; manual invocation required.';
  END IF;
END $cron_block$;

GRANT EXECUTE ON FUNCTION drive.check_new_pois_for_waitlist() TO service_role;
GRANT EXECUTE ON FUNCTION drive.check_new_pois_for_waitlist() TO postgres;
