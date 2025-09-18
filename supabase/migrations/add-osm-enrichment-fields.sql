-- Script para adicionar campos de enriquecimento OSM à tabela core.attractions
-- Baseado nos testes realizados com 5 POIs diferentes

-- ============================================================================
-- 1. CAMPOS OSM BÁSICOS
-- ============================================================================

-- Categoria e tags OSM
ALTER TABLE core.attractions 
ADD COLUMN IF NOT EXISTS osm_category text,
ADD COLUMN IF NOT EXISTS osm_tags jsonb,
ADD COLUMN IF NOT EXISTS osm_data_quality_score numeric(3,2) CHECK (osm_data_quality_score >= 0 AND osm_data_quality_score <= 100),
ADD COLUMN IF NOT EXISTS osm_geometry geography(Polygon, 4326),
ADD COLUMN IF NOT EXISTS osm_last_updated timestamp with time zone;

-- ============================================================================
-- 2. DADOS GEOGRÁFICOS E FÍSICOS
-- ============================================================================

-- Elevação e dimensões
ALTER TABLE core.attractions 
ADD COLUMN IF NOT EXISTS elevation_m integer,
ADD COLUMN IF NOT EXISTS estimated_height_m numeric(6,2),
ADD COLUMN IF NOT EXISTS osm_area_m2 integer;

-- ============================================================================
-- 3. CARACTERÍSTICAS ARQUITETÔNICAS E HISTÓRICAS
-- ============================================================================

-- Status patrimonial e arquitetura
ALTER TABLE core.attractions 
ADD COLUMN IF NOT EXISTS heritage_status text CHECK (heritage_status IN (
  'none', 'local_heritage', 'national_heritage', 'unesco_world_heritage', 
  'regional_heritage', 'municipal_heritage'
)),
ADD COLUMN IF NOT EXISTS architectural_style text,
ADD COLUMN IF NOT EXISTS historical_period text,
ADD COLUMN IF NOT EXISTS landmark_type text,
ADD COLUMN IF NOT EXISTS architect text,
ADD COLUMN IF NOT EXISTS construction_status text CHECK (construction_status IN (
  'completed', 'under_construction', 'planned', 'abandoned', 'demolished'
)),
ADD COLUMN IF NOT EXISTS completion_estimated_year integer;

-- ============================================================================
-- 4. DADOS UNESCO E PATRIMÔNIO
-- ============================================================================

-- Informações UNESCO (especialmente para monumentos internacionais)
ALTER TABLE core.attractions 
ADD COLUMN IF NOT EXISTS unesco_status text CHECK (unesco_status IN (
  'none', 'world_heritage_site', 'tentative_list', 'proposed'
)),
ADD COLUMN IF NOT EXISTS unesco_inscription_date date,
ADD COLUMN IF NOT EXISTS unesco_reference text,
ADD COLUMN IF NOT EXISTS landmark_level integer CHECK (landmark_level >= 1 AND landmark_level <= 10),
ADD COLUMN IF NOT EXISTS importance_level text CHECK (importance_level IN (
  'local', 'regional', 'national', 'international', 'global'
));

-- ============================================================================
-- 5. ACESSIBILIDADE E INFRAESTRUTURA
-- ============================================================================

-- Acessibilidade física
ALTER TABLE core.attractions 
ADD COLUMN IF NOT EXISTS wheelchair_accessible boolean,
ADD COLUMN IF NOT EXISTS wheelchair_toilets boolean,
ADD COLUMN IF NOT EXISTS parking_capacity text CHECK (parking_capacity IN (
  'none', 'small', 'medium', 'large', 'very_large'
)),
ADD COLUMN IF NOT EXISTS public_transport text[],
ADD COLUMN IF NOT EXISTS access_points text[];

-- ============================================================================
-- 6. DADOS AMBIENTAIS E URBANOS
-- ============================================================================

