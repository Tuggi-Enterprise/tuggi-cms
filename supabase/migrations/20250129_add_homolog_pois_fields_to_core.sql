-- Migration: Add fields from homolog.pois to core.attractions
-- Created: 2025-01-29
-- Purpose: Prepare core.attractions schema for migration from homolog.pois

-- ============================================================================
-- 1. CAMPOS OSM BÁSICOS (CRÍTICOS)
-- ============================================================================

ALTER TABLE core.attractions 
ADD COLUMN IF NOT EXISTS osm_id bigint,
ADD COLUMN IF NOT EXISTS osm_type text,
ADD COLUMN IF NOT EXISTS place_id bigint,
ADD COLUMN IF NOT EXISTS importance numeric(5,2),
ADD COLUMN IF NOT EXISTS osm_category text;

-- ============================================================================
-- 2. METADADOS DE PROCESSAMENTO
-- ============================================================================

ALTER TABLE core.attractions 
ADD COLUMN IF NOT EXISTS source_file text,
ADD COLUMN IF NOT EXISTS source_type text DEFAULT 'osm',
ADD COLUMN IF NOT EXISTS is_complete boolean DEFAULT false,
ADD COLUMN IF NOT EXISTS has_nominatim_data boolean DEFAULT false,
ADD COLUMN IF NOT EXISTS processing_status text DEFAULT 'pending',
ADD COLUMN IF NOT EXISTS processing_lock_by text,
ADD COLUMN IF NOT EXISTS processing_lock_at timestamp with time zone;

-- ============================================================================
-- 3. ENDEREÇO DETALHADO
-- ============================================================================

ALTER TABLE core.attractions 
ADD COLUMN IF NOT EXISTS description text,
ADD COLUMN IF NOT EXISTS neighborhood text,
ADD COLUMN IF NOT EXISTS street_name text,
ADD COLUMN IF NOT EXISTS house_number text,
ADD COLUMN IF NOT EXISTS postal_code text;

-- ============================================================================
-- 4. CATEGORIZAÇÃO
-- ============================================================================

ALTER TABLE core.attractions 
ADD COLUMN IF NOT EXISTS primary_category text,
ADD COLUMN IF NOT EXISTS primary_category_type text;

-- ============================================================================
-- 5. CONTATO
-- ============================================================================

ALTER TABLE core.attractions 
ADD COLUMN IF NOT EXISTS contact_phone text,
ADD COLUMN IF NOT EXISTS contact_email text,
ADD COLUMN IF NOT EXISTS operator_name text;

-- ============================================================================
-- 6. MARCA
-- ============================================================================

ALTER TABLE core.attractions 
ADD COLUMN IF NOT EXISTS brand text,
ADD COLUMN IF NOT EXISTS brand_wikidata text,
ADD COLUMN IF NOT EXISTS brand_wikipedia text;

-- ============================================================================
-- 7. INTERNET
-- ============================================================================

ALTER TABLE core.attractions 
ADD COLUMN IF NOT EXISTS internet_access text,
ADD COLUMN IF NOT EXISTS internet_access_fee text;

-- ============================================================================
-- 8. ACESSIBILIDADE
-- ============================================================================

ALTER TABLE core.attractions 
ADD COLUMN IF NOT EXISTS accessibility_notes text;

-- ============================================================================
-- 9. DATAS
-- ============================================================================

ALTER TABLE core.attractions 
ADD COLUMN IF NOT EXISTS start_date text;

-- ============================================================================
-- 10. MUSEU
-- ============================================================================

ALTER TABLE core.attractions 
ADD COLUMN IF NOT EXISTS museum_collection text,
ADD COLUMN IF NOT EXISTS museum_audience text,
ADD COLUMN IF NOT EXISTS museum_education text;

-- ============================================================================
-- 11. PARQUE/NATURAL
-- ============================================================================

