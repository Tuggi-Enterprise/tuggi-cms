-- ===========================================
-- POV LEARNING SYSTEM - APRENDIZADO CONTÍNUO
-- ===========================================
-- Sistema que aprende com trigger points inseridos manualmente
-- para melhorar sugestões futuras de POVs

-- Habilitar extensão pgvector se não estiver habilitada
CREATE EXTENSION IF NOT EXISTS vector;

-- ===========================================
-- 1. TABELA DE PADRÕES APRENDIDOS
-- ===========================================

CREATE TABLE IF NOT EXISTS core.pov_learning_patterns (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  
  -- Contexto do POI
  poi_category text, -- 'building', 'landmark', 'park', etc.
  poi_types text[], -- google_types do POI
  urban_density text CHECK (urban_density IN ('open', 'mixed', 'dense', 'very_dense')),
  poi_height_category text CHECK (poi_height_category IN ('ground', 'low', 'medium', 'high', 'very_high')),
  
  -- Padrão de sucesso identificado
  successful_distance_range text, -- 'close' (<100m), 'medium' (100-500m), 'far' (>500m)
  successful_bearing_sectors text[], -- ['N', 'NE', 'E', etc.]
  preferred_access_type text CHECK (preferred_access_type IN ('walk', 'car', 'both')),
  preferred_vantage_types text[], -- ['street', 'bridge', 'highway', etc.]
  
  -- Estatísticas do padrão
  total_examples integer DEFAULT 0,
  success_rate real DEFAULT 0.0,
  avg_priority real DEFAULT 0.0,
  avg_radius_meters real DEFAULT 0.0,
  avg_distance_meters real DEFAULT 0.0,
  
  -- Metadados
  pattern_confidence real DEFAULT 0.0, -- 0-1, confiança no padrão
  last_updated timestamp with time zone DEFAULT now(),
  created_at timestamp with time zone DEFAULT now(),
  
  -- Constraint para unicidade do padrão
  CONSTRAINT unique_pattern UNIQUE (poi_category, urban_density, preferred_access_type)
);

-- ===========================================
-- 2. TABELA DE EXEMPLOS DE TREINAMENTO
-- ===========================================

CREATE TABLE IF NOT EXISTS core.pov_training_examples (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  
  -- Referência ao trigger point real
  trigger_point_id uuid REFERENCES core.attraction_trigger_points(id) ON DELETE CASCADE,
  attraction_id uuid REFERENCES core.attractions(id) ON DELETE CASCADE,
  
  -- Dados do POI no momento da criação
  poi_name text NOT NULL,
  poi_lat double precision NOT NULL,
  poi_lng double precision NOT NULL,
  poi_types text[], -- google_types se disponível
  poi_category text, -- classificação automática
  urban_density text, -- detectado automaticamente
  
  -- Dados do trigger point
  trigger_lat double precision NOT NULL,
  trigger_lng double precision NOT NULL,
  distance_m integer NOT NULL,
  bearing_deg integer NOT NULL,
  access_type text NOT NULL,
  trigger_type text NOT NULL,
  priority integer NOT NULL,
  radius_meters integer NOT NULL,
  
  -- Contexto ambiental (extraído via análise)
  street_context text, -- Nome da rua ou tipo detectado
  neighborhood text,
  is_highway boolean DEFAULT false,
  is_bridge boolean DEFAULT false,
  is_elevated boolean DEFAULT false,
  estimated_visibility text CHECK (estimated_visibility IN ('excellent', 'good', 'fair', 'poor')),
  
  -- Análise de qualidade
  human_created boolean DEFAULT true,
  quality_score real DEFAULT 85.0, -- Score inicial para exemplos humanos
  is_positive_example boolean DEFAULT true,
  
  -- Embedding para similaridade semântica
  context_embedding vector(1536), -- OpenAI embeddings
  
  -- Texto para busca full-text
  context_text text,
  context_tsv tsvector GENERATED ALWAYS AS (
    to_tsvector('english', context_text)
  ) STORED,
  
  created_at timestamp with time zone DEFAULT now()
);

-- ===========================================
-- 3. TABELA DE RECOMENDAÇÕES DA IA
-- ===========================================

