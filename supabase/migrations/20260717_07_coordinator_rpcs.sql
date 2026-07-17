-- ============================================================================
-- Migration: RPCs de leitura do coordenador — FASE 2
-- Date: 2026-07-17
-- Depende de: 20260717_02 (SSOT), 20260717_05 (sessão direta), 20260717_06 (hierarquia)
--
-- OBJETIVO
-- --------
-- O painel do coordenador: consolidado (ele + filhas) e breakdown POR EMPRESA dos
-- cadastros do app atribuídos via QR.
--
-- DECISÃO DE PRODUTO: só agregado/anônimo. Sem PII, sem lista nominal, sem mapa de pins.
--   - NÃO reusar core.dashboard_user_location_pins (devolve nickname + lat/lng por usuário).
--   - NÃO reusar a métrica 12 de dashboard_user_analytics (upcoming_expirations traz full_name).
--
-- POR QUE CONTAR AO VIVO EM drive.profiles E NÃO USAR drive.mv_user_monthly_stats:
--   `grep -rn "mv_user_monthly_stats" supabase/ lib/` → ZERO. A MV só existe em produção,
--   sem definição versionada neste repo e sem cron de refresh auditável. O número-manchete
--   do coordenador não pode sair de uma view cujo frescor ninguém consegue verificar.
--   Com 224 profiles / 6 clients, contar ao vivo é grátis e sempre correto.
--
-- ⚠️ APLICAR MANUALMENTE NO PAINEL. NUNCA DDL via CLI.
-- ============================================================================


-- ============================================================================
-- 1. BREAKDOWN POR EMPRESA
-- ============================================================================
CREATE OR REPLACE FUNCTION core.coordinator_child_breakdown(p_root uuid DEFAULT NULL)
RETURNS TABLE (
  client_id uuid,
  company_name text,
  slug text,
  status text,
  is_root boolean,
  qr_url text,
  signups bigint,
  mau_30d bigint,
  premium_users bigint,
  last_signup_at timestamptz
)
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path = core, public, extensions
AS $$
DECLARE
  v_scope uuid[] := core.resolve_dashboard_scope(p_root);  -- fail-closed + valida IDOR
  v_free  uuid   := '984a7cd3-c937-4218-842a-9c5fdf824f25';
BEGIN
  -- Admin global (p_root NULL) não faz sentido aqui: este painel é sempre de UM guarda-chuva.
  IF v_scope IS NULL THEN
    RAISE EXCEPTION 'coordinator_child_breakdown requer um p_root (client raiz)'
      USING ERRCODE = '22023';
  END IF;

  RETURN QUERY
  SELECT
    c.id,
    c.company_name::text,
    c.slug::text,
    c.status::text,
    (c.parent_client_id IS NULL) AS is_root,
    -- Mesma URL que components/admin/clients/shared/ClientQrCode.tsx renderiza.
    CASE WHEN c.slug IS NOT NULL AND c.slug <> ''
         THEN 'https://www.tuggi.app/d/' || c.slug
         ELSE 'https://www.tuggi.app/download?ID=' || c.id::text
    END AS qr_url,
    count(p.id)                                                        AS signups,
    count(p.id) FILTER (WHERE p.last_sign_in_at > now() - interval '30 days') AS mau_30d,
    count(p.id) FILTER (WHERE p.subscription_tier_id IS NOT NULL
                          AND p.subscription_tier_id <> v_free)        AS premium_users,
    max(p.created_at)                                                  AS last_signup_at
  FROM core.clients c
  -- LEFT JOIN de propósito: uma filha com ZERO cadastros PRECISA aparecer na lista —
  -- é justamente o caso que o coordenador precisa ver para agir.
  LEFT JOIN drive.profiles p ON p.partner_id = c.id
  WHERE c.id = ANY(v_scope)
  GROUP BY c.id, c.company_name, c.slug, c.status, c.parent_client_id
  ORDER BY (c.parent_client_id IS NULL) DESC, count(p.id) DESC, c.company_name;
END;
$$;

COMMENT ON FUNCTION core.coordinator_child_breakdown(uuid) IS
  'Cadastros do app por empresa do guarda-chuva (o coordenador + filhas). Só agregado — sem PII. Conta ao vivo em drive.profiles (a MV mv_user_monthly_stats não é versionada neste repo).';


-- ============================================================================
-- 2. SÉRIE TEMPORAL DE CADASTROS (consolidado do guarda-chuva)
-- ============================================================================
CREATE OR REPLACE FUNCTION core.coordinator_signup_timeseries(
  p_root uuid DEFAULT NULL,
  p_months integer DEFAULT 12
)
RETURNS TABLE (month text, signups bigint, cumulative bigint)
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path = core, public, extensions
AS $$
DECLARE
  v_scope uuid[] := core.resolve_dashboard_scope(p_root);
