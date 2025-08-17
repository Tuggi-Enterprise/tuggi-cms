-- =========================================
-- ADICIONAR FONTES CONFIÁVEIS DE VERIFICAÇÃO
-- =========================================
-- Data: 2025-01-20
-- Descrição: Adicionar sites confiáveis de verificação para BR, ES, US, IE
-- =========================================

-- =========================================
-- 0) VERIFICAÇÃO INICIAL - PAÍSES DISPONÍVEIS
-- =========================================

DO $$
BEGIN
  RAISE NOTICE '=== VERIFICAÇÃO DE PAÍSES DISPONÍVEIS ===';
  
  -- Verificar se os países necessários existem
  IF EXISTS (SELECT 1 FROM core.countries WHERE code = 'BR') THEN
    RAISE NOTICE '✅ Brasil (BR) encontrado';
  ELSE
    RAISE NOTICE '❌ Brasil (BR) NÃO encontrado';
  END IF;
  
  IF EXISTS (SELECT 1 FROM core.countries WHERE code = 'ES') THEN
    RAISE NOTICE '✅ Espanha (ES) encontrada';
  ELSE
    RAISE NOTICE '❌ Espanha (ES) NÃO encontrada';
  END IF;
  
  IF EXISTS (SELECT 1 FROM core.countries WHERE code = 'US') THEN
    RAISE NOTICE '✅ Estados Unidos (US) encontrados';
  ELSE
    RAISE NOTICE '❌ Estados Unidos (US) NÃO encontrados';
  END IF;
  
  IF EXISTS (SELECT 1 FROM core.countries WHERE code = 'IE') THEN
    RAISE NOTICE '✅ Irlanda (IE) encontrada';
  ELSE
    RAISE NOTICE '❌ Irlanda (IE) NÃO encontrada';
  END IF;
  
  RAISE NOTICE '=== FIM DA VERIFICAÇÃO ===';
END $$;

-- =========================================
-- 1) BRASIL - FONTES ADICIONAIS
-- =========================================

-- Obter ID do Brasil
DO $$
DECLARE
  br_id uuid;
BEGIN
  SELECT id INTO br_id FROM core.countries WHERE code = 'BR';
  
  -- Verificar se o Brasil existe
  IF br_id IS NULL THEN
    RAISE NOTICE 'País BR (Brasil) não encontrado na tabela core.countries';
    RETURN;
  END IF;
  
  RAISE NOTICE 'Adicionando fontes para Brasil (ID: %)', br_id;
  
  -- Adicionar fontes brasileiras adicionais
  INSERT INTO core.country_verification_sources (country_id, source_name, source_type, base_url, search_endpoint, priority) VALUES
    -- Fontes governamentais
    (br_id, 'Ministério da Cultura', 'government', 'https://www.gov.br/cultura', '/pt-br/assuntos', 2),
    (br_id, 'IBRAM - Instituto Brasileiro de Museus', 'government', 'https://www.gov.br/museus', '/pt-br', 3),
    (br_id, 'Fundação Palmares', 'government', 'https://www.gov.br/palmares', '/pt-br', 4),
    (br_id, 'Biblioteca Nacional', 'government', 'https://www.bn.gov.br', '/busca', 5),
    
    -- Fontes acadêmicas
    (br_id, 'SciELO Brasil', 'academic', 'https://www.scielo.br', '/search', 6),
    (br_id, 'CAPES - Portal de Periódicos', 'academic', 'https://www-periodicos-capes-gov-br.ezproxy.ufsc.br', '/search', 7),
    
    -- Fontes de mídia confiáveis
    (br_id, 'Agência Brasil', 'media', 'https://agenciabrasil.ebc.com.br', '/busca', 8),
    (br_id, 'BBC Brasil', 'media', 'https://www.bbc.com/portuguese', '/search', 9),
    
    -- Fontes especializadas
    (br_id, 'Museu de Arte de São Paulo', 'heritage', 'https://masp.org.br', '/busca', 10),
    (br_id, 'Museu Nacional', 'heritage', 'https://www.museunacional.ufrj.br', '/busca', 10),
    (br_id, 'Instituto Moreira Salles', 'heritage', 'https://ims.com.br', '/busca', 10),
    (br_id, 'Fundação Getúlio Vargas', 'academic', 'https://portal.fgv.br', '/busca', 10)
  ON CONFLICT (country_id, source_name) DO NOTHING;
