-- ============================================================================
-- Migration: corrigir o escopo das 3 dashboard_* restantes
-- Date: 2026-07-17
-- Depende de: 20260717_02_identity_ssot_and_scope_hardening.sql (SSOT já aplicado)
--
-- CONTEXTO
-- --------
-- A 02 corrigiu dashboard_user_location_pins e a 03 tirou o anon das 4 expostas.
-- O vazamento SEM LOGIN está fechado. Estas 3 ainda resolvem identidade com a GUC
-- inválida 'request.jwt.claims.email' → escopo desligado para qualquer authenticated
-- (o mesmo role dos 224 usuários do app, não só dos 13 do CMS).
--
-- MUDANÇA: só o bloco de identidade + o predicado de filtro. Todo o resto do corpo é
-- verbatim do pg_get_functiondef() — nenhuma métrica, join, ordenação ou limite muda.
--
--   ANTES:  caller_cms_id := ... current_setting('request.jwt.claims.email')  → NULL sempre
--           IF NOT is_admin AND caller_cms_id IS NOT NULL THEN ... ELSE target := p_owner_id
--           WHERE (target_owner_id IS NULL OR x = target_owner_id)   → filtro desligado
--
--   DEPOIS: v_scope := core.resolve_dashboard_scope(p_owner_id)   → fail-closed + valida IDOR
--           WHERE (v_scope IS NULL OR x = ANY(v_scope))           → NULL só para admin
--
-- ESPAÇO DE IDENTIDADE (verificado, não presumido):
--   drive.profiles.partner_id        → clients.id  (21/23 casam com clients, 0 com cms_users)
--   core.mv_geographic_stats.owner_id → clients.id  (98.313/98.313 casam com clients, 0 com cms_users)
--                                       (a MV agrega core.attractions.owner_id)
--   Ambos no MESMO espaço → resolve_dashboard_scope serve aos 3 sem tradução.
--
-- ⚠️ APLICAR MANUALMENTE NO PAINEL. NUNCA DDL via CLI.
-- ============================================================================


-- ============================================================================
-- 1. dashboard_country_stats
-- ============================================================================
CREATE OR REPLACE FUNCTION core.dashboard_country_stats(p_owner_id uuid DEFAULT NULL::uuid)
 RETURNS TABLE(country text, poi_count bigint, city_count bigint, approved_count bigint)
 LANGUAGE plpgsql
 STABLE
 SECURITY DEFINER
 SET search_path = core, public, extensions
AS $function$
DECLARE
  v_scope uuid[] := core.resolve_dashboard_scope(p_owner_id);  -- 42501 se fora do escopo
BEGIN
  RETURN QUERY
  SELECT
    gs.country,
    SUM(gs.poi_count)::bigint as poi_count,
    COUNT(DISTINCT gs.city)::bigint as city_count,
    SUM(gs.approved_count)::bigint as approved_count
  FROM core.mv_geographic_stats gs
  WHERE (v_scope IS NULL OR gs.owner_id = ANY(v_scope))
  GROUP BY gs.country
  ORDER BY poi_count DESC;
END;
$function$;


-- ============================================================================
-- 2. dashboard_city_stats
-- ============================================================================
CREATE OR REPLACE FUNCTION core.dashboard_city_stats(p_owner_id uuid DEFAULT NULL::uuid)
 RETURNS TABLE(city text, country text, poi_count bigint, approved_count bigint, pending_count bigint)
 LANGUAGE plpgsql
 STABLE
 SECURITY DEFINER
 SET search_path = core, public, extensions
AS $function$
DECLARE
  v_scope uuid[] := core.resolve_dashboard_scope(p_owner_id);
BEGIN
  RETURN QUERY
  SELECT
    gs.city,
    gs.country,
    SUM(gs.poi_count)::bigint as poi_count,
    SUM(gs.approved_count)::bigint as approved_count,
    SUM(gs.pending_count)::bigint as pending_count
  FROM core.mv_geographic_stats gs
  WHERE (v_scope IS NULL OR gs.owner_id = ANY(v_scope))
  GROUP BY gs.city, gs.country
  ORDER BY poi_count DESC
  LIMIT 50;
END;
$function$;


