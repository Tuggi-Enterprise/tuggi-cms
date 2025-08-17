-- =========================================
-- SISTEMA DE FONTES DINÂMICAS POR PAÍS
-- =========================================
-- Data: 2025-01-20
-- Descrição: Sistema para gerenciar fontes de verificação por país
-- RLS: Apenas usuários do CMS têm acesso
-- =========================================

-- =========================================
-- 1) TABELA DE PAÍSES (FONTE ÚNICA DE VERDADE)
-- =========================================
CREATE TABLE IF NOT EXISTS core.countries (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code text UNIQUE NOT NULL,                    -- 'BR', 'US', 'CL', 'MX', etc.
  name text NOT NULL,                           -- 'Brazil', 'United States', 'Chile'
  name_native text,                             -- 'Brasil', 'Estados Unidos', 'Chile'
  flag_emoji text,                              -- '🇧🇷', '🇺🇸', '🇨🇱', '🇲🇽'
  language_code text NOT NULL,                  -- 'pt-br', 'en-us', 'es-cl', 'es-mx'
  is_active boolean DEFAULT true,
  created_at timestamp with time zone DEFAULT now(),
  updated_at timestamp with time zone DEFAULT now()
);

-- Índices para performance
CREATE INDEX IF NOT EXISTS idx_countries_code ON core.countries(code);
CREATE INDEX IF NOT EXISTS idx_countries_language ON core.countries(language_code);
CREATE INDEX IF NOT EXISTS idx_countries_active ON core.countries(is_active) WHERE is_active = true;
CREATE INDEX IF NOT EXISTS idx_countries_name ON core.countries(name);

-- =========================================
-- 2) TABELA DE FONTES POR PAÍS
-- =========================================
CREATE TABLE IF NOT EXISTS core.country_verification_sources (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  country_id uuid NOT NULL REFERENCES core.countries(id) ON DELETE CASCADE,
  source_name text NOT NULL,                    -- 'IPHAN', 'Wikipedia', 'Government Portal'
  source_type text NOT NULL,                    -- 'government', 'encyclopedia', 'official', 'heritage'
  base_url text NOT NULL,                       -- 'https://portal.iphan.gov.br'
  search_endpoint text,                         -- '/buscas'
  api_key_required boolean DEFAULT false,
  priority integer DEFAULT 1 CHECK (priority >= 1 AND priority <= 10),
  is_active boolean DEFAULT true,
  config jsonb DEFAULT '{}',                    -- Additional configuration
  created_at timestamp with time zone DEFAULT now(),
  updated_at timestamp with time zone DEFAULT now(),
  
  -- Constraints
  CONSTRAINT unique_country_source UNIQUE(country_id, source_name)
);

-- Índices para performance
CREATE INDEX IF NOT EXISTS idx_verification_sources_country ON core.country_verification_sources(country_id);
CREATE INDEX IF NOT EXISTS idx_verification_sources_active ON core.country_verification_sources(is_active) WHERE is_active = true;
CREATE INDEX IF NOT EXISTS idx_verification_sources_priority ON core.country_verification_sources(country_id, priority);
CREATE INDEX IF NOT EXISTS idx_verification_sources_type ON core.country_verification_sources(source_type);

-- =========================================
-- 3) TABELA DE CONFIGURAÇÕES DE BUSCA
-- =========================================
CREATE TABLE IF NOT EXISTS core.source_search_configs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  source_id uuid NOT NULL REFERENCES core.country_verification_sources(id) ON DELETE CASCADE,
  search_type text NOT NULL,                    -- 'keyword', 'entity', 'structured', 'api'
  query_template text NOT NULL,                 -- '?busca={query}&tipo=patrimonio'
  headers jsonb DEFAULT '{}',                   -- Custom headers
  rate_limit_rps integer DEFAULT 10 CHECK (rate_limit_rps >= 1),
  timeout_ms integer DEFAULT 5000 CHECK (timeout_ms >= 1000),
  retry_attempts integer DEFAULT 3 CHECK (retry_attempts >= 0),
  cache_ttl_hours integer DEFAULT 24 CHECK (cache_ttl_hours >= 0),
  created_at timestamp with time zone DEFAULT now(),
  updated_at timestamp with time zone DEFAULT now()
);

