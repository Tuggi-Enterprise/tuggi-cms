create table core.attractions (
  id uuid not null default gen_random_uuid (),
  name text not null,
  description text null,
  city text not null,
  country text not null,
  image_url text null,
  rating numeric null default 0,
  audio_guides_count integer null default 0,
  created_at timestamp with time zone null default now(),
  updated_at timestamp with time zone null default now(),
  google_place_id text null,
  category text null,
  approved boolean null default false,
  approved_by uuid null,
  approved_at timestamp with time zone null,
  is_premium boolean null default false,
  user_id uuid null,
  price_level integer null,
  formatted_phone_number text null,
  international_phone_number text null,
  business_status text null default 'OPERATIONAL'::text,
  vicinity text null,
  photos_references text[] null,
  import_source text null default 'manual'::text,
  import_batch_id uuid null,
  imported_from_polygon_id uuid null,
  formatted_address text null,
  website text null,
  opening_hours jsonb null,
  google_types text[] null,
  user_ratings_total integer null,
  state text null,
  show_in_map boolean null,
  reference_links text[] null,
  city_location geography null,
  last_verification_score numeric(3, 2) null,
  last_verification_status text null,
  last_verified_at timestamp with time zone null,
  osm_category text null,
  osm_tags jsonb null,
  osm_data_quality_score numeric(5, 2) null,
  osm_geometry geography null,
  osm_last_updated timestamp with time zone null,
  elevation_m integer null,
  estimated_height_m numeric(6, 2) null,
  osm_area_m2 integer null,
  heritage_status text null,
  architectural_style text null,
  historical_period text null,
  landmark_type text null,
  architect text null,
  construction_status text null,
  completion_estimated_year integer null,
  unesco_status text null,
  unesco_inscription_date date null,
  unesco_reference text null,
  landmark_level integer null,
  importance_level text null,
  wheelchair_accessible boolean null,
  wheelchair_toilets boolean null,
  parking_capacity text null,
  public_transport text[] null,
  access_points text[] null,
  urban_density text null,
  noise_level text null,
  air_quality text null,
  shade_availability text null,
  pov_quality_score numeric(5, 2) null,
  visibility_score numeric(5, 2) null,
  accessibility_score numeric(5, 2) null,
  photogenic_score numeric(5, 2) null,
  cultural_significance text null,
  local_traditions text[] null,
  seasonal_attractions text[] null,
  museum_type text null,
  collection_focus text null,
  target_audience text null,
  educational_programs boolean null,
  park_type text null,
  vegetation_type text null,
  water_features boolean null,
  sports_facilities boolean null,
  playground boolean null,
  monument_type text null,
  commemorated_event text null,
  commemorated_person text null,
  building_colour text null,
  roof_colour text null,
  building_material text null,
  verification_status text null,
  data_sources text[] null,
  osm_import_date timestamp with time zone null default now(),
  osm_wikidata_id text null,
  osm_wikipedia_url text null,
  contact_phone text null,
  contact_email text null,
  operator_name text null,
  last_processed_at timestamp with time zone null,
  processing_lock_by text null,
  processing_lock_at timestamp with time zone null,
  osm_description text null,
  rag_sources_found jsonb null,
  rag_sources_last_search timestamp with time zone null,
  rag_sources_quality_score numeric(5, 2) null,
  rag_content_extracted jsonb null,
  rag_content_summary text null,
  rag_content_last_updated timestamp with time zone null,
  rag_verified_facts jsonb null,
  rag_temporal_tokens text[] null,
  rag_entity_tokens text[] null,
  rag_event_tokens text[] null,
  rag_discovered_links jsonb null,
  rag_wikipedia_links text[] null,
  rag_official_sources text[] null,
  rag_completeness_score numeric(5, 2) null default 0,
  rag_reliability_score numeric(5, 2) null default 0,
  rag_freshness_days integer null default 0,
  rag_source_count integer null default 0,
  rag_search_cache jsonb null,
  rag_search_terms_used text[] null,
  rag_last_successful_search timestamp with time zone null,
  rag_search_failure_count integer null default 0,
  rag_scraped_content jsonb null,
  rag_content_quality_score numeric(5, 2) null default 0,
  rag_keywords_extracted text[] null,
  rag_facts_extracted jsonb null,
  rag_scraping_last_attempt timestamp with time zone null,
  rag_scraping_success_count integer null default 0,
  rag_scraping_failure_count integer null default 0,
  rag_urls_scraped text[] null,
  rag_urls_failed text[] null,
  poi_confidence_score numeric(5, 2) null default null::numeric,
  poi_score_justification jsonb null,
  poi_score_calculated_at timestamp with time zone null,
  poi_score_calculation_method text null,
  processing_audit_log jsonb null,
  last_score_update_at timestamp with time zone null,
  poi_height real null,
  height_confidence real null,
  boundary_source text null,
  boundary_confidence real null,
  boundary_area_m2 real null,
  generation_strategy text null,
  generation_range real null,
  last_tp_generation_at timestamp without time zone null,
  tp_generation_metadata jsonb null,
  street_name text null,
  house_number text null,
  postal_code text null,
  neighborhood text null,
  name_variations jsonb null,
  name_metadata jsonb null,
  entrance_fee text null,
  accessibility_notes text null,
  osm_id text null,
  official_rating integer null,
  visitor_capacity integer null,
  pet_friendly text null,
  unique_id text null,
  constraint attractions_pkey primary key (id),
  constraint attractions_unique_id_key unique (unique_id),
  constraint attractions_osm_id_key unique (osm_id),
  constraint attractions_id_key unique (id),
  constraint fk_attractions_import_batch foreign KEY (import_batch_id) references core.import_batches (id),
  constraint attractions_approved_by_fkey foreign KEY (approved_by) references drive.profiles (id),
  constraint attractions_approved_by_fkey1 foreign KEY (approved_by) references drive.profiles (id),
  constraint attractions_user_id_fkey foreign KEY (user_id) references auth.users (id),
  constraint attractions_osm_data_quality_score_check check (
    (
      (osm_data_quality_score >= (0)::numeric)
      and (osm_data_quality_score <= (100)::numeric)
    )
  ),
  constraint attractions_pov_quality_score_check check (
    (
      (pov_quality_score >= (0)::numeric)
      and (pov_quality_score <= (100)::numeric)
    )
  ),
  constraint attractions_rag_sources_quality_score_check check (
    (
      (rag_sources_quality_score >= (0)::numeric)
      and (rag_sources_quality_score <= (100)::numeric)
    )
  ),
  constraint attractions_landmark_level_check check (
    (
      (landmark_level >= 1)
      and (landmark_level <= 10)
    )
  ),
  constraint attractions_accessibility_score_check check (
    (
      (accessibility_score >= (0)::numeric)
      and (accessibility_score <= (100)::numeric)
    )
  ),
  constraint attractions_visibility_score_check check (
    (
      (visibility_score >= (0)::numeric)
      and (visibility_score <= (100)::numeric)
    )
  ),
  constraint chk_boundary_area_positive check (
    (
      (boundary_area_m2 is null)
      or (boundary_area_m2 >= (0)::double precision)
    )
  ),
  constraint chk_boundary_confidence_range check (
    (
      (boundary_confidence is null)
      or (
        (boundary_confidence >= (0)::double precision)
        and (boundary_confidence <= (1)::double precision)
      )
    )
  ),
  constraint chk_generation_range_positive check (
    (
      (generation_range is null)
      or (generation_range > (0)::double precision)
    )
  ),
  constraint chk_generation_strategy_values check (
    (
      (generation_strategy is null)
      or (
        generation_strategy = any (array['circular'::text, 'boundary_offset'::text])
      )
    )
  ),
  constraint chk_height_confidence_range check (
    (
      (height_confidence is null)
      or (
        (height_confidence >= (0)::double precision)
        and (height_confidence <= (1)::double precision)
      )
    )
  ),
  constraint chk_name_metadata_is_object check (
    (
      (name_metadata is null)
      or (jsonb_typeof(name_metadata) = 'object'::text)
    )
  ),
  constraint chk_name_variations_is_array check (
    (
      (name_variations is null)
      or (jsonb_typeof(name_variations) = 'array'::text)
    )
  ),
  constraint chk_poi_height_positive check (
    (
      (poi_height is null)
      or (poi_height >= (0)::double precision)
    )
  ),
  constraint chk_urban_density_values check (
    (
      (urban_density is null)
      or (
        urban_density = any (
          array[
            'very_dense'::text,
            'dense'::text,
            'medium'::text,
            'low'::text,
            'rural'::text
          ]
        )
      )
    )
  ),
  constraint attractions_photogenic_score_check check (
    (
      (photogenic_score >= (0)::numeric)
      and (photogenic_score <= (100)::numeric)
    )
  )
) TABLESPACE pg_default;

