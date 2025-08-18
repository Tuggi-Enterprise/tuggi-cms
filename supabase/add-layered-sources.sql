-- =========================================
-- SISTEMA DE FONTES CONFIÁVEIS EM CAMADAS
-- =========================================
-- Data: 2025-01-20
-- Descrição: Sistema de fontes em camadas (nacional + cidade) para melhor performance
-- =========================================

-- =========================================
-- 1) CRIAÇÃO DA TABELA DE FONTES POR CIDADE
-- =========================================

-- Tabela para fontes específicas por cidade
CREATE TABLE IF NOT EXISTS core.city_verification_sources (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  city_name text NOT NULL,
  country_code text NOT NULL,
  source_name text NOT NULL,
  source_type text NOT NULL CHECK (source_type IN ('government', 'academic', 'media', 'heritage', 'local')),
  base_url text NOT NULL,
  search_endpoint text,
  priority integer NOT NULL CHECK (priority >= 1 AND priority <= 10),
  is_active boolean DEFAULT true,
  created_at timestamp with time zone DEFAULT now(),
  updated_at timestamp with time zone DEFAULT now(),
  
  -- Constraints
  UNIQUE(city_name, country_code, source_name),
  FOREIGN KEY (country_code) REFERENCES core.countries(code) ON DELETE CASCADE
);

-- Índices para performance
CREATE INDEX IF NOT EXISTS idx_city_verification_sources_city_country 
ON core.city_verification_sources(city_name, country_code);

CREATE INDEX IF NOT EXISTS idx_city_verification_sources_active 
ON core.city_verification_sources(is_active) WHERE is_active = true;

-- =========================================
-- 2) CONFIGURAÇÕES DE BUSCA PARA FONTES DE CIDADE
-- =========================================

-- Tabela para configurações de busca das fontes de cidade
CREATE TABLE IF NOT EXISTS core.city_source_search_configs (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  source_id uuid NOT NULL REFERENCES core.city_verification_sources(id) ON DELETE CASCADE,
  search_type text NOT NULL DEFAULT 'keyword',
  query_template text NOT NULL,
  rate_limit_rps integer DEFAULT 10,
  timeout_ms integer DEFAULT 5000,
  cache_ttl_hours integer DEFAULT 24,
  created_at timestamp with time zone DEFAULT now(),
  
  UNIQUE(source_id)
);

-- Índices
CREATE INDEX IF NOT EXISTS idx_city_source_search_configs_source 
ON core.city_source_search_configs(source_id);

-- =========================================
-- 3) FONTES NACIONAIS (CAMADA 1 - ALTA PRIORIDADE)
-- =========================================

-- Brasil - Fontes Nacionais (apenas as que não existem)
DO $$
DECLARE
  br_id uuid;
BEGIN
  SELECT id INTO br_id FROM core.countries WHERE code = 'BR';
  
  IF br_id IS NOT NULL THEN
    RAISE NOTICE 'Verificando fontes NACIONAIS para Brasil (evitando duplicidades)';
    
    -- Apenas adicionar fontes que não existem
    INSERT INTO core.country_verification_sources (country_id, source_name, source_type, base_url, search_endpoint, priority) VALUES
      -- IPHAN já existe, mas vamos atualizar a prioridade se necessário
      (br_id, 'IPHAN - Instituto do Patrimônio Histórico', 'government', 'https://www.gov.br/iphan', '/pt-br/assuntos/preservacao/patrimonio-cultural', 1)
    ON CONFLICT (country_id, source_name) DO UPDATE SET
      priority = EXCLUDED.priority,
      updated_at = now();
      
    RAISE NOTICE 'Fontes brasileiras já existem - apenas atualizando prioridades se necessário';
  END IF;
END $$;

-- Espanha, EUA e Irlanda já têm fontes nacionais configuradas
-- Focando apenas nas fontes de cidade (CAMADA 2)