CREATE TABLE IF NOT EXISTS core.pov_ai_recommendations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  
  -- Contexto da recomendação
  attraction_id uuid REFERENCES core.attractions(id) ON DELETE CASCADE,
  recommendation_batch_id uuid DEFAULT gen_random_uuid(), -- Agrupa recomendações da mesma sessão
  
  -- POV recomendado pela IA
  recommended_lat double precision NOT NULL,
  recommended_lng double precision NOT NULL,
  recommended_distance_m integer NOT NULL,
  recommended_bearing_deg integer NOT NULL,
  recommended_access text NOT NULL CHECK (recommended_access IN ('walk', 'car', 'both')),
  recommended_vantage text,
  recommended_priority integer DEFAULT 1,
  
  -- Metadados da recomendação
  confidence_score real NOT NULL, -- 0-100
  pattern_matches text[], -- IDs dos padrões que geraram esta recomendação
  reasoning text, -- Explicação da IA
  data_sources_used text[], -- Fontes de dados utilizadas
  
  -- Resultado (preenchido quando humano aceita/rejeita)
  was_accepted boolean,
  human_feedback text,
  feedback_score real, -- Score que humano deu (0-100)
  actual_trigger_point_id uuid REFERENCES core.attraction_trigger_points(id), -- Se foi aceito e criado
  
  created_at timestamp with time zone DEFAULT now(),
  feedback_at timestamp with time zone
);

-- ===========================================
-- 4. TABELA DE MÉTRICAS DO SISTEMA
-- ===========================================

CREATE TABLE IF NOT EXISTS core.pov_system_metrics (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  
  -- Métricas por período
  date_period date NOT NULL,
  
  -- Contadores
  new_trigger_points_created integer DEFAULT 0,
  ai_recommendations_generated integer DEFAULT 0,
  recommendations_accepted integer DEFAULT 0,
  recommendations_rejected integer DEFAULT 0,
  
  -- Taxas de sucesso
  acceptance_rate real DEFAULT 0.0,
  pattern_confidence_avg real DEFAULT 0.0,
  
  -- Aprendizado
  new_patterns_discovered integer DEFAULT 0,
  patterns_updated integer DEFAULT 0,
  
  created_at timestamp with time zone DEFAULT now(),
  
  CONSTRAINT unique_date_period UNIQUE (date_period)
);

-- ===========================================
-- 5. ÍNDICES PARA PERFORMANCE
-- ===========================================

-- Índices para padrões
CREATE INDEX IF NOT EXISTS idx_pov_patterns_category_density 
ON core.pov_learning_patterns(poi_category, urban_density);

CREATE INDEX IF NOT EXISTS idx_pov_patterns_confidence 
ON core.pov_learning_patterns(pattern_confidence DESC) 
WHERE pattern_confidence > 0.5;

CREATE INDEX IF NOT EXISTS idx_pov_patterns_success_rate 
ON core.pov_learning_patterns(success_rate DESC);

-- Índices para exemplos
CREATE INDEX IF NOT EXISTS idx_pov_examples_attraction 
ON core.pov_training_examples(attraction_id);

CREATE INDEX IF NOT EXISTS idx_pov_examples_trigger_point 
ON core.pov_training_examples(trigger_point_id);

CREATE INDEX IF NOT EXISTS idx_pov_examples_category 
ON core.pov_training_examples(poi_category, urban_density);

CREATE INDEX IF NOT EXISTS idx_pov_examples_embedding 
ON core.pov_training_examples USING hnsw (context_embedding vector_cosine_ops);

CREATE INDEX IF NOT EXISTS idx_pov_examples_tsv 
ON core.pov_training_examples USING GIN (context_tsv);

CREATE INDEX IF NOT EXISTS idx_pov_examples_quality 
ON core.pov_training_examples(quality_score DESC);

-- Índices para recomendações
CREATE INDEX IF NOT EXISTS idx_pov_recommendations_attraction 
ON core.pov_ai_recommendations(attraction_id);

CREATE INDEX IF NOT EXISTS idx_pov_recommendations_batch 
ON core.pov_ai_recommendations(recommendation_batch_id);

CREATE INDEX IF NOT EXISTS idx_pov_recommendations_confidence 
ON core.pov_ai_recommendations(confidence_score DESC);

CREATE INDEX IF NOT EXISTS idx_pov_recommendations_feedback 
ON core.pov_ai_recommendations(was_accepted, feedback_score);

