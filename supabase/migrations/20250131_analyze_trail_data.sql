-- Análise profunda dos dados na tabela route_trail
-- Execute este SQL para entender o que realmente existe no banco

-- ============================================================================
-- 1. ESTATÍSTICAS GERAIS
-- ============================================================================
SELECT 
  'Total de linhas' as metric,
  COUNT(*)::BIGINT as value
FROM drive.route_trail
UNION ALL
SELECT 
  'Usuários únicos' as metric,
  COUNT(DISTINCT user_id)::BIGINT as value
FROM drive.route_trail
UNION ALL
SELECT 
  'Trip sessions únicas' as metric,
  COUNT(DISTINCT trip_session_id)::BIGINT as value
FROM drive.route_trail
UNION ALL
SELECT 
  'Pontos em movimento' as metric,
  COUNT(*) FILTER (WHERE is_moving = true)::BIGINT as value
FROM drive.route_trail
UNION ALL
SELECT 
  'Pontos parados' as metric,
  COUNT(*) FILTER (WHERE is_moving = false OR is_moving IS NULL)::BIGINT as value
FROM drive.route_trail;

-- ============================================================================
-- 2. DISTRIBUIÇÃO POR USUÁRIO
-- ============================================================================
SELECT 
  user_id,
  COUNT(*) as total_points,
  COUNT(DISTINCT trip_session_id) as unique_trips,
  MIN(timestamp) as first_point,
  MAX(timestamp) as last_point,
  SUM(CASE WHEN is_moving THEN 1 ELSE 0 END) as moving_points,
  SUM(CASE WHEN is_moving = false OR is_moving IS NULL THEN 1 ELSE 0 END) as stationary_points
FROM drive.route_trail
GROUP BY user_id
ORDER BY total_points DESC;

-- ============================================================================
-- 3. DISTRIBUIÇÃO POR TRIP SESSION
-- ============================================================================
SELECT 
  trip_session_id,
  user_id,
  COUNT(*) as point_count,
  MIN(timestamp) as trip_start,
  MAX(timestamp) as trip_end,
  MIN(sequence_order) as min_sequence,
  MAX(sequence_order) as max_sequence,
  (EXTRACT(EPOCH FROM (MAX(timestamp) - MIN(timestamp))) / 60)::NUMERIC(10,2) as duration_minutes
FROM drive.route_trail
GROUP BY trip_session_id, user_id
ORDER BY point_count DESC
LIMIT 20;

-- ============================================================================
-- 4. VERIFICAR VIEW trail_trips_unified
-- ============================================================================
SELECT 
  COUNT(*) as total_unified_trips,
  COUNT(DISTINCT user_id) as unique_users,
  SUM(point_count) as total_points,
  AVG(point_count)::NUMERIC(10,2) as avg_points_per_trip,
  MIN(point_count) as min_points,
  MAX(point_count) as max_points
FROM drive.trail_trips_unified;

-- ============================================================================
-- 5. COMPARAR: route_trail vs trail_trips_unified
-- ============================================================================
SELECT 
  'route_trail (raw)' as source,
  COUNT(DISTINCT trip_session_id) as trip_sessions,
  COUNT(DISTINCT user_id) as unique_users,
  COUNT(*) as total_points
FROM drive.route_trail
UNION ALL
SELECT 
  'trail_trips_unified (view)' as source,
  COUNT(*) as trip_sessions,
  COUNT(DISTINCT user_id) as unique_users,
  SUM(point_count) as total_points
FROM drive.trail_trips_unified;

-- ============================================================================
-- 6. VERIFICAR SE HÁ TRIPS COM MUITOS PONTOS (possível problema de unificação)
-- ============================================================================
SELECT 
  trip_session_id,
  user_id,
  point_count,
  duration_minutes,
  trip_start,
  trip_end
FROM drive.trail_trips_unified
ORDER BY point_count DESC
LIMIT 10;

-- ============================================================================
-- 7. VERIFICAR RANGE DE DATAS
-- ============================================================================
SELECT 
  MIN(timestamp) as earliest_point,
  MAX(timestamp) as latest_point,
  (EXTRACT(EPOCH FROM (MAX(timestamp) - MIN(timestamp))) / 86400)::NUMERIC(10,2) as days_span
FROM drive.route_trail;

-- ============================================================================
-- 8. VERIFICAR SE HÁ DADOS DENTRO DO RANGE DE 30 DIAS (padrão do frontend)
-- ============================================================================
SELECT 
  COUNT(*) as points_last_30_days,
  COUNT(DISTINCT user_id) as users_last_30_days,
  COUNT(DISTINCT trip_session_id) as trips_last_30_days
FROM drive.route_trail
WHERE timestamp >= NOW() - INTERVAL '30 days';

-- ============================================================================
-- 9. VERIFICAR LIMITE DE 1000 ITENS (Supabase)
-- ============================================================================
-- Quantas trips existem? Se > 1000, precisamos de paginação
SELECT 
  CASE 
    WHEN COUNT(*) > 1000 THEN '⚠️ PRECISA PAGINAÇÃO - ' || COUNT(*)::TEXT || ' trips'
    ELSE '✅ OK - ' || COUNT(*)::TEXT || ' trips'
  END as pagination_status
FROM drive.trail_trips_unified;

