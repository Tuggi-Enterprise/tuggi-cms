-- ============================================================================
-- 20260615 — Simplifica os filtros de localização da /pois (perf + dedup)
-- ============================================================================
-- Problema: cms_get_states levava ~5s (borderline 8s). Causa: o WHERE
--   (is_platform_admin OR a.owner_id = caller) com is_platform_admin sendo
--   VARIÁVEL plpgsql gera plano genérico que não usa o índice de country.
-- Fix: ramificar — admin roda a query SEM o OR (usa índice); senão filtra owner.
--   (mesma simplificação aplicada ao cms_get_countries por robustez)
-- Também remove as versões órfãs sem p_category (o front sempre passa p_category;
--   eram só dívida/risco de overload).
-- Aplicar no painel. Idempotente.
-- ============================================================================

-- ── 1. Remover overloads órfãos (front chama sempre com p_category) ─────────
DROP FUNCTION IF EXISTS core.cms_get_states(text);
DROP FUNCTION IF EXISTS core.cms_get_cities(text, text);

-- ── 2. cms_get_states — ramificado (admin usa índice, ~130ms vs ~5s) ────────
CREATE OR REPLACE FUNCTION core.cms_get_states(country_name text, p_category text DEFAULT NULL)
 RETURNS TABLE(value text, label text, count bigint)
 LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'core','public','extensions'
AS $function$
DECLARE
  caller_client_id UUID; caller_role TEXT; is_platform_admin BOOLEAN := FALSE;
BEGIN
  BEGIN
    SELECT cu.client_id, cu.role INTO caller_client_id, caller_role
    FROM core.cms_users cu WHERE cu.email = current_setting('request.jwt.claims.email', true);
    IF caller_role IS NULL THEN is_platform_admin := TRUE;
    ELSE is_platform_admin := EXISTS (SELECT 1 FROM core.clients c WHERE c.id = caller_client_id AND c.is_platform_owner = TRUE)
                              AND (caller_role IN ('admin','super_admin'));
    END IF;
  EXCEPTION WHEN OTHERS THEN is_platform_admin := TRUE; END;

  IF is_platform_admin THEN
    RETURN QUERY
      SELECT a.state, a.state, COUNT(*)::BIGINT FROM core.attractions a
      WHERE a.country = country_name
        AND (p_category IS NULL OR a.category = p_category)
        AND a.state IS NOT NULL AND a.state <> ''
      GROUP BY a.state ORDER BY COUNT(*) DESC;
  ELSE
    RETURN QUERY
      SELECT a.state, a.state, COUNT(*)::BIGINT FROM core.attractions a
      WHERE a.owner_id = caller_client_id
        AND a.country = country_name
        AND (p_category IS NULL OR a.category = p_category)
        AND a.state IS NOT NULL AND a.state <> ''
      GROUP BY a.state ORDER BY COUNT(*) DESC;
  END IF;
END;
$function$;

-- ── 3. cms_get_countries — mesma ramificação (já rápido via índice; robustez) ─
CREATE OR REPLACE FUNCTION core.cms_get_countries(p_category text DEFAULT NULL)
 RETURNS TABLE(value text, label text, count bigint)
 LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'core','public','extensions'
AS $function$
DECLARE
  caller_client_id UUID; caller_role TEXT; is_platform_admin BOOLEAN := FALSE;
BEGIN
  BEGIN
    SELECT cu.client_id, cu.role INTO caller_client_id, caller_role
    FROM core.cms_users cu WHERE cu.email = current_setting('request.jwt.claims.email', true);
    IF caller_role IS NULL THEN is_platform_admin := TRUE;
    ELSE is_platform_admin := EXISTS (SELECT 1 FROM core.clients c WHERE c.id = caller_client_id AND c.is_platform_owner = TRUE)
                              AND (caller_role IN ('admin','super_admin'));
    END IF;
  EXCEPTION WHEN OTHERS THEN is_platform_admin := TRUE; END;

  IF is_platform_admin THEN
    RETURN QUERY
      SELECT a.country, a.country, COUNT(*)::BIGINT FROM core.attractions a
      WHERE (p_category IS NULL OR a.category = p_category)
        AND a.country IS NOT NULL AND a.country <> ''
      GROUP BY a.country ORDER BY COUNT(*) DESC;
  ELSE
    RETURN QUERY
      SELECT a.country, a.country, COUNT(*)::BIGINT FROM core.attractions a
      WHERE a.owner_id = caller_client_id
        AND (p_category IS NULL OR a.category = p_category)
        AND a.country IS NOT NULL AND a.country <> ''
      GROUP BY a.country ORDER BY COUNT(*) DESC;
  END IF;
END;
$function$;

NOTIFY pgrst, 'reload schema';
