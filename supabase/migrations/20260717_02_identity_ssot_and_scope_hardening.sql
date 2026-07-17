-- ============================================================================
-- Migration: SSOT de identidade + endurecimento do escopo (FASE 0 — BLOQUEANTE)
-- Date: 2026-07-17
--
-- POR QUE ISTO EXISTE
-- -------------------
-- O escopo whitelabel do CMS nunca funcionou. 12 funções resolvem identidade com
--
--     current_setting('request.jwt.claims.email', true)
--
-- e esse nome de GUC NÃO EXISTE em nenhuma versão do PostgREST. O formato real é
-- 'request.jwt.claim.email' (singular, v7) ou o JSON 'request.jwt.claims' (v9+).
-- O que está no código é um híbrido inválido → retorna NULL para todo caller.
-- Não há db-pre-request hook que a popule (verificado em pg_db_role_setting).
--
-- Consequência, verificada em produção:
--   caller_cms_id := NULL  →  IF NOT is_admin AND caller_cms_id IS NOT NULL  → FALSE
--                          →  ELSE target_owner_id := p_owner_id  → NULL
--                          →  WHERE (target_owner_id IS NULL OR ...)  → FILTRO DESLIGADO
--
--   core.dashboard_user_location_pins(NULL, 20000) devolvia 96 linhas
--   drive.profiles com coordenada                   = 96 linhas   → 100% da base.
--
-- Origem do padrão: scripts/archive-sql/patch_dashboard_rpc_scope.sql — o patch que
-- vinha "consertar o escopo" propagou a GUC inválida + o fail-open para as 12.
--
-- O banco JÁ tem o padrão correto em uso: core.is_active_cms_admin() usa
-- auth.jwt() ->> 'email' e funciona. Esta migration adota isso como SSOT.
--
-- ⚠️ APLICAR MANUALMENTE NO PAINEL SQL. NUNCA DDL via CLI (regra do projeto).
-- ⚠️ Os blocos 1–4 formam UMA unidade. Aplicar o bloco 3 (identidade correta) sem o
--    bloco 2 (validação de p_owner_id ∈ escopo) ARMA um IDOR: p_owner_id é controlado
--    pelo caller e hoje só é inofensivo PORQUE a identidade nunca resolve.
-- ============================================================================


-- ============================================================================
-- 1. SSOT DE IDENTIDADE (fail-closed)
-- ============================================================================

-- Email do caller. auth.jwt() já faz o coalesce dos dois formatos válidos.
-- NULL = caller sem identidade (anon, ou service_role, cujo JWT não tem email).
CREATE OR REPLACE FUNCTION core.caller_email()
RETURNS text
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = core, public, extensions, pg_temp
AS $$
  SELECT NULLIF(auth.jwt() ->> 'email', '');
$$;

COMMENT ON FUNCTION core.caller_email() IS
  'SSOT do email do caller. Usa auth.jwt() (formato correto). NUNCA usar current_setting(''request.jwt.claims.email'') — essa GUC não existe e retorna NULL sempre.';

-- service_role = chamadas de servidor (API routes com getSupabaseService()), confiáveis.
-- Sem isto, o fail-closed abaixo quebraria toda rota que usa service role.
CREATE OR REPLACE FUNCTION core.is_caller_service_role()
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = core, public, extensions, pg_temp
AS $$
  SELECT COALESCE(auth.jwt() ->> 'role', '') = 'service_role';
$$;

-- Admin da plataforma (Tuggi). NB: o CHECK de cms_users.role só aceita
-- ('admin','editor','viewer','client') — 'super_admin' é impossível, por isso
-- não aparece aqui (o código TS que o testa é morto).
CREATE OR REPLACE FUNCTION core.is_caller_platform_admin()
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = core, public, extensions, pg_temp
AS $$
  SELECT core.is_caller_service_role()
      OR EXISTS (
        SELECT 1 FROM core.cms_users cu
         WHERE cu.email = core.caller_email()
           AND cu.is_active
           AND cu.role = 'admin'
      );
$$;


-- ============================================================================
-- 2. ESCOPO DE CLIENTS
-- ============================================================================

-- Escopo de um client. NA FASE 0 é só ele mesmo (parent_client_id ainda não existe).
-- A FASE 1 substitui por uma CTE RECURSIVE — as call sites NÃO mudam, e é por isso
-- que esta função existe já agora em vez de um "= caller_client_id" inline.
CREATE OR REPLACE FUNCTION core.client_scope_ids(p_root uuid)
RETURNS TABLE (client_id uuid)
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = core, public, extensions, pg_temp
AS $$
  SELECT c.id FROM core.clients c WHERE c.id = p_root;
$$;

COMMENT ON FUNCTION core.client_scope_ids(uuid) IS
  'Escopo de um client (ele + descendentes). FASE 0: só ele. FASE 1 troca por RECURSIVE com o limite de 2 níveis no trigger.';