-- Características ambientais
ALTER TABLE core.attractions 
ADD COLUMN IF NOT EXISTS urban_density text CHECK (urban_density IN (
  'rural', 'low', 'medium', 'dense', 'very_dense'
)),
ADD COLUMN IF NOT EXISTS noise_level text CHECK (noise_level IN (
  'very_low', 'low', 'moderate', 'high', 'very_high'
)),
ADD COLUMN IF NOT EXISTS air_quality text CHECK (air_quality IN (
  'poor', 'fair', 'good', 'excellent'
)),
ADD COLUMN IF NOT EXISTS shade_availability text CHECK (shade_availability IN (
  'none', 'partial', 'full'
));

-- ============================================================================
-- 7. SCORES DE QUALIDADE PARA POVs
-- ============================================================================

-- Scores específicos para geração de POVs
ALTER TABLE core.attractions 
ADD COLUMN IF NOT EXISTS pov_quality_score numeric(5,2) CHECK (pov_quality_score >= 0 AND pov_quality_score <= 100),
ADD COLUMN IF NOT EXISTS visibility_score numeric(5,2) CHECK (visibility_score >= 0 AND visibility_score <= 100),
ADD COLUMN IF NOT EXISTS accessibility_score numeric(5,2) CHECK (accessibility_score >= 0 AND accessibility_score <= 100),
ADD COLUMN IF NOT EXISTS photogenic_score numeric(5,2) CHECK (photogenic_score >= 0 AND photogenic_score <= 100);

-- ============================================================================
-- 8. DADOS CULTURAIS E SOCIAIS
-- ============================================================================

-- Significado cultural e tradições
ALTER TABLE core.attractions 
ADD COLUMN IF NOT EXISTS cultural_significance text CHECK (cultural_significance IN (
  'low', 'medium', 'high', 'very_high'
)),
ADD COLUMN IF NOT EXISTS local_traditions text[],
ADD COLUMN IF NOT EXISTS seasonal_attractions text[];

-- ============================================================================
-- 9. CARACTERÍSTICAS ESPECÍFICAS POR TIPO
-- ============================================================================

-- Para museus
ALTER TABLE core.attractions 
ADD COLUMN IF NOT EXISTS museum_type text CHECK (museum_type IN (
  'art', 'history', 'science', 'natural_history', 'specialized', 'general'
)),
ADD COLUMN IF NOT EXISTS collection_focus text,
ADD COLUMN IF NOT EXISTS target_audience text CHECK (target_audience IN (
  'local_community', 'regional', 'national', 'international', 'academic'
)),
ADD COLUMN IF NOT EXISTS educational_programs boolean;

-- Para parques
ALTER TABLE core.attractions 
ADD COLUMN IF NOT EXISTS park_type text CHECK (park_type IN (
  'urban', 'national', 'state', 'municipal', 'botanical', 'zoological', 'recreational'
)),
ADD COLUMN IF NOT EXISTS vegetation_type text,
ADD COLUMN IF NOT EXISTS water_features boolean,
ADD COLUMN IF NOT EXISTS sports_facilities boolean,
ADD COLUMN IF NOT EXISTS playground boolean;

-- Para monumentos
ALTER TABLE core.attractions 
ADD COLUMN IF NOT EXISTS monument_type text CHECK (monument_type IN (
  'statue', 'memorial', 'obelisk', 'arch', 'tower', 'basilica', 'cathedral', 'church'
)),
ADD COLUMN IF NOT EXISTS commemorated_event text,
ADD COLUMN IF NOT EXISTS commemorated_person text;

-- ============================================================================
-- 10. CARACTERÍSTICAS FÍSICAS
-- ============================================================================

-- Cores e materiais
ALTER TABLE core.attractions 
ADD COLUMN IF NOT EXISTS building_colour text,
ADD COLUMN IF NOT EXISTS roof_colour text,
ADD COLUMN IF NOT EXISTS building_material text;

-- ============================================================================
-- 11. METADADOS E FONTES
-- ============================================================================