-- =========================================
-- 4) FONTES POR CIDADE (CAMADA 2 - ESPECÍFICAS)
-- =========================================

-- Brasil - Fontes por Cidade
INSERT INTO core.city_verification_sources (city_name, country_code, source_name, source_type, base_url, search_endpoint, priority) VALUES
  -- São Paulo
  ('São Paulo', 'BR', 'Prefeitura de São Paulo', 'government', 'https://www.prefeitura.sp.gov.br', '/cidade/secretarias/cultura/patrimonio', 1),
  ('São Paulo', 'BR', 'Secretaria de Cultura de SP', 'government', 'https://www.cultura.sp.gov.br', '/patrimonio-cultural', 2),
  ('São Paulo', 'BR', 'Arquivo Histórico de São Paulo', 'government', 'https://www.arquivohistorico.sp.gov.br', '/busca', 3),
  ('São Paulo', 'BR', 'Museu de Arte de São Paulo', 'heritage', 'https://masp.org.br', '/colecao', 4),
  ('São Paulo', 'BR', 'Pinacoteca do Estado', 'heritage', 'https://pinacoteca.org.br', '/colecao', 4),
  ('São Paulo', 'BR', 'Museu Paulista', 'heritage', 'https://www.mp.usp.br', '/colecao', 4),
  
  -- Rio de Janeiro
  ('Rio De Janeiro', 'BR', 'Prefeitura do Rio de Janeiro', 'government', 'https://www.rio.rj.gov.br', '/cultura/patrimonio', 1),
  ('Rio De Janeiro', 'BR', 'Secretaria de Cultura do RJ', 'government', 'https://www.cultura.rj.gov.br', '/patrimonio', 2),
  ('Rio De Janeiro', 'BR', 'Arquivo Nacional', 'government', 'https://www.gov.br/arquivonacional', '/pesquisa', 3),
  ('Rio De Janeiro', 'BR', 'Museu Nacional', 'heritage', 'https://www.museunacional.ufrj.br', '/colecao', 4),
  ('Rio De Janeiro', 'BR', 'Museu de Arte Moderna', 'heritage', 'https://mam.rio', '/colecao', 4),
  ('Rio De Janeiro', 'BR', 'Museu Histórico Nacional', 'heritage', 'https://mhn.museus.gov.br', '/colecao', 4),
  
  -- Belo Horizonte
  ('Belo Horizonte', 'BR', 'Prefeitura de Belo Horizonte', 'government', 'https://prefeitura.pbh.gov.br', '/cultura/patrimonio', 1),
  ('Belo Horizonte', 'BR', 'Secretaria de Cultura de MG', 'government', 'https://www.cultura.mg.gov.br', '/patrimonio', 2),
  ('Belo Horizonte', 'BR', 'Museu de Artes e Ofícios', 'heritage', 'https://www.mao.org.br', '/colecao', 4),
  ('Belo Horizonte', 'BR', 'Museu de Arte da Pampulha', 'heritage', 'https://mapabrasil.org.br', '/colecao', 4),
  
  -- Outras cidades brasileiras
  ('Bragança Paulista', 'BR', 'Prefeitura de Bragança Paulista', 'government', 'https://www.braganca.sp.gov.br', '/cultura', 1),
  ('Barueri', 'BR', 'Prefeitura de Barueri', 'government', 'https://www.barueri.sp.gov.br', '/cultura', 1),
  ('Carapicuíba', 'BR', 'Prefeitura de Carapicuíba', 'government', 'https://www.carapicuiba.sp.gov.br', '/cultura', 1),
  ('Osasco', 'BR', 'Prefeitura de Osasco', 'government', 'https://www.osasco.sp.gov.br', '/cultura', 1),
  ('Atibaia', 'BR', 'Prefeitura de Atibaia', 'government', 'https://www.atibaia.sp.gov.br', '/cultura', 1),
  ('Birigui', 'BR', 'Prefeitura de Birigui', 'government', 'https://www.birigui.sp.gov.br', '/cultura', 1),
  ('Jarinu', 'BR', 'Prefeitura de Jarinu', 'government', 'https://www.jarinu.sp.gov.br', '/cultura', 1)
