-- ============================================================================
-- RAG ATIVO - CAMPOS PARA CONTEÚDO EXTRAÍDO DAS FONTES
-- ============================================================================
-- Adiciona campos para armazenar conteúdo real extraído das URLs descobertas

-- ============================================================================
-- 1. CONTEÚDO EXTRAÍDO DAS FONTES
-- ============================================================================

-- Conteúdo real extraído via scraping
ALTER TABLE core.attractions 
ADD COLUMN IF NOT EXISTS rag_scraped_content jsonb,
ADD COLUMN IF NOT EXISTS rag_content_quality_score numeric(5,2) DEFAULT 0,
ADD COLUMN IF NOT EXISTS rag_keywords_extracted text[],
ADD COLUMN IF NOT EXISTS rag_facts_extracted jsonb;

-- ============================================================================
-- 2. METADADOS DE SCRAPING
-- ============================================================================

-- Informações sobre o processo de scraping
ALTER TABLE core.attractions 
ADD COLUMN IF NOT EXISTS rag_scraping_last_attempt timestamp with time zone,
ADD COLUMN IF NOT EXISTS rag_scraping_success_count integer DEFAULT 0,
ADD COLUMN IF NOT EXISTS rag_scraping_failure_count integer DEFAULT 0,
ADD COLUMN IF NOT EXISTS rag_urls_scraped text[], -- URLs que foram processadas
ADD COLUMN IF NOT EXISTS rag_urls_failed text[]; -- URLs que falharam

-- ============================================================================
-- 3. CACHE COMPARTILHADO POR CIDADE
-- ============================================================================

-- Tabela para cache compartilhado entre POIs da mesma cidade
CREATE TABLE IF NOT EXISTS core.rag_city_cache (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  
  -- Identificação da localização
  city text NOT NULL,
  country text NOT NULL,
  state text,
  
  -- Fontes encontradas para esta cidade
  sources_found jsonb NOT NULL,
  sources_quality_score numeric(5,2) DEFAULT 0,
  sources_count integer DEFAULT 0,
  
  -- Conteúdo extraído das fontes da cidade
  scraped_content jsonb,
  content_quality_score numeric(5,2) DEFAULT 0,
  
  -- Tokens e fatos comuns da cidade
  common_keywords text[],
  common_facts jsonb,
  historical_periods text[],
  
  -- Metadados do cache
  created_at timestamp with time zone DEFAULT now(),
  last_updated timestamp with time zone DEFAULT now(),
  last_used timestamp with time zone DEFAULT now(),
  usage_count integer DEFAULT 0,
  
  -- Performance metrics
  avg_description_quality numeric(5,2) DEFAULT 0,
  total_pois_using_cache integer DEFAULT 0,
  
  CONSTRAINT unique_city_cache UNIQUE (city, country, state)
);

-- ============================================================================
-- 4. ÍNDICES PARA PERFORMANCE
-- ============================================================================

-- Índices para campos RAG ativo
CREATE INDEX IF NOT EXISTS idx_attractions_rag_content_quality 
ON core.attractions(rag_content_quality_score DESC) 
WHERE rag_content_quality_score > 0;

CREATE INDEX IF NOT EXISTS idx_attractions_rag_scraping_success 
ON core.attractions(rag_scraping_success_count DESC) 
WHERE rag_scraping_success_count > 0;

CREATE INDEX IF NOT EXISTS idx_attractions_rag_keywords_gin 
ON core.attractions USING GIN(rag_keywords_extracted);

-- Índices para cache de cidade
CREATE INDEX IF NOT EXISTS idx_rag_city_cache_location 
ON core.rag_city_cache(country, city);

CREATE INDEX IF NOT EXISTS idx_rag_city_cache_quality 
ON core.rag_city_cache(sources_quality_score DESC);

CREATE INDEX IF NOT EXISTS idx_rag_city_cache_last_used 
ON core.rag_city_cache(last_used DESC);

CREATE INDEX IF NOT EXISTS idx_rag_city_cache_usage_count 
ON core.rag_city_cache(usage_count DESC);