-- Índices para métricas
CREATE INDEX IF NOT EXISTS idx_pov_metrics_date 
ON core.pov_system_metrics(date_period DESC);

-- ===========================================
-- 6. FUNÇÕES DE APRENDIZADO
-- ===========================================

-- Função para detectar densidade urbana baseada em coordenadas
CREATE OR REPLACE FUNCTION core.detect_urban_density(lat double precision, lng double precision)
RETURNS text AS $$
DECLARE
  density text := 'mixed'; -- Default
BEGIN
  -- Lógica expandida para múltiplas cidades brasileiras
  
  -- São Paulo centro: very_dense
  IF lat BETWEEN -23.57 AND -23.52 AND lng BETWEEN -46.66 AND -46.62 THEN
    density := 'very_dense';
  -- São Paulo periferia: dense
  ELSIF lat BETWEEN -23.75 AND -23.40 AND lng BETWEEN -46.80 AND -46.40 THEN
    density := 'dense';
  -- São Paulo área metropolitana: mixed
  ELSIF lat BETWEEN -23.85 AND -23.30 AND lng BETWEEN -46.90 AND -46.30 THEN
    density := 'mixed';
  
  -- Rio de Janeiro centro: very_dense
  ELSIF lat BETWEEN -22.92 AND -22.89 AND lng BETWEEN -43.20 AND -43.16 THEN
    density := 'very_dense';
  -- Rio de Janeiro zona sul: dense
  ELSIF lat BETWEEN -22.95 AND -22.88 AND lng BETWEEN -43.25 AND -43.15 THEN
    density := 'dense';
  -- Rio de Janeiro área metropolitana: mixed
  ELSIF lat BETWEEN -23.00 AND -22.85 AND lng BETWEEN -43.30 AND -43.10 THEN
    density := 'mixed';
  
  -- Brasília centro: dense
  ELSIF lat BETWEEN -15.80 AND -15.75 AND lng BETWEEN -47.95 AND -47.90 THEN
    density := 'dense';
  -- Brasília área metropolitana: mixed
  ELSIF lat BETWEEN -15.85 AND -15.70 AND lng BETWEEN -48.00 AND -47.85 THEN
    density := 'mixed';
  
  -- Belo Horizonte centro: dense
  ELSIF lat BETWEEN -19.95 AND -19.90 AND lng BETWEEN -43.95 AND -43.90 THEN
    density := 'dense';
  -- Belo Horizonte área metropolitana: mixed
  ELSIF lat BETWEEN -20.00 AND -19.85 AND lng BETWEEN -44.00 AND -43.85 THEN
    density := 'mixed';
  
  -- Porto Alegre centro: dense
  ELSIF lat BETWEEN -30.05 AND -30.00 AND lng BETWEEN -51.25 AND -51.20 THEN
    density := 'dense';
  -- Porto Alegre área metropolitana: mixed
  ELSIF lat BETWEEN -30.10 AND -29.95 AND lng BETWEEN -51.30 AND -51.15 THEN
    density := 'mixed';
  
  -- Curitiba centro: dense
  ELSIF lat BETWEEN -25.45 AND -25.40 AND lng BETWEEN -49.30 AND -49.25 THEN
    density := 'dense';
  -- Curitiba área metropolitana: mixed
  ELSIF lat BETWEEN -25.50 AND -25.35 AND lng BETWEEN -49.35 AND -49.20 THEN
    density := 'mixed';
  
  -- Salvador centro: dense
  ELSIF lat BETWEEN -12.98 AND -12.93 AND lng BETWEEN -38.53 AND -38.48 THEN
    density := 'dense';
  -- Salvador área metropolitana: mixed
  ELSIF lat BETWEEN -13.03 AND -12.88 AND lng BETWEEN -38.58 AND -38.43 THEN
    density := 'mixed';
  
  -- Recife centro: dense
  ELSIF lat BETWEEN -8.05 AND -8.00 AND lng BETWEEN -34.90 AND -34.85 THEN
    density := 'dense';
  -- Recife área metropolitana: mixed
  ELSIF lat BETWEEN -8.10 AND -7.95 AND lng BETWEEN -34.95 AND -34.80 THEN
    density := 'mixed';
  
  -- Fortaleza centro: dense
  ELSIF lat BETWEEN -3.73 AND -3.68 AND lng BETWEEN -38.53 AND -38.48 THEN
    density := 'dense';
  -- Fortaleza área metropolitana: mixed
  ELSIF lat BETWEEN -3.78 AND -3.63 AND lng BETWEEN -38.58 AND -38.43 THEN
    density := 'mixed';
  
  -- Áreas rurais ou não identificadas: open
  ELSE
    density := 'open';
  END IF;
  
  RETURN density;