END $$;

-- =========================================
-- 2) ESPANHA - FONTES ADICIONAIS
-- =========================================

DO $$
DECLARE
  es_id uuid;
BEGIN
  SELECT id INTO es_id FROM core.countries WHERE code = 'ES';
  
  -- Verificar se a Espanha existe
  IF es_id IS NULL THEN
    RAISE NOTICE 'País ES (Espanha) não encontrado na tabela core.countries';
    RETURN;
  END IF;
  
  RAISE NOTICE 'Adicionando fontes para Espanha (ID: %)', es_id;
  
  -- Adicionar fontes espanholas adicionais
  INSERT INTO core.country_verification_sources (country_id, source_name, source_type, base_url, search_endpoint, priority) VALUES
    -- Fontes governamentais
    (es_id, 'Ministerio de Cultura y Deporte', 'government', 'https://www.culturaydeporte.gob.es', '/buscar', 2),
    (es_id, 'Instituto del Patrimonio Cultural de España', 'government', 'https://ipce.culturaydeporte.gob.es', '/buscar', 3),
    (es_id, 'Archivo General de Indias', 'government', 'https://www.culturaydeporte.gob.es/cultura/areas/archivos/mc/archivos/agi', '/buscar', 4),
    (es_id, 'Biblioteca Nacional de España', 'government', 'https://www.bne.es', '/buscar', 5),
    
    -- Fontes acadêmicas
    (es_id, 'CSIC - Consejo Superior de Investigaciones Científicas', 'academic', 'https://www.csic.es', '/buscar', 6),
    (es_id, 'Universidad Complutense de Madrid', 'academic', 'https://www.ucm.es', '/buscar', 7),
    
    -- Fontes de mídia confiáveis
    (es_id, 'El País', 'media', 'https://elpais.com', '/buscar', 8),
    (es_id, 'El Mundo', 'media', 'https://www.elmundo.es', '/buscar', 9),
    (es_id, 'ABC', 'media', 'https://www.abc.es', '/buscar', 10),
    
    -- Fontes especializadas
    (es_id, 'Museo del Prado', 'heritage', 'https://www.museodelprado.es', '/buscar', 10),
    (es_id, 'Museo Reina Sofía', 'heritage', 'https://www.museoreinasofia.es', '/buscar', 10),
    (es_id, 'Fundación Telefónica', 'heritage', 'https://www.fundaciontelefonica.com', '/buscar', 10),
    (es_id, 'Real Academia de la Historia', 'academic', 'https://www.rah.es', '/buscar', 10)
  ON CONFLICT (country_id, source_name) DO NOTHING;
END $$;

-- =========================================
-- 3) ESTADOS UNIDOS - FONTES ADICIONAIS
-- =========================================

DO $$
DECLARE
  us_id uuid;
