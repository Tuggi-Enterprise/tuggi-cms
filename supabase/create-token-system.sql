-- =========================================
-- TOKEN-BASED INDEXING SYSTEM FOR RAG OPTIMIZATION
-- =========================================
-- Date: 2025-01-20
-- Description: Create token-based indexing system for improved RAG searches
-- =========================================

-- =========================================
-- 1) ATTRACTION TOKENS TABLE
-- =========================================

-- Table to store extracted tokens from descriptions for RAG optimization
CREATE TABLE IF NOT EXISTS core.attraction_tokens (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  attraction_id uuid NOT NULL REFERENCES core.attractions(id) ON DELETE CASCADE,
  token text NOT NULL,
  weight numeric(3,2) NOT NULL CHECK (weight >= 0 AND weight <= 1),
  context text NOT NULL,
  token_type text NOT NULL CHECK (token_type IN ('temporal', 'entity', 'style', 'location', 'category', 'factual')),
  language text DEFAULT 'pt-br',
  created_at timestamp with time zone DEFAULT now(),
  updated_at timestamp with time zone DEFAULT now(),
  
  -- Constraints
  UNIQUE(attraction_id, token, context)
);

-- Indexes for performance
CREATE INDEX IF NOT EXISTS idx_attraction_tokens_attraction 
ON core.attraction_tokens(attraction_id);

CREATE INDEX IF NOT EXISTS idx_attraction_tokens_weight 
ON core.attraction_tokens(weight DESC);

CREATE INDEX IF NOT EXISTS idx_attraction_tokens_type 
ON core.attraction_tokens(token_type);

CREATE INDEX IF NOT EXISTS idx_attraction_tokens_search 
ON core.attraction_tokens(token, weight DESC);

-- Full-text search index for tokens
CREATE INDEX IF NOT EXISTS idx_attraction_tokens_fulltext 
ON core.attraction_tokens USING gin(to_tsvector('portuguese', token || ' ' || context));

-- =========================================
-- 2) RAG SEARCH OPTIMIZATION TABLE
-- =========================================

-- Table to cache RAG search results and optimize future searches
CREATE TABLE IF NOT EXISTS core.rag_search_cache (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  query_hash text NOT NULL,
  query_text text NOT NULL,
  search_type text NOT NULL DEFAULT 'similarity',
  results jsonb NOT NULL,
  relevance_scores jsonb,
  source_weights jsonb,
  created_at timestamp with time zone DEFAULT now(),
  expires_at timestamp with time zone NOT NULL,
  hit_count integer DEFAULT 1,
  last_accessed timestamp with time zone DEFAULT now(),
  
  -- Constraints
  UNIQUE(query_hash)
);

-- Indexes for cache performance
CREATE INDEX IF NOT EXISTS idx_rag_cache_query_hash 
ON core.rag_search_cache(query_hash);

CREATE INDEX IF NOT EXISTS idx_rag_cache_expires 
ON core.rag_search_cache(expires_at);

CREATE INDEX IF NOT EXISTS idx_rag_cache_type 
ON core.rag_search_cache(search_type);

-- =========================================
-- 3) TOKEN SIMILARITY MATRIX
-- =========================================

-- Pre-computed similarity matrix for fast token matching
CREATE TABLE IF NOT EXISTS core.token_similarity (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  token_a text NOT NULL,
  token_b text NOT NULL,
  similarity_score numeric(3,2) NOT NULL CHECK (similarity_score >= 0 AND similarity_score <= 1),
  similarity_type text NOT NULL CHECK (similarity_type IN ('semantic', 'lexical', 'phonetic', 'contextual')),
  computed_at timestamp with time zone DEFAULT now(),
  
  -- Constraints
  UNIQUE(token_a, token_b, similarity_type),
  CHECK (token_a <= token_b) -- Ensure consistent ordering
);

-- Indexes for similarity searches
CREATE INDEX IF NOT EXISTS idx_token_similarity_tokens 
ON core.token_similarity(token_a, token_b);

CREATE INDEX IF NOT EXISTS idx_token_similarity_score 
ON core.token_similarity(similarity_score DESC);

-- =========================================
-- 4) FUNCTIONS FOR TOKEN OPERATIONS
-- =========================================

