-- Script simples para corrigir a precisão dos campos de score OSM
-- Altera os campos de numeric(3,2) para numeric(5,2) para permitir valores 0-100

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