BEGIN
  SELECT id INTO us_id FROM core.countries WHERE code = 'US';
  
  -- Verificar se os Estados Unidos existem
  IF us_id IS NULL THEN
    RAISE NOTICE 'País US (Estados Unidos) não encontrado na tabela core.countries';
    RETURN;
  END IF;
  
  RAISE NOTICE 'Adicionando fontes para Estados Unidos (ID: %)', us_id;
  
  -- Adicionar fontes americanas adicionais
  INSERT INTO core.country_verification_sources (country_id, source_name, source_type, base_url, search_endpoint, priority) VALUES
    -- Fontes governamentais
    (us_id, 'National Archives', 'government', 'https://www.archives.gov', '/search', 3),
    (us_id, 'Library of Congress - Digital Collections', 'government', 'https://www.loc.gov/collections', '/search', 4),
    (us_id, 'Smithsonian Institution Archives', 'government', 'https://siarchives.si.edu', '/search', 5),
    (us_id, 'National Gallery of Art', 'government', 'https://www.nga.gov', '/search', 6),
    
    -- Fontes acadêmicas
    (us_id, 'JSTOR', 'academic', 'https://www.jstor.org', '/search', 7),
    (us_id, 'Google Scholar', 'academic', 'https://scholar.google.com', '/search', 8),
    (us_id, 'Harvard University Library', 'academic', 'https://library.harvard.edu', '/search', 9),
    (us_id, 'Stanford University Libraries', 'academic', 'https://library.stanford.edu', '/search', 10),
    
    -- Fontes de mídia confiáveis
    (us_id, 'The New York Times', 'media', 'https://www.nytimes.com', '/search', 10),
    (us_id, 'The Washington Post', 'media', 'https://www.washingtonpost.com', '/search', 10),
    (us_id, 'NPR - National Public Radio', 'media', 'https://www.npr.org', '/search', 10),
    (us_id, 'PBS - Public Broadcasting Service', 'media', 'https://www.pbs.org', '/search', 10),
    
    -- Fontes especializadas
    (us_id, 'Metropolitan Museum of Art', 'heritage', 'https://www.metmuseum.org', '/search', 10),
    (us_id, 'Museum of Modern Art (MoMA)', 'heritage', 'https://www.moma.org', '/search', 10),
    (us_id, 'Guggenheim Museum', 'heritage', 'https://www.guggenheim.org', '/search', 10),
    (us_id, 'American Museum of Natural History', 'heritage', 'https://www.amnh.org', '/search', 10),
    (us_id, 'Brooklyn Museum', 'heritage', 'https://www.brooklynmuseum.org', '/search', 10),
    (us_id, 'Art Institute of Chicago', 'heritage', 'https://www.artic.edu', '/search', 10)
  ON CONFLICT (country_id, source_name) DO NOTHING;
END $$;

-- =========================================
-- 4) IRLANDA - FONTES ADICIONAIS
-- =========================================

DO $$
DECLARE
  ie_id uuid;
BEGIN
  SELECT id INTO ie_id FROM core.countries WHERE code = 'IE';
  
  -- Verificar se a Irlanda existe
  IF ie_id IS NULL THEN
    RAISE NOTICE 'País IE (Irlanda) não encontrado na tabela core.countries';
    RETURN;
  END IF;
  
  RAISE NOTICE 'Adicionando fontes para Irlanda (ID: %)', ie_id;
  
  -- Adicionar fontes irlandesas adicionais
  INSERT INTO core.country_verification_sources (country_id, source_name, source_type, base_url, search_endpoint, priority) VALUES
    -- Fontes governamentais
    (ie_id, 'Department of Culture, Heritage and the Gaeltacht', 'government', 'https://www.gov.ie/en/organisation/department-of-culture-heritage-and-the-gaeltacht', '/search', 2),
    (ie_id, 'National Archives of Ireland', 'government', 'https://www.nationalarchives.ie', '/search', 3),
    (ie_id, 'National Library of Ireland', 'government', 'https://www.nli.ie', '/search', 4),
    (ie_id, 'Heritage Ireland', 'government', 'https://heritageireland.ie', '/search', 5),
    
    -- Fontes acadêmicas
    (ie_id, 'Trinity College Dublin Library', 'academic', 'https://www.tcd.ie/library', '/search', 6),
    (ie_id, 'University College Dublin Library', 'academic', 'https://www.ucd.ie/library', '/search', 7),
    (ie_id, 'Royal Irish Academy', 'academic', 'https://www.ria.ie', '/search', 8),
    
    -- Fontes de mídia confiáveis
    (ie_id, 'The Irish Times', 'media', 'https://www.irishtimes.com', '/search', 9),
    (ie_id, 'RTÉ - Raidió Teilifís Éireann', 'media', 'https://www.rte.ie', '/search', 10),
    (ie_id, 'Irish Independent', 'media', 'https://www.independent.ie', '/search', 10),
    
    -- Fontes especializadas
    (ie_id, 'National Gallery of Ireland', 'heritage', 'https://www.nationalgallery.ie', '/search', 10),
    (ie_id, 'Irish Museum of Modern Art', 'heritage', 'https://imma.ie', '/search', 10),
    (ie_id, 'Chester Beatty Library', 'heritage', 'https://chesterbeatty.ie', '/search', 10),
    (ie_id, 'Dublin Castle', 'heritage', 'https://www.dublincastle.ie', '/search', 10),
    (ie_id, 'Kilmainham Gaol', 'heritage', 'https://kilmainhamgaolmuseum.ie', '/search', 10),
    (ie_id, 'Book of Kells', 'heritage', 'https://www.tcd.ie/visitors/book-of-kells', '/search', 10)
  ON CONFLICT (country_id, source_name) DO NOTHING;
