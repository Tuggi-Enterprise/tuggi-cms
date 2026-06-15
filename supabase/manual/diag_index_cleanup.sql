-- ============================================================================
-- LIMPEZA DE ÍNDICES — gerado a partir do diagnóstico de 2026-06-15
-- Rodar no SQL Editor do Supabase. NÃO está em transação de propósito:
-- DROP INDEX CONCURRENTLY não pode rodar dentro de BEGIN/COMMIT.
-- Rode SEÇÃO POR SEÇÃO. Cada DROP usa CONCURRENTLY (não trava a tabela).
--
-- ⚠️ Lição 57014: NENHUM índice GiST/GIN é removido por "idx_scan=0".
--    A Seção C remove apenas GiST/btree REDUNDANTES (existe um gêmeo na MESMA
--    coluna que absorve a carga) — e ainda assim só após você conferir.
-- ============================================================================


-- ┌────────────────────────────────────────────────────────────────────────┐
-- │ SEÇÃO A — Redundantes com UNIQUE (100% seguro)                          │
-- │ A constraint UNIQUE já provê um índice idêntico na mesma coluna.        │
-- │ Recupera ~76 MB.                                                        │
-- └────────────────────────────────────────────────────────────────────────┘
DROP INDEX CONCURRENTLY IF EXISTS homolog.idx_coordinates_poi_uuid;                       -- 41 MB  (coordinates_poi_uuid_unique)
DROP INDEX CONCURRENTLY IF EXISTS core.idx_attraction_coordinate_attraction_id_optimized; -- 34 MB  (attraction_coordinate_attraction_id_key)
DROP INDEX CONCURRENTLY IF EXISTS core.idx_cache_narrations_hash;                          -- 208 kB (cache_narrations_pkey)
DROP INDEX CONCURRENTLY IF EXISTS drive.idx_poi_visit_analytics_poi_date;                  -- (unique_poi_date_period)
DROP INDEX CONCURRENTLY IF EXISTS drive.idx_poi_scores_precomputed_poi;                    -- (unique_poi_score)
DROP INDEX CONCURRENTLY IF EXISTS core.idx_attraction_group_members_attraction_id;         -- (idx_unique_attraction_group_member)
DROP INDEX CONCURRENTLY IF EXISTS drive.idx_subscription_tiers_name;                        -- (subscription_tiers_name_key)
DROP INDEX CONCURRENTLY IF EXISTS drive.idx_profiles_nickname;                              -- (profiles_nickname_key)
DROP INDEX CONCURRENTLY IF EXISTS marketing.idx_notification_templates_name;                -- (notification_templates_name_key)
DROP INDEX CONCURRENTLY IF EXISTS core.idx_clients_cms_user_id;                             -- (clients_cms_user_id_key)
DROP INDEX CONCURRENTLY IF EXISTS core.idx_clients_email;                                   -- (clients_email_key)
DROP INDEX CONCURRENTLY IF EXISTS core.idx_cms_users_email;                                 -- (cms_users_email_key)
DROP INDEX CONCURRENTLY IF EXISTS core.idx_countries_code;                                  -- (countries_code_key)
DROP INDEX CONCURRENTLY IF EXISTS core.idx_city_source_search_configs_source;               -- (city_source_search_configs_source_id_key)
DROP INDEX CONCURRENTLY IF EXISTS core.idx_pov_metrics_date;                                -- (unique_date_period)
DROP INDEX CONCURRENTLY IF EXISTS drive.idx_user_preferences_user_id;                       -- (user_preferences_user_unique)
DROP INDEX CONCURRENTLY IF EXISTS drive.idx_daily_audio_usage_user_date;                    -- (daily_audio_usage_user_id_usage_date_key)


-- ┌────────────────────────────────────────────────────────────────────────┐
-- │ SEÇÃO B — Pares idênticos (mesmas colunas, ambos não-unique)            │
-- │ Mantém o gêmeo mais usado/descritivo, dropa a cópia. ~18 MB.           │
-- └────────────────────────────────────────────────────────────────────────┘
DROP INDEX CONCURRENTLY IF EXISTS homolog.idx_homolog_pois_category;   -- == idx_pois_category (14 MB)
DROP INDEX CONCURRENTLY IF EXISTS core.idx_audit_logs_action;          -- == idx_audit_logs_action_created_at (4.4 MB)
DROP INDEX CONCURRENTLY IF EXISTS drive.idx_trip_session_attractions_session; -- == _session_id


-- ┌────────────────────────────────────────────────────────────────────────┐
-- │ SEÇÃO C — Gêmeos espaciais/parciais (ALTO GANHO ~777 MB) — CONFERIR    │
-- │ Em cada caso há DOIS índices na MESMA coluna; um gêmeo recebe a quase  │
-- │ totalidade dos scans e cobre o outro. Removo o POUCO usado.            │
-- │ ⚠️ Rode 1 por vez e observe a latência das telas de mapa/descoberta.  │
-- └────────────────────────────────────────────────────────────────────────┘

-- attraction_coordinate: GiST cheio (3.559 scans) vs parcial NOT NULL (71.072 scans).
-- O parcial cobre toda query espacial real (só geografia não-nula é consultada).
DROP INDEX CONCURRENTLY IF EXISTS core.idx_attraction_coordinate_location_geography_gist;  -- 88 MB, mantém ..._location_approved

-- attraction_coordinate: btree (lat,lng) cheio (750 scans) vs parcial NOT NULL (102.349 scans).
DROP INDEX CONCURRENTLY IF EXISTS core.idx_attraction_coordinate_spatial_discover;         -- 42 MB, mantém ..._viewport_v4

-- attraction_trigger_points: GiST parcial WHERE is_active (8.326 scans, 647 MB) vs
-- GiST cheio sobre location (272.937 scans, 562 MB). O cheio é o cavalo de trabalho
-- e atende também queries de TP ativo (is_active vira filtro). Maior ganho isolado.
-- ⚠️ Este é o mais sensível (engine de TP). Confirme no app que a latência de
--    disparo de TP não regride antes de considerar definitivo.
DROP INDEX CONCURRENTLY IF EXISTS core.idx_atp_location_active_gist;                        -- 647 MB, mantém ..._location_gist


-- ┌────────────────────────────────────────────────────────────────────────┐
-- │ SEÇÃO D — Índices FK de auditoria nunca usados (idx_scan=0)            │
-- │ Colunas created_by/updated_by no TP nunca filtradas. ~118 MB.          │
-- └────────────────────────────────────────────────────────────────────────┘
DROP INDEX CONCURRENTLY IF EXISTS core.idx_atp_updated_by;   -- 59 MB, 0 scans
DROP INDEX CONCURRENTLY IF EXISTS core.idx_atp_created_by;   -- 59 MB, 0 scans

-- Total potencial das 4 seções: ~990 MB