ON CONFLICT (city_name, country_code, source_name) DO NOTHING;

-- Espanha - Fontes por Cidade
INSERT INTO core.city_verification_sources (city_name, country_code, source_name, source_type, base_url, search_endpoint, priority) VALUES
  -- Madrid
  ('Madrid', 'ES', 'Ayuntamiento de Madrid', 'government', 'https://www.madrid.es', '/cultura/patrimonio', 1),
  ('Madrid', 'ES', 'Museo del Prado', 'heritage', 'https://www.museodelprado.es', '/coleccion', 2),
  ('Madrid', 'ES', 'Museo Reina Sofía', 'heritage', 'https://www.museoreinasofia.es', '/coleccion', 2),
  ('Madrid', 'ES', 'Real Academia de la Historia', 'academic', 'https://www.rah.es', '/investigacion', 3),
  
  -- Barcelona
  ('Barcelona', 'ES', 'Ajuntament de Barcelona', 'government', 'https://www.barcelona.cat', '/cultura/patrimoni', 1),
  ('Barcelona', 'ES', 'Museu Nacional d''Art de Catalunya', 'heritage', 'https://www.museunacional.cat', '/colleccio', 2),
  ('Barcelona', 'ES', 'Museu Picasso', 'heritage', 'https://www.museupicasso.bcn.cat', '/colleccio', 2),
  ('Barcelona', 'ES', 'Arxiu Històric de Barcelona', 'government', 'https://ajuntament.barcelona.cat/arxiumunicipal', '/cerca', 3),
  
  -- Sevilha
  ('Sevilla', 'ES', 'Ayuntamiento de Sevilla', 'government', 'https://www.sevilla.org', '/cultura/patrimonio', 1),
  ('Sevilla', 'ES', 'Archivo General de Indias', 'government', 'https://www.culturaydeporte.gob.es/cultura/areas/archivos/mc/archivos/agi', '/buscar', 2),
  ('Sevilla', 'ES', 'Catedral de Sevilla', 'heritage', 'https://www.catedraldesevilla.es', '/patrimonio', 3)
ON CONFLICT (city_name, country_code, source_name) DO NOTHING;

-- Estados Unidos - Fontes por Cidade
INSERT INTO core.city_verification_sources (city_name, country_code, source_name, source_type, base_url, search_endpoint, priority) VALUES
  -- Nova York
  ('New York', 'US', 'NYC Department of Cultural Affairs', 'government', 'https://www.nyc.gov/site/dcla', '/cultural-organizations', 1),
  ('New York', 'US', 'Metropolitan Museum of Art', 'heritage', 'https://www.metmuseum.org', '/collection', 2),
  ('New York', 'US', 'Museum of Modern Art (MoMA)', 'heritage', 'https://www.moma.org', '/collection', 2),
  ('New York', 'US', 'Guggenheim Museum', 'heritage', 'https://www.guggenheim.org', '/collection', 2),
  ('New York', 'US', 'Brooklyn Museum', 'heritage', 'https://www.brooklynmuseum.org', '/collection', 3),
  
  -- Chicago
  ('Chicago', 'US', 'Chicago Department of Cultural Affairs', 'government', 'https://www.chicago.gov/city/en/depts/dca', '/cultural-grants', 1),
  ('Chicago', 'US', 'Art Institute of Chicago', 'heritage', 'https://www.artic.edu', '/collection', 2),
  ('Chicago', 'US', 'Field Museum', 'heritage', 'https://www.fieldmuseum.org', '/collection', 3),
  
  -- Los Angeles
  ('Los Angeles', 'US', 'LA Department of Cultural Affairs', 'government', 'https://culture.lacity.org', '/cultural-affairs', 1),
  ('Los Angeles', 'US', 'Los Angeles County Museum of Art', 'heritage', 'https://www.lacma.org', '/collection', 2),
  ('Los Angeles', 'US', 'Getty Center', 'heritage', 'https://www.getty.edu', '/collection', 2)