END $$;

-- =========================================
-- 5) CONFIGURAÇÕES DE BUSCA PARA NOVAS FONTES
-- =========================================

-- Configurações para fontes brasileiras adicionais
INSERT INTO core.source_search_configs (source_id, search_type, query_template, rate_limit_rps, timeout_ms, cache_ttl_hours)
SELECT 
  vs.id,
  'keyword',
  CASE 
    WHEN vs.source_name = 'Ministério da Cultura' THEN '?q={query}&tipo=patrimonio'
    WHEN vs.source_name = 'IBRAM - Instituto Brasileiro de Museus' THEN '?busca={query}&tipo=museu'
    WHEN vs.source_name = 'Fundação Palmares' THEN '?q={query}&tipo=cultural'
    WHEN vs.source_name = 'Biblioteca Nacional' THEN '?q={query}&tipo=patrimonio'
    WHEN vs.source_name = 'SciELO Brasil' THEN '?q={query}&lang=pt'
    WHEN vs.source_name = 'CAPES - Portal de Periódicos' THEN '?q={query}&lang=pt'
    WHEN vs.source_name = 'Agência Brasil' THEN '?q={query}&tipo=noticia'
    WHEN vs.source_name = 'BBC Brasil' THEN '?q={query}&lang=pt'
    WHEN vs.source_name LIKE '%Museu%' THEN '?q={query}&tipo=arte'
    WHEN vs.source_name LIKE '%Fundação%' THEN '?q={query}&tipo=cultural'
    ELSE '?q={query}'
  END,
  CASE 
    WHEN vs.source_name LIKE '%Museu%' THEN 3
    WHEN vs.source_name LIKE '%Fundação%' THEN 3
    WHEN vs.source_name LIKE '%Biblioteca%' THEN 5
    ELSE 10
  END,
  CASE 
    WHEN vs.source_name LIKE '%Museu%' THEN 10000
    WHEN vs.source_name LIKE '%Fundação%' THEN 10000
    WHEN vs.source_name LIKE '%Biblioteca%' THEN 8000
    ELSE 5000
  END,
  CASE 
    WHEN vs.source_name LIKE '%Museu%' THEN 72
    WHEN vs.source_name LIKE '%Fundação%' THEN 72
    WHEN vs.source_name LIKE '%Biblioteca%' THEN 48
    ELSE 24
  END
FROM core.country_verification_sources vs
JOIN core.countries c ON vs.country_id = c.id
WHERE c.code = 'BR' 
  AND vs.source_name IN (
    'Ministério da Cultura', 'IBRAM - Instituto Brasileiro de Museus', 'Fundação Palmares',
    'Biblioteca Nacional', 'SciELO Brasil', 'CAPES - Portal de Periódicos', 'Agência Brasil',
    'BBC Brasil', 'Museu de Arte de São Paulo', 'Museu Nacional', 'Instituto Moreira Salles',
    'Fundação Getúlio Vargas'
  )