END;
$$ LANGUAGE plpgsql IMMUTABLE;

-- Função para classificar categoria do POI
CREATE OR REPLACE FUNCTION core.classify_poi_category(poi_types text[], poi_name text)
RETURNS text AS $$
DECLARE
  category text := 'building'; -- Default
BEGIN
  -- Classificação baseada em google_types (ordem de prioridade importa!)
  IF poi_types IS NOT NULL AND array_length(poi_types, 1) > 0 THEN
    -- Prioridade 1: Park (mais específico)
    IF 'park' = ANY(poi_types) OR 'natural_feature' = ANY(poi_types) THEN
      category := 'park';
    -- Prioridade 2: Shopping (mais específico)
    ELSIF 'shopping_mall' = ANY(poi_types) THEN
      category := 'shopping';
    -- Prioridade 3: Landmark/Museum (mais específico)
    ELSIF 'tourist_attraction' = ANY(poi_types) OR 'museum' = ANY(poi_types) THEN
      category := 'landmark';
    -- Prioridade 4: Building (genérico)
    ELSIF 'establishment' = ANY(poi_types) OR 'point_of_interest' = ANY(poi_types) THEN
      category := 'building';
    END IF;
  END IF;
  
  -- Classificação baseada no nome
  IF poi_name IS NOT NULL THEN
    IF poi_name ILIKE '%park%' OR poi_name ILIKE '%jardim%' THEN
      category := 'park';
    ELSIF poi_name ILIKE '%museu%' OR poi_name ILIKE '%memorial%' OR poi_name ILIKE '%monumento%' THEN
      category := 'landmark';
    ELSIF poi_name ILIKE '%ponte%' OR poi_name ILIKE '%bridge%' THEN
      category := 'infrastructure';
    END IF;
  END IF;
  
  RETURN category;
END;
$$ LANGUAGE plpgsql IMMUTABLE;

-- Função para extrair contexto completo de um trigger point
CREATE OR REPLACE FUNCTION core.extract_trigger_point_context(trigger_point_id uuid)
RETURNS jsonb AS $$
DECLARE
  context_data jsonb;
  tp_record record;
  attraction_record record;
  coords_record record;
  distance_m integer;
  bearing_deg integer;
  poi_category text;
  urban_density text;
BEGIN
  -- Buscar dados do trigger point
  SELECT * INTO tp_record 
  FROM core.attraction_trigger_points 
  WHERE id = trigger_point_id;
  
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Trigger point not found: %', trigger_point_id;
  END IF;
  
  -- Buscar dados da atração
  SELECT * INTO attraction_record 
  FROM core.attractions 
  WHERE id = tp_record.attraction_id;
  
  -- Buscar coordenadas da atração
  SELECT * INTO coords_record 
  FROM core.attraction_coordinate 
  WHERE attraction_id = tp_record.attraction_id 
  LIMIT 1;
  
  -- Calcular distância e bearing
  IF coords_record IS NOT NULL THEN
    distance_m := ST_Distance(
      tp_record.location::geography,
      ST_SetSRID(ST_MakePoint(coords_record.longitude, coords_record.latitude), 4326)::geography
    )::integer;
    
    bearing_deg := (ST_Azimuth(
      ST_SetSRID(ST_MakePoint(coords_record.longitude, coords_record.latitude), 4326),
      tp_record.location::geometry
    ) * 180 / pi())::integer;
  ELSE
    distance_m := 0;
    bearing_deg := 0;
  END IF;
  
  -- Classificar POI e detectar densidade urbana
  poi_category := core.classify_poi_category(attraction_record.google_types, attraction_record.name);
  urban_density := core.detect_urban_density(
    ST_Y(tp_record.location::geometry), 
    ST_X(tp_record.location::geometry)
  );
  
  -- Construir dados de contexto
  context_data := jsonb_build_object(
    'trigger_point_id', trigger_point_id,
    'attraction_id', tp_record.attraction_id,
    'poi_name', attraction_record.name,
    'poi_lat', coords_record.latitude,
    'poi_lng', coords_record.longitude,
    'poi_types', attraction_record.google_types,
    'poi_category', poi_category,
    'urban_density', urban_density,
    'trigger_lat', ST_Y(tp_record.location::geometry),
    'trigger_lng', ST_X(tp_record.location::geometry),
    'distance_m', distance_m,
    'bearing_deg', bearing_deg,
    'access_type', tp_record.access,
    'trigger_type', tp_record.type,
    'priority', tp_record.priority,
    'radius_meters', tp_record.radius_meters,
    'context_text', format('POI: %s (%s) in %s area, Distance: %sm, Access: %s, Type: %s, Priority: %s', 
                          attraction_record.name,
                          poi_category,
                          urban_density,
                          distance_m,
                          tp_record.access,
                          tp_record.type,
                          tp_record.priority),
    'created_at', tp_record.created_at
  );
  
  RETURN context_data;
