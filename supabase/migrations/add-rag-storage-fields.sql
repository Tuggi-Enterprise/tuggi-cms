-- ============================================================================
-- RAG (RETRIEVAL-AUGMENTED GENERATION) STORAGE FIELDS
-- ============================================================================
-- Adiciona campos para armazenar dados RAG diretamente na tabela attractions
-- Isso permite reutilizar pesquisas e melhorar descrições ao longo do tempo

-- ============================================================================
-- 1. FONTES RAG ENCONTRADAS
-- ============================================================================

-- Armazenar fontes dinâmicas encontradas durante a pesquisa RAG
ALTER TABLE core.attractions 
ADD COLUMN IF NOT EXISTS rag_sources_found jsonb,
ADD COLUMN IF NOT EXISTS rag_sources_last_search timestamp with time zone,
ADD COLUMN IF NOT EXISTS rag_sources_quality_score numeric(5,2) CHECK (rag_sources_quality_score >= 0 AND rag_sources_quality_score <= 100);

-- ============================================================================
-- 2. CONTEÚDO EXTRAÍDO DAS FONTES
-- ============================================================================

-- Armazenar conteúdo relevante extraído das fontes RAG
ALTER TABLE core.attractions 
ADD COLUMN IF NOT EXISTS rag_content_extracted jsonb,
ADD COLUMN IF NOT EXISTS rag_content_summary text,
ADD COLUMN IF NOT EXISTS rag_content_last_updated timestamp with time zone;

-- ============================================================================
-- 3. TOKENS E FATOS VERIFICÁVEIS EXTRAÍDOS
-- ============================================================================

-- Tokens importantes extraídos (anos, nomes, eventos)
ALTER TABLE core.attractions 
ADD COLUMN IF NOT EXISTS rag_verified_facts jsonb,
ADD COLUMN IF NOT EXISTS rag_temporal_tokens text[], -- Anos, datas importantes
ADD COLUMN IF NOT EXISTS rag_entity_tokens text[], -- Nomes de pessoas, arquitetos
ADD COLUMN IF NOT EXISTS rag_event_tokens text[]; -- Eventos históricos

-- ============================================================================
-- 4. LINKS DE REFERÊNCIA ESPECÍFICOS
-- ============================================================================

-- Links específicos encontrados para este POI
ALTER TABLE core.attractions 
ADD COLUMN IF NOT EXISTS reference_links text[], -- Links adicionados pelo usuário
ADD COLUMN IF NOT EXISTS rag_discovered_links jsonb, -- Links descobertos automaticamente
ADD COLUMN IF NOT EXISTS rag_wikipedia_links text[], -- Links Wikipedia específicos
ADD COLUMN IF NOT EXISTS rag_official_sources text[]; -- Sites oficiais descobertos

-- ============================================================================
-- 5. METADADOS DE QUALIDADE RAG
-- ============================================================================

-- Métricas de qualidade dos dados RAG
ALTER TABLE core.attractions 
ADD COLUMN IF NOT EXISTS rag_completeness_score numeric(5,2) DEFAULT 0, -- 0-100, quão completos são os dados
ADD COLUMN IF NOT EXISTS rag_reliability_score numeric(5,2) DEFAULT 0, -- 0-100, confiabilidade das fontes
ADD COLUMN IF NOT EXISTS rag_freshness_days integer DEFAULT 0, -- Dias desde última atualização RAG
ADD COLUMN IF NOT EXISTS rag_source_count integer DEFAULT 0; -- Número de fontes encontradas

-- ============================================================================
-- 6. CACHE DE PESQUISAS RAG
-- ============================================================================

-- Cache das últimas pesquisas RAG realizadas
ALTER TABLE core.attractions 
ADD COLUMN IF NOT EXISTS rag_search_cache jsonb,
ADD COLUMN IF NOT EXISTS rag_search_terms_used text[],
ADD COLUMN IF NOT EXISTS rag_last_successful_search timestamp with time zone,
ADD COLUMN IF NOT EXISTS rag_search_failure_count integer DEFAULT 0;

-- ============================================================================
-- 7. ÍNDICES PARA PERFORMANCE
-- ============================================================================

-- Índices para consultas RAG eficientes
CREATE INDEX IF NOT EXISTS idx_attractions_rag_sources_quality 
ON core.attractions(rag_sources_quality_score DESC) 
WHERE rag_sources_quality_score IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_attractions_rag_completeness 
ON core.attractions(rag_completeness_score DESC) 
WHERE rag_completeness_score > 0;

CREATE INDEX IF NOT EXISTS idx_attractions_rag_freshness 
ON core.attractions(rag_freshness_days ASC) 
WHERE rag_freshness_days IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_attractions_rag_last_search 
ON core.attractions(rag_last_successful_search DESC) 
WHERE rag_last_successful_search IS NOT NULL;

-- Índices GIN para campos JSONB
CREATE INDEX IF NOT EXISTS idx_attractions_rag_sources_found_gin 
ON core.attractions USING GIN(rag_sources_found);