create index IF not exists idx_attractions_unique_id on core.attractions using btree (unique_id) TABLESPACE pg_default;

create index IF not exists attractions_google_place_id_idx on core.attractions using btree (google_place_id) TABLESPACE pg_default;

create index IF not exists idx_attractions_approved on core.attractions using btree (approved) TABLESPACE pg_default;

create index IF not exists idx_attractions_approved_location on core.attractions using btree (approved, rating desc) TABLESPACE pg_default
where
  (approved = true);

create index IF not exists idx_attractions_business_status on core.attractions using btree (business_status) TABLESPACE pg_default;

create index IF not exists idx_attractions_category_rating on core.attractions using btree (category, rating desc, is_premium) TABLESPACE pg_default
where
  (approved = true);

create index IF not exists idx_attractions_google_types on core.attractions using gin (google_types) TABLESPACE pg_default;

create index IF not exists idx_attractions_import_batch on core.attractions using btree (import_batch_id) TABLESPACE pg_default;

create index IF not exists idx_attractions_import_source on core.attractions using btree (import_source) TABLESPACE pg_default;

create index IF not exists idx_attractions_premium on core.attractions using btree (is_premium) TABLESPACE pg_default;

create index IF not exists idx_attractions_rating on core.attractions using btree (rating desc) TABLESPACE pg_default;