END;
$$ LANGUAGE plpgsql;

-- Função para atualizar padrões de aprendizado
CREATE OR REPLACE FUNCTION core.update_learning_patterns() 
RETURNS void AS $$
DECLARE
  pattern_record record;
BEGIN
  -- Atualizar padrões baseado em exemplos recentes (últimos 30 dias)
  FOR pattern_record IN 
    SELECT 
      poi_category,
      urban_density,
      access_type as preferred_access_type,
      COUNT(*) as total_examples,
      AVG(quality_score) as avg_quality_score,
      AVG(priority) as avg_priority,
      AVG(radius_meters) as avg_radius,
      AVG(distance_m) as avg_distance,
      array_agg(DISTINCT 
        CASE 
          WHEN bearing_deg BETWEEN 0 AND 44 THEN 'N'
          WHEN bearing_deg BETWEEN 45 AND 89 THEN 'NE'
          WHEN bearing_deg BETWEEN 90 AND 134 THEN 'E'
          WHEN bearing_deg BETWEEN 135 AND 179 THEN 'SE'
          WHEN bearing_deg BETWEEN 180 AND 224 THEN 'S'
          WHEN bearing_deg BETWEEN 225 AND 269 THEN 'SW'
          WHEN bearing_deg BETWEEN 270 AND 314 THEN 'W'
          ELSE 'NW'
        END
      ) as bearing_sectors,
      CASE 
        WHEN AVG(distance_m) < 100 THEN 'close'
        WHEN AVG(distance_m) < 500 THEN 'medium'
        ELSE 'far'
      END as distance_range
    FROM core.pov_training_examples
    WHERE created_at > now() - interval '30 days'
      AND is_positive_example = true
      AND quality_score >= 70
    GROUP BY poi_category, urban_density, access_type
    HAVING COUNT(*) >= 3  -- Mínimo de 3 exemplos para formar um padrão
  LOOP
    -- Inserir ou atualizar padrão
    INSERT INTO core.pov_learning_patterns (
      poi_category, 
      urban_density, 
      preferred_access_type,
      successful_distance_range,
      successful_bearing_sectors,
      total_examples, 
      success_rate, 
      avg_priority, 
      avg_radius_meters,
      avg_distance_meters,
      pattern_confidence, 
      last_updated
    ) VALUES (
      pattern_record.poi_category,
      pattern_record.urban_density,
      pattern_record.preferred_access_type,
      pattern_record.distance_range,
      pattern_record.bearing_sectors,
      pattern_record.total_examples,
      pattern_record.avg_quality_score / 100.0, -- Converter para 0-1
      pattern_record.avg_priority,
      pattern_record.avg_radius,
      pattern_record.avg_distance,
      LEAST(pattern_record.total_examples / 20.0, 1.0), -- Confiança baseada em exemplos
      now()
    )
    ON CONFLICT (poi_category, urban_density, preferred_access_type)
    DO UPDATE SET
      successful_distance_range = EXCLUDED.successful_distance_range,
      successful_bearing_sectors = EXCLUDED.successful_bearing_sectors,
      total_examples = EXCLUDED.total_examples,
      success_rate = EXCLUDED.success_rate,
      avg_priority = EXCLUDED.avg_priority,
      avg_radius_meters = EXCLUDED.avg_radius_meters,
      avg_distance_meters = EXCLUDED.avg_distance_meters,
      pattern_confidence = EXCLUDED.pattern_confidence,
      last_updated = now();
  END LOOP;
  
  -- Atualizar métricas do sistema
  INSERT INTO core.pov_system_metrics (
    date_period,
    new_patterns_discovered,
    patterns_updated
  ) VALUES (
    CURRENT_DATE,
    (SELECT COUNT(*) FROM core.pov_learning_patterns WHERE DATE(created_at) = CURRENT_DATE),
    (SELECT COUNT(*) FROM core.pov_learning_patterns WHERE DATE(last_updated) = CURRENT_DATE)
  )
  ON CONFLICT (date_period)
  DO UPDATE SET
    patterns_updated = EXCLUDED.patterns_updated;
    