ON CONFLICT DO NOTHING;

-- Configurações para fontes espanholas adicionais
INSERT INTO core.source_search_configs (source_id, search_type, query_template, rate_limit_rps, timeout_ms, cache_ttl_hours)
SELECT 
  vs.id,
  'keyword',
  CASE 
    WHEN vs.source_name = 'Ministerio de Cultura y Deporte' THEN '?q={query}&tipo=patrimonio'
    WHEN vs.source_name = 'Instituto del Patrimonio Cultural de España' THEN '?busca={query}&tipo=cultural'
    WHEN vs.source_name = 'Archivo General de Indias' THEN '?q={query}&tipo=archivo'
    WHEN vs.source_name = 'Biblioteca Nacional de España' THEN '?q={query}&tipo=biblioteca'
    WHEN vs.source_name = 'CSIC - Consejo Superior de Investigaciones Científicas' THEN '?q={query}&lang=es'
    WHEN vs.source_name = 'Universidad Complutense de Madrid' THEN '?q={query}&lang=es'
    WHEN vs.source_name IN ('El País', 'El Mundo', 'ABC') THEN '?q={query}&lang=es'
    WHEN vs.source_name LIKE '%Museo%' THEN '?q={query}&tipo=arte'
    WHEN vs.source_name LIKE '%Fundación%' THEN '?q={query}&tipo=cultural'
    ELSE '?q={query}'
  END,
  CASE 
    WHEN vs.source_name LIKE '%Museo%' THEN 3
    WHEN vs.source_name LIKE '%Fundación%' THEN 3
    WHEN vs.source_name LIKE '%Biblioteca%' THEN 5
    WHEN vs.source_name IN ('El País', 'El Mundo', 'ABC') THEN 8
    ELSE 10
  END,
  CASE 
    WHEN vs.source_name LIKE '%Museo%' THEN 10000
    WHEN vs.source_name LIKE '%Fundación%' THEN 10000
    WHEN vs.source_name LIKE '%Biblioteca%' THEN 8000
    WHEN vs.source_name IN ('El País', 'El Mundo', 'ABC') THEN 6000
    ELSE 5000
  END,
  CASE 
    WHEN vs.source_name LIKE '%Museo%' THEN 72
    WHEN vs.source_name LIKE '%Fundación%' THEN 72
    WHEN vs.source_name LIKE '%Biblioteca%' THEN 48
    WHEN vs.source_name IN ('El País', 'El Mundo', 'ABC') THEN 12
    ELSE 24
  END
FROM core.country_verification_sources vs
JOIN core.countries c ON vs.country_id = c.id
WHERE c.code = 'ES' 
  AND vs.source_name IN (
    'Ministerio de Cultura y Deporte', 'Instituto del Patrimonio Cultural de España',
    'Archivo General de Indias', 'Biblioteca Nacional de España', 'CSIC - Consejo Superior de Investigaciones Científicas',
    'Universidad Complutense de Madrid', 'El País', 'El Mundo', 'ABC', 'Museo del Prado',
    'Museo Reina Sofía', 'Fundación Telefónica', 'Real Academia de la Historia'
  )
ON CONFLICT DO NOTHING;

