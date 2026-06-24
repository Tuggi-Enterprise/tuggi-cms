-- ============================================================================
-- App user <-> client link (partner QR) — RPCs
--
-- Read:  extend core.dashboard_user_detail to expose the linked client.
-- Write: core.admin_set_app_user_client sets/clears drive.profiles.client_id.
--
-- The link column drive.profiles.client_id (FK -> core.clients, ON DELETE SET
-- NULL) was added in tuggi-drive-v2 migration 20260624120300_profiles_client_id.
-- Once populated, drive.get_user_profile_v1 surfaces the client's partner QR
-- (https://tuggi.app/d/<slug>) in the app's Passaporte.
--
-- Run manually in the Supabase SQL editor (no DDL via CLI).
-- ============================================================================

-- 1. Read RPC — add client_id + linked_client to the existing detail function.
--    The return type changes (new OUT columns), so CREATE OR REPLACE is not enough;
--    the function must be dropped first.
DROP FUNCTION IF EXISTS core.dashboard_user_detail(uuid);

CREATE OR REPLACE FUNCTION core.dashboard_user_detail(target_user_id uuid)
RETURNS TABLE(
  user_id uuid,
  full_name text,
  nickname text,
  email text,
  phone text,
  country text,
  language text,
  timezone text,
  voice_preference text,
  driver_type text,
  last_platform text,
  last_device_model text,
  last_app_version text,
  subscription_tier_id uuid,
  subscription_tier_name text,
  subscription_tier_display_name text,
  subscription_provider text,
  subscription_start_date timestamp with time zone,
  subscription_end_date timestamp with time zone,
  is_premium boolean,
  login_count integer,
  last_sign_in_at timestamp with time zone,
  created_at timestamp with time zone,
  onboarding_completed boolean,
  trip_count bigint,
  total_km numeric,
  poi_visits_count bigint,
  unique_cities_visited bigint,
  last_trip_at timestamp with time zone,
  subscription_history jsonb,
  client_id uuid,            -- ADICIONADO: vínculo de client (QR de parceiro)
  linked_client jsonb        -- ADICIONADO: { id, name, client_type, slug, qr_url }
)
LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'core', 'public', 'extensions'
AS $$
DECLARE
  free_tier_id uuid := '984a7cd3-c937-4218-842a-9c5fdf824f25';
BEGIN
  RETURN QUERY
  SELECT
    p.id as user_id,
    p.full_name,
    p.nickname,
    au.email::text,
    p.phone,
    COALESCE(p.country, CASE WHEN p.phone_country_code IS NOT NULL THEN '+' || p.phone_country_code ELSE NULL END) as country,
    p.language,
    p.timezone,
    p.voice_preference,
    p.driver_type,

    p.last_platform,
    p.last_device_model,
    p.last_app_version,

    p.subscription_tier_id,
    st.name as subscription_tier_name,
    st.display_name as subscription_tier_display_name,
    p.subscription_provider,
    p.subscription_start_date,
    p.subscription_end_date,
    (p.subscription_tier_id IS NOT NULL AND p.subscription_tier_id != free_tier_id) as is_premium,

    COALESCE(p.login_count, 0) as login_count,
    p.last_sign_in_at,
    p.created_at,
    COALESCE(p.onboarding_completed, false) as onboarding_completed,

    -- Trip stats
    COALESCE(t.trip_count, 0)::bigint as trip_count,
    COALESCE(t.total_distance_km, 0)::numeric as total_km,

    -- POI visits count
    COALESCE((
      SELECT COUNT(*) FROM drive.poi_visits pv WHERE pv.user_id = target_user_id
    ), 0)::bigint as poi_visits_count,

    -- Unique cities (usando poi_city da tabela poi_visits)
    COALESCE((
      SELECT COUNT(DISTINCT pv.poi_city)
      FROM drive.poi_visits pv
      WHERE pv.user_id = target_user_id AND pv.poi_city IS NOT NULL
    ), 0)::bigint as unique_cities_visited,

    -- Last trip
    t.last_trip as last_trip_at,

    -- Subscription history
    COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'id', sh.id,
        'action', sh.action,
        'provider', sh.provider,
        'tier_name', sth.display_name,
        'previous_tier_name', sthp.display_name,
        'created_at', sh.created_at
      ) ORDER BY sh.created_at DESC)
      FROM drive.subscription_history sh
      LEFT JOIN drive.subscription_tiers sth ON sth.id = sh.tier_id
      LEFT JOIN drive.subscription_tiers sthp ON sthp.id = sh.previous_tier_id
      WHERE sh.user_id = target_user_id
      LIMIT 20
    ), '[]'::jsonb) as subscription_history,

    -- Linked client (partner QR)
    p.client_id,
    CASE WHEN c.id IS NOT NULL THEN jsonb_build_object(
      'id', c.id,
      'name', c.name,
      'client_type', c.client_type,
      'slug', c.slug,
      'qr_url', CASE WHEN c.slug IS NOT NULL THEN 'https://tuggi.app/d/' || c.slug ELSE NULL END
    ) END as linked_client

  FROM drive.profiles p
  LEFT JOIN auth.users au ON au.id = p.id
  LEFT JOIN drive.subscription_tiers st ON st.id = p.subscription_tier_id
  LEFT JOIN drive.trail_users_from_trips t ON t.user_id = p.id
  LEFT JOIN core.clients c ON c.id = p.client_id
  WHERE p.id = target_user_id;
END; $$;

GRANT EXECUTE ON FUNCTION core.dashboard_user_detail(uuid) TO authenticated, service_role;


-- 2. Write RPC — set or clear drive.profiles.client_id for an app user.
--    Called only by the admin API route (service role); the route enforces the
--    admin gate and writes the audit log. Validation lives here.
CREATE OR REPLACE FUNCTION core.admin_set_app_user_client(
  target_user_id uuid,
  target_client_id uuid
)
RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'core', 'public', 'extensions'
AS $$
DECLARE
  updated_id uuid;
BEGIN
  -- Validate target client exists (when linking)
  IF target_client_id IS NOT NULL THEN
    IF NOT EXISTS (SELECT 1 FROM core.clients WHERE id = target_client_id) THEN
      RAISE EXCEPTION 'client_not_found' USING ERRCODE = 'P0002';
    END IF;
  END IF;

  UPDATE drive.profiles
  SET client_id = target_client_id
  WHERE id = target_user_id
  RETURNING id INTO updated_id;

  IF updated_id IS NULL THEN
    RAISE EXCEPTION 'app_user_not_found' USING ERRCODE = 'P0002';
  END IF;

  RETURN target_client_id;
END; $$;

-- service_role only: the link can only be mutated through the admin route.
GRANT EXECUTE ON FUNCTION core.admin_set_app_user_client(uuid, uuid) TO service_role;

-- Ask PostgREST to reload its schema cache so the new RPC is callable.
NOTIFY pgrst, 'reload schema';