-- ============================================================================
-- 5. FUNÇÕES AUXILIARES
-- ============================================================================

-- Função para calcular score geral de RAG ativo
CREATE OR REPLACE FUNCTION calculate_rag_active_score(
    p_sources_quality numeric DEFAULT 0,
    p_content_quality numeric DEFAULT 0,
    p_completeness numeric DEFAULT 0,
    p_scraping_success_rate numeric DEFAULT 0
) RETURNS numeric AS $$
BEGIN
    -- Score baseado em: Qualidade das fontes (30%) + Qualidade do conteúdo (40%) + 
    -- Completude (20%) + Taxa de sucesso do scraping (10%)
    
    RETURN ROUND(
        (COALESCE(p_sources_quality, 0) * 0.3) +
        (COALESCE(p_content_quality, 0) * 0.4) +
        (COALESCE(p_completeness, 0) * 0.2) +
        (COALESCE(p_scraping_success_rate, 0) * 0.1), 2
    );
END;
$$ LANGUAGE plpgsql;

-- Função para limpar cache antigo (>30 dias sem uso)
CREATE OR REPLACE FUNCTION cleanup_old_rag_cache() RETURNS integer AS $$
DECLARE
    deleted_count integer;
BEGIN
    DELETE FROM core.rag_city_cache 
    WHERE last_used < NOW() - INTERVAL '30 days';
    
    GET DIAGNOSTICS deleted_count = ROW_COUNT;
    RETURN deleted_count;
END;
$$ LANGUAGE plpgsql;

-- ============================================================================
-- 6. VIEW PARA ANÁLISE DE PERFORMANCE RAG
-- ============================================================================

CREATE OR REPLACE VIEW core.v_rag_performance AS
SELECT 
    a.city,
    a.country,
    COUNT(*) as total_pois,
    AVG(a.rag_sources_quality_score) as avg_sources_quality,
    AVG(a.rag_content_quality_score) as avg_content_quality,
    AVG(a.rag_completeness_score) as avg_completeness,
    AVG(a.rag_scraping_success_count::numeric / NULLIF(a.rag_scraping_success_count + a.rag_scraping_failure_count, 0) * 100) as avg_scraping_success_rate,
    COUNT(*) FILTER (WHERE a.rag_scraped_content IS NOT NULL) as pois_with_scraped_content,
    c.usage_count as cache_usage_count,
    c.last_updated as cache_last_updated
FROM core.attractions a
LEFT JOIN core.rag_city_cache c ON c.city = a.city AND c.country = a.country
WHERE a.rag_sources_quality_score IS NOT NULL
GROUP BY a.city, a.country, c.usage_count, c.last_updated
ORDER BY avg_sources_quality DESC;

-- ============================================================================
-- 7. COMENTÁRIOS PARA DOCUMENTAÇÃO
-- ============================================================================

COMMENT ON COLUMN core.attractions.rag_scraped_content IS 'Conteúdo real extraído das fontes via scraping';
COMMENT ON COLUMN core.attractions.rag_content_quality_score IS 'Score de qualidade do conteúdo extraído (0-100)';
COMMENT ON COLUMN core.attractions.rag_keywords_extracted IS 'Palavras-chave extraídas do conteúdo das fontes';
COMMENT ON COLUMN core.attractions.rag_facts_extracted IS 'Fatos específicos extraídos do conteúdo';

COMMENT ON TABLE core.rag_city_cache IS 'Cache compartilhado de dados RAG por cidade para reutilização entre POIs';
COMMENT ON COLUMN core.rag_city_cache.sources_found IS 'Fontes descobertas para esta cidade';
COMMENT ON COLUMN core.rag_city_cache.scraped_content IS 'Conteúdo extraído das fontes da cidade';
COMMENT ON COLUMN core.rag_city_cache.usage_count IS 'Número de POIs que utilizaram este cache';

COMMENT ON VIEW core.v_rag_performance IS 'View para análise de performance do sistema RAG ativo';

-- ============================================================================
