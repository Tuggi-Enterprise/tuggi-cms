-- ============================================================================
-- CAUSA RAIZ do Disk I/O: ~4,5 GB de índices NUNCA usados (idx_scan = 0) sendo
-- reescritos em todo INSERT/UPDATE/DELETE. Dropar reduz write amplification direto.
--
-- Curadoria baseada em pg_stat_user_indexes (consultas B e C). Só inclui:
--   - idx_scan = 0 (nunca usados para leitura)
--   - NÃO-únicos e NÃO-PK (constraints de unicidade preservadas)
--   - não são índices novos que entram em uso pós-deploy do cutover
--
-- ⚠️ Um DROP INDEX CONCURRENTLY por vez (fora de transação; não bloqueia escrita).
--    Se houver janela de baixo tráfego, pode trocar por "DROP INDEX" simples (mais
--    rápido), mas com a migração rodando o CONCURRENTLY é mais seguro.
--
-- ⚠️ Reset de stats: idx_scan é acumulado. Estes têm 0 há tempo e/ou são versões
--    legadas (_v2/_v4/_optimized/_search) — seguros. Os índices do cutover novo
--    (created_at_id, name_trgm, *_created, category_*) foram PRESERVADOS.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. attraction_trigger_points (4,73M linhas) — MAIOR GANHO (~3,5 GB, writer #2).
--    Mantidos (em uso): idx_trigger_points_attraction_id (10.8M scans),
--    pkey, idx_atp_location_active_gist (8239), attraction_active_priority (2357),
--    location_gist (101), type_priority (14), approved_active (5), final_status (4).
-- ----------------------------------------------------------------------------
DROP INDEX CONCURRENTLY IF EXISTS core.idx_trigger_points_spatial_walk;
DROP INDEX CONCURRENTLY IF EXISTS core.idx_trigger_points_spatial_car;
DROP INDEX CONCURRENTLY IF EXISTS core.idx_trigger_points_active_location;
DROP INDEX CONCURRENTLY IF EXISTS core.idx_trigger_points_active_type_location_v2;
DROP INDEX CONCURRENTLY IF EXISTS core.idx_trigger_points_location;
DROP INDEX CONCURRENTLY IF EXISTS core.idx_attraction_trigger_points_location_active;
DROP INDEX CONCURRENTLY IF EXISTS core.idx_attraction_trigger_points_location_gist;
DROP INDEX CONCURRENTLY IF EXISTS core.idx_trigger_points_priority_location_v2;
DROP INDEX CONCURRENTLY IF EXISTS core.idx_trigger_points_attraction_active_type_priority;
DROP INDEX CONCURRENTLY IF EXISTS core.idx_trigger_points_confidence;
DROP INDEX CONCURRENTLY IF EXISTS core.idx_trigger_points_active_priority;
DROP INDEX CONCURRENTLY IF EXISTS core.idx_attraction_trigger_points_attraction_id_optimized;
DROP INDEX CONCURRENTLY IF EXISTS core.idx_attraction_trigger_points_active_priority_optimized;
DROP INDEX CONCURRENTLY IF EXISTS core.idx_attraction_trigger_points_type_priority_active;
DROP INDEX CONCURRENTLY IF EXISTS core.idx_trigger_points_auto_status;
DROP INDEX CONCURRENTLY IF EXISTS core.idx_trigger_points_access;
DROP INDEX CONCURRENTLY IF EXISTS core.idx_trigger_points_active_access_priority;

-- ----------------------------------------------------------------------------
-- 2. attraction_coordinate (640k) — attraction_id redundante + boundary/geography
--    sem uso + meu lat_lng (redundante com viewport_v4/location_approved).
--    Mantidos: idx_attraction_coordinate_attraction_id_optimized (759M scans!),
--    viewport_v4 (102k), location_approved (61k), pkey, attraction_id_key (unique),
--    location_geography_gist (3385), spatial_discover (705).
-- ----------------------------------------------------------------------------
DROP INDEX CONCURRENTLY IF EXISTS core.idx_attraction_coordinate_attraction_id;       -- redundante
DROP INDEX CONCURRENTLY IF EXISTS core.idx_attraction_coordinate_lat_lng;             -- meu, redundante
DROP INDEX CONCURRENTLY IF EXISTS core.idx_attraction_coordinate_boundary_geometry;
DROP INDEX CONCURRENTLY IF EXISTS core.idx_attraction_coordinate_geography_v2;
DROP INDEX CONCURRENTLY IF EXISTS core.idx_attraction_coordinate_location_geography;  -- mantém o _gist
DROP INDEX CONCURRENTLY IF EXISTS core.idx_attraction_coordinate_boundary_metadata;
DROP INDEX CONCURRENTLY IF EXISTS core.idx_attraction_coordinate_boundary_confidence;
DROP INDEX CONCURRENTLY IF EXISTS core.idx_attraction_coordinate_boundary_source;
DROP INDEX CONCURRENTLY IF EXISTS core.idx_attraction_coordinate_boundary_type;
DROP INDEX CONCURRENTLY IF EXISTS core.idx_attractions_near_sao_paulo_v4;
DROP INDEX CONCURRENTLY IF EXISTS core.idx_attractions_near_rio_v4;

-- ----------------------------------------------------------------------------
-- 3. attraction_descriptions — poucos sem uso.
--    Mantidos: attraction_lang (30.5M), poi_lang (3.7M), pkey, attraction_id (104k),
--    audio_check (16k), unique(lang,gender) (36k), etc.
-- ----------------------------------------------------------------------------
DROP INDEX CONCURRENTLY IF EXISTS core.idx_attraction_descriptions_attraction_audio;
DROP INDEX CONCURRENTLY IF EXISTS core.idx_descriptions_original_updated;
DROP INDEX CONCURRENTLY IF EXISTS core.idx_descriptions_created_at_tokens;

-- ----------------------------------------------------------------------------
-- 4. attractions — ~40 índices legados sem uso (~800 MB). NÃO inclui constraints
--    únicas (*_key) nem os índices do cutover novo.
-- ----------------------------------------------------------------------------
DROP INDEX CONCURRENTLY IF EXISTS core.idx_attractions_city_rating_optimized;
DROP INDEX CONCURRENTLY IF EXISTS core.idx_attractions_planner_optimize;
DROP INDEX CONCURRENTLY IF EXISTS core.idx_attractions_name_gin_search;
DROP INDEX CONCURRENTLY IF EXISTS core.idx_attractions_destination_search;
DROP INDEX CONCURRENTLY IF EXISTS core.idx_attractions_city_rating;
DROP INDEX CONCURRENTLY IF EXISTS core.idx_attractions_approved_category;
DROP INDEX CONCURRENTLY IF EXISTS core.idx_attractions_last_processed_at;
DROP INDEX CONCURRENTLY IF EXISTS core.idx_attractions_photogenic_score;
DROP INDEX CONCURRENTLY IF EXISTS core.idx_attractions_verification;
DROP INDEX CONCURRENTLY IF EXISTS core.idx_attractions_category_rating;
DROP INDEX CONCURRENTLY IF EXISTS core.idx_attractions_approved_pov_quality;
DROP INDEX CONCURRENTLY IF EXISTS core.idx_attractions_approved_location;
DROP INDEX CONCURRENTLY IF EXISTS core.idx_attractions_full_address;
DROP INDEX CONCURRENTLY IF EXISTS core.idx_attractions_website;
DROP INDEX CONCURRENTLY IF EXISTS core.idx_attractions_street_name;
DROP INDEX CONCURRENTLY IF EXISTS core.idx_attractions_postal_code;
DROP INDEX CONCURRENTLY IF EXISTS core.idx_attractions_operator_name;
DROP INDEX CONCURRENTLY IF EXISTS core.idx_attractions_city_category;
DROP INDEX CONCURRENTLY IF EXISTS core.idx_attractions_city_category_optimized;
DROP INDEX CONCURRENTLY IF EXISTS core.idx_attractions_contact_phone;
DROP INDEX CONCURRENTLY IF EXISTS core.idx_attractions_neighborhood;
DROP INDEX CONCURRENTLY IF EXISTS core.idx_attractions_image_source;
DROP INDEX CONCURRENTLY IF EXISTS core.idx_attractions_heritage_status;
DROP INDEX CONCURRENTLY IF EXISTS core.idx_attractions_is_complete;
DROP INDEX CONCURRENTLY IF EXISTS core.idx_attractions_user_ratings_total;
DROP INDEX CONCURRENTLY IF EXISTS core.idx_attractions_business_status;
DROP INDEX CONCURRENTLY IF EXISTS core.idx_attractions_wheelchair_accessible;
DROP INDEX CONCURRENTLY IF EXISTS core.idx_attractions_cultural_significance;
DROP INDEX CONCURRENTLY IF EXISTS core.idx_attractions_thumbnail_url;
DROP INDEX CONCURRENTLY IF EXISTS core.idx_attractions_park_type;
DROP INDEX CONCURRENTLY IF EXISTS core.idx_attractions_museum_type;
DROP INDEX CONCURRENTLY IF EXISTS core.idx_attractions_monument_type;
DROP INDEX CONCURRENTLY IF EXISTS core.idx_attractions_landmark_type;
DROP INDEX CONCURRENTLY IF EXISTS core.idx_attractions_premium;
DROP INDEX CONCURRENTLY IF EXISTS core.idx_attractions_osm_wikidata;
DROP INDEX CONCURRENTLY IF EXISTS core.idx_attractions_architectural_style;
DROP INDEX CONCURRENTLY IF EXISTS core.idx_attractions_processing_status;
DROP INDEX CONCURRENTLY IF EXISTS core.idx_attractions_city_country_approved;
DROP INDEX CONCURRENTLY IF EXISTS core.idx_attractions_category_approved;
DROP INDEX CONCURRENTLY IF EXISTS core.idx_attractions_name_metadata_gin;
DROP INDEX CONCURRENTLY IF EXISTS core.idx_attractions_seasonal_attractions;
DROP INDEX CONCURRENTLY IF EXISTS core.idx_attractions_name_variations_text;
DROP INDEX CONCURRENTLY IF EXISTS core.idx_attractions_name_variations_gin;
DROP INDEX CONCURRENTLY IF EXISTS core.idx_attractions_city_correction_audit;
DROP INDEX CONCURRENTLY IF EXISTS core.idx_attractions_google_types;
DROP INDEX CONCURRENTLY IF EXISTS core.idx_attractions_reference_links_gin;
DROP INDEX CONCURRENTLY IF EXISTS core.idx_attractions_local_traditions;
DROP INDEX CONCURRENTLY IF EXISTS core.idx_attractions_public_transport;
DROP INDEX CONCURRENTLY IF EXISTS core.idx_attractions_data_sources;
DROP INDEX CONCURRENTLY IF EXISTS core.idx_attractions_processing_lock;
DROP INDEX CONCURRENTLY IF EXISTS core.idx_attractions_name_search_optimized;
DROP INDEX CONCURRENTLY IF EXISTS core.idx_attractions_last_score_update;
DROP INDEX CONCURRENTLY IF EXISTS core.idx_attractions_source_file;
DROP INDEX CONCURRENTLY IF EXISTS core.idx_attractions_city_location_v2;
DROP INDEX CONCURRENTLY IF EXISTS core.idx_attractions_city_location_gist;
DROP INDEX CONCURRENTLY IF EXISTS core.idx_attractions_generation_strategy;
DROP INDEX CONCURRENTLY IF EXISTS core.idx_attractions_last_tp_generation;
DROP INDEX CONCURRENTLY IF EXISTS core.idx_attractions_poi_confidence_score;
-- taxonomia (WIP) sem uso pela app — só custam escrita no backfill:
DROP INDEX CONCURRENTLY IF EXISTS core.idx_attractions_is_notable;
DROP INDEX CONCURRENTLY IF EXISTS core.idx_attractions_importance_score;

-- ----------------------------------------------------------------------------
-- 5. NÃO automatizado (revisar manualmente — risco de integridade/uso):
--    - attractions_id_key (UNIQUE em id, 33MB): redundante com attractions_pkey.
--      Se nenhuma FK referencia esta constraint específica, dropar:
--        ALTER TABLE core.attractions DROP CONSTRAINT IF EXISTS attractions_id_key;
--    - idx_attractions_osm_geometry (GIST 81MB, scans=1) e idx_attractions_rating
--      (37MB, scans=7868 — EM USO, manter).
--    - FK duplicado: ALTER TABLE core.attractions
--        DROP CONSTRAINT IF EXISTS attractions_approved_by_fkey1;
-- ----------------------------------------------------------------------------

-- Após dropar, atualizar planner:
ANALYZE core.attraction_trigger_points;
ANALYZE core.attractions;
ANALYZE core.attraction_coordinate;
ANALYZE core.attraction_descriptions;