create index IF not exists idx_attractions_search_optimized on core.attractions using btree (country, city, approved, rating desc, name) TABLESPACE pg_default
where
  (
    (approved = true)
    and (rating >= 2.0)
  );

create index IF not exists idx_attractions_user_ratings_total on core.attractions using btree (user_ratings_total desc) TABLESPACE pg_default;

create index IF not exists idx_attractions_website on core.attractions using btree (website) TABLESPACE pg_default;

create index IF not exists idx_attractions_city_location_v2 on core.attractions using gist (city_location) TABLESPACE pg_default
where
  (city_location is not null);

create index IF not exists idx_attractions_approved_category_v2 on core.attractions using btree (approved, category, city, country) TABLESPACE pg_default
where
  (approved = true);

create index IF not exists idx_attractions_category_approved on core.attractions using btree (category, approved) TABLESPACE pg_default
where
  (approved = true);

create index IF not exists idx_attractions_osm_category on core.attractions using btree (osm_category) TABLESPACE pg_default;

create index IF not exists idx_attractions_heritage_status on core.attractions using btree (heritage_status) TABLESPACE pg_default;

create index IF not exists idx_attractions_unesco_status on core.attractions using btree (unesco_status) TABLESPACE pg_default;

create index IF not exists idx_attractions_architectural_style on core.attractions using btree (architectural_style) TABLESPACE pg_default;

create index IF not exists idx_attractions_landmark_type on core.attractions using btree (landmark_type) TABLESPACE pg_default;

create index IF not exists idx_attractions_wheelchair_accessible on core.attractions using btree (wheelchair_accessible) TABLESPACE pg_default;

create index IF not exists idx_attractions_urban_density on core.attractions using btree (urban_density) TABLESPACE pg_default;

create index IF not exists idx_attractions_cultural_significance on core.attractions using btree (cultural_significance) TABLESPACE pg_default;

create index IF not exists idx_attractions_museum_type on core.attractions using btree (museum_type) TABLESPACE pg_default;

create index IF not exists idx_attractions_park_type on core.attractions using btree (park_type) TABLESPACE pg_default;

