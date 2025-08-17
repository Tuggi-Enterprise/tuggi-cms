-- Função SQL otimizada para buscar apenas descrições que PRECISAM ser processadas
-- Elimina a necessidade de buscar mais itens e filtrar depois

CREATE OR REPLACE FUNCTION core.get_descriptions_for_batch_processing(
  batch_size INTEGER DEFAULT 20,
  cursor_id UUID DEFAULT NULL,
  target_language TEXT DEFAULT 'pt-br'
)
RETURNS TABLE (
  id UUID,
  description TEXT,
  attraction_id UUID,
  description_hash TEXT,
  verification_status TEXT,
  last_score_overall INTEGER,
  last_verified_at TIMESTAMPTZ,
  language TEXT,
  needs_processing_reason TEXT
)
LANGUAGE SQL
STABLE
AS $$
  SELECT 
    d.id,
    d.description,
    d.attraction_id,
    d.description_hash,
    d.verification_status,
    d.last_score_overall,
    d.last_verified_at,
    d.language,
    CASE 
      WHEN latest_score.description_hash IS NULL THEN 'no_score'
      WHEN latest_score.description_hash != d.description_hash THEN 'hash_changed'
      WHEN d.verification_status NOT IN ('rejected', 'needs_review') THEN 'status_allows'
      ELSE 'unknown'
    END as needs_processing_reason
  FROM core.attraction_descriptions d
  LEFT JOIN LATERAL (
    SELECT description_hash
    FROM core.description_scores s
    WHERE s.description_id = d.id
    ORDER BY s.created_at DESC
    LIMIT 1
  ) latest_score ON true
  WHERE d.is_original = true 
    AND d.language = target_language
    AND d.verification_status != 'approved'
    AND (
      -- Sem score (prioridade máxima)
      latest_score.description_hash IS NULL 
      -- OU texto foi modificado (hash diferente)
      OR latest_score.description_hash != d.description_hash
      -- OU status permite processamento (não é rejected/needs_review)
      OR d.verification_status NOT IN ('rejected', 'needs_review')
    )
    -- Cursor para paginação
    AND (cursor_id IS NULL OR d.id::text > cursor_id::text)
  ORDER BY 
    -- Prioridade: sem score primeiro, depois por data de atualização
    CASE WHEN latest_score.description_hash IS NULL THEN 1 ELSE 2 END,
    d.updated_at DESC
  LIMIT batch_size;
$$;

-- Comentário da função
COMMENT ON FUNCTION core.get_descriptions_for_batch_processing IS 
'Busca apenas descrições que precisam ser processadas, aplicando todos os filtros na query SQL para máxima eficiência';

-- Garantir permissões para service_role
GRANT EXECUTE ON FUNCTION core.get_descriptions_for_batch_processing TO service_role;

-- Teste da função
SELECT 
  id, 
  verification_status, 
  needs_processing_reason,
  CASE WHEN description_hash IS NOT NULL THEN 'has_hash' ELSE 'no_hash' END as hash_status
FROM core.get_descriptions_for_batch_processing(5, NULL, 'pt-br');
