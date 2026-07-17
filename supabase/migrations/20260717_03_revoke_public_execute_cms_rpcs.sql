-- ============================================================================
-- Migration: fechar o segundo caminho de exposição — GRANT ... TO PUBLIC
-- Date: 2026-07-17
-- Complementa: 20260717_02_identity_ssot_and_scope_hardening.sql
--
-- POR QUE ESTA EXISTE
-- -------------------
-- Depois de aplicar a 02, a verificação mostrou que 3 das 4 funções continuavam
-- alcançáveis pelo anon:
--
--   cms_list_pois        anon_ainda_pode = true
--   cms_poi_facets       anon_ainda_pode = true
--   cms_search_pois_map  anon_ainda_pode = true
--   dashboard_user_location_pins  = false   ← só esta fechou
--
-- Causa: existem DOIS caminhos de exposição, e a 02 só fechou um.
--
--   ACL de cms_list_pois:                {=X/postgres, postgres=X/…, authenticated=X/…, service_role=X/…}
--                                         ^^^^^^^^^^^ grant para PUBLIC (role vazio antes do '=')
--   ACL de dashboard_user_location_pins: {postgres=X/…, authenticated=X/…, service_role=X/…}
--
--   Caminho 1: ALTER DEFAULT PRIVILEGES → grant EXPLÍCITO ao anon.  Fecha com REVOKE FROM anon.
--   Caminho 2: GRANT ... TO PUBLIC       → anon herda (todo role é membro de PUBLIC).
--                                          Fecha SÓ com REVOKE FROM PUBLIC.
--
-- dashboard_user_location_pins fechou porque a migration original dela já fazia
-- "REVOKE ALL ... FROM PUBLIC" — faltava apenas tirar o anon, e a 02 fez isso.
-- Nas outras 3 faltavam os dois. Revogar do anon sem revogar de PUBLIC não fecha nada.
--
-- ⚠️ APLICAR MANUALMENTE NO PAINEL. NUNCA DDL via CLI.
-- ============================================================================

-- Assinaturas geradas de pg_get_function_identity_arguments (autoritativas).
REVOKE EXECUTE ON FUNCTION core.cms_list_pois(search_term text, status_filter text, country_filter text, state_filter text, city_filter text, google_types_filter text, category_filter text, osm_category_filter text, content_status_filter text, group_status_filter text, score_filter text, trigger_points_filter text, limit_count integer, offset_count integer, fetch_all boolean, owner_id uuid, is_active_filter text, p_before_created_at timestamp with time zone, p_before_id uuid, priority_filter integer) FROM PUBLIC;

REVOKE EXECUTE ON FUNCTION core.cms_poi_facets(search_term text, status_filter text, country_filter text, state_filter text, city_filter text, google_types_filter text, category_filter text, osm_category_filter text, content_status_filter text, group_status_filter text, score_filter text, trigger_points_filter text, owner_id uuid, is_active_filter text, priority_filter integer) FROM PUBLIC;

REVOKE EXECUTE ON FUNCTION core.cms_search_pois_map(min_lat double precision, min_lng double precision, max_lat double precision, max_lng double precision, zoom_level integer, search_term text, status_filter text, country_filter text, state_filter text, city_filter text, p_owner_id uuid, is_active_filter text) FROM PUBLIC;

-- Garantir que quem PRECISA continua com acesso.
-- (O CMS chama estas 3 do browser com sessão => authenticated; e de API routes => service_role.
--  O app NÃO as chama — verificado por grep em tuggi-drive-v2: zero ocorrências.)
GRANT EXECUTE ON FUNCTION core.cms_list_pois(search_term text, status_filter text, country_filter text, state_filter text, city_filter text, google_types_filter text, category_filter text, osm_category_filter text, content_status_filter text, group_status_filter text, score_filter text, trigger_points_filter text, limit_count integer, offset_count integer, fetch_all boolean, owner_id uuid, is_active_filter text, p_before_created_at timestamp with time zone, p_before_id uuid, priority_filter integer) TO authenticated, service_role;

GRANT EXECUTE ON FUNCTION core.cms_poi_facets(search_term text, status_filter text, country_filter text, state_filter text, city_filter text, google_types_filter text, category_filter text, osm_category_filter text, content_status_filter text, group_status_filter text, score_filter text, trigger_points_filter text, owner_id uuid, is_active_filter text, priority_filter integer) TO authenticated, service_role;

GRANT EXECUTE ON FUNCTION core.cms_search_pois_map(min_lat double precision, min_lng double precision, max_lat double precision, max_lng double precision, zoom_level integer, search_term text, status_filter text, country_filter text, state_filter text, city_filter text, p_owner_id uuid, is_active_filter text) TO authenticated, service_role;

NOTIFY pgrst, 'reload schema';

-- ============================================================================
-- VERIFICAÇÃO
-- ============================================================================
--   SELECT p.proname, has_function_privilege('anon', p.oid,'EXECUTE') AS anon_ainda_pode
--     FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
--    WHERE n.nspname='core'
--      AND p.proname IN ('cms_list_pois','cms_poi_facets','cms_search_pois_map',
--                        'dashboard_user_location_pins');
--   -- as 4 devem ser false
--
-- NB: estas 3 continuam com a GUC inválida no corpo (escopo desligado para
-- authenticated). O REVOKE tira o anon; o escopo em si só é corrigido quando o
-- corpo delas for reescrito com core.resolve_dashboard_scope(). Ver 0.2 do plano.
-- Restam 11 funções em core com 'request.jwt.claims.email'.