ON CONFLICT (city_name, country_code, source_name) DO NOTHING;

-- Irlanda - Fontes por Cidade
INSERT INTO core.city_verification_sources (city_name, country_code, source_name, source_type, base_url, search_endpoint, priority) VALUES
  -- Dublin
  ('Dublin', 'IE', 'Dublin City Council', 'government', 'https://www.dublincity.ie', '/culture-heritage', 1),
  ('Dublin', 'IE', 'National Gallery of Ireland', 'heritage', 'https://www.nationalgallery.ie', '/collection', 2),
  ('Dublin', 'IE', 'Irish Museum of Modern Art', 'heritage', 'https://imma.ie', '/collection', 2),
  ('Dublin', 'IE', 'Chester Beatty Library', 'heritage', 'https://chesterbeatty.ie', '/collection', 3),
  ('Dublin', 'IE', 'Dublin Castle', 'heritage', 'https://www.dublincastle.ie', '/history', 3),
  ('Dublin', 'IE', 'Kilmainham Gaol', 'heritage', 'https://kilmainhamgaolmuseum.ie', '/history', 3),
  ('Dublin', 'IE', 'Book of Kells', 'heritage', 'https://www.tcd.ie/visitors/book-of-kells', '/exhibition', 3),
  
  -- Cork
  ('Cork', 'IE', 'Cork City Council', 'government', 'https://www.corkcity.ie', '/culture-heritage', 1),
  ('Cork', 'IE', 'Crawford Art Gallery', 'heritage', 'https://crawfordartgallery.ie', '/collection', 2),
  
  -- Galway
  ('Galway', 'IE', 'Galway City Council', 'government', 'https://www.galwaycity.ie', '/culture-heritage', 1),
  ('Galway', 'IE', 'Galway City Museum', 'heritage', 'https://www.galwaycitymuseum.ie', '/collection', 2)
ON CONFLICT (city_name, country_code, source_name) DO NOTHING;

-- =========================================
-- 5) CONFIGURAÇÕES DE BUSCA PARA FONTES NACIONAIS
-- =========================================

-- Configurações já existem para fontes nacionais
-- Focando apenas nas configurações de fontes de cidade

-- =========================================
-- 6) CONFIGURAÇÕES DE BUSCA PARA FONTES DE CIDADE
-- =========================================

-- Configurações para fontes de cidade brasileiras
INSERT INTO core.city_source_search_configs (source_id, search_type, query_template, rate_limit_rps, timeout_ms, cache_ttl_hours)
SELECT 
  cvs.id,
  'keyword',
  CASE 
    WHEN cvs.source_name LIKE '%Prefeitura%' THEN '?q={query}&tipo=patrimonio&cidade=' || cvs.city_name
    WHEN cvs.source_name LIKE '%Secretaria%' THEN '?q={query}&tipo=cultural&estado=sp'
    WHEN cvs.source_name LIKE '%Arquivo%' THEN '?q={query}&tipo=historico'
    WHEN cvs.source_name LIKE '%Museu%' THEN '?q={query}&tipo=arte&cidade=' || cvs.city_name
    WHEN cvs.source_name LIKE '%Pinacoteca%' THEN '?q={query}&tipo=arte'
    ELSE '?q={query}&cidade=' || cvs.city_name
  END,
  CASE 
    WHEN cvs.source_name LIKE '%Prefeitura%' THEN 6
    WHEN cvs.source_name LIKE '%Secretaria%' THEN 5
    WHEN cvs.source_name LIKE '%Arquivo%' THEN 4
    WHEN cvs.source_name LIKE '%Museu%' THEN 3
    WHEN cvs.source_name LIKE '%Pinacoteca%' THEN 3
    ELSE 5
  END,
  CASE 
    WHEN cvs.source_name LIKE '%Prefeitura%' THEN 7000
    WHEN cvs.source_name LIKE '%Secretaria%' THEN 8000
    WHEN cvs.source_name LIKE '%Arquivo%' THEN 10000
    WHEN cvs.source_name LIKE '%Museu%' THEN 12000
    WHEN cvs.source_name LIKE '%Pinacoteca%' THEN 12000
    ELSE 8000
  END,
  CASE 
    WHEN cvs.source_name LIKE '%Prefeitura%' THEN 24
    WHEN cvs.source_name LIKE '%Secretaria%' THEN 36
    WHEN cvs.source_name LIKE '%Arquivo%' THEN 72
    WHEN cvs.source_name LIKE '%Museu%' THEN 96
    WHEN cvs.source_name LIKE '%Pinacoteca%' THEN 96
    ELSE 48
  END