END;
$$ LANGUAGE plpgsql;

-- ===========================================
-- 7. TRIGGERS PARA APRENDIZADO AUTOMÁTICO
-- ===========================================

-- Trigger para capturar novos trigger points
CREATE OR REPLACE FUNCTION core.capture_trigger_point_learning()
RETURNS TRIGGER AS $$
DECLARE
  context_data jsonb;
BEGIN
  -- Extrair contexto do novo trigger point
  BEGIN
    context_data := core.extract_trigger_point_context(NEW.id);
  EXCEPTION WHEN OTHERS THEN
    -- Se falhar na extração, log e continue
    RAISE WARNING 'Failed to extract context for trigger point %: %', NEW.id, SQLERRM;
    RETURN NEW;
  END;
  
  -- Inserir como exemplo de treinamento
  INSERT INTO core.pov_training_examples (
    trigger_point_id,
    attraction_id,
    poi_name,
    poi_lat,
    poi_lng,
    poi_types,
    poi_category,
    urban_density,
    trigger_lat,
    trigger_lng,
    distance_m,
    bearing_deg,
    access_type,
    trigger_type,
    priority,
    radius_meters,
    context_text,
    human_created,
    quality_score,
    estimated_visibility
  ) VALUES (
    NEW.id,
    NEW.attraction_id,
    context_data->>'poi_name',
    (context_data->>'poi_lat')::double precision,
    (context_data->>'poi_lng')::double precision,
    CASE 
      WHEN context_data->'poi_types' IS NOT NULL 
      THEN ARRAY(SELECT jsonb_array_elements_text(context_data->'poi_types'))
      ELSE NULL 
    END,
    context_data->>'poi_category',
    context_data->>'urban_density',
    (context_data->>'trigger_lat')::double precision,
    (context_data->>'trigger_lng')::double precision,
    (context_data->>'distance_m')::integer,
    (context_data->>'bearing_deg')::integer,
    context_data->>'access_type',
    context_data->>'trigger_type',
    (context_data->>'priority')::integer,
    (context_data->>'radius_meters')::integer,
    context_data->>'context_text',
    true, -- human_created
    85.0, -- quality_score inicial para exemplos humanos
    'good' -- estimated_visibility inicial
  );
  
  -- Atualizar padrões de aprendizado (async para não bloquear)
  PERFORM core.update_learning_patterns();
  
  -- Atualizar métricas diárias
  INSERT INTO core.pov_system_metrics (
    date_period,
    new_trigger_points_created
  ) VALUES (
    CURRENT_DATE,
    1
  )
  ON CONFLICT (date_period)
  DO UPDATE SET
    new_trigger_points_created = core.pov_system_metrics.new_trigger_points_created + 1;
  
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Criar trigger (remover se existir)
DROP TRIGGER IF EXISTS trigger_capture_learning ON core.attraction_trigger_points;
CREATE TRIGGER trigger_capture_learning
  AFTER INSERT ON core.attraction_trigger_points
  FOR EACH ROW
  EXECUTE FUNCTION core.capture_trigger_point_learning();

-- ===========================================
-- 8. VIEWS PARA CONSULTA
-- ===========================================

