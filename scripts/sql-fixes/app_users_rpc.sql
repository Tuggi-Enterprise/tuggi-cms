-- ============================================================================
-- RPC: dashboard_app_users_detailed
-- Busca usuários do app com dados completos incluindo subscription tier
-- NOTA: Usa apenas colunas confirmadas existentes em drive.profiles
-- ============================================================================

-- Drop se existir
DROP FUNCTION IF EXISTS core.dashboard_app_users_detailed(int, text, text);

CREATE FUNCTION core.dashboard_app_users_detailed(
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
    p.country,
    p.language,
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
    (filter_country IS NULL OR p.country = filter_country)
    AND (filter_platform IS NULL OR p.last_platform = filter_platform)
  
  ORDER BY 
    t.last_trip DESC NULLS LAST, 
    p.last_sign_in_at DESC NULLS LAST,
    p.created_at DESC
  LIMIT limit_count;
END; $$;

-- Permissões
GRANT EXECUTE ON FUNCTION core.dashboard_app_users_detailed(int, text, text) TO authenticated, service_role;

-- ============================================================================
-- RPC: dashboard_subscription_stats
-- Estatísticas de assinaturas para o dashboard
-- ============================================================================

DROP FUNCTION IF EXISTS core.dashboard_subscription_stats();

CREATE FUNCTION core.dashboard_subscription_stats()
RETURNS TABLE (
  total_users bigint,
  free_users bigint,
  premium_users bigint,
  premium_percentage numeric,
  -- Por provider
  apple_subscriptions bigint,
  google_subscriptions bigint,
  stripe_subscriptions bigint,
  -- Por tier
  tiers_breakdown jsonb,
  -- Recentes
  new_subscriptions_7d bigint,
  churned_7d bigint
)
LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  free_tier_id uuid := '984a7cd3-c937-4218-842a-9c5fdf824f25';
BEGIN
  RETURN QUERY
  SELECT 
    -- Totais
    (SELECT COUNT(*) FROM drive.profiles)::bigint as total_users,
    (SELECT COUNT(*) FROM drive.profiles WHERE subscription_tier_id IS NULL OR subscription_tier_id = free_tier_id)::bigint as free_users,
    (SELECT COUNT(*) FROM drive.profiles WHERE subscription_tier_id IS NOT NULL AND subscription_tier_id != free_tier_id)::bigint as premium_users,
    ROUND(
      (SELECT COUNT(*)::numeric FROM drive.profiles WHERE subscription_tier_id IS NOT NULL AND subscription_tier_id != free_tier_id) /
      NULLIF((SELECT COUNT(*)::numeric FROM drive.profiles), 0) * 100,
      1
    ) as premium_percentage,
    
    -- Por provider
    (SELECT COUNT(*) FROM drive.profiles WHERE subscription_provider = 'apple')::bigint as apple_subscriptions,
    (SELECT COUNT(*) FROM drive.profiles WHERE subscription_provider = 'google')::bigint as google_subscriptions,
    (SELECT COUNT(*) FROM drive.profiles WHERE subscription_provider = 'stripe')::bigint as stripe_subscriptions,
    
    -- Breakdown por tier
    (SELECT COALESCE(jsonb_agg(jsonb_build_object(
      'tier_id', st.id,
      'tier_name', st.display_name,
      'count', COALESCE(user_counts.cnt, 0)
    )), '[]'::jsonb)
    FROM drive.subscription_tiers st
    LEFT JOIN (
      SELECT subscription_tier_id, COUNT(*) as cnt 
      FROM drive.profiles 
      WHERE subscription_tier_id IS NOT NULL
      GROUP BY subscription_tier_id
    ) user_counts ON user_counts.subscription_tier_id = st.id
    WHERE st.is_active = true
    ) as tiers_breakdown,
    
    -- Novas assinaturas (últimos 7 dias no history)
    (SELECT COUNT(*) FROM drive.subscription_history 
     WHERE action = 'subscribe' AND created_at > NOW() - INTERVAL '7 days')::bigint as new_subscriptions_7d,
    
    -- Churned (últimos 7 dias no history)
    (SELECT COUNT(*) FROM drive.subscription_history 
     WHERE action IN ('cancel', 'expire', 'churn') AND created_at > NOW() - INTERVAL '7 days')::bigint as churned_7d;
END; $$;

GRANT EXECUTE ON FUNCTION core.dashboard_subscription_stats() TO authenticated, service_role;

-- ============================================================================
-- RPC: dashboard_user_detail
-- Detalhe completo de um usuário específico (para o modal)
-- VERSÃO SIMPLIFICADA - usa apenas colunas confirmadas
-- ============================================================================

DROP FUNCTION IF EXISTS core.dashboard_user_detail(uuid);

CREATE FUNCTION core.dashboard_user_detail(target_user_id uuid)
RETURNS TABLE (
  -- Profile
  user_id uuid,
  full_name text,
  nickname text,
  email text,
  country text,
  language text,
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
    p.country,
    p.language,
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

-- ============================================================================
-- Feedback de conclusão
-- ============================================================================
SELECT 'RPCs de App Users criadas com sucesso!' as resultado;