-- Metadados de verificação e fontes
ALTER TABLE core.attractions 
ADD COLUMN IF NOT EXISTS verification_status text CHECK (verification_status IN (
  'pending', 'verified', 'unverified', 'disputed'
)),
ADD COLUMN IF NOT EXISTS data_sources text[],
ADD COLUMN IF NOT EXISTS osm_import_date timestamp with time zone DEFAULT now();

-- ============================================================================
-- 12. ÍNDICES PARA PERFORMANCE
-- ============================================================================

-- Índices para campos OSM
CREATE INDEX IF NOT EXISTS idx_attractions_osm_category ON core.attractions (osm_category);
CREATE INDEX IF NOT EXISTS idx_attractions_heritage_status ON core.attractions (heritage_status);
CREATE INDEX IF NOT EXISTS idx_attractions_unesco_status ON core.attractions (unesco_status);
CREATE INDEX IF NOT EXISTS idx_attractions_architectural_style ON core.attractions (architectural_style);
CREATE INDEX IF NOT EXISTS idx_attractions_landmark_type ON core.attractions (landmark_type);
CREATE INDEX IF NOT EXISTS idx_attractions_wheelchair_accessible ON core.attractions (wheelchair_accessible);
CREATE INDEX IF NOT EXISTS idx_attractions_urban_density ON core.attractions (urban_density);
CREATE INDEX IF NOT EXISTS idx_attractions_pov_quality_score ON core.attractions (pov_quality_score DESC);
CREATE INDEX IF NOT EXISTS idx_attractions_photogenic_score ON core.attractions (photogenic_score DESC);
CREATE INDEX IF NOT EXISTS idx_attractions_cultural_significance ON core.attractions (cultural_significance);
CREATE INDEX IF NOT EXISTS idx_attractions_museum_type ON core.attractions (museum_type);
CREATE INDEX IF NOT EXISTS idx_attractions_park_type ON core.attractions (park_type);
CREATE INDEX IF NOT EXISTS idx_attractions_monument_type ON core.attractions (monument_type);

-- Índice GIN para arrays
CREATE INDEX IF NOT EXISTS idx_attractions_public_transport ON core.attractions USING GIN (public_transport);
CREATE INDEX IF NOT EXISTS idx_attractions_local_traditions ON core.attractions USING GIN (local_traditions);
CREATE INDEX IF NOT EXISTS idx_attractions_seasonal_attractions ON core.attractions USING GIN (seasonal_attractions);
CREATE INDEX IF NOT EXISTS idx_attractions_data_sources ON core.attractions USING GIN (data_sources);

-- Índice espacial para geometria OSM
CREATE INDEX IF NOT EXISTS idx_attractions_osm_geometry ON core.attractions USING GIST (osm_geometry);

-- Índices compostos para consultas comuns
CREATE INDEX IF NOT EXISTS idx_attractions_approved_heritage ON core.attractions (approved, heritage_status) WHERE approved = true;
CREATE INDEX IF NOT EXISTS idx_attractions_approved_pov_quality ON core.attractions (approved, pov_quality_score DESC) WHERE approved = true;
CREATE INDEX IF NOT EXISTS idx_attractions_approved_cultural ON core.attractions (approved, cultural_significance) WHERE approved = true;

-- ============================================================================
-- 13. COMENTÁRIOS PARA DOCUMENTAÇÃO
-- ============================================================================

