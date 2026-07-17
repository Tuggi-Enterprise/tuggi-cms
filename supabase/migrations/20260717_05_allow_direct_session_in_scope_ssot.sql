-- ============================================================================
-- Migration: permitir sessão direta (painel/psql/cron) no SSOT de escopo
-- Date: 2026-07-17
-- Corrige: 20260717_02_identity_ssot_and_scope_hardening.sql
--
-- O PROBLEMA
-- ----------
-- Testar no editor SQL do painel dá:
--
--   ERROR: 42501: forbidden: caller has no client scope
--   CONTEXT: PL/pgSQL function resolve_dashboard_scope(uuid) line 16 at RAISE
--            PL/pgSQL function dashboard_user_analytics(uuid) line 3
--
-- O fail-closed está funcionando — mas o editor do painel roda numa SESSÃO DIRETA,
-- sem JWT: auth.jwt() é NULL → não é service_role → sem email → escopo vazio → 42501.
-- Idem para psql e para pg_cron (que roda como `postgres`).
--
-- POR QUE LIBERAR NÃO REDUZ SEGURANÇA
-- -----------------------------------
-- Quem abre sessão direta já lê tudo, independentemente destas funções:
--
--   role                       rolcanlogin   rolbypassrls
--   ----                       -----------   ------------
--   anon / authenticated /
--   service_role               false         false          ← NUNCA são session_user
--   authenticator (PostgREST)  true          false
--   postgres                   true          TRUE           ← ignora RLS
--   supabase_admin             true          TRUE           ← ignora RLS (superuser)
--   supabase_read_only_user    true          TRUE           ← ignora RLS
--
-- Os roles web não conseguem conectar (rolcanlogin=false), então jamais aparecem em
-- session_user. Os que conectam já têm rolbypassrls=true — bloqueá-los aqui é teatro:
-- basta um SELECT direto na tabela. O PostgREST sempre conecta como `authenticator`
-- e faz SET ROLE, então a distinção é limpa e não colide.
--
-- ⚠️ APLICAR MANUALMENTE NO PAINEL. NUNCA DDL via CLI.
-- ============================================================================

-- Sessão direta ao Postgres: painel SQL, psql, pg_cron. Whitelist explícita em vez de
-- "session_user <> 'authenticator'" para não abrir espaço a um role futuro com LOGIN.
CREATE OR REPLACE FUNCTION core.is_caller_direct_session()
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = core, public, extensions, pg_temp
AS $$
  SELECT session_user IN ('postgres', 'supabase_admin', 'supabase_read_only_user');
$$;

COMMENT ON FUNCTION core.is_caller_direct_session() IS
  'true quando a chamada vem de uma sessão direta (painel SQL/psql/pg_cron) em vez do PostgREST (que conecta como authenticator). Esses roles têm rolbypassrls=true e já leem tudo — tratá-los como confiáveis não amplia acesso, só evita 42501 em cron e no painel.';

-- Passa a considerar a sessão direta. service_role continua confiável (API routes).
CREATE OR REPLACE FUNCTION core.is_caller_platform_admin()
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = core, public, extensions, pg_temp
AS $$
  SELECT core.is_caller_service_role()
      OR core.is_caller_direct_session()
      OR EXISTS (
        SELECT 1 FROM core.cms_users cu
         WHERE cu.email = core.caller_email()
           AND cu.is_active
           AND cu.role = 'admin'
      );
$$;

REVOKE ALL ON FUNCTION core.is_caller_direct_session() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION core.is_caller_direct_session() TO authenticated, service_role;

NOTIFY pgrst, 'reload schema';


-- ============================================================================
-- VERIFICAÇÃO — agora dá para rodar TUDO isto direto no painel
-- ============================================================================
-- 1) A sessão do painel é reconhecida:
--      SELECT session_user, core.is_caller_direct_session(), core.is_caller_platform_admin();
--      -- postgres | true | true
--
-- 2) Visão global do admin (o teste que falhou com 42501):
--      SELECT total_users FROM core.dashboard_user_analytics(NULL);
--      -- 224
--
-- 3) ⭐ O TESTE QUE IMPORTA — o escopo por client passou a funcionar?
--      SELECT total_users FROM core.dashboard_user_analytics('c63f0cda-4c9f-4b1b-82c8-7634d4fda2f0');
--      -- Torel Boutiques: 2      (antes da 04 dava 224 — o filtro estava desligado)
--      SELECT total_users FROM core.dashboard_user_analytics('65671d87-320f-44b5-95c4-406375b0a292');
--      -- BenSaude: 0
--      SELECT total_users FROM core.dashboard_user_analytics('8be94d35-282d-46bf-bc12-6fcd2f83a432');
--      -- Tuggi: 18
--      -- A soma tem de bater com: SELECT partner_id, count(*) FROM drive.profiles
--      --                           WHERE partner_id IS NOT NULL GROUP BY 1;
--
-- 4) Pins com escopo:
--      SELECT count(*) FROM core.dashboard_user_location_pins(NULL, 20000);      -- 96 (global, admin)
--      SELECT count(*) FROM core.dashboard_user_location_pins('c63f0cda-4c9f-4b1b-82c8-7634d4fda2f0', 20000);
--      -- só os de Torel
--
-- NB: o IDOR e o fail-closed NÃO são testáveis no painel — a sessão direta é admin por
-- desenho. Esses dois exigem um caller não-admin com sessão real (browser, item 0.5/portão):
--      supabase.schema('core').rpc('dashboard_user_analytics', { p_owner_id: '<outro client>' })
--      -- esperado: 42501 'forbidden: owner out of scope'