-- Índices para performance
CREATE INDEX IF NOT EXISTS idx_search_configs_source ON core.source_search_configs(source_id);
CREATE INDEX IF NOT EXISTS idx_search_configs_type ON core.source_search_configs(search_type);

-- =========================================
-- 4) TABELA DE CACHE DE BUSCAS
-- =========================================
CREATE TABLE IF NOT EXISTS core.source_search_cache (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  source_id uuid NOT NULL REFERENCES core.country_verification_sources(id) ON DELETE CASCADE,
  query_hash text NOT NULL,                     -- SHA256 do query
  query_text text NOT NULL,                     -- Query original
  results jsonb NOT NULL,                       -- Resultados da busca
  created_at timestamp with time zone DEFAULT now(),
  expires_at timestamp with time zone NOT NULL,
  
  -- Constraints
  CONSTRAINT unique_source_query UNIQUE(source_id, query_hash)
);

-- Índices para performance
CREATE INDEX IF NOT EXISTS idx_search_cache_source ON core.source_search_cache(source_id);
CREATE INDEX IF NOT EXISTS idx_search_cache_expires ON core.source_search_cache(expires_at);
CREATE INDEX IF NOT EXISTS idx_search_cache_query_hash ON core.source_search_cache(query_hash);

-- =========================================
-- 5) TABELA DE LOGS DE BUSCA
-- =========================================
CREATE TABLE IF NOT EXISTS core.source_search_logs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  source_id uuid NOT NULL REFERENCES core.country_verification_sources(id) ON DELETE CASCADE,
  query_text text NOT NULL,
  status text NOT NULL,                         -- 'success', 'error', 'timeout'
  response_time_ms integer,
  results_count integer DEFAULT 0,
  error_message text,
  user_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamp with time zone DEFAULT now()
);

-- Índices para performance
CREATE INDEX IF NOT EXISTS idx_search_logs_source ON core.source_search_logs(source_id);
CREATE INDEX IF NOT EXISTS idx_search_logs_status ON core.source_search_logs(status);
CREATE INDEX IF NOT EXISTS idx_search_logs_created ON core.source_search_logs(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_search_logs_user ON core.source_search_logs(user_id);

-- =========================================
-- 6) VIEWS ÚTEIS
-- =========================================

-- View para listar fontes ativas por país
CREATE OR REPLACE VIEW core.v_active_sources_by_country AS
SELECT 
  c.id as country_id,
  c.code as country_code,
  c.language_code,
  c.name as country_name,
  c.name_native as country_name_native,
  c.flag_emoji,
  vs.id as source_id,
  vs.source_name,
  vs.source_type,
  vs.base_url,
  vs.search_endpoint,
  vs.priority,
  ssc.search_type,
  ssc.query_template,
  ssc.rate_limit_rps,
  ssc.timeout_ms,
  ssc.cache_ttl_hours
FROM core.countries c
JOIN core.country_verification_sources vs ON c.id = vs.country_id
LEFT JOIN core.source_search_configs ssc ON vs.id = ssc.source_id
WHERE c.is_active = true 
  AND vs.is_active = true
ORDER BY c.name, vs.priority, vs.source_name;

-- View para estatísticas de uso
CREATE OR REPLACE VIEW core.v_source_usage_stats AS
SELECT 
  vs.source_name,
  c.name as country_name,
  COUNT(sl.id) as total_searches,
  COUNT(CASE WHEN sl.status = 'success' THEN 1 END) as successful_searches,
  COUNT(CASE WHEN sl.status = 'error' THEN 1 END) as failed_searches,
  AVG(sl.response_time_ms) as avg_response_time_ms,
  MAX(sl.created_at) as last_used
FROM core.country_verification_sources vs
JOIN core.countries c ON vs.country_id = c.id
LEFT JOIN core.source_search_logs sl ON vs.id = sl.source_id
WHERE sl.created_at >= NOW() - INTERVAL '30 days'
GROUP BY vs.id, vs.source_name, c.name
ORDER BY total_searches DESC;