BEGIN
  IF v_scope IS NULL THEN
    RAISE EXCEPTION 'coordinator_signup_timeseries requer um p_root'
      USING ERRCODE = '22023';
  END IF;

  RETURN QUERY
  WITH por_mes AS (
    SELECT to_char(date_trunc('month', p.created_at), 'YYYY-MM') AS m,
           count(*) AS n
      FROM drive.profiles p
     WHERE p.partner_id = ANY(v_scope)
       AND p.created_at > now() - (GREATEST(1, LEAST(p_months, 36)) || ' months')::interval
     GROUP BY 1
  )
  SELECT m, n, SUM(n) OVER (ORDER BY m)::bigint
    FROM por_mes
   ORDER BY m;
END;
$$;


-- ============================================================================
-- 3. DISTRIBUIÇÃO POR CIDADE — COM PISO DE k-ANONIMATO
-- ============================================================================
-- "Agregado" não é "anônimo" quando N é pequeno: 1 cadastro + cidade + mês = uma pessoa
-- identificada. Com 23 usuários atribuídos hoje, PRATICAMENTE TODO bucket tem N<5 — sem
-- este piso, a promessa de "só agregado/anônimo" estaria quebrada no dia 1.
CREATE OR REPLACE FUNCTION core.coordinator_city_breakdown(
  p_root uuid DEFAULT NULL,
  p_min_bucket integer DEFAULT 5   -- k. Abaixo disso, colapsa em "Outras".
)
RETURNS TABLE (city text, country text, signups bigint, suppressed boolean)
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path = core, public, extensions
AS $$
DECLARE
  v_scope uuid[] := core.resolve_dashboard_scope(p_root);
  v_k integer := GREATEST(1, p_min_bucket);
BEGIN
  IF v_scope IS NULL THEN
    RAISE EXCEPTION 'coordinator_city_breakdown requer um p_root'
      USING ERRCODE = '22023';
  END IF;

  RETURN QUERY
  WITH base AS (
    SELECT COALESCE(NULLIF(TRIM(p.city), ''), 'Desconhecida') AS ct,
           COALESCE(NULLIF(TRIM(p.country), ''), '—')         AS cy,
           count(*) AS n
      FROM drive.profiles p
     WHERE p.partner_id = ANY(v_scope)
     GROUP BY 1, 2
  )
  SELECT ct, cy, n, false FROM base WHERE n >= v_k
  UNION ALL
  SELECT 'Outras', '—', COALESCE(SUM(n), 0), true FROM base WHERE n < v_k
  HAVING COALESCE(SUM(n), 0) > 0
  ORDER BY 4, 3 DESC;
END;
$$;

COMMENT ON FUNCTION core.coordinator_city_breakdown(uuid, integer) IS
  'Cadastros por cidade no guarda-chuva, com piso de k-anonimato (default k=5): buckets menores colapsam em "Outras". Impede re-identificação com N pequeno.';


-- ============================================================================
-- 4. GRANTS — nunca anon
-- ============================================================================
REVOKE ALL ON FUNCTION core.coordinator_child_breakdown(uuid)          FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION core.coordinator_signup_timeseries(uuid, integer) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION core.coordinator_city_breakdown(uuid, integer)  FROM PUBLIC, anon;

GRANT EXECUTE ON FUNCTION core.coordinator_child_breakdown(uuid)          TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION core.coordinator_signup_timeseries(uuid, integer) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION core.coordinator_city_breakdown(uuid, integer)  TO authenticated, service_role;

NOTIFY pgrst, 'reload schema';


-- ============================================================================
-- VERIFICAÇÃO (no painel — a sessão direta é admin; ver migration 05)
-- ============================================================================
-- Cenário temporário, desfeito pelo ROLLBACK:
--
  BEGIN;
  UPDATE core.clients SET is_coordinator = true WHERE slug = 'tuggi-demo';
  UPDATE core.clients SET parent_client_id = (SELECT id FROM core.clients WHERE slug='tuggi-demo')
   WHERE slug IN ('torel-boutiques','masana-algarve');

  SELECT company_name, is_root, signups, mau_30d, qr_url
    FROM core.coordinator_child_breakdown('fa4d408c-2f67-475e-81d8-72456d221690');
--   -- esperado 3 linhas:
--   --   Tuggi Demo      is_root=true   signups=0   ← o coordenador aparece com o dele
--   --   Torel Boutiques is_root=false  signups=2
--   --   Masana Algarve  is_root=false  signups=1
--   -- e o qr_url de cada uma = https://www.tuggi.app/d/<slug>
--
  SELECT * FROM core.coordinator_city_breakdown('fa4d408c-2f67-475e-81d8-72456d221690');
  -- com N pequeno, TUDO deve colapsar em ('Outras','—',3,true).
  -- Se aparecer o nome de uma cidade com 1 cadastro, o k-anonimato falhou.

  ROLLBACK;
--
-- Negativo (exige caller não-admin no browser):
--   rpc('coordinator_child_breakdown', { p_root: '<client fora do guarda-chuva>' })
--   -- esperado: 42501 'forbidden: owner out of scope'