-- Function to find similar attractions based on tokens
CREATE OR REPLACE FUNCTION core.find_similar_attractions(
  p_attraction_id uuid,
  p_limit integer DEFAULT 10,
  p_min_similarity numeric DEFAULT 0.3
)
RETURNS TABLE (
  similar_attraction_id uuid,
  similarity_score numeric,
  shared_tokens text[],
  attraction_name text,
  city text,
  country text
) AS $$
BEGIN
  RETURN QUERY
  SELECT 
    a.id as similar_attraction_id,
    AVG(at1.weight * at2.weight)::numeric(3,2) as similarity_score,
    ARRAY_AGG(DISTINCT at1.token) as shared_tokens,
    a.name as attraction_name,
    a.city,
    a.country
  FROM core.attraction_tokens at1
  JOIN core.attraction_tokens at2 ON at1.token = at2.token
  JOIN core.attractions a ON at2.attraction_id = a.id
  WHERE at1.attraction_id = p_attraction_id
    AND at2.attraction_id != p_attraction_id
    AND at1.weight >= 0.3
    AND at2.weight >= 0.3
  GROUP BY a.id, a.name, a.city, a.country
  HAVING AVG(at1.weight * at2.weight) >= p_min_similarity
  ORDER BY similarity_score DESC
  LIMIT p_limit;
END;
$$ LANGUAGE plpgsql;

-- Function to search tokens with context
CREATE OR REPLACE FUNCTION core.search_tokens_with_context(
  p_search_term text,
  p_token_types text[] DEFAULT NULL,
  p_min_weight numeric DEFAULT 0.2,
  p_limit integer DEFAULT 50
)
RETURNS TABLE (
  attraction_id uuid,
  token text,
  weight numeric,
  context text,
  token_type text,
  attraction_name text,
  city text,
  country text,
  relevance_score numeric
) AS $$
BEGIN
  RETURN QUERY
  SELECT 
    at.attraction_id,
    at.token,
    at.weight,
    at.context,
    at.token_type,
    a.name as attraction_name,
    a.city,
    a.country,
    (ts_rank(to_tsvector('portuguese', at.token || ' ' || at.context), plainto_tsquery('portuguese', p_search_term)) * at.weight)::numeric(3,2) as relevance_score
  FROM core.attraction_tokens at
  JOIN core.attractions a ON at.attraction_id = a.id
  WHERE (p_token_types IS NULL OR at.token_type = ANY(p_token_types))
    AND at.weight >= p_min_weight
    AND (
      at.token ILIKE '%' || p_search_term || '%'
      OR at.context ILIKE '%' || p_search_term || '%'
      OR to_tsvector('portuguese', at.token || ' ' || at.context) @@ plainto_tsquery('portuguese', p_search_term)
    )
  ORDER BY relevance_score DESC, at.weight DESC
  LIMIT p_limit;
END;
$$ LANGUAGE plpgsql;

-- Function to get token statistics
CREATE OR REPLACE FUNCTION core.get_token_statistics()
RETURNS TABLE (
  total_tokens bigint,
  unique_tokens bigint,
  avg_weight numeric,
  tokens_by_type jsonb,
  top_tokens jsonb
) AS $$
BEGIN
  RETURN QUERY
  SELECT 
    COUNT(*) as total_tokens,
    COUNT(DISTINCT token) as unique_tokens,
    AVG(weight)::numeric(3,2) as avg_weight,
    jsonb_object_agg(token_type, type_count) as tokens_by_type,
    jsonb_agg(jsonb_build_object('token', token, 'count', token_count, 'avg_weight', avg_weight) ORDER BY token_count DESC) as top_tokens
  FROM (
    SELECT 
      token_type,
      COUNT(*) as type_count
    FROM core.attraction_tokens
    GROUP BY token_type
  ) type_stats,
  (
    SELECT 
      token,
      COUNT(*) as token_count,
      AVG(weight)::numeric(3,2) as avg_weight
    FROM core.attraction_tokens
    GROUP BY token
    ORDER BY COUNT(*) DESC
    LIMIT 20
  ) token_stats;
END;
$$ LANGUAGE plpgsql;

-- =========================================
-- 5) VIEWS FOR TOKEN ANALYSIS
-- =========================================

-- View for token analysis and optimization
CREATE OR REPLACE VIEW core.v_token_analysis AS
SELECT 
  at.token,
  at.token_type,
  COUNT(*) as usage_count,
  AVG(at.weight)::numeric(3,2) as avg_weight,
  MIN(at.weight)::numeric(3,2) as min_weight,
  MAX(at.weight)::numeric(3,2) as max_weight,
  COUNT(DISTINCT at.attraction_id) as unique_attractions,
  ARRAY_AGG(DISTINCT at.context) as contexts,
  ARRAY_AGG(DISTINCT a.city) as cities,
  ARRAY_AGG(DISTINCT a.country) as countries
FROM core.attraction_tokens at
JOIN core.attractions a ON at.attraction_id = a.id
GROUP BY at.token, at.token_type
ORDER BY usage_count DESC, avg_weight DESC;