-- =========================================
-- 7) FUNCTIONS ÚTEIS
-- =========================================

-- Function para limpar cache expirado
CREATE OR REPLACE FUNCTION core.cleanup_expired_cache()
RETURNS integer
LANGUAGE plpgsql
AS $$
DECLARE
  deleted_count integer;
BEGIN
  DELETE FROM core.source_search_cache 
  WHERE expires_at < NOW();
  
  GET DIAGNOSTICS deleted_count = ROW_COUNT;
  RETURN deleted_count;
END;
$$;

-- Function para obter idioma por código do país
CREATE OR REPLACE FUNCTION core.get_language_for_country(country_code text)
RETURNS text
LANGUAGE plpgsql
AS $$
DECLARE
  language_code text;
BEGIN
  SELECT c.language_code INTO language_code
  FROM core.countries c
  WHERE c.code = country_code AND c.is_active = true;
  
  RETURN COALESCE(language_code, 'en-us'); -- Fallback para inglês
END;
$$;

-- Function para obter fontes por país (usando código do país diretamente)
CREATE OR REPLACE FUNCTION core.get_sources_for_country(country_code text)
RETURNS TABLE (
  source_id uuid,
  source_name text,
  source_type text,
  base_url text,
  search_endpoint text,
  priority integer,
  search_type text,
  query_template text,
  rate_limit_rps integer,
  timeout_ms integer,
  language_code text
)
LANGUAGE plpgsql
AS $$
BEGIN
  RETURN QUERY
  SELECT 
    vs.id,
    vs.source_name,
    vs.source_type,
    vs.base_url,
    vs.search_endpoint,
    vs.priority,
    ssc.search_type,
    ssc.query_template,
    ssc.rate_limit_rps,
    ssc.timeout_ms,
    c.language_code
  FROM core.countries c
  JOIN core.country_verification_sources vs ON c.id = vs.country_id
  LEFT JOIN core.source_search_configs ssc ON vs.id = ssc.source_id
  WHERE c.code = country_code
    AND c.is_active = true
    AND vs.is_active = true
  ORDER BY vs.priority, vs.source_name;
END;
$$;

-- =========================================
-- 8) ROW LEVEL SECURITY (RLS)
-- =========================================

-- Habilitar RLS em todas as tabelas
ALTER TABLE core.countries ENABLE ROW LEVEL SECURITY;
ALTER TABLE core.country_verification_sources ENABLE ROW LEVEL SECURITY;
ALTER TABLE core.source_search_configs ENABLE ROW LEVEL SECURITY;
ALTER TABLE core.source_search_cache ENABLE ROW LEVEL SECURITY;
ALTER TABLE core.source_search_logs ENABLE ROW LEVEL SECURITY;

-- =========================================
-- 9) POLÍTICAS RLS - APENAS USUÁRIOS CMS
-- =========================================

-- Política para core.countries (READ/WRITE para CMS users)
CREATE POLICY "cms_users_can_manage_countries" ON core.countries
  FOR ALL USING (
    EXISTS (
      SELECT 1 FROM auth.users u
      WHERE u.id = auth.uid()
      AND u.email LIKE '%@tuggi.app'
    )
  );

-- Política para core.country_verification_sources (READ/WRITE para CMS users)
CREATE POLICY "cms_users_can_manage_sources" ON core.country_verification_sources
  FOR ALL USING (
    EXISTS (
      SELECT 1 FROM auth.users u
      WHERE u.id = auth.uid()
      AND u.email LIKE '%@tuggi.app'
    )
  );

-- Política para core.source_search_configs (READ/WRITE para CMS users)
CREATE POLICY "cms_users_can_manage_configs" ON core.source_search_configs
  FOR ALL USING (
    EXISTS (
      SELECT 1 FROM auth.users u
      WHERE u.id = auth.uid()
      AND u.email LIKE '%@tuggi.app'
    )
  );