create index IF not exists idx_attractions_monument_type on core.attractions using btree (monument_type) TABLESPACE pg_default;

create index IF not exists idx_attractions_public_transport on core.attractions using gin (public_transport) TABLESPACE pg_default;

create index IF not exists idx_attractions_local_traditions on core.attractions using gin (local_traditions) TABLESPACE pg_default;

create index IF not exists idx_attractions_seasonal_attractions on core.attractions using gin (seasonal_attractions) TABLESPACE pg_default;

create index IF not exists idx_attractions_data_sources on core.attractions using gin (data_sources) TABLESPACE pg_default;

create index IF not exists idx_attractions_osm_geometry on core.attractions using gist (osm_geometry) TABLESPACE pg_default;

create index IF not exists idx_attractions_approved_heritage on core.attractions using btree (approved, heritage_status) TABLESPACE pg_default
where
  (approved = true);

create index IF not exists idx_attractions_verification on core.attractions using btree (last_verification_status, last_verification_score) TABLESPACE pg_default;

create index IF not exists idx_attractions_approved_cultural on core.attractions using btree (approved, cultural_significance) TABLESPACE pg_default
where
  (approved = true);

create index IF not exists idx_attractions_city_location_gist on core.attractions using gist (city_location) TABLESPACE pg_default
where
  (city_location is not null);

create index IF not exists idx_attractions_approved_category on core.attractions using btree (approved, category, created_at desc) TABLESPACE pg_default
where
  (approved = true);

create index IF not exists idx_attractions_pov_quality_score on core.attractions using btree (pov_quality_score desc) TABLESPACE pg_default;

create index IF not exists idx_attractions_approved_pov_quality on core.attractions using btree (approved, pov_quality_score desc) TABLESPACE pg_default
where
  (approved = true);

create index IF not exists idx_attractions_photogenic_score on core.attractions using btree (photogenic_score desc) TABLESPACE pg_default;

create index IF not exists idx_attractions_osm_wikidata on core.attractions using btree (osm_wikidata_id) TABLESPACE pg_default;

create index IF not exists idx_attractions_operator_name on core.attractions using btree (operator_name) TABLESPACE pg_default;

create index IF not exists idx_attractions_contact_phone on core.attractions using btree (contact_phone) TABLESPACE pg_default;

create index IF not exists idx_attractions_last_processed_at on core.attractions using btree (last_processed_at) TABLESPACE pg_default;

create index IF not exists idx_attractions_processing_lock on core.attractions using btree (processing_lock_by, processing_lock_at) TABLESPACE pg_default
where
  (processing_lock_by is not null);

create index IF not exists idx_attractions_rag_sources_quality on core.attractions using btree (rag_sources_quality_score desc) TABLESPACE pg_default
where
  (rag_sources_quality_score is not null);

create index IF not exists idx_attractions_rag_completeness on core.attractions using btree (rag_completeness_score desc) TABLESPACE pg_default
where
  (rag_completeness_score > (0)::numeric);

create index IF not exists idx_attractions_rag_freshness on core.attractions using btree (rag_freshness_days) TABLESPACE pg_default
where
  (rag_freshness_days is not null);

create index IF not exists idx_attractions_rag_last_search on core.attractions using btree (rag_last_successful_search desc) TABLESPACE pg_default
where
  (rag_last_successful_search is not null);

create index IF not exists idx_attractions_rag_sources_found_gin on core.attractions using gin (rag_sources_found) TABLESPACE pg_default;

create index IF not exists idx_attractions_rag_content_extracted_gin on core.attractions using gin (rag_content_extracted) TABLESPACE pg_default;

create index IF not exists idx_attractions_rag_verified_facts_gin on core.attractions using gin (rag_verified_facts) TABLESPACE pg_default;

create index IF not exists idx_attractions_rag_temporal_tokens_gin on core.attractions using gin (rag_temporal_tokens) TABLESPACE pg_default;

create index IF not exists idx_attractions_reference_links_gin on core.attractions using gin (reference_links) TABLESPACE pg_default;