FROM core.city_verification_sources cvs
WHERE cvs.country_code = 'BR'
  AND cvs.priority <= 4
ON CONFLICT DO NOTHING;

-- =========================================
-- 7) FUNÇÃO PARA BUSCAR FONTES EM CAMADAS
-- =========================================

-- Função para buscar fontes por cidade e país
CREATE OR REPLACE FUNCTION core.get_verification_sources_layered(
  p_city_name text,
  p_country_code text,
  p_limit integer DEFAULT 10
)
RETURNS TABLE (
  source_name text,
  source_type text,
  base_url text,
  search_endpoint text,
  priority integer,
  layer text,
  search_type text,
  query_template text,
  rate_limit_rps integer,
  timeout_ms integer,
  cache_ttl_hours integer
) AS $$
BEGIN
  RETURN QUERY
  
  -- CAMADA 1: Fontes NACIONAIS (prioridade 1-3)
  SELECT 
    cvs.source_name,
    cvs.source_type,
    cvs.base_url,
    cvs.search_endpoint,
    cvs.priority,
    'national'::text as layer,
    ssc.search_type,
    ssc.query_template,
    ssc.rate_limit_rps,
    ssc.timeout_ms,
    ssc.cache_ttl_hours
  FROM core.country_verification_sources cvs
  JOIN core.countries c ON cvs.country_id = c.id
  LEFT JOIN core.source_search_configs ssc ON cvs.id = ssc.source_id
  WHERE c.code = p_country_code
    AND cvs.is_active = true
    AND cvs.priority <= 3
  
  UNION ALL
  
  -- CAMADA 2: Fontes de CIDADE (prioridade 1-4)
  SELECT 
    cvs.source_name,
    cvs.source_type,
    cvs.base_url,
    cvs.search_endpoint,
    cvs.priority,
    'city'::text as layer,
    cssc.search_type,
    cssc.query_template,
    cssc.rate_limit_rps,
    cssc.timeout_ms,
    cssc.cache_ttl_hours
  FROM core.city_verification_sources cvs
  LEFT JOIN core.city_source_search_configs cssc ON cvs.id = cssc.source_id
  WHERE cvs.city_name ILIKE p_city_name
    AND cvs.country_code = p_country_code
    AND cvs.is_active = true
    AND cvs.priority <= 4
  
  ORDER BY layer DESC, priority ASC, source_name
  LIMIT p_limit;
END;
$$ LANGUAGE plpgsql;

-- =========================================
-- 8) VIEW PARA MONITORAMENTO DAS FONTES
-- =========================================