-- Política para core.source_search_cache (READ/WRITE para CMS users)
CREATE POLICY "cms_users_can_access_cache" ON core.source_search_cache
  FOR ALL USING (
    EXISTS (
      SELECT 1 FROM auth.users u
      WHERE u.id = auth.uid()
      AND u.email LIKE '%@tuggi.app'
    )
  );

-- Política para core.source_search_logs (READ/WRITE para CMS users)
CREATE POLICY "cms_users_can_access_logs" ON core.source_search_logs
  FOR ALL USING (
    EXISTS (
      SELECT 1 FROM auth.users u
      WHERE u.id = auth.uid()
      AND u.email LIKE '%@tuggi.app'
    )
  );

-- =========================================
-- 10) DADOS INICIAIS
-- =========================================

-- Inserir países principais (FONTE ÚNICA DE VERDADE)
INSERT INTO core.countries (code, name, name_native, flag_emoji, language_code) VALUES
  ('BR', 'Brazil', 'Brasil', '🇧🇷', 'pt-br'),
  ('US', 'United States', 'United States', '🇺🇸', 'en-us'),
  ('CL', 'Chile', 'Chile', '🇨🇱', 'es-cl'),
  ('MX', 'Mexico', 'México', '🇲🇽', 'es-mx'),
  ('AR', 'Argentina', 'Argentina', '🇦🇷', 'es-ar'),
  ('CO', 'Colombia', 'Colombia', '🇨🇴', 'es-co'),
  ('PE', 'Peru', 'Perú', '🇵🇪', 'es-pe'),
  ('UY', 'Uruguay', 'Uruguay', '🇺🇾', 'es-uy'),
  ('PY', 'Paraguay', 'Paraguay', '🇵🇾', 'es-py'),
  ('BO', 'Bolivia', 'Bolivia', '🇧🇴', 'es-bo'),
  ('EC', 'Ecuador', 'Ecuador', '🇪🇨', 'es-ec'),
  ('VE', 'Venezuela', 'Venezuela', '🇻🇪', 'es-ve'),
  ('CA', 'Canada', 'Canada', '🇨🇦', 'en-ca'),
  ('PT', 'Portugal', 'Portugal', '🇵🇹', 'pt-pt'),
  ('ES', 'Spain', 'España', '🇪🇸', 'es-es'),
  ('FR', 'France', 'France', '🇫🇷', 'fr-fr'),
  ('IT', 'Italy', 'Italia', '🇮🇹', 'it-it'),
  ('DE', 'Germany', 'Deutschland', '🇩🇪', 'de-de'),
  ('GB', 'United Kingdom', 'United Kingdom', '🇬🇧', 'en-gb'),
  ('JP', 'Japan', '日本', '🇯🇵', 'ja-jp'),
  ('CN', 'China', '中国', '🇨🇳', 'zh-cn'),
  ('IN', 'India', 'भारत', '🇮🇳', 'hi-in'),
  ('AU', 'Australia', 'Australia', '🇦🇺', 'en-au')
ON CONFLICT (code) DO NOTHING;

-- Obter IDs dos países para inserir fontes
DO $$
DECLARE
  br_id uuid;
  us_id uuid;
  cl_id uuid;
  mx_id uuid;