-- View para padrões de sucesso
CREATE OR REPLACE VIEW core.pov_success_patterns AS
SELECT 
  id,
  poi_category,
  urban_density,
  preferred_access_type,
  successful_distance_range,
  successful_bearing_sectors,
  total_examples,
  success_rate,
  avg_priority,
  avg_radius_meters,
  avg_distance_meters,
  pattern_confidence,
  last_updated,
  created_at
FROM core.pov_learning_patterns
WHERE pattern_confidence > 0.3
ORDER BY success_rate DESC, total_examples DESC;

-- View para exemplos recentes
CREATE OR REPLACE VIEW core.pov_recent_examples AS
SELECT 
  te.*,
  a.name as attraction_name,
  a.city,
  a.country,
  a.google_types as attraction_google_types
FROM core.pov_training_examples te
JOIN core.attractions a ON te.attraction_id = a.id
WHERE te.created_at > now() - interval '7 days'
ORDER BY te.created_at DESC;

-- View para métricas do sistema
CREATE OR REPLACE VIEW core.pov_system_dashboard AS
SELECT 
  date_period,
  new_trigger_points_created,
  ai_recommendations_generated,
  recommendations_accepted,
  recommendations_rejected,
  CASE 
    WHEN ai_recommendations_generated > 0 
    THEN (recommendations_accepted::float / ai_recommendations_generated::float) * 100
    ELSE 0 
  END as acceptance_rate_percent,
  new_patterns_discovered,
  patterns_updated
FROM core.pov_system_metrics
ORDER BY date_period DESC;

-- ===========================================
-- 9. ENABLE ROW LEVEL SECURITY
-- ===========================================

ALTER TABLE core.pov_learning_patterns ENABLE ROW LEVEL SECURITY;
ALTER TABLE core.pov_training_examples ENABLE ROW LEVEL SECURITY;
ALTER TABLE core.pov_ai_recommendations ENABLE ROW LEVEL SECURITY;
ALTER TABLE core.pov_system_metrics ENABLE ROW LEVEL SECURITY;

-- Políticas para leitura (authenticated users)
DROP POLICY IF EXISTS "Allow read access to learning patterns" ON core.pov_learning_patterns;
CREATE POLICY "Allow read access to learning patterns" 
ON core.pov_learning_patterns FOR SELECT TO authenticated USING (true);

DROP POLICY IF EXISTS "Allow read access to training examples" ON core.pov_training_examples;
CREATE POLICY "Allow read access to training examples" 
ON core.pov_training_examples FOR SELECT TO authenticated USING (true);

DROP POLICY IF EXISTS "Allow read access to AI recommendations" ON core.pov_ai_recommendations;
CREATE POLICY "Allow read access to AI recommendations" 
ON core.pov_ai_recommendations FOR SELECT TO authenticated USING (true);

DROP POLICY IF EXISTS "Allow read access to system metrics" ON core.pov_system_metrics;
CREATE POLICY "Allow read access to system metrics" 
ON core.pov_system_metrics FOR SELECT TO authenticated USING (true);

-- Políticas para escrita (service role only)
DROP POLICY IF EXISTS "Service role can manage learning patterns" ON core.pov_learning_patterns;
CREATE POLICY "Service role can manage learning patterns" 
ON core.pov_learning_patterns FOR ALL TO service_role USING (true);

DROP POLICY IF EXISTS "Service role can manage training examples" ON core.pov_training_examples;
CREATE POLICY "Service role can manage training examples" 
ON core.pov_training_examples FOR ALL TO service_role USING (true);

DROP POLICY IF EXISTS "Service role can manage AI recommendations" ON core.pov_ai_recommendations;
CREATE POLICY "Service role can manage AI recommendations" 
ON core.pov_ai_recommendations FOR ALL TO service_role USING (true);

DROP POLICY IF EXISTS "Service role can manage system metrics" ON core.pov_system_metrics;
CREATE POLICY "Service role can manage system metrics" 
ON core.pov_system_metrics FOR ALL TO service_role USING (true);

-- ===========================================
-- 10. GRANT PERMISSIONS
-- ===========================================

-- Views
GRANT SELECT ON core.pov_success_patterns TO authenticated;
GRANT SELECT ON core.pov_recent_examples TO authenticated;
GRANT SELECT ON core.pov_system_dashboard TO authenticated;

