-- ============================================================================
-- 20260615 — Limpeza e tuning a partir do diagnóstico do banco (jun/2026)
-- ============================================================================
-- DOCUMENTO/REGISTRO: todas as mudanças abaixo JÁ FORAM APLICADAS manualmente
-- no SQL Editor do Supabase (regra do projeto: DDL só via painel, nunca via CLI).
-- Esta migration existe para versionar o que foi feito e servir de roteiro
-- reaplicável. É idempotente (IF EXISTS / CREATE OR REPLACE).
--
-- Contexto do diagnóstico (instância ~2 GB RAM, banco ~10,7 GB → ~9,0 GB depois):
--   • core 7,7GB · homolog 2,7GB (staging, MANTIDO — migração em curso) · drive 283MB
--   • cache hit (heap) 90,7% → working set não cabe na RAM; alavancas = reduzir
--     volume (índices) + reduzir trabalho recorrente (cron).
--   • RLS 100% on, zero tabelas sem PK, public só com spatial_ref_sys → organização OK.
--
-- ⚠️ Os DROP INDEX originais foram feitos com CONCURRENTLY (sem lock) no painel.
--    Aqui usamos DROP INDEX IF EXISTS (sem CONCURRENTLY) só para registro/no-op,
--    pois CONCURRENTLY não roda dentro de transação de migration.
-- ============================================================================


-- ┌──────────────────────────────────────────────────────────────────────────┐
-- │ 1. LIMPEZA DE ÍNDICES  (~1,77 GB recuperados, sem regressão)              │
-- └──────────────────────────────────────────────────────────────────────────┘

-- 1A. Redundantes com constraint UNIQUE (a unique já provê índice idêntico) — ~76 MB
DROP INDEX IF EXISTS homolog.idx_coordinates_poi_uuid;                       -- coordinates_poi_uuid_unique
DROP INDEX IF EXISTS core.idx_attraction_coordinate_attraction_id_optimized; -- attraction_coordinate_attraction_id_key
DROP INDEX IF EXISTS core.idx_cache_narrations_hash;                          -- cache_narrations_pkey
DROP INDEX IF EXISTS drive.idx_poi_visit_analytics_poi_date;                  -- unique_poi_date_period
DROP INDEX IF EXISTS drive.idx_poi_scores_precomputed_poi;                    -- unique_poi_score
DROP INDEX IF EXISTS core.idx_attraction_group_members_attraction_id;         -- idx_unique_attraction_group_member
DROP INDEX IF EXISTS drive.idx_subscription_tiers_name;                       -- subscription_tiers_name_key
DROP INDEX IF EXISTS drive.idx_profiles_nickname;                             -- profiles_nickname_key
DROP INDEX IF EXISTS marketing.idx_notification_templates_name;               -- notification_templates_name_key
DROP INDEX IF EXISTS core.idx_clients_cms_user_id;                            -- clients_cms_user_id_key
DROP INDEX IF EXISTS core.idx_clients_email;                                  -- clients_email_key
DROP INDEX IF EXISTS core.idx_cms_users_email;                                -- cms_users_email_key
DROP INDEX IF EXISTS core.idx_countries_code;                                 -- countries_code_key
DROP INDEX IF EXISTS core.idx_city_source_search_configs_source;              -- city_source_search_configs_source_id_key
DROP INDEX IF EXISTS core.idx_pov_metrics_date;                              -- unique_date_period
DROP INDEX IF EXISTS drive.idx_user_preferences_user_id;                      -- user_preferences_user_unique
DROP INDEX IF EXISTS drive.idx_daily_audio_usage_user_date;                   -- daily_audio_usage_user_id_usage_date_key

-- 1B. Pares idênticos (mesmas colunas, ambos não-unique) — mantido o mais usado — ~18 MB
DROP INDEX IF EXISTS homolog.idx_homolog_pois_category;        -- == idx_pois_category
DROP INDEX IF EXISTS core.idx_audit_logs_action;               -- == idx_audit_logs_action_created_at
DROP INDEX IF EXISTS drive.idx_trip_session_attractions_session; -- == _session_id

-- 1C. Gêmeos espaciais/parciais — removido o pouco usado, mantido o cavalo de trabalho — ~777 MB
--     (⚠️ região da lição 57014: cada coluna manteve um índice espacial ativo)
DROP INDEX IF EXISTS core.idx_attraction_coordinate_location_geography_gist;  -- 3.559 scans; mantém _location_approved (71k scans)
DROP INDEX IF EXISTS core.idx_attraction_coordinate_spatial_discover;         -- 750 scans; mantém _viewport_v4 (102k scans)
DROP INDEX IF EXISTS core.idx_atp_location_active_gist;                       -- 8k scans (parcial is_active); mantém _location_gist (273k scans)

-- 1D. Índices FK de auditoria nunca usados (idx_scan=0) — ~118 MB
DROP INDEX IF EXISTS core.idx_atp_updated_by;
DROP INDEX IF EXISTS core.idx_atp_created_by;