BEGIN
  -- Obter IDs dos países
  SELECT id INTO br_id FROM core.countries WHERE code = 'BR';
  SELECT id INTO us_id FROM core.countries WHERE code = 'US';
  SELECT id INTO cl_id FROM core.countries WHERE code = 'CL';
  SELECT id INTO mx_id FROM core.countries WHERE code = 'MX';

  -- Fontes para Brasil
  INSERT INTO core.country_verification_sources (country_id, source_name, source_type, base_url, search_endpoint, priority) VALUES
    (br_id, 'IPHAN', 'government', 'https://portal.iphan.gov.br', '/buscas', 1),
    (br_id, 'Wikipedia PT', 'encyclopedia', 'https://pt.wikipedia.org', '/w/api.php', 2),
    (br_id, 'Prefeituras', 'government', 'https://www.gov.br', '/pt-br', 3),
    (br_id, 'IBGE', 'government', 'https://www.ibge.gov.br', '/cidades-e-estados', 4)
  ON CONFLICT (country_id, source_name) DO NOTHING;

  -- Fontes para Estados Unidos
  INSERT INTO core.country_verification_sources (country_id, source_name, source_type, base_url, search_endpoint, priority) VALUES
    (us_id, 'National Park Service', 'government', 'https://www.nps.gov', '/findapark', 1),
    (us_id, 'Wikipedia EN', 'encyclopedia', 'https://en.wikipedia.org', '/w/api.php', 2),
    (us_id, 'Library of Congress', 'government', 'https://www.loc.gov', '/search', 3),
    (us_id, 'Smithsonian', 'government', 'https://www.si.edu', '/search', 4)
  ON CONFLICT (country_id, source_name) DO NOTHING;

  -- Fontes para Chile
  INSERT INTO core.country_verification_sources (country_id, source_name, source_type, base_url, search_endpoint, priority) VALUES
    (cl_id, 'Monumentos Nacionales', 'government', 'https://www.monumentos.gob.cl', '/monumentos', 1),
    (cl_id, 'Wikipedia ES', 'encyclopedia', 'https://es.wikipedia.org', '/w/api.php', 2),
    (cl_id, 'Biblioteca Nacional', 'government', 'https://www.bibliotecanacionaldigital.gob.cl', '/buscar', 3)
  ON CONFLICT (country_id, source_name) DO NOTHING;

  -- Fontes para México
  INSERT INTO core.country_verification_sources (country_id, source_name, source_type, base_url, search_endpoint, priority) VALUES
    (mx_id, 'INAH', 'government', 'https://www.inah.gob.mx', '/buscar', 1),
    (mx_id, 'Wikipedia ES', 'encyclopedia', 'https://es.wikipedia.org', '/w/api.php', 2),
    (mx_id, 'CONACULTA', 'government', 'https://www.cultura.gob.mx', '/buscar', 3)
  ON CONFLICT (country_id, source_name) DO NOTHING;
END $$;

-- =========================================
-- 11) CONFIGURAÇÕES DE BUSCA PADRÃO
-- =========================================

-- Configurações para fontes brasileiras
INSERT INTO core.source_search_configs (source_id, search_type, query_template, rate_limit_rps, timeout_ms, cache_ttl_hours)
SELECT 
  vs.id,
  'keyword',
  CASE 
    WHEN vs.source_name = 'IPHAN' THEN '?busca={query}&tipo=patrimonio'
    WHEN vs.source_name = 'Wikipedia PT' THEN '?action=query&list=search&srsearch={query}&format=json&srlimit=10'
    WHEN vs.source_name = 'Prefeituras' THEN '?q={query}&tipo=patrimonio'
    WHEN vs.source_name = 'IBGE' THEN '?busca={query}&tipo=cidade'
    ELSE '?q={query}'
  END,
  CASE 
    WHEN vs.source_name = 'IPHAN' THEN 5
    WHEN vs.source_name = 'Wikipedia PT' THEN 10
    ELSE 3
  END,
  CASE 
    WHEN vs.source_name = 'IPHAN' THEN 8000
    WHEN vs.source_name = 'Wikipedia PT' THEN 5000
    ELSE 10000
  END,
  CASE 
    WHEN vs.source_name = 'IPHAN' THEN 48
    WHEN vs.source_name = 'Wikipedia PT' THEN 24
    ELSE 72
  END
FROM core.country_verification_sources vs
JOIN core.countries c ON vs.country_id = c.id
WHERE c.code = 'BR'
ON CONFLICT DO NOTHING;