ALTER TABLE core.attractions 
ADD COLUMN IF NOT EXISTS natural_water text,
ADD COLUMN IF NOT EXISTS entrance_fee text;

-- ============================================================================
-- 12. FLAGS BOOLEANAS
-- ============================================================================

ALTER TABLE core.attractions 
ADD COLUMN IF NOT EXISTS is_historic boolean DEFAULT false,
ADD COLUMN IF NOT EXISTS is_touristic boolean DEFAULT false,
ADD COLUMN IF NOT EXISTS has_train boolean DEFAULT false,
ADD COLUMN IF NOT EXISTS has_ferry boolean DEFAULT false,
ADD COLUMN IF NOT EXISTS has_bus boolean DEFAULT false,
ADD COLUMN IF NOT EXISTS has_fishing boolean DEFAULT false,
ADD COLUMN IF NOT EXISTS is_building boolean DEFAULT false,
ADD COLUMN IF NOT EXISTS has_ruins boolean DEFAULT false;

-- ============================================================================
-- 13. WIKIDATA/WIKIPEDIA
-- ============================================================================

-- wikidata e wikipedia já podem existir, mas vamos garantir
ALTER TABLE core.attractions 
ADD COLUMN IF NOT EXISTS wikidata text,
ADD COLUMN IF NOT EXISTS wikipedia text;

-- ============================================================================
-- 14. CAMPOS OSM RAW (Tags diretas do OSM)
-- ============================================================================
-- Nota: Esses campos podem estar em osm_tags JSONB, mas adicionamos como campos separados
-- para compatibilidade com homolog.pois. Se já existirem, não serão duplicados.

ALTER TABLE core.attractions 
ADD COLUMN IF NOT EXISTS amenity text,
ADD COLUMN IF NOT EXISTS building text,
ADD COLUMN IF NOT EXISTS artwork_type text,
ADD COLUMN IF NOT EXISTS information text,
ADD COLUMN IF NOT EXISTS source text,
ADD COLUMN IF NOT EXISTS landuse text,
ADD COLUMN IF NOT EXISTS access text,
ADD COLUMN IF NOT EXISTS ref text,
ADD COLUMN IF NOT EXISTS type text,
ADD COLUMN IF NOT EXISTS contact_phone_alt text,
ADD COLUMN IF NOT EXISTS contact_mobile text,
ADD COLUMN IF NOT EXISTS contact_website_alt text,
ADD COLUMN IF NOT EXISTS contact_email_alt text,
ADD COLUMN IF NOT EXISTS contact_facebook text,
ADD COLUMN IF NOT EXISTS contact_instagram text,
ADD COLUMN IF NOT EXISTS contact_whatsapp text,
ADD COLUMN IF NOT EXISTS contact_twitter text,
ADD COLUMN IF NOT EXISTS contact_youtube text,
ADD COLUMN IF NOT EXISTS fee text,
ADD COLUMN IF NOT EXISTS payment_credit_cards text,
ADD COLUMN IF NOT EXISTS payment_cash text,
ADD COLUMN IF NOT EXISTS payment_visa text,
ADD COLUMN IF NOT EXISTS payment_mastercard text,
ADD COLUMN IF NOT EXISTS rooms integer,
ADD COLUMN IF NOT EXISTS air_conditioning text,
ADD COLUMN IF NOT EXISTS smoking text,
ADD COLUMN IF NOT EXISTS capacity integer,
ADD COLUMN IF NOT EXISTS pets_allowed text,
ADD COLUMN IF NOT EXISTS surface text,
ADD COLUMN IF NOT EXISTS waterway text,
ADD COLUMN IF NOT EXISTS power text,
ADD COLUMN IF NOT EXISTS lanes integer,
ADD COLUMN IF NOT EXISTS maxspeed integer,
ADD COLUMN IF NOT EXISTS intermittent text,
ADD COLUMN IF NOT EXISTS layer integer,
ADD COLUMN IF NOT EXISTS leisure text,
ADD COLUMN IF NOT EXISTS lit text,
ADD COLUMN IF NOT EXISTS service text,
ADD COLUMN IF NOT EXISTS barrier text,
ADD COLUMN IF NOT EXISTS alt_name text,
ADD COLUMN IF NOT EXISTS tunnel text,
ADD COLUMN IF NOT EXISTS bus text,
ADD COLUMN IF NOT EXISTS place text,
ADD COLUMN IF NOT EXISTS man_made text,
ADD COLUMN IF NOT EXISTS source_name text,
ADD COLUMN IF NOT EXISTS trees text,
ADD COLUMN IF NOT EXISTS shop text;