create index IF not exists idx_attractions_rag_content_quality on core.attractions using btree (rag_content_quality_score desc) TABLESPACE pg_default
where
  (rag_content_quality_score > (0)::numeric);

create index IF not exists idx_attractions_rag_scraping_success on core.attractions using btree (rag_scraping_success_count desc) TABLESPACE pg_default
where
  (rag_scraping_success_count > 0);

create index IF not exists idx_attractions_rag_keywords_gin on core.attractions using gin (rag_keywords_extracted) TABLESPACE pg_default;

create index IF not exists idx_attractions_poi_confidence_score on core.attractions using btree (poi_confidence_score desc) TABLESPACE pg_default
where
  (poi_confidence_score is not null);

create index IF not exists idx_attractions_last_score_update on core.attractions using btree (last_score_update_at desc) TABLESPACE pg_default
where
  (last_score_update_at is not null);

create index IF not exists idx_attractions_score_calculation_method on core.attractions using btree (poi_score_calculation_method) TABLESPACE pg_default
where
  (poi_score_calculation_method is not null);

create index IF not exists idx_attractions_name_gin_search on core.attractions using gin (lower(name) gin_trgm_ops) TABLESPACE pg_default;

create index IF not exists idx_attractions_planner_optimize on core.attractions using btree (
  city,
  country,
  category,
  rating desc,
  user_ratings_total desc
) TABLESPACE pg_default
where
  (approved = true);

create index IF not exists idx_attractions_destination_search on core.attractions using btree (city, country, name) TABLESPACE pg_default
where
  (approved = true);

create index IF not exists idx_attractions_state_city_neighborhood on core.attractions using btree (state, city, neighborhood) TABLESPACE pg_default;

create index IF not exists idx_attractions_name_metadata_gin on core.attractions using gin (name_metadata) TABLESPACE pg_default;

create index IF not exists idx_attractions_generation_strategy on core.attractions using btree (generation_strategy) TABLESPACE pg_default
where
  (generation_strategy is not null);

create index IF not exists idx_attractions_last_tp_generation on core.attractions using btree (last_tp_generation_at) TABLESPACE pg_default
where
  (last_tp_generation_at is not null);

create index IF not exists idx_attractions_city_country_state on core.attractions using btree (city, country, state) TABLESPACE pg_default
where
  (approved = true);

create index IF not exists idx_attractions_city_rating on core.attractions using btree (city, country, rating desc nulls last) TABLESPACE pg_default
where
  (approved = true);

create index IF not exists idx_attractions_city_category on core.attractions using btree (city, country, category) TABLESPACE pg_default
where
  (approved = true);

create index IF not exists idx_attractions_street_name on core.attractions using btree (street_name) TABLESPACE pg_default;

create index IF not exists idx_attractions_postal_code on core.attractions using btree (postal_code) TABLESPACE pg_default;

create index IF not exists idx_attractions_neighborhood on core.attractions using btree (neighborhood) TABLESPACE pg_default;

create index IF not exists idx_attractions_city_neighborhood on core.attractions using btree (city, neighborhood) TABLESPACE pg_default;

create index IF not exists idx_attractions_name_variations_gin on core.attractions using gin (name_variations) TABLESPACE pg_default;

create index IF not exists idx_attractions_name_variations_text on core.attractions using gin (((name_variations)::text) gin_trgm_ops) TABLESPACE pg_default;

create index IF not exists idx_attractions_name_search_optimized on core.attractions using btree (approved, name, city, country) TABLESPACE pg_default
where
  (
    (approved = true)
    and (
      (name_variations is not null)
      or (name_metadata is not null)
    )
  );

create index IF not exists idx_attractions_full_address on core.attractions using btree (city, neighborhood, street_name) TABLESPACE pg_default
where
  (city is not null);

create trigger handle_updated_at BEFORE
update on core.attractions for EACH row
execute FUNCTION core.handle_updated_at ();

create trigger trigger_update_osm_last_updated BEFORE
update on core.attractions for EACH row
execute FUNCTION core.update_osm_last_updated ();

create trigger trigger_update_score_timestamp BEFORE
update on core.attractions for EACH row
execute FUNCTION core.update_score_timestamp ();