-- ============================================================================
-- 3. dashboard_user_analytics
-- ============================================================================
-- 12 métricas, todas escopadas por p.partner_id / mv_user_monthly_stats.owner_id.
-- Corpo verbatim, exceto o predicado repetido em cada subquery.
CREATE OR REPLACE FUNCTION core.dashboard_user_analytics(p_owner_id uuid DEFAULT NULL::uuid)
 RETURNS TABLE(total_users bigint, active_users_30d bigint, total_trips bigint, total_km_driven numeric, total_poi_visits bigint, total_audio_plays bigint, avg_trip_duration text, trips_by_platform jsonb, mau_history jsonb, user_growth jsonb, total_premium_users bigint, upcoming_expirations jsonb)
 LANGUAGE plpgsql
 STABLE
 SECURITY DEFINER
 SET search_path = core, public, extensions
AS $function$
DECLARE
  v_scope uuid[] := core.resolve_dashboard_scope(p_owner_id);
  free_tier_id uuid := '984a7cd3-c937-4218-842a-9c5fdf824f25';
BEGIN
  RETURN QUERY SELECT
    -- 1. TOTAL USERS (Fast lookup from profiles)
    (SELECT COUNT(*)::bigint FROM drive.profiles p
     WHERE (v_scope IS NULL OR p.partner_id = ANY(v_scope))) AS total_users,

    -- 2. ACTIVE USERS (MAU 30d)
    (SELECT COUNT(*)::bigint FROM drive.profiles p
     WHERE p.last_sign_in_at > NOW() - INTERVAL '30 days'
       AND (v_scope IS NULL OR p.partner_id = ANY(v_scope))) AS active_users_30d,

    -- 3. TOTAL TRIPS
    (SELECT COUNT(*)::bigint FROM drive.trail_trips_unified t
     INNER JOIN drive.profiles p ON t.user_id = p.id
     WHERE (v_scope IS NULL OR p.partner_id = ANY(v_scope))) AS total_trips,

    -- 4. TOTAL KM
    (SELECT COALESCE(SUM(distance_km), 0)::numeric FROM drive.trail_trips_unified t
     INNER JOIN drive.profiles p ON t.user_id = p.id
     WHERE (v_scope IS NULL OR p.partner_id = ANY(v_scope))) AS total_km_driven,

    -- 5. TOTAL POI VISITS
    (SELECT COUNT(*)::bigint FROM drive.poi_visits v
     INNER JOIN drive.profiles p ON v.user_id = p.id
     WHERE (v_scope IS NULL OR p.partner_id = ANY(v_scope))) AS total_poi_visits,

    -- 6. TOTAL AUDIO PLAYS
    (SELECT COUNT(*)::bigint FROM drive.poi_visits v
     INNER JOIN drive.profiles p ON v.user_id = p.id
     WHERE v.audio_played = true
       AND (v_scope IS NULL OR p.partner_id = ANY(v_scope))) AS total_audio_plays,

    -- 7. AVG TRIP DURATION
    (SELECT COALESCE(ROUND(AVG(duration_minutes))::text, '0') || ' min'
     FROM drive.trail_trips_unified t
     INNER JOIN drive.profiles p ON t.user_id = p.id
     WHERE t.duration_minutes > 0
       AND (v_scope IS NULL OR p.partner_id = ANY(v_scope))) AS avg_trip_duration,

    -- 8. TRIPS BY PLATFORM
    (SELECT COALESCE(jsonb_agg(jsonb_build_object('platform', platform, 'count', cnt)), '[]'::jsonb)
     FROM (
       SELECT COALESCE(p.last_platform, 'unknown') as platform, COUNT(t.trip_session_id) as cnt
       FROM drive.trail_trips_unified t
       LEFT JOIN drive.profiles p ON t.user_id = p.id
       WHERE (v_scope IS NULL OR p.partner_id = ANY(v_scope))
       GROUP BY p.last_platform
       ORDER BY cnt DESC
     ) sub) AS trips_by_platform,

    -- 9. MAU HISTORY (Optimized using View)
    (SELECT COALESCE(jsonb_agg(jsonb_build_object('date', month, 'count', mau)), '[]'::jsonb)
     FROM (
       SELECT month, SUM(mau)::int as mau
       FROM drive.mv_user_monthly_stats
       WHERE (v_scope IS NULL OR owner_id = ANY(v_scope))
       GROUP BY month
       ORDER BY month ASC
       LIMIT 12
     ) dau) AS mau_history,

    -- 10. USER GROWTH (Optimized using View)
    (SELECT COALESCE(jsonb_agg(jsonb_build_object('month', month, 'count', cumulative_users)), '[]'::jsonb)
     FROM (
       SELECT
         month,
         SUM(SUM(new_users)) OVER (ORDER BY month)::int as cumulative_users
       FROM drive.mv_user_monthly_stats
       WHERE (v_scope IS NULL OR owner_id = ANY(v_scope))
       GROUP BY month
       ORDER BY month ASC
     ) sub) AS user_growth,

    -- 11. TOTAL PREMIUM USERS
    (SELECT COUNT(*)::bigint FROM drive.profiles p
     WHERE p.subscription_tier_id IS NOT NULL
       AND p.subscription_tier_id != free_tier_id
       AND (v_scope IS NULL OR p.partner_id = ANY(v_scope))) AS total_premium_users,

    -- 12. UPCOMING EXPIRATIONS
    -- NB: devolve full_name (PII). Aceitável para admin/dono do próprio escopo; ao
    -- construir o painel do COORDENADOR (Fase 2), NÃO reusar esta métrica — a decisão
    -- de produto é "só agregado/anônimo". Ver o plano.
    (SELECT COALESCE(jsonb_agg(exp), '[]'::jsonb)
     FROM (
       SELECT
         p.id as user_id,
         COALESCE(p.full_name, 'Anonymous') as full_name,
         '' as email, -- Email removed for privacy/performance in summary
         'Premium' as tier_name,
         p.subscription_end_date as end_date
       FROM drive.profiles p
       WHERE p.subscription_tier_id IS NOT NULL
         AND p.subscription_tier_id != free_tier_id
         AND p.subscription_end_date IS NOT NULL
         AND p.subscription_end_date >= NOW()
         AND (v_scope IS NULL OR p.partner_id = ANY(v_scope))
       ORDER BY p.subscription_end_date ASC
       LIMIT 5
     ) exp) AS upcoming_expirations;