COMMENT ON COLUMN core.attractions.osm_category IS 'Categoria OSM (ex: tourism, amenity, historic)';
COMMENT ON COLUMN core.attractions.osm_tags IS 'Tags OSM completas em formato JSONB';
COMMENT ON COLUMN core.attractions.osm_data_quality_score IS 'Score de qualidade dos dados OSM (0-100)';
COMMENT ON COLUMN core.attractions.osm_geometry IS 'Geometria OSM em formato PostGIS';
COMMENT ON COLUMN core.attractions.heritage_status IS 'Status do patrimônio histórico/cultural';
COMMENT ON COLUMN core.attractions.unesco_status IS 'Status UNESCO (world_heritage_site, etc.)';
COMMENT ON COLUMN core.attractions.landmark_level IS 'Nível de landmark OSM (1-10)';
COMMENT ON COLUMN core.attractions.pov_quality_score IS 'Score de qualidade para geração de POVs (0-100)';
COMMENT ON COLUMN core.attractions.photogenic_score IS 'Score de qualidade fotográfica (0-100)';
COMMENT ON COLUMN core.attractions.cultural_significance IS 'Significado cultural do POI';
COMMENT ON COLUMN core.attractions.museum_type IS 'Tipo específico de museu';
COMMENT ON COLUMN core.attractions.park_type IS 'Tipo específico de parque';
COMMENT ON COLUMN core.attractions.monument_type IS 'Tipo específico de monumento';

-- ============================================================================
-- 14. VIEWS ÚTEIS PARA CONSULTAS
-- ============================================================================

-- View para POIs com dados OSM enriquecidos
CREATE OR REPLACE VIEW core.attractions_enriched AS
SELECT 
    a.*,
    CASE 
        WHEN a.heritage_status = 'unesco_world_heritage' THEN 'UNESCO'
        WHEN a.heritage_status IN ('national_heritage', 'regional_heritage') THEN 'Heritage'
        ELSE 'Regular'
    END as heritage_category,
    CASE 
        WHEN a.pov_quality_score >= 90 THEN 'Excellent'
        WHEN a.pov_quality_score >= 75 THEN 'Good'
        WHEN a.pov_quality_score >= 60 THEN 'Fair'
        ELSE 'Poor'
    END as pov_quality_category,
    CASE 
        WHEN a.cultural_significance = 'very_high' THEN 'Iconic'
        WHEN a.cultural_significance = 'high' THEN 'Important'
        WHEN a.cultural_significance = 'medium' THEN 'Notable'
        ELSE 'Local'
    END as cultural_category
FROM core.attractions a
WHERE a.approved = true;

-- View para POIs com melhor qualidade para POVs
CREATE OR REPLACE VIEW core.attractions_pov_optimized AS
SELECT 
    a.*,
    (a.pov_quality_score + a.visibility_score + a.accessibility_score + a.photogenic_score) / 4 as overall_pov_score
FROM core.attractions a
WHERE a.approved = true 
    AND a.pov_quality_score IS NOT NULL
    AND a.pov_quality_score >= 70
ORDER BY overall_pov_score DESC;

-- ============================================================================
-- 15. FUNÇÕES ÚTEIS
-- ============================================================================

-- Função para calcular score de qualidade OSM baseado nos dados disponíveis
CREATE OR REPLACE FUNCTION core.calculate_osm_quality_score(
    p_osm_tags jsonb,
    p_heritage_status text,
    p_unesco_status text,
    p_landmark_level integer,
    p_architect text,
    p_opening_hours text
) RETURNS numeric AS $$
DECLARE
    score numeric := 0;
    tag_count integer := 0;
BEGIN
    -- Base score
    score := 50;
    
    -- Pontos por tags OSM
    IF p_osm_tags IS NOT NULL THEN
        tag_count := jsonb_object_keys(p_osm_tags);
        score := score + LEAST(tag_count * 2, 20); -- Máximo 20 pontos por tags
    END IF;
    
    -- Pontos por status patrimonial
    IF p_heritage_status = 'unesco_world_heritage' THEN
        score := score + 15;
    ELSIF p_heritage_status IN ('national_heritage', 'regional_heritage') THEN
        score := score + 10;
    ELSIF p_heritage_status = 'local_heritage' THEN
        score := score + 5;
    END IF;
    
    -- Pontos por status UNESCO
    IF p_unesco_status = 'world_heritage_site' THEN
        score := score + 10;
    END IF;
    
    -- Pontos por nível de landmark
    IF p_landmark_level IS NOT NULL THEN
        score := score + LEAST(p_landmark_level, 10);
    END IF;
    
    -- Pontos por informações do arquiteto
    IF p_architect IS NOT NULL THEN
        score := score + 5;
    END IF;
    
    -- Pontos por horários de funcionamento
    IF p_opening_hours IS NOT NULL THEN
        score := score + 5;
    END IF;
    
    RETURN LEAST(score, 100);
