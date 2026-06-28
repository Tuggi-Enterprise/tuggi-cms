-- Migration: dashboard_trip_duration_stats — duração de viagem ROBUSTA (mediana + média filtrada)
-- Date: 2026-06-28
-- Description:
--   O avg_trip_duration do dashboard_user_analytics usa AVG(duration_minutes) SEM filtrar
--   outliers, e drive.trail_trips_unified tem registros lixo (sessões que ficaram abertas /
--   fim de viagem errado), fazendo a média explodir (ex.: 64.510 min ≈ 44 dias).
--
--   Esta RPC entrega métricas confiáveis:
--     - median_minutes: mediana (não é afetada pelos outliers) → headline recomendado
--     - avg_minutes: média só de viagens plausíveis (1..600 min)
--     - outliers: quantas viagens foram descartadas (transparência do dado sujo)
--
--   ⚠️ Rodar manualmente no painel SQL do Supabase (nunca DDL via CLI).

CREATE OR REPLACE FUNCTION core.dashboard_trip_duration_stats(
  p_max_minutes integer DEFAULT 600  -- teto plausível (10h); acima disso = lixo
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'core', 'public', 'drive', 'extensions'
AS $$
DECLARE
  v_median numeric;
  v_avg numeric;
  v_valid bigint;
  v_outliers bigint;
BEGIN
  SELECT
    percentile_cont(0.5) WITHIN GROUP (ORDER BY duration_minutes),
    ROUND(AVG(duration_minutes), 1),
    COUNT(*)
  INTO v_median, v_avg, v_valid
  FROM drive.trail_trips_unified
  WHERE duration_minutes BETWEEN 1 AND p_max_minutes;

  SELECT COUNT(*) INTO v_outliers
  FROM drive.trail_trips_unified
  WHERE duration_minutes > p_max_minutes;

  RETURN jsonb_build_object(
    'median_minutes', COALESCE(ROUND(v_median, 1), 0),
    'avg_minutes', COALESCE(v_avg, 0),
    'valid_trips', COALESCE(v_valid, 0),
    'outliers', COALESCE(v_outliers, 0),
    'max_minutes', p_max_minutes
  );
END;
$$;

REVOKE ALL ON FUNCTION core.dashboard_trip_duration_stats(integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION core.dashboard_trip_duration_stats(integer) TO authenticated;
GRANT EXECUTE ON FUNCTION core.dashboard_trip_duration_stats(integer) TO service_role;

COMMENT ON FUNCTION core.dashboard_trip_duration_stats(integer) IS
  'Duração de viagem robusta: mediana + média filtrada (1..max_minutes), descartando outliers lixo de trail_trips_unified. Substitui o avg_trip_duration ingênuo.';
