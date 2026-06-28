-- Migration: dashboard_user_location_pins (Dashboard refactor — mapa-hero da Overview)
-- Date: 2026-06-28
-- Description:
--   Retorna a última posição conhecida de cada usuário (drive.profiles.latitude/longitude)
--   para o mapa "base de usuários" na Overview. O front cruza esses pins com o set de
--   ATIVOS (core.dashboard_realtime_activity → route_trail) por user_id e faz o pin piscar.
--
--   profiles.latitude/longitude é UMA posição por usuário (atualizada no login/sync),
--   então isto é leve. Cap via p_limit para proteger conforme a base cresce; clustering
--   adicional fica no cliente (MarkerClusterer) se necessário.
--
--   Padrão: schema core, SECURITY DEFINER, mesma resolução de identidade admin/owner
--   das demais dashboard_*. Escopo opcional por partner_id (profiles é multi-tenant).
--
--   ⚠️ Rodar manualmente no painel SQL do Supabase (nunca DDL via CLI).
--   Após criar, expor no PostgREST (schema core já exposto).

CREATE OR REPLACE FUNCTION core.dashboard_user_location_pins(
  p_owner_id uuid DEFAULT NULL,
  p_limit integer DEFAULT 5000
)
RETURNS TABLE (
  user_id uuid,
  latitude double precision,
  longitude double precision,
  country text,
  nickname text,
  last_platform text,
  last_sign_in_at timestamptz,
  is_premium boolean
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'core', 'public', 'extensions'
AS $$
DECLARE
  caller_cms_id uuid;
  is_admin boolean := false;
  target_owner_id uuid;
  v_free_tier uuid := '984a7cd3-c937-4218-842a-9c5fdf824f25';
BEGIN
  -- Resolve identidade (padrão de segurança Tuggi)
  BEGIN
    caller_cms_id := (SELECT cu.id FROM core.cms_users cu WHERE cu.email = current_setting('request.jwt.claims.email', true));
    is_admin := EXISTS (
      SELECT 1 FROM core.cms_users cu
      WHERE cu.email = current_setting('request.jwt.claims.email', true)
      AND cu.role IN ('admin','super_admin')
    );
  EXCEPTION WHEN OTHERS THEN
    is_admin := TRUE;
  END;

  IF NOT is_admin AND caller_cms_id IS NOT NULL THEN
    target_owner_id := COALESCE(p_owner_id, caller_cms_id);
  ELSE
    target_owner_id := p_owner_id;
  END IF;

  RETURN QUERY
  SELECT
    p.id AS user_id,
    p.latitude,
    p.longitude,
    p.country,
    COALESCE(p.nickname, p.full_name, 'Anonymous') AS nickname,
    p.last_platform,
    p.last_sign_in_at,
    (p.subscription_tier_id IS NOT NULL AND p.subscription_tier_id <> v_free_tier) AS is_premium
  FROM drive.profiles p
  WHERE p.latitude IS NOT NULL
    AND p.longitude IS NOT NULL
    AND (target_owner_id IS NULL OR p.partner_id = target_owner_id)
  ORDER BY p.last_sign_in_at DESC NULLS LAST
  LIMIT GREATEST(1, LEAST(p_limit, 20000));
END;
$$;

REVOKE ALL ON FUNCTION core.dashboard_user_location_pins(uuid, integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION core.dashboard_user_location_pins(uuid, integer) TO authenticated;
GRANT EXECUTE ON FUNCTION core.dashboard_user_location_pins(uuid, integer) TO service_role;

COMMENT ON FUNCTION core.dashboard_user_location_pins(uuid, integer) IS
  'Última posição conhecida (profiles.lat/lng) de cada usuário para o mapa-hero da Overview. Front cruza com dashboard_realtime_activity para o pin ativo piscar.';
