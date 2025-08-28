-- Script para corrigir a precisão dos campos de score OSM
-- Remove views dependentes, altera campos e recria views

-- ============================================================================
-- 1. REMOVER VIEWS DEPENDENTES
-- ============================================================================

-- Remover views que dependem dos campos de score
DROP VIEW IF EXISTS core.attractions_enriched;
DROP VIEW IF EXISTS core.attractions_pov_optimized;

-- ============================================================================
-- 2. ALTERAR PRECISÃO DOS CAMPOS
-- ============================================================================

-- Alterar a precisão dos campos de score
ALTER TABLE core.attractions 
ALTER COLUMN osm_data_quality_score TYPE numeric(5,2);

ALTER TABLE core.attractions 
ALTER COLUMN pov_quality_score TYPE numeric(5,2);

ALTER TABLE core.attractions 
ALTER COLUMN visibility_score TYPE numeric(5,2);

ALTER TABLE core.attractions 
ALTER COLUMN accessibility_score TYPE numeric(5,2);

ALTER TABLE core.attractions 
ALTER COLUMN photogenic_score TYPE numeric(5,2);

-- ============================================================================
-- 3. RECRIAR VIEWS
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
-- 4. VERIFICAÇÃO
-- ============================================================================

-- Verificar a estrutura dos campos após a correção
SELECT 
    column_name,
    data_type,
    numeric_precision,
    numeric_scale
FROM information_schema.columns 
WHERE table_schema = 'core' 
AND table_name = 'attractions' 
AND column_name IN (
    'osm_data_quality_score',
    'pov_quality_score', 
    'visibility_score',
    'accessibility_score',
    'photogenic_score'
)
ORDER BY column_name;

-- Verificar se as views foram recriadas
SELECT 
    table_name,
    table_type
FROM information_schema.tables 
WHERE table_schema = 'core' 
AND table_name IN ('attractions_enriched', 'attractions_pov_optimized')
ORDER BY table_name;