-- Configurações para fontes americanas adicionais
INSERT INTO core.source_search_configs (source_id, search_type, query_template, rate_limit_rps, timeout_ms, cache_ttl_hours)
SELECT 
  vs.id,
  'keyword',
  CASE 
    WHEN vs.source_name = 'National Archives' THEN '?q={query}&type=archives'
    WHEN vs.source_name = 'Library of Congress - Digital Collections' THEN '?q={query}&type=collection'
    WHEN vs.source_name = 'Smithsonian Institution Archives' THEN '?q={query}&type=archive'
    WHEN vs.source_name = 'National Gallery of Art' THEN '?q={query}&type=art'
    WHEN vs.source_name = 'JSTOR' THEN '?q={query}&lang=en'
    WHEN vs.source_name = 'Google Scholar' THEN '?q={query}&lang=en'
    WHEN vs.source_name LIKE '%University%' THEN '?q={query}&lang=en'
    WHEN vs.source_name IN ('The New York Times', 'The Washington Post') THEN '?q={query}&lang=en'
    WHEN vs.source_name IN ('NPR - National Public Radio', 'PBS - Public Broadcasting Service') THEN '?q={query}&lang=en'
    WHEN vs.source_name LIKE '%Museum%' THEN '?q={query}&type=art'
    ELSE '?q={query}'
  END,
  CASE 
    WHEN vs.source_name LIKE '%Museum%' THEN 3
    WHEN vs.source_name LIKE '%University%' THEN 5
    WHEN vs.source_name IN ('The New York Times', 'The Washington Post') THEN 8
    WHEN vs.source_name IN ('NPR - National Public Radio', 'PBS - Public Broadcasting Service') THEN 6
    ELSE 10
  END,
  CASE 
    WHEN vs.source_name LIKE '%Museum%' THEN 10000
    WHEN vs.source_name LIKE '%University%' THEN 8000
    WHEN vs.source_name IN ('The New York Times', 'The Washington Post') THEN 6000
    WHEN vs.source_name IN ('NPR - National Public Radio', 'PBS - Public Broadcasting Service') THEN 7000
    ELSE 5000
  END,
  CASE 
    WHEN vs.source_name LIKE '%Museum%' THEN 72
    WHEN vs.source_name LIKE '%University%' THEN 48
    WHEN vs.source_name IN ('The New York Times', 'The Washington Post') THEN 12
    WHEN vs.source_name IN ('NPR - National Public Radio', 'PBS - Public Broadcasting Service') THEN 24
    ELSE 24
  END
FROM core.country_verification_sources vs
JOIN core.countries c ON vs.country_id = c.id
WHERE c.code = 'US' 
  AND vs.source_name IN (
    'National Archives', 'Library of Congress - Digital Collections', 'Smithsonian Institution Archives',
    'National Gallery of Art', 'JSTOR', 'Google Scholar', 'Harvard University Library', 'Stanford University Libraries',
    'The New York Times', 'The Washington Post', 'NPR - National Public Radio', 'PBS - Public Broadcasting Service',
    'Metropolitan Museum of Art', 'Museum of Modern Art (MoMA)', 'Guggenheim Museum', 'American Museum of Natural History',
    'Brooklyn Museum', 'Art Institute of Chicago'
  )
ON CONFLICT DO NOTHING;