-- Raízes do caller. Via client_cms_users (o vínculo VIVO: 5 linhas / 3 clients) +
-- clients.cms_user_id (legado). NUNCA via cms_users.client_id: está NULL em 9/9 dos
-- usuários role='client' e, sendo escalar, não representa o N:N real.
CREATE OR REPLACE FUNCTION core.caller_client_ids()
RETURNS TABLE (client_id uuid)
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = core, public, extensions, pg_temp
AS $$
  WITH me AS (
    SELECT cu.id FROM core.cms_users cu
     WHERE cu.email = core.caller_email() AND cu.is_active
  ), roots AS (
    SELECT ccu.client_id FROM core.client_cms_users ccu JOIN me ON ccu.cms_user_id = me.id
    UNION
    SELECT c.id FROM core.clients c JOIN me ON c.cms_user_id = me.id
  )
  SELECT DISTINCT s.client_id
    FROM roots r, LATERAL core.client_scope_ids(r.client_id) s;
$$;

-- Guarda usada por TODA dashboard_*. Retorna o array de clients que o caller pode ver.
-- NULL = sem filtro (só admin/service_role chega a isso).
CREATE OR REPLACE FUNCTION core.resolve_dashboard_scope(p_owner_id uuid)
RETURNS uuid[]
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path = core, public, extensions, pg_temp
AS $$
DECLARE
  v_scope uuid[];
BEGIN
  IF core.is_caller_platform_admin() THEN
    IF p_owner_id IS NULL THEN
      RETURN NULL;                        -- admin sem filtro = visão global (intencional)
    END IF;
    RETURN ARRAY(SELECT s.client_id FROM core.client_scope_ids(p_owner_id) s);
  END IF;

  v_scope := ARRAY(SELECT c.client_id FROM core.caller_client_ids() c);

  -- FAIL CLOSED. O código antigo fazia o oposto: sem identidade => sem filtro => tudo.
  IF v_scope IS NULL OR cardinality(v_scope) = 0 THEN
    RAISE EXCEPTION 'forbidden: caller has no client scope' USING ERRCODE = '42501';
  END IF;

  IF p_owner_id IS NULL THEN
    RETURN v_scope;
  END IF;

  -- Fecha o IDOR: p_owner_id é controlado pelo caller e precisa estar DENTRO do escopo.
  IF NOT (p_owner_id = ANY(v_scope)) THEN
    RAISE EXCEPTION 'forbidden: owner out of scope' USING ERRCODE = '42501';
  END IF;

  RETURN ARRAY(SELECT s.client_id FROM core.client_scope_ids(p_owner_id) s);
END;
$$;

REVOKE ALL ON FUNCTION core.caller_email()             FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION core.is_caller_service_role()   FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION core.is_caller_platform_admin() FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION core.client_scope_ids(uuid)     FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION core.caller_client_ids()        FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION core.resolve_dashboard_scope(uuid) FROM PUBLIC, anon;

GRANT EXECUTE ON FUNCTION core.caller_email()             TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION core.is_caller_service_role()   TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION core.is_caller_platform_admin() TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION core.client_scope_ids(uuid)     TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION core.caller_client_ids()        TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION core.resolve_dashboard_scope(uuid) TO authenticated, service_role;


-- ============================================================================
-- 3. dashboard_user_location_pins — a mais crítica (PII de localização)
-- ============================================================================
-- Devolvia 96/96 linhas (nickname + lat/lng exatos) para QUALQUER caller, inclusive
-- anon. Reescrita com identidade correta + escopo validado + fail-closed.
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
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path TO 'core', 'public', 'extensions'
AS $$
DECLARE
  v_scope uuid[] := core.resolve_dashboard_scope(p_owner_id);  -- levanta 42501 se fora do escopo
  v_free_tier uuid := '984a7cd3-c937-4218-842a-9c5fdf824f25';
BEGIN
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
    AND (v_scope IS NULL OR p.partner_id = ANY(v_scope))
  ORDER BY p.last_sign_in_at DESC NULLS LAST
  LIMIT GREATEST(1, LEAST(p_limit, 20000));
END;
$$;


-- ============================================================================
-- 4. REVOKE do anon nas funções alcançáveis sem login
-- ============================================================================
-- Estas 4 tinham EXECUTE para anon apesar de as migrations fazerem
-- "REVOKE ALL FROM PUBLIC" — porque PUBLIC ≠ anon (ver bloco 5).
-- Assinaturas geradas a partir de pg_get_function_identity_arguments (autoritativas):
-- um tipo errado faria o REVOKE falhar por "function does not exist".
REVOKE EXECUTE ON FUNCTION core.dashboard_user_location_pins(p_owner_id uuid, p_limit integer) FROM anon;

REVOKE EXECUTE ON FUNCTION core.cms_list_pois(search_term text, status_filter text, country_filter text, state_filter text, city_filter text, google_types_filter text, category_filter text, osm_category_filter text, content_status_filter text, group_status_filter text, score_filter text, trigger_points_filter text, limit_count integer, offset_count integer, fetch_all boolean, owner_id uuid, is_active_filter text, p_before_created_at timestamp with time zone, p_before_id uuid, priority_filter integer) FROM anon;