END;
$$ LANGUAGE plpgsql;

-- Função para atualizar scores de qualidade OSM
CREATE OR REPLACE FUNCTION core.update_osm_quality_scores() RETURNS void AS $$
BEGIN
    UPDATE core.attractions 
    SET osm_data_quality_score = core.calculate_osm_quality_score(
        osm_tags, 
        heritage_status, 
        unesco_status, 
        landmark_level, 
        architect, 
        opening_hours::text
    )
    WHERE osm_tags IS NOT NULL;
END;
$$ LANGUAGE plpgsql;

-- ============================================================================
-- 16. TRIGGERS PARA MANUTENÇÃO AUTOMÁTICA
-- ============================================================================

-- Trigger para atualizar osm_last_updated quando dados OSM são modificados
CREATE OR REPLACE FUNCTION core.update_osm_last_updated()
RETURNS TRIGGER AS $$
BEGIN
    IF (OLD.osm_tags IS DISTINCT FROM NEW.osm_tags OR 
        OLD.heritage_status IS DISTINCT FROM NEW.heritage_status OR
        OLD.unesco_status IS DISTINCT FROM NEW.unesco_status) THEN
        NEW.osm_last_updated = now();
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trigger_update_osm_last_updated
    BEFORE UPDATE ON core.attractions
    FOR EACH ROW
    EXECUTE FUNCTION core.update_osm_last_updated();

-- ============================================================================
-- 17. RESUMO DAS ALTERAÇÕES
-- ============================================================================

-- Total de novos campos adicionados: ~50 campos
-- Principais categorias:
-- - Dados OSM básicos (5 campos)
-- - Dados geográficos (3 campos)
-- - Características arquitetônicas (7 campos)
-- - Dados UNESCO (4 campos)
-- - Acessibilidade (6 campos)
-- - Dados ambientais (4 campos)
-- - Scores de qualidade (4 campos)
-- - Dados culturais (3 campos)
-- - Características específicas por tipo (12 campos)
-- - Metadados (3 campos)

-- Índices criados: ~20 índices
-- Views criadas: 2 views
-- Funções criadas: 2 funções
-- Triggers criados: 1 trigger

-- ============================================================================
-- 18. EXEMPLO DE USO
-- ============================================================================

/*
-- Exemplo de inserção com dados OSM enriquecidos
INSERT INTO core.attractions (
    name, city, country, approved,
    osm_category, osm_tags, osm_data_quality_score,
    heritage_status, architectural_style, architect,
    unesco_status, landmark_level, importance_level,
    wheelchair_accessible, parking_capacity, public_transport,
    pov_quality_score, visibility_score, accessibility_score, photogenic_score,
    cultural_significance, local_traditions, seasonal_attractions,
    museum_type, collection_focus, target_audience,
    building_colour, roof_colour, building_material,
    verification_status, data_sources
) VALUES (
    'Museu de Arte de São Paulo',
    'São Paulo',
    'Brasil',
    true,
    'tourism',
    '{"museum": "art", "website": "http://masp.art.br/", "opening_hours": "Tu-Su 10:00-18:00; Th 10:00-20:00"}'::jsonb,
    95.0,
    'national_heritage',
    'modern',
    'Lina Bo Bardi',
    'none',
    8,
    'national',
    true,
    'medium',
    ARRAY['metro', 'bus'],
    85.0,
    80.0,
    90.0,
    95.0,
    'very_high',
    ARRAY['art_exhibitions', 'cultural_events'],
    ARRAY['temporary_exhibitions', 'art_workshops'],
    'art',
    'modern_art',
    'international',
    '#e6e6e6',
    '#e6e6e6',
    'concrete',
    'verified',
    ARRAY['osm_nominatim', 'osm_reverse', 'official_website']
);
*/