-- Configurações para fontes irlandesas adicionais
INSERT INTO core.source_search_configs (source_id, search_type, query_template, rate_limit_rps, timeout_ms, cache_ttl_hours)
SELECT 
  vs.id,
  'keyword',
  CASE 
    WHEN vs.source_name = 'Department of Culture, Heritage and the Gaeltacht' THEN '?q={query}&type=heritage'
    WHEN vs.source_name = 'National Archives of Ireland' THEN '?q={query}&type=archives'
    WHEN vs.source_name = 'National Library of Ireland' THEN '?q={query}&type=library'
    WHEN vs.source_name = 'Heritage Ireland' THEN '?q={query}&type=heritage'
    WHEN vs.source_name LIKE '%University%' THEN '?q={query}&lang=en'
    WHEN vs.source_name = 'Royal Irish Academy' THEN '?q={query}&lang=en'
    WHEN vs.source_name IN ('The Irish Times', 'Irish Independent') THEN '?q={query}&lang=en'
    WHEN vs.source_name = 'RTÉ - Raidió Teilifís Éireann' THEN '?q={query}&lang=en'
    WHEN vs.source_name LIKE '%Gallery%' OR vs.source_name LIKE '%Museum%' THEN '?q={query}&type=art'
    WHEN vs.source_name LIKE '%Castle%' OR vs.source_name LIKE '%Gaol%' THEN '?q={query}&type=heritage'
    ELSE '?q={query}'
  END,
  CASE 
    WHEN vs.source_name LIKE '%Gallery%' OR vs.source_name LIKE '%Museum%' THEN 3
    WHEN vs.source_name LIKE '%Castle%' OR vs.source_name LIKE '%Gaol%' THEN 3
    WHEN vs.source_name LIKE '%University%' THEN 5
    WHEN vs.source_name IN ('The Irish Times', 'Irish Independent') THEN 8
    WHEN vs.source_name = 'RTÉ - Raidió Teilifís Éireann' THEN 6
    ELSE 10
  END,
  CASE 
    WHEN vs.source_name LIKE '%Gallery%' OR vs.source_name LIKE '%Museum%' THEN 10000
    WHEN vs.source_name LIKE '%Castle%' OR vs.source_name LIKE '%Gaol%' THEN 10000
    WHEN vs.source_name LIKE '%University%' THEN 8000
    WHEN vs.source_name IN ('The Irish Times', 'Irish Independent') THEN 6000
    WHEN vs.source_name = 'RTÉ - Raidió Teilifís Éireann' THEN 7000
    ELSE 5000
  END,
  CASE 
    WHEN vs.source_name LIKE '%Gallery%' OR vs.source_name LIKE '%Museum%' THEN 72
    WHEN vs.source_name LIKE '%Castle%' OR vs.source_name LIKE '%Gaol%' THEN 72
    WHEN vs.source_name LIKE '%University%' THEN 48
    WHEN vs.source_name IN ('The Irish Times', 'Irish Independent') THEN 12
    WHEN vs.source_name = 'RTÉ - Raidió Teilifís Éireann' THEN 24
    ELSE 24
  END
FROM core.country_verification_sources vs
JOIN core.countries c ON vs.country_id = c.id
WHERE c.code = 'IE' 
  AND vs.source_name IN (
    'Department of Culture, Heritage and the Gaeltacht', 'National Archives of Ireland',
    'National Library of Ireland', 'Heritage Ireland', 'Trinity College Dublin Library',
    'University College Dublin Library', 'Royal Irish Academy', 'The Irish Times',
    'RTÉ - Raidió Teilifís Éireann', 'Irish Independent', 'National Gallery of Ireland',
    'Irish Museum of Modern Art', 'Chester Beatty Library', 'Dublin Castle', 'Kilmainham Gaol',
    'Book of Kells'
  )
ON CONFLICT DO NOTHING;

-- =========================================
-- 6) VERIFICAÇÃO FINAL
-- =========================================

-- Mostrar total de fontes por país
SELECT 
  c.code,
  c.name,
  c.flag_emoji,
  COUNT(vs.id) as total_sources,
  COUNT(CASE WHEN vs.source_type = 'government' THEN 1 END) as government_sources,
  COUNT(CASE WHEN vs.source_type = 'academic' THEN 1 END) as academic_sources,
  COUNT(CASE WHEN vs.source_type = 'media' THEN 1 END) as media_sources,
  COUNT(CASE WHEN vs.source_type = 'heritage' THEN 1 END) as heritage_sources
FROM core.countries c
LEFT JOIN core.country_verification_sources vs ON c.id = vs.country_id
WHERE c.code IN ('BR', 'ES', 'US', 'IE')
GROUP BY c.id, c.code, c.name, c.flag_emoji
ORDER BY c.name;

-- Mostrar fontes detalhadas por país
SELECT 
  c.code,
  c.name,
  vs.source_name,
  vs.source_type,
  vs.base_url,
  vs.priority,
  ssc.search_type,
  ssc.rate_limit_rps,
  ssc.timeout_ms
FROM core.countries c
JOIN core.country_verification_sources vs ON c.id = vs.country_id
LEFT JOIN core.source_search_configs ssc ON vs.id = ssc.source_id
WHERE c.code IN ('BR', 'ES', 'US', 'IE')
  AND vs.is_active = true
ORDER BY c.name, vs.priority, vs.source_name;
