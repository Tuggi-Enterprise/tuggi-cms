-- Migration: dashboard_waitlist_stats + dashboard_waitlist_pins (Dashboard refactor — Demanda)
-- Date: 2026-06-28
-- Description:
--   Agregações read-only sobre drive.region_waitlist para a Overview (KPI + painel
--   "Demanda por país") e para o report geography (funil pendente/notificado + pins no mapa).
--
--   region_waitlist = 1 pin por usuário capturado quando ele cai numa área sem POIs.
--   notified_at IS NULL  → demanda reprimida (ainda sem cobertura)
--   notified_at NOT NULL → convertido (já recebeu push "Tuggi chegou na sua região")
--
--   Funções no schema core (exposto no PostgREST), lendo drive.region_waitlist.
--   ⚠️ Rodar manualmente no painel SQL do Supabase (nunca DDL via CLI).

-- ============================================================
-- 1. Stats agregadas (KPI + funil + por país)
-- ============================================================
CREATE OR REPLACE FUNCTION core.dashboard_waitlist_stats()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'core', 'public', 'drive', 'extensions'
AS $$
DECLARE
  v_total bigint;
  v_pending bigint;
  v_notified bigint;
  v_by_country jsonb;
BEGIN
  SELECT
    COUNT(*),
    COUNT(*) FILTER (WHERE notified_at IS NULL),
    COUNT(*) FILTER (WHERE notified_at IS NOT NULL)
  INTO v_total, v_pending, v_notified
  FROM drive.region_waitlist;

  SELECT COALESCE(jsonb_agg(row_to_json(t)), '[]'::jsonb)
  INTO v_by_country
  FROM (
    SELECT
      COALESCE(country, 'Unknown') AS country,
      COUNT(*) FILTER (WHERE notified_at IS NULL)::bigint AS pending,
      COUNT(*) FILTER (WHERE notified_at IS NOT NULL)::bigint AS notified,
      COUNT(*)::bigint AS total
    FROM drive.region_waitlist
    GROUP BY COALESCE(country, 'Unknown')
    ORDER BY COUNT(*) FILTER (WHERE notified_at IS NULL) DESC, COUNT(*) DESC
    LIMIT 50
  ) t;

  RETURN jsonb_build_object(
    'total', v_total,
    'pending', v_pending,
    'notified', v_notified,
    'conversion_rate', CASE WHEN v_total > 0 THEN ROUND((v_notified::numeric / v_total) * 100, 1) ELSE 0 END,
    'by_country', v_by_country,
    'generated_at', NOW()
  );
END;
$$;

REVOKE ALL ON FUNCTION core.dashboard_waitlist_stats() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION core.dashboard_waitlist_stats() TO authenticated;
GRANT EXECUTE ON FUNCTION core.dashboard_waitlist_stats() TO service_role;

COMMENT ON FUNCTION core.dashboard_waitlist_stats() IS
  'Agrega drive.region_waitlist: pendente/notificado, taxa de conversão e por país. Usado no KPI/painel Demanda da Overview e no funil do report geography.';

-- ============================================================
-- 2. Pins para o mapa/lista de demanda (com nickname do usuário)
--    O país do waitlist é quase sempre nulo/UNKNOWN, então a UI usa
--    nickname + link de Google Maps (lat/lng) em vez de agrupar por país.
-- ============================================================
DROP FUNCTION IF EXISTS core.dashboard_waitlist_pins(integer, boolean);

CREATE OR REPLACE FUNCTION core.dashboard_waitlist_pins(
  p_limit integer DEFAULT 5000,
  p_only_pending boolean DEFAULT true
)
RETURNS TABLE (
  id uuid,
  latitude double precision,
  longitude double precision,
  country text,
  nickname text,
  notified boolean,
  created_at timestamptz
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'core', 'public', 'drive', 'extensions'
AS $$
BEGIN
  RETURN QUERY
  SELECT
    w.id,
    w.latitude,
    w.longitude,
    w.country,
    COALESCE(p.nickname, p.full_name, 'Viajante') AS nickname,
    (w.notified_at IS NOT NULL) AS notified,
    w.created_at
  FROM drive.region_waitlist w
  LEFT JOIN drive.profiles p ON p.id = w.user_id
  WHERE w.latitude IS NOT NULL
    AND w.longitude IS NOT NULL
    AND (NOT p_only_pending OR w.notified_at IS NULL)
  ORDER BY w.created_at DESC
  LIMIT GREATEST(1, LEAST(p_limit, 20000));
END;
$$;

REVOKE ALL ON FUNCTION core.dashboard_waitlist_pins(integer, boolean) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION core.dashboard_waitlist_pins(integer, boolean) TO authenticated;
GRANT EXECUTE ON FUNCTION core.dashboard_waitlist_pins(integer, boolean) TO service_role;

COMMENT ON FUNCTION core.dashboard_waitlist_pins(integer, boolean) IS
  'Pins de demanda (region_waitlist) para o mapa do report geography. p_only_pending=true traz só demanda reprimida.';