END;
$function$;


-- ============================================================================
-- 4. GRANTS — manter authenticated/service_role, nunca anon
-- ============================================================================
REVOKE ALL ON FUNCTION core.dashboard_country_stats(uuid)  FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION core.dashboard_city_stats(uuid)     FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION core.dashboard_user_analytics(uuid) FROM PUBLIC, anon;

GRANT EXECUTE ON FUNCTION core.dashboard_country_stats(uuid)  TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION core.dashboard_city_stats(uuid)     TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION core.dashboard_user_analytics(uuid) TO authenticated, service_role;

NOTIFY pgrst, 'reload schema';


-- ============================================================================
-- VERIFICAÇÃO
-- ============================================================================
-- 1) Nenhuma das 3 usa mais a GUC inválida:
--      SELECT p.proname FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
--       WHERE n.nspname='core' AND p.prosrc LIKE '%request.jwt.claims.email%'
--       ORDER BY 1;
--      -- as 3 dashboard_* devem ter sumido; restam os 8 cms_* (item 0.2e do plano)
--
-- 2) Admin continua com visão global (service_role conta como admin):
--      SELECT total_users FROM core.dashboard_user_analytics(NULL);   -- 224
--      SELECT count(*) FROM core.dashboard_country_stats(NULL);
--
-- 3) Escopo por client funciona:
--      SELECT total_users FROM core.dashboard_user_analytics('c63f0cda-4c9f-4b1b-82c8-7634d4fda2f0');
--      -- Torel Boutiques: 2   (era 224 antes — o filtro estava desligado)
--
-- 4) IDOR fechado (exige um caller NÃO-admin, no browser com sessão):
--      supabase.schema('core').rpc('dashboard_user_analytics', { p_owner_id: '<outro client>' })
--      -- deve dar 42501 'forbidden: owner out of scope'
--
-- 5) A Overview do admin não regrediu: abrir /dashboard como admin e conferir os KPIs.