REVOKE EXECUTE ON FUNCTION core.cms_poi_facets(search_term text, status_filter text, country_filter text, state_filter text, city_filter text, google_types_filter text, category_filter text, osm_category_filter text, content_status_filter text, group_status_filter text, score_filter text, trigger_points_filter text, owner_id uuid, is_active_filter text, priority_filter integer) FROM anon;

REVOKE EXECUTE ON FUNCTION core.cms_search_pois_map(min_lat double precision, min_lng double precision, max_lat double precision, max_lng double precision, zoom_level integer, search_term text, status_filter text, country_filter text, state_filter text, city_filter text, p_owner_id uuid, is_active_filter text) FROM anon;


-- ============================================================================
-- 5. A CAUSA-RAIZ: default privileges concedendo EXECUTE ao anon
-- ============================================================================
-- pg_default_acl tem, para o schema core (objtype 'f'):
--   {postgres=X/postgres, anon=X/postgres, authenticated=X/postgres, service_role=X/postgres}
--
-- Ou seja: TODA função criada em core nasce executável por anon. É por isso que o
-- "REVOKE ALL ON FUNCTION ... FROM PUBLIC" das migrations não protegeu nada — PUBLIC
-- e anon são coisas diferentes, e o default privilege já concedeu ao anon antes.
-- Hoje: 78 funções de core (70 SECURITY DEFINER) alcançáveis por anon; 36 em drive; 7 em marketing.
--
-- Sem corrigir isto, todo RPC novo — inclusive os do coordenador (Fase 2) — nasce aberto.
--
-- ⚠️⚠️ MUDANÇA DE PROCESSO — LEIA ANTES DE APLICAR ⚠️⚠️
--
-- Isto NÃO quebra nada hoje: default privileges valem só para objetos FUTUROS; as 121
-- funções existentes ficam exatamente como estão. O app (tuggi-drive-v2) foi verificado
-- e NÃO chama nenhuma das 12 funções com escopo quebrado — os conjuntos são disjuntos.
--
-- MAS, a partir daqui, toda função NOVA em core/drive nasce FECHADA para anon. E o app
-- depende de anon de verdade: get_latest_app_version (splash), get_user_by_email (login),
-- opt_into_region_waitlist (waitlist sem cadastro), app_get_nearby_* — todas hoje anon=true.
--
-- ⇒ Quem criar um RPC que o app chama ANTES do login DEVE agora conceder explicitamente:
--       GRANT EXECUTE ON FUNCTION drive.minha_funcao_nova(...) TO anon;
--    Esquecer isso quebra o app em produção com "permission denied for function", e o
--    sintoma não parece um default privilege — parece qualquer outra coisa. Avisar o time
--    do app antes de aplicar.
--
-- Se preferir um passo menor agora: aplique só em `core` (schema do CMS, onde está o
-- vazamento) e deixe `drive` (schema do app) para uma janela combinada com o time do app.
ALTER DEFAULT PRIVILEGES IN SCHEMA core      REVOKE EXECUTE ON FUNCTIONS FROM anon;
ALTER DEFAULT PRIVILEGES IN SCHEMA drive     REVOKE EXECUTE ON FUNCTIONS FROM anon;
ALTER DEFAULT PRIVILEGES IN SCHEMA marketing REVOKE EXECUTE ON FUNCTIONS FROM anon;

-- NB: as 121 já expostas exigem auditoria caso a caso — várias são legitimamente
-- públicas (a landing /d/<slug> lê clients como anon; o app lê POIs sem login).
-- Ver o levantamento no bloco de verificação (item 6).

NOTIFY pgrst, 'reload schema';


-- ============================================================================
-- VERIFICAÇÃO (rodar depois de aplicar)
-- ============================================================================
-- 1) A identidade agora resolve? (como authenticated, NÃO no editor SQL — lá não há JWT)
--      SELECT core.caller_email();                 -- deve devolver seu email
--      SELECT core.is_caller_platform_admin();     -- true para admin Tuggi
--
-- 2) O vazamento fechou?
--      SELECT count(*) FROM core.dashboard_user_location_pins(NULL, 20000);
--      -- admin: 96 (visão global, intencional)
--      -- client: só os profiles do partner dele
--      -- sem identidade: ERRO 42501  ← antes devolvia 96
--
-- 3) O IDOR fechou?
--      SELECT * FROM core.dashboard_user_location_pins('<uuid de outro client>', 10);
--      -- deve levantar 42501 'forbidden: owner out of scope'
--
-- 4) O anon perdeu o acesso?
--      SELECT has_function_privilege('anon', 'core.dashboard_user_location_pins(uuid,integer)', 'EXECUTE');
--      -- deve ser false
--
-- 5) Funções futuras nascem fechadas?
--      SELECT defaclacl::text FROM pg_default_acl d
--       JOIN pg_namespace n ON n.oid=d.defaclnamespace
--       WHERE n.nspname='core' AND d.defaclobjtype='f';
--      -- não deve mais conter anon=X
--
-- 6) Auditoria pendente — as demais funções ainda abertas ao anon:
--      SELECT n.nspname||'.'||p.proname, p.prosecdef
--        FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
--       WHERE n.nspname IN ('core','drive','marketing')
--         AND has_function_privilege('anon', p.oid,'EXECUTE')
--       ORDER BY 1;