-- ============================================================================
-- 15. CONSTRAINTS
-- ============================================================================

-- Constraint para processing_status (drop if exists first)
DO $$
BEGIN
    IF EXISTS (
        SELECT 1 FROM pg_constraint 
        WHERE conname = 'chk_processing_status' 
        AND conrelid = 'core.attractions'::regclass
    ) THEN
        ALTER TABLE core.attractions DROP CONSTRAINT chk_processing_status;
    END IF;
END $$;

ALTER TABLE core.attractions 
ADD CONSTRAINT chk_processing_status 
CHECK (processing_status IS NULL OR processing_status IN ('pending', 'processing', 'completed', 'failed', 'migrated'));

-- Constraint para importance (drop if exists first)
DO $$
BEGIN
    IF EXISTS (
        SELECT 1 FROM pg_constraint 
        WHERE conname = 'chk_importance_range' 
        AND conrelid = 'core.attractions'::regclass
    ) THEN
        ALTER TABLE core.attractions DROP CONSTRAINT chk_importance_range;
    END IF;
END $$;

ALTER TABLE core.attractions 
ADD CONSTRAINT chk_importance_range 
CHECK (importance IS NULL OR (importance >= 0 AND importance <= 1));

-- ============================================================================
-- 16. ÍNDICES PARA PERFORMANCE
-- ============================================================================

-- Índices para campos OSM (críticos para evitar duplicatas)
CREATE INDEX IF NOT EXISTS idx_attractions_osm_id ON core.attractions(osm_id) WHERE osm_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_attractions_osm_type ON core.attractions(osm_type) WHERE osm_type IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_attractions_osm_id_type ON core.attractions(osm_id, osm_type) WHERE osm_id IS NOT NULL AND osm_type IS NOT NULL;

-- Índices para metadados de processamento
CREATE INDEX IF NOT EXISTS idx_attractions_source_file ON core.attractions(source_file) WHERE source_file IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_attractions_processing_status ON core.attractions(processing_status);
CREATE INDEX IF NOT EXISTS idx_attractions_is_complete ON core.attractions(is_complete);

-- Índices para categorização
CREATE INDEX IF NOT EXISTS idx_attractions_primary_category ON core.attractions(primary_category) WHERE primary_category IS NOT NULL;

-- Índices para flags booleanas (filtros comuns)
CREATE INDEX IF NOT EXISTS idx_attractions_is_historic ON core.attractions(is_historic);
CREATE INDEX IF NOT EXISTS idx_attractions_is_touristic ON core.attractions(is_touristic);
CREATE INDEX IF NOT EXISTS idx_attractions_is_building ON core.attractions(is_building);

-- ============================================================================
-- 17. COMENTÁRIOS
-- ============================================================================

COMMENT ON COLUMN core.attractions.osm_id IS 'OSM identifier - critical for duplicate detection';
COMMENT ON COLUMN core.attractions.osm_type IS 'OSM type (node, way, relation) - critical for duplicate detection';
COMMENT ON COLUMN core.attractions.processing_status IS 'Migration and processing status: pending, processing, completed, failed, migrated';
COMMENT ON COLUMN core.attractions.source_file IS 'Source file from which POI was imported';
COMMENT ON COLUMN core.attractions.source_type IS 'Source type: osm, geojson, pbf';

