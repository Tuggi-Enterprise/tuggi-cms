-- Script para inserir fontes de verificação de dados para Campinas
-- Usa ON CONFLICT para substituir registros existentes baseado na chave única (city_name, country_code, source_name)

-- Fontes Governamentais
INSERT INTO core.city_verification_sources (
  city_name,
  country_code,
  source_name,
  source_type,
  base_url,
  search_endpoint,
  priority,
  is_active
) VALUES 
  (
    'Campinas',
    'BR',
    'Prefeitura Municipal de Campinas',
    'government',
    'https://campinas.sp.gov.br',
    '/turismo',
    1,
    true
  ),
  (
    'Campinas',
    'BR',
    'CONDEPACC - Conselho de Defesa do Patrimônio Cultural',
    'government',
    'https://campinas.sp.gov.br',
    '/patrimonio',
    2,
    true
  )
ON CONFLICT (city_name, country_code, source_name) 
DO UPDATE SET
  source_type = EXCLUDED.source_type,
  base_url = EXCLUDED.base_url,
  search_endpoint = EXCLUDED.search_endpoint,
  priority = EXCLUDED.priority,
  is_active = EXCLUDED.is_active,
  updated_at = now();

-- Fontes Acadêmicas
INSERT INTO core.city_verification_sources (
  city_name,
  country_code,
  source_name,
  source_type,
  base_url,
  search_endpoint,
  priority,
  is_active
) VALUES 
  (
    'Campinas',
    'BR',
    'UNICAMP - Centro de Memória',
    'academic',
    'https://difusao.cmu.unicamp.br',
    '/tema',
    3,
    true
  ),
  (
    'Campinas',
    'BR',
    'PUC-Campinas',
    'academic',
    'https://puc-campinas.edu.br',
    '/noticias',
    4,
    true
  ),
  (
    'Campinas',
    'BR',
    'ResearchGate - Estudos sobre Campinas',
    'academic',
    'https://researchgate.net',
    '/publication',
    5,
    true
  )
ON CONFLICT (city_name, country_code, source_name) 
DO UPDATE SET
  source_type = EXCLUDED.source_type,
  base_url = EXCLUDED.base_url,
  search_endpoint = EXCLUDED.search_endpoint,
  priority = EXCLUDED.priority,
  is_active = EXCLUDED.is_active,
  updated_at = now();

-- Fontes de Mídia
INSERT INTO core.city_verification_sources (
  city_name,
  country_code,
  source_name,
  source_type,
  base_url,
  search_endpoint,
  priority,
  is_active
) VALUES 
  (
    'Campinas',
    'BR',
    'Campinas.com.br',
    'media',
    'https://campinas.com.br',
    '/turismo',
    7,
    true
  ),
  (
    'Campinas',
    'BR',
    'Campinas Virtual',
    'media',
    'https://campinasvirtual.com.br',
    '/historia',
    8,
    true
  )
ON CONFLICT (city_name, country_code, source_name) 
DO UPDATE SET
  source_type = EXCLUDED.source_type,
  base_url = EXCLUDED.base_url,
  search_endpoint = EXCLUDED.search_endpoint,
  priority = EXCLUDED.priority,
  is_active = EXCLUDED.is_active,
  updated_at = now();

-- Fontes de Herança Cultural
INSERT INTO core.city_verification_sources (
  city_name,
  country_code,
  source_name,
  source_type,
  base_url,
  search_endpoint,
  priority,
  is_active
) VALUES 
  (
    'Campinas',
    'BR',
    'Google Arts & Culture - Campinas',
    'heritage',
    'https://artsandculture.google.com',
    '/story',
    5,
    true
  ),
  (
    'Campinas',
    'BR',
    'Grafiati - Patrimônio Histórico',
    'heritage',
    'https://grafiati.com',
    '/pt/literature-selections',
    6,
    true
  ),
  (
    'Campinas',
    'BR',
    'Arquidiocese de Campinas',
    'heritage',
    'https://arquidiocesecampinas.com',
    '/paroquias',
    3,
    true
  )
ON CONFLICT (city_name, country_code, source_name) 
DO UPDATE SET
  source_type = EXCLUDED.source_type,
  base_url = EXCLUDED.base_url,
  search_endpoint = EXCLUDED.search_endpoint,
  priority = EXCLUDED.priority,
  is_active = EXCLUDED.is_active,
  updated_at = now();

-- Fontes Locais
INSERT INTO core.city_verification_sources (
  city_name,
  country_code,
  source_name,
  source_type,
  base_url,
  search_endpoint,
  priority,
  is_active
) VALUES 
  (
    'Campinas',
    'BR',
    'Campinas Guia',
    'local',
    'https://campinasguia.com',
    '/parques-urbanos',
    9,
    true
  ),
  (
    'Campinas',
    'BR',
    'Conheça Campinas',
    'local',
    'https://conheca.campinas.sp.gov.br',
    '/tours',
    10,
    true
  ),
  (
    'Campinas',
    'BR',
    'Campinas Nostálgica',
    'local',
    'https://campinasnostalgica.wordpress.com',
    '/',
    10,
    true
  )
ON CONFLICT (city_name, country_code, source_name) 
DO UPDATE SET
  source_type = EXCLUDED.source_type,
  base_url = EXCLUDED.base_url,
  search_endpoint = EXCLUDED.search_endpoint,
  priority = EXCLUDED.priority,
  is_active = EXCLUDED.is_active,
  updated_at = now();

-- Verificar os registros inseridos
SELECT 
  source_name,
  source_type,
  base_url,
  priority,
  is_active
FROM core.city_verification_sources 
WHERE city_name = 'Campinas' 
  AND country_code = 'BR'
ORDER BY priority, source_name;