CREATE INDEX IF NOT EXISTS idx_attractions_rag_content_extracted_gin 
ON core.attractions USING GIN(rag_content_extracted);

CREATE INDEX IF NOT EXISTS idx_attractions_rag_verified_facts_gin 
ON core.attractions USING GIN(rag_verified_facts);

-- Índices para arrays de texto
CREATE INDEX IF NOT EXISTS idx_attractions_rag_temporal_tokens_gin 
ON core.attractions USING GIN(rag_temporal_tokens);

CREATE INDEX IF NOT EXISTS idx_attractions_reference_links_gin 
ON core.attractions USING GIN(reference_links);

-- ============================================================================
-- 8. COMENTÁRIOS PARA DOCUMENTAÇÃO
-- ============================================================================

COMMENT ON COLUMN core.attractions.rag_sources_found IS 'Fontes RAG encontradas em formato JSON com metadados';
COMMENT ON COLUMN core.attractions.rag_sources_quality_score IS 'Score de qualidade das fontes RAG (0-100)';
COMMENT ON COLUMN core.attractions.rag_content_extracted IS 'Conteúdo relevante extraído das fontes RAG';
COMMENT ON COLUMN core.attractions.rag_verified_facts IS 'Fatos verificáveis extraídos via RAG em formato JSON';
COMMENT ON COLUMN core.attractions.rag_temporal_tokens IS 'Tokens temporais (anos, datas) extraídos';
COMMENT ON COLUMN core.attractions.rag_entity_tokens IS 'Tokens de entidades (pessoas, arquitetos) extraídos';
COMMENT ON COLUMN core.attractions.reference_links IS 'Links de referência adicionados pelo usuário';
COMMENT ON COLUMN core.attractions.rag_discovered_links IS 'Links descobertos automaticamente via RAG';
COMMENT ON COLUMN core.attractions.rag_completeness_score IS 'Score de completude dos dados RAG (0-100)';
COMMENT ON COLUMN core.attractions.rag_reliability_score IS 'Score de confiabilidade das fontes RAG (0-100)';
COMMENT ON COLUMN core.attractions.rag_search_cache IS 'Cache das últimas pesquisas RAG realizadas';

-- ============================================================================
-- 9. FUNÇÃO PARA CALCULAR SCORE RAG GERAL
-- ============================================================================

CREATE OR REPLACE FUNCTION calculate_rag_overall_score(
    p_quality_score numeric DEFAULT 0,
    p_completeness_score numeric DEFAULT 0,
    p_reliability_score numeric DEFAULT 0,
    p_freshness_days integer DEFAULT 999
) RETURNS numeric AS $$
BEGIN
    -- Calcular score geral baseado em múltiplos fatores
    -- Qualidade (40%) + Completude (30%) + Confiabilidade (20%) + Frescor (10%)
    
    RETURN ROUND(
        (COALESCE(p_quality_score, 0) * 0.4) +
        (COALESCE(p_completeness_score, 0) * 0.3) +
        (COALESCE(p_reliability_score, 0) * 0.2) +
        (CASE 
            WHEN p_freshness_days <= 7 THEN 100 * 0.1
            WHEN p_freshness_days <= 30 THEN 80 * 0.1
            WHEN p_freshness_days <= 90 THEN 60 * 0.1
            WHEN p_freshness_days <= 180 THEN 40 * 0.1
            ELSE 20 * 0.1
        END), 2
    );
END;
$$ LANGUAGE plpgsql;

-- ============================================================================
-- 10. VIEW PARA CONSULTAS RAG OTIMIZADAS
-- ============================================================================

CREATE OR REPLACE VIEW core.v_attractions_rag_quality AS
SELECT 
    id,
    name,
    city,
    country,
    rag_sources_quality_score,
    rag_completeness_score,
    rag_reliability_score,
    rag_freshness_days,
    rag_source_count,
    calculate_rag_overall_score(
        rag_sources_quality_score,
        rag_completeness_score, 
        rag_reliability_score,
        rag_freshness_days
    ) as rag_overall_score,
    rag_last_successful_search,
    CASE 
        WHEN rag_freshness_days <= 7 THEN 'fresh'
        WHEN rag_freshness_days <= 30 THEN 'recent'
        WHEN rag_freshness_days <= 90 THEN 'stale'
        ELSE 'outdated'
    END as rag_freshness_status,
    CASE
        WHEN rag_sources_quality_score >= 80 THEN 'excellent'
        WHEN rag_sources_quality_score >= 60 THEN 'good'
        WHEN rag_sources_quality_score >= 40 THEN 'fair'
        ELSE 'poor'
    END as rag_quality_status
FROM core.attractions
WHERE rag_sources_quality_score IS NOT NULL;

COMMENT ON VIEW core.v_attractions_rag_quality IS 'View otimizada para análise de qualidade dos dados RAG';

-- ============================================================================