-- Tables
GRANT SELECT ON core.pov_learning_patterns TO authenticated;
GRANT SELECT ON core.pov_training_examples TO authenticated;
GRANT SELECT ON core.pov_ai_recommendations TO authenticated;
GRANT SELECT ON core.pov_system_metrics TO authenticated;

-- Service role permissions
GRANT ALL ON core.pov_learning_patterns TO service_role;
GRANT ALL ON core.pov_training_examples TO service_role;
GRANT ALL ON core.pov_ai_recommendations TO service_role;
GRANT ALL ON core.pov_system_metrics TO service_role;

-- Functions
GRANT EXECUTE ON FUNCTION core.detect_urban_density TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION core.classify_poi_category TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION core.extract_trigger_point_context TO service_role;
GRANT EXECUTE ON FUNCTION core.update_learning_patterns TO service_role;

-- ===========================================
-- 11. COMENTÁRIOS
-- ===========================================

COMMENT ON TABLE core.pov_learning_patterns IS 'Padrões aprendidos de trigger points bem-sucedidos para melhorar sugestões de IA';
COMMENT ON TABLE core.pov_training_examples IS 'Exemplos de treinamento extraídos de trigger points criados manualmente';
COMMENT ON TABLE core.pov_ai_recommendations IS 'Recomendações geradas pela IA e feedback humano para aprendizado contínuo';
COMMENT ON TABLE core.pov_system_metrics IS 'Métricas do sistema de aprendizado para monitoramento e análise';

COMMENT ON FUNCTION core.detect_urban_density IS 'Detecta densidade urbana baseada em coordenadas geográficas';
COMMENT ON FUNCTION core.classify_poi_category IS 'Classifica categoria do POI baseado em google_types e nome';
COMMENT ON FUNCTION core.extract_trigger_point_context IS 'Extrai contexto completo de um trigger point para aprendizado';
COMMENT ON FUNCTION core.update_learning_patterns IS 'Atualiza padrões de aprendizado baseado em exemplos recentes';
COMMENT ON FUNCTION core.capture_trigger_point_learning IS 'Captura automaticamente novos trigger points para aprendizado';

-- ===========================================
-- 12. VERIFICAÇÃO E INICIALIZAÇÃO
-- ===========================================

-- Função para verificar se o sistema está funcionando
CREATE OR REPLACE FUNCTION core.verify_learning_system()
RETURNS text AS $$
DECLARE
  patterns_count integer;
  examples_count integer;
  recommendations_count integer;
  result_text text;
BEGIN
  SELECT COUNT(*) INTO patterns_count FROM core.pov_learning_patterns;
  SELECT COUNT(*) INTO examples_count FROM core.pov_training_examples;
  SELECT COUNT(*) INTO recommendations_count FROM core.pov_ai_recommendations;
  
  result_text := format(
    'POV Learning System Status:
    - Learning Patterns: %s
    - Training Examples: %s  
    - AI Recommendations: %s
    - Trigger Function: %s
    - Views Created: %s
    - Indexes Created: %s
    
    System is ready for learning!',
    patterns_count,
    examples_count,
    recommendations_count,
    CASE WHEN EXISTS(
      SELECT 1 FROM information_schema.triggers 
      WHERE trigger_name = 'trigger_capture_learning'
    ) THEN 'Active' ELSE 'Missing' END,
    CASE WHEN EXISTS(
      SELECT 1 FROM information_schema.views 
      WHERE table_name = 'pov_success_patterns'
    ) THEN 'Yes' ELSE 'No' END,
    CASE WHEN EXISTS(
      SELECT 1 FROM pg_indexes 
      WHERE indexname = 'idx_pov_patterns_confidence'
    ) THEN 'Yes' ELSE 'No' END
  );
  
  RETURN result_text;
END;
$$ LANGUAGE plpgsql;

-- Executar verificação
SELECT core.verify_learning_system() as system_status;

-- ===========================================
-- FINALIZAÇÃO
-- ===========================================

SELECT 'POV Learning System created successfully! 🚀

Next steps:
1. Run migration script to import existing trigger points
2. Create pattern extraction service  
3. Implement embedding service for semantic search
4. Test the complete learning system

The system will now automatically:
- Capture new trigger points as training examples
- Extract patterns from successful examples
- Update learning patterns continuously
- Track system metrics and performance

Ready for Phase 2: API Implementation!' as status;