-- ┌──────────────────────────────────────────────────────────────────────────┐
-- │ 2. CRON HTTP SÍNCRONO → ASSÍNCRONO (pg_net)                               │
-- │    Removeu ~10% do tempo TOTAL do banco: o Postgres ficava bloqueado      │
-- │    esperando a Edge Function via http() a cada minuto (jobs 21 e 41).     │
-- └──────────────────────────────────────────────────────────────────────────┘

CREATE OR REPLACE FUNCTION core.trigger_process_scheduled_notifications()
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'core', 'public', 'extensions', 'net'
AS $function$
DECLARE
  v_url text;
  v_key text;
BEGIN
  SELECT TRIM(decrypted_secret) INTO v_url
  FROM vault.decrypted_secrets WHERE name = 'SUPABASE_URL' LIMIT 1;
  SELECT TRIM(decrypted_secret) INTO v_key
  FROM vault.decrypted_secrets WHERE name = 'SERVICE_ROLE_KEY' LIMIT 1;

  IF v_url IS NULL OR v_key IS NULL THEN
    RAISE WARNING 'Falha ao disparar push: SUPABASE_URL ou SERVICE_ROLE_KEY ausentes no Vault.';
    RETURN;
  END IF;

  v_url := rtrim(v_url, '/') || '/functions/v1/firebase-push-notification/process-scheduled';

  -- assíncrono: retorna na hora, a Edge Function processa sozinha
  PERFORM net.http_post(
    url     := v_url,
    body    := '{}'::jsonb,
    headers := jsonb_build_object(
      'apikey',        v_key,
      'Authorization', 'Bearer ' || v_key,
      'Content-Type',  'application/json'
    )
  );
END;
$function$;

CREATE OR REPLACE FUNCTION marketing.trigger_process_scheduled_newsletters()
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'marketing', 'public', 'extensions', 'net'
AS $function$
DECLARE
  v_url text;
  v_key text;
BEGIN
  SELECT TRIM(decrypted_secret) INTO v_url
  FROM vault.decrypted_secrets WHERE name = 'SUPABASE_URL' LIMIT 1;
  SELECT TRIM(decrypted_secret) INTO v_key
  FROM vault.decrypted_secrets WHERE name = 'SERVICE_ROLE_KEY' LIMIT 1;

  IF v_url IS NULL OR v_key IS NULL THEN
    RAISE WARNING 'Skipping newsletter trigger: SUPABASE_URL ou SERVICE_ROLE_KEY ausentes no Vault.';
    RETURN;
  END IF;

  v_url := rtrim(v_url, '/') || '/functions/v1/send-newsletter/process-scheduled';

  PERFORM net.http_post(
    url     := v_url,
    body    := '{}'::jsonb,
    headers := jsonb_build_object(
      'apikey',        v_key,
      'Authorization', 'Bearer ' || v_key,
      'Content-Type',  'application/json'
    )
  );
END;
$function$;


-- ┌──────────────────────────────────────────────────────────────────────────┐
-- │ 3. CADÊNCIA DO CRON                                                        │
-- │    Decisão chave: o contador with_trigger_points_count varria os 7M de    │
-- │    attraction_trigger_points 2×/run só para um card de lista — não        │
-- │    precisava otimizar (work_mem/EXISTS), precisava rodar MENOS.            │
-- └──────────────────────────────────────────────────────────────────────────┘
-- Os jobids abaixo refletem o ambiente atual; ajuste se divergir.

-- 3A. Facets da lista de POIs: 30min → 4h  (varredura dos 7M: 96×/dia → 6×/dia)
SELECT cron.alter_job(42, schedule := '0 */4 * * *');

-- 3B. Dashboard funil/qualidade (mv_inventory_stats): 6h → 30min — o que mais muda na migração
SELECT cron.alter_job(36, schedule := '*/30 * * * *');

-- 3C. Dashboard analytics de usuário (mv_user_analytics_global + mv_country_stats): 10min → 5min
SELECT cron.alter_job(44, schedule := '*/5 * * * *');

-- 3D. City/country stats (mv_geographic_stats): refresh_geographic_stats() existia mas
--     NUNCA fora agendado → cards congelados. Agendado de hora em hora.
--     (idempotente: cron.schedule por jobname faz upsert)
SELECT cron.schedule('refresh-geographic-stats', '0 * * * *',
                     $$ SELECT core.refresh_geographic_stats(); $$);


-- ┌──────────────────────────────────────────────────────────────────────────┐
-- │ NOTAS (fora desta migration)                                              │
-- │  • VACUUM (ANALYZE) one-time em core.attractions,                          │
-- │    core.attraction_trigger_points, homolog.coordinates (dead 6–10%).      │
-- │  • homolog (2,7GB) MANTIDO — migração POI→core em curso.                   │
-- │  • Backlog se o facets voltar a doer com refresh frequente: reescrever     │
-- │    tp_agg das MVs como EXISTS + ALTER FUNCTION refresh_poi_list_facets     │
-- │    SET work_mem (medido: 13,6s→6,7s). Hoje desnecessário (roda a cada 4h). │
-- │  • work_mem=5MB causa disk-spill em agregações grandes; subir POR FUNÇÃO   │
-- │    nos refreshes pesados se necessário, nunca global (90 conns / 2GB RAM). │
-- └──────────────────────────────────────────────────────────────────────────┘