-- View para monitorar fontes em camadas
CREATE OR REPLACE VIEW core.v_verification_sources_layered AS
SELECT 
  'national' as layer,
  c.code as country_code,
  c.name as country_name,
  NULL as city_name,
  cvs.source_name,
  cvs.source_type,
  cvs.base_url,
  cvs.priority,
  cvs.is_active,
  ssc.search_type,
  ssc.rate_limit_rps,
  ssc.timeout_ms,
  ssc.cache_ttl_hours
FROM core.country_verification_sources cvs
JOIN core.countries c ON cvs.country_id = c.id
LEFT JOIN core.source_search_configs ssc ON cvs.id = ssc.source_id

UNION ALL

SELECT 
  'city' as layer,
  cvs.country_code,
  c.name as country_name,
  cvs.city_name,
  cvs.source_name,
  cvs.source_type,
  cvs.base_url,
  cvs.priority,
  cvs.is_active,
  cssc.search_type,
  cssc.rate_limit_rps,
  cssc.timeout_ms,
  cssc.cache_ttl_hours
FROM core.city_verification_sources cvs
JOIN core.countries c ON cvs.country_code = c.code
LEFT JOIN core.city_source_search_configs cssc ON cvs.id = cssc.source_id;

-- =========================================
-- 9) RLS POLICIES
-- =========================================

-- Políticas RLS para city_verification_sources
ALTER TABLE core.city_verification_sources ENABLE ROW LEVEL SECURITY;

CREATE POLICY "CMS users can view city verification sources" ON core.city_verification_sources
  FOR SELECT USING (
    auth.jwt() ->> 'email' LIKE '%@tuggi.app'
  );

-- Políticas RLS para city_source_search_configs
ALTER TABLE core.city_source_search_configs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "CMS users can view city source search configs" ON core.city_source_search_configs
  FOR SELECT USING (
    auth.jwt() ->> 'email' LIKE '%@tuggi.app'
  );

-- =========================================
-- 10) VERIFICAÇÃO FINAL
-- =========================================

-- Mostrar resumo das fontes em camadas
SELECT 
  layer,
  country_code,
  country_name,
  city_name,
  COUNT(*) as total_sources,
  COUNT(CASE WHEN is_active = true THEN 1 END) as active_sources,
  COUNT(CASE WHEN source_type = 'government' THEN 1 END) as government_sources,
  COUNT(CASE WHEN source_type = 'heritage' THEN 1 END) as heritage_sources,
  COUNT(CASE WHEN source_type = 'academic' THEN 1 END) as academic_sources,
  COUNT(CASE WHEN source_type = 'media' THEN 1 END) as media_sources,
  COUNT(CASE WHEN source_type = 'local' THEN 1 END) as local_sources
FROM core.v_verification_sources_layered
WHERE country_code IN ('BR', 'ES', 'US', 'IE')
GROUP BY layer, country_code, country_name, city_name
ORDER BY country_code, layer DESC, city_name;

-- Mostrar fontes nacionais por prioridade
SELECT 
  'NATIONAL' as layer,
  c.code as country_code,
  c.name as country_name,
  cvs.source_name,
  cvs.source_type,
  cvs.priority,
  cvs.is_active
FROM core.country_verification_sources cvs
JOIN core.countries c ON cvs.country_id = c.id
WHERE c.code IN ('BR', 'ES', 'US', 'IE')
  AND cvs.priority <= 4
  AND cvs.is_active = true
ORDER BY c.code, cvs.priority, cvs.source_name;

-- Mostrar fontes de cidade por país
SELECT 
  'CITY' as layer,
  cvs.country_code,
  c.name as country_name,
  cvs.city_name,
  cvs.source_name,
  cvs.source_type,
  cvs.priority,
  cvs.is_active
FROM core.city_verification_sources cvs
JOIN core.countries c ON cvs.country_code = c.code
WHERE cvs.country_code IN ('BR', 'ES', 'US', 'IE')
  AND cvs.priority <= 4
  AND cvs.is_active = true
ORDER BY cvs.country_code, cvs.city_name, cvs.priority, cvs.source_name;