-- Configurações para fontes americanas
INSERT INTO core.source_search_configs (source_id, search_type, query_template, rate_limit_rps, timeout_ms, cache_ttl_hours)
SELECT 
  vs.id,
  'keyword',
  CASE 
    WHEN vs.source_name = 'National Park Service' THEN '?q={query}&type=park'
    WHEN vs.source_name = 'Wikipedia EN' THEN '?action=query&list=search&srsearch={query}&format=json&srlimit=10'
    WHEN vs.source_name = 'Library of Congress' THEN '?q={query}&type=place'
    WHEN vs.source_name = 'Smithsonian' THEN '?q={query}&type=collection'
    ELSE '?q={query}'
  END,
  CASE 
    WHEN vs.source_name = 'National Park Service' THEN 5
    WHEN vs.source_name = 'Wikipedia EN' THEN 10
    ELSE 3
  END,
  CASE 
    WHEN vs.source_name = 'National Park Service' THEN 8000
    WHEN vs.source_name = 'Wikipedia EN' THEN 5000
    ELSE 10000
  END,
  CASE 
    WHEN vs.source_name = 'National Park Service' THEN 48
    WHEN vs.source_name = 'Wikipedia EN' THEN 24
    ELSE 72
  END
FROM core.country_verification_sources vs
JOIN core.countries c ON vs.country_id = c.id
WHERE c.code = 'US'
ON CONFLICT DO NOTHING;

-- =========================================
-- 12) TRIGGERS PARA MANUTENÇÃO
-- =========================================

-- Trigger para atualizar updated_at
CREATE OR REPLACE FUNCTION core.update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ language 'plpgsql';

CREATE TRIGGER update_countries_updated_at 
  BEFORE UPDATE ON core.countries 
  FOR EACH ROW EXECUTE FUNCTION core.update_updated_at_column();

CREATE TRIGGER update_verification_sources_updated_at 
  BEFORE UPDATE ON core.country_verification_sources 
  FOR EACH ROW EXECUTE FUNCTION core.update_updated_at_column();

CREATE TRIGGER update_search_configs_updated_at 
  BEFORE UPDATE ON core.source_search_configs 
  FOR EACH ROW EXECUTE FUNCTION core.update_updated_at_column();

-- =========================================
-- 13) COMENTÁRIOS PARA DOCUMENTAÇÃO
-- =========================================

COMMENT ON TABLE core.countries IS 'Países suportados pelo sistema de verificação';
COMMENT ON TABLE core.country_verification_sources IS 'Fontes de verificação configuradas por país';
COMMENT ON TABLE core.source_search_configs IS 'Configurações de busca para cada fonte';
COMMENT ON TABLE core.source_search_cache IS 'Cache de resultados de busca para otimizar performance';
COMMENT ON TABLE core.source_search_logs IS 'Logs de todas as buscas realizadas para monitoramento';

COMMENT ON COLUMN core.countries.code IS 'Código ISO do país (BR, US, CL, etc.) - FONTE ÚNICA DE VERDADE';
COMMENT ON COLUMN core.countries.language_code IS 'Código de idioma do país (pt-br, en-us, es-cl, etc.) - Mapeamento direto';
COMMENT ON COLUMN core.countries.flag_emoji IS 'Emoji da bandeira do país';
COMMENT ON COLUMN core.country_verification_sources.priority IS 'Prioridade da fonte (1=mais alta, 10=mais baixa)';
COMMENT ON COLUMN core.country_verification_sources.config IS 'Configuração adicional em JSON';
COMMENT ON COLUMN core.source_search_configs.query_template IS 'Template da query com {query} como placeholder';
COMMENT ON COLUMN core.source_search_cache.query_hash IS 'Hash SHA256 da query para identificação única';

-- =========================================
-- 14) VERIFICAÇÃO FINAL
-- =========================================

-- Verificar se tudo foi criado corretamente
SELECT 
  'countries' as table_name,
  COUNT(*) as record_count
FROM core.countries
UNION ALL
SELECT 
  'verification_sources' as table_name,
  COUNT(*) as record_count
FROM core.country_verification_sources
UNION ALL
SELECT 
  'search_configs' as table_name,
  COUNT(*) as record_count
FROM core.source_search_configs;

-- Mostrar países e fontes configurados
SELECT 
  c.code,
  c.language_code,
  c.name,
  c.name_native,
  c.flag_emoji,
  COUNT(vs.id) as sources_count
FROM core.countries c
LEFT JOIN core.country_verification_sources vs ON c.id = vs.country_id
GROUP BY c.id, c.code, c.language_code, c.name, c.name_native, c.flag_emoji
ORDER BY c.name;
