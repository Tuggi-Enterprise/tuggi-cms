-- =====================================
-- ADD POI CONFIDENCE SCORE AND AUDIT FIELDS
-- =====================================

-- Add POI confidence score and audit fields to attractions table
ALTER TABLE core.attractions 
ADD COLUMN IF NOT EXISTS poi_confidence_score numeric(5,2) DEFAULT NULL,
ADD COLUMN IF NOT EXISTS poi_score_justification jsonb DEFAULT NULL,
ADD COLUMN IF NOT EXISTS poi_score_calculated_at timestamp with time zone DEFAULT NULL,
ADD COLUMN IF NOT EXISTS poi_score_calculation_method text DEFAULT NULL,
ADD COLUMN IF NOT EXISTS processing_audit_log jsonb DEFAULT NULL,
ADD COLUMN IF NOT EXISTS last_score_update_at timestamp with time zone DEFAULT NULL;

-- Add comments for documentation
COMMENT ON COLUMN core.attractions.poi_confidence_score IS 'Score geral de confiança do POI (0.00-1.00)';
COMMENT ON COLUMN core.attractions.poi_score_justification IS 'Justificativas detalhadas do cálculo do score (boundary_quality, trigger_points_quality, etc.)';
COMMENT ON COLUMN core.attractions.poi_score_calculated_at IS 'Timestamp do último cálculo do score';
COMMENT ON COLUMN core.attractions.poi_score_calculation_method IS 'Método usado para calcular o score (osm_overpass, osm_nominatim, etc.)';
COMMENT ON COLUMN core.attractions.processing_audit_log IS 'Log de auditoria do processamento (steps, durations, errors)';
COMMENT ON COLUMN core.attractions.last_score_update_at IS 'Timestamp da última atualização de qualquer score';

-- Create indexes for performance
CREATE INDEX IF NOT EXISTS idx_attractions_poi_confidence_score 
ON core.attractions(poi_confidence_score DESC) 
WHERE poi_confidence_score IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_attractions_last_score_update 
ON core.attractions(last_score_update_at DESC) 
WHERE last_score_update_at IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_attractions_score_calculation_method 
ON core.attractions(poi_score_calculation_method) 
WHERE poi_score_calculation_method IS NOT NULL;

-- Create view for audit analysis
CREATE OR REPLACE VIEW core.poi_audit_summary AS
SELECT 
    id,
    name,
    city,
    
    -- Scores disponíveis
    poi_confidence_score,
    osm_data_quality_score,
    rag_sources_quality_score,
    rag_content_quality_score,
    
    -- Timestamps de auditoria
    poi_score_calculated_at,
    last_score_update_at,
    last_processed_at,
    
    -- Métodos e justificativas
    poi_score_calculation_method,
    poi_score_justification,
    processing_audit_log,
    
    -- Status de completude da auditoria
    CASE 
        WHEN poi_confidence_score IS NOT NULL 
         AND osm_data_quality_score IS NOT NULL 
         AND (rag_sources_quality_score IS NOT NULL OR rag_content_quality_score IS NOT NULL)
        THEN 'complete'
        WHEN poi_confidence_score IS NOT NULL 
        THEN 'partial'
        ELSE 'incomplete'
    END as audit_completeness,
    
    -- Score de auditoria geral (0-100)
    CASE 
        WHEN poi_confidence_score IS NOT NULL 
         AND osm_data_quality_score IS NOT NULL 
         AND (rag_sources_quality_score IS NOT NULL OR rag_content_quality_score IS NOT NULL)
         AND poi_score_justification IS NOT NULL
        THEN 100
        WHEN poi_confidence_score IS NOT NULL 
         AND (osm_data_quality_score IS NOT NULL OR rag_sources_quality_score IS NOT NULL)
        THEN 75
        WHEN poi_confidence_score IS NOT NULL 
        THEN 50
        ELSE 0
    END as audit_score,
    
    created_at,
    updated_at

FROM core.attractions
ORDER BY last_score_update_at DESC NULLS LAST;

-- Add comment to view
COMMENT ON VIEW core.poi_audit_summary IS 'View para análise de auditoria dos scores e justificativas dos POIs';

-- Create function to update score timestamp automatically
CREATE OR REPLACE FUNCTION core.update_score_timestamp()
RETURNS TRIGGER AS $$
BEGIN
    -- Update last_score_update_at when any score field changes
    IF (OLD.poi_confidence_score IS DISTINCT FROM NEW.poi_confidence_score) OR
       (OLD.osm_data_quality_score IS DISTINCT FROM NEW.osm_data_quality_score) OR
       (OLD.rag_sources_quality_score IS DISTINCT FROM NEW.rag_sources_quality_score) OR
       (OLD.rag_content_quality_score IS DISTINCT FROM NEW.rag_content_quality_score) THEN
        NEW.last_score_update_at = NOW();
    END IF;
    
    -- Update poi_score_calculated_at when poi_confidence_score changes
    IF OLD.poi_confidence_score IS DISTINCT FROM NEW.poi_confidence_score THEN
        NEW.poi_score_calculated_at = NOW();
    END IF;
    
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Create trigger to automatically update timestamps
DROP TRIGGER IF EXISTS trigger_update_score_timestamp ON core.attractions;
CREATE TRIGGER trigger_update_score_timestamp
    BEFORE UPDATE ON core.attractions
    FOR EACH ROW
    EXECUTE FUNCTION core.update_score_timestamp();

-- Grant permissions
GRANT SELECT ON core.poi_audit_summary TO anon, authenticated;

-- Success message
DO $$
BEGIN
    RAISE NOTICE '✅ POI confidence score and audit fields added successfully!';
    RAISE NOTICE '📊 New fields: poi_confidence_score, poi_score_justification, processing_audit_log';
    RAISE NOTICE '📈 View created: core.poi_audit_summary';
    RAISE NOTICE '⚡ Triggers created for automatic timestamp updates';
END $$;
