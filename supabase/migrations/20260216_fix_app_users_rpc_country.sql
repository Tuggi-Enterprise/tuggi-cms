-- ============================================================================
-- RPC: dashboard_app_users_detailed
-- Update to include timezone and fix country fallback
-- ============================================================================

-- 1. Update list function
CREATE OR REPLACE FUNCTION core.dashboard_app_users_detailed(
  limit_count int DEFAULT 100,
  filter_country text DEFAULT NULL,
  filter_platform text DEFAULT NULL
)
RETURNS TABLE (
  -- Profile básico
  user_id uuid,
  full_name text,
  nickname text,
  email text,
  country text,
  language text,
  timezone text, -- ADICIONADO
  voice_preference text,
  driver_type text,
  
  -- Device info
  last_platform text,
  last_device_model text,
  last_app_version text,
  
  -- Subscription info
  subscription_tier_id uuid,
  subscription_tier_name text,
  subscription_tier_display_name text,
  subscription_provider text,
  subscription_start_date timestamptz,
  subscription_end_date timestamptz,
  is_premium boolean,
  
  -- Activity stats
  login_count int,
  last_sign_in_at timestamptz,
  created_at timestamptz,
  onboarding_completed boolean,
  
  -- Trip/Visit stats (agregados)
  trip_count bigint,
  total_km numeric,
  poi_visits_count bigint,
  last_trip_at timestamptz
)
LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  free_tier_id uuid := '984a7cd3-c937-4218-842a-9c5fdf824f25'; -- ID do tier free
BEGIN
  RETURN QUERY
  SELECT 
    -- Profile básico
    p.id as user_id,
    p.full_name,
    p.nickname,
    au.email::text,
    -- Fallback country logic: country -> phone country code -> null
    COALESCE(p.country, CASE WHEN p.phone_country_code IS NOT NULL THEN '+' || p.phone_country_code ELSE NULL END) as country,
    p.language,
    p.timezone, -- ADICIONADO
    p.voice_preference,
    p.driver_type,
    
    -- Device info
    p.last_platform,
    p.last_device_model,
    p.last_app_version,
    
    -- Subscription info
    p.subscription_tier_id,
    st.name as subscription_tier_name,
    st.display_name as subscription_tier_display_name,
    p.subscription_provider,
    p.subscription_start_date,
    p.subscription_end_date,
    (p.subscription_tier_id IS NOT NULL AND p.subscription_tier_id != free_tier_id) as is_premium,
    
    -- Activity stats
    COALESCE(p.login_count, 0) as login_count,
    p.last_sign_in_at,
    p.created_at,
    COALESCE(p.onboarding_completed, false) as onboarding_completed,
    
    -- Trip/Visit stats
    COALESCE(t.trip_count, 0)::bigint as trip_count,
    COALESCE(t.total_distance_km, 0)::numeric as total_km,
    COALESCE(v.visit_count, 0)::bigint as poi_visits_count,
    t.last_trip as last_trip_at
    
  FROM drive.profiles p
  -- Join com auth.users para pegar email
  LEFT JOIN auth.users au ON au.id = p.id
  -- Join com subscription_tiers para pegar nome do tier
  LEFT JOIN drive.subscription_tiers st ON st.id = p.subscription_tier_id
  -- Join com view de trips agregadas
  LEFT JOIN drive.trail_users_from_trips t ON t.user_id = p.id
  -- Subquery para POI visits agregadas
  LEFT JOIN (
    SELECT pv.user_id, COUNT(*) as visit_count 
    FROM drive.poi_visits pv 
    GROUP BY pv.user_id
  ) v ON v.user_id = p.id
  
  -- Filtros opcionais
  WHERE 
    (filter_country IS NULL OR p.country = filter_country OR ('+' || p.phone_country_code) = filter_country)
    AND (filter_platform IS NULL OR p.last_platform = filter_platform)
  
  ORDER BY 
    p.created_at DESC
  LIMIT limit_count;
END; $$;

GRANT EXECUTE ON FUNCTION core.dashboard_app_users_detailed(int, text, text) TO authenticated, service_role;


-- 2. Update detail function
DROP FUNCTION IF EXISTS core.dashboard_user_detail(uuid);

CREATE FUNCTION core.dashboard_user_detail(target_user_id uuid)
RETURNS TABLE (
  -- Profile
  user_id uuid,
  full_name text,
  nickname text,
  email text,
  phone text,
  country text,
  language text,
  timezone text, -- ADICIONADO
  voice_preference text,
  driver_type text,
  
  -- Device
  last_platform text,
  last_device_model text,
  last_app_version text,
  
  -- Subscription
  subscription_tier_id uuid,
  subscription_tier_name text,
  subscription_tier_display_name text,
  subscription_provider text,
  subscription_start_date timestamptz,
  subscription_end_date timestamptz,
  is_premium boolean,
  
  -- Activity
  login_count int,
  last_sign_in_at timestamptz,
  created_at timestamptz,
  onboarding_completed boolean,
  
  -- Stats agregados
  trip_count bigint,
  total_km numeric,
  poi_visits_count bigint,
  unique_cities_visited bigint,
  last_trip_at timestamptz,
  
  -- Subscription history (JSON array)
  subscription_history jsonb
)
LANGUAGE plpgsql SECURITY DEFINER AS $$
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
    p.timezone, -- ADICIONADO
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
    ), '[]'::jsonb) as subscription_history
    
  FROM drive.profiles p
  LEFT JOIN auth.users au ON au.id = p.id
  LEFT JOIN drive.subscription_tiers st ON st.id = p.subscription_tier_id
  LEFT JOIN drive.trail_users_from_trips t ON t.user_id = p.id
  WHERE p.id = target_user_id;
END; $$;

GRANT EXECUTE ON FUNCTION core.dashboard_user_detail(uuid) TO authenticated, service_role;