-- View for attraction token profiles
CREATE OR REPLACE VIEW core.v_attraction_token_profiles AS
SELECT 
  a.id as attraction_id,
  a.name as attraction_name,
  a.city,
  a.country,
  COUNT(at.id) as total_tokens,
  AVG(at.weight)::numeric(3,2) as avg_token_weight,
  jsonb_object_agg(at.token_type, type_info) as token_distribution,
  ARRAY_AGG(at.token ORDER BY at.weight DESC) as top_tokens
FROM core.attractions a
LEFT JOIN core.attraction_tokens at ON a.id = at.attraction_id
LEFT JOIN (
  SELECT 
    attraction_id,
    token_type,
    jsonb_build_object(
      'count', COUNT(*),
      'avg_weight', AVG(weight)::numeric(3,2),
      'tokens', ARRAY_AGG(token ORDER BY weight DESC)
    ) as type_info
  FROM core.attraction_tokens
  GROUP BY attraction_id, token_type
) type_stats ON a.id = type_stats.attraction_id AND at.token_type = type_stats.token_type
GROUP BY a.id, a.name, a.city, a.country;

-- =========================================
-- 6) RLS POLICIES
-- =========================================

-- Enable RLS on token tables
ALTER TABLE core.attraction_tokens ENABLE ROW LEVEL SECURITY;
ALTER TABLE core.rag_search_cache ENABLE ROW LEVEL SECURITY;
ALTER TABLE core.token_similarity ENABLE ROW LEVEL SECURITY;

-- Policies for attraction_tokens
CREATE POLICY "CMS users can view attraction tokens" ON core.attraction_tokens
  FOR SELECT USING (
    auth.jwt() ->> 'email' LIKE '%@tuggi.app'
  );

CREATE POLICY "CMS users can manage attraction tokens" ON core.attraction_tokens
  FOR ALL USING (
    auth.jwt() ->> 'email' LIKE '%@tuggi.app'
  );

-- Policies for rag_search_cache
CREATE POLICY "CMS users can view RAG cache" ON core.rag_search_cache
  FOR SELECT USING (
    auth.jwt() ->> 'email' LIKE '%@tuggi.app'
  );

CREATE POLICY "CMS users can manage RAG cache" ON core.rag_search_cache
  FOR ALL USING (
    auth.jwt() ->> 'email' LIKE '%@tuggi.app'
  );

-- Policies for token_similarity
CREATE POLICY "CMS users can view token similarity" ON core.token_similarity
  FOR SELECT USING (
    auth.jwt() ->> 'email' LIKE '%@tuggi.app'
  );

-- =========================================
-- 7) CACHE CLEANUP FUNCTION
-- =========================================

-- Function to clean up expired cache entries
CREATE OR REPLACE FUNCTION core.cleanup_expired_cache()
RETURNS integer AS $$
DECLARE
  deleted_count integer;
BEGIN
  DELETE FROM core.rag_search_cache 
  WHERE expires_at < now();
  
  GET DIAGNOSTICS deleted_count = ROW_COUNT;
  
  RETURN deleted_count;
END;
$$ LANGUAGE plpgsql;

-- =========================================
-- 8) INITIAL DATA AND EXAMPLES
-- =========================================

-- Insert some example similarity relationships (respecting alphabetical order constraint)
INSERT INTO core.token_similarity (token_a, token_b, similarity_score, similarity_type) VALUES
  ('catedral', 'igreja', 0.8, 'semantic'),
  ('galeria', 'museu', 0.7, 'semantic'),
  ('jardim', 'parque', 0.6, 'semantic'),
  ('barroco', 'colonial', 0.5, 'contextual'),
  ('contemporâneo', 'modernista', 0.6, 'contextual'),
  ('fundado', 'inaugurado', 0.7, 'semantic'),
  ('construído', 'edificado', 0.9, 'semantic')
ON CONFLICT DO NOTHING;

-- =========================================
-- 9) VERIFICATION FINAL
-- =========================================

-- Show token system statistics
SELECT 
  'attraction_tokens' as table_name,
  COUNT(*) as record_count
FROM core.attraction_tokens

UNION ALL

SELECT 
  'rag_search_cache' as table_name,
  COUNT(*) as record_count
FROM core.rag_search_cache

UNION ALL

SELECT 
  'token_similarity' as table_name,
  COUNT(*) as record_count
FROM core.token_similarity;

-- Show available functions
SELECT 
  routine_name,
  routine_type
FROM information_schema.routines 
WHERE routine_schema = 'core' 
  AND routine_name LIKE '%token%'
ORDER BY routine_name;
