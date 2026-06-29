-- ============================================================================
-- PROCEDÊNCIA DA DESCRIÇÃO — grounding + trilha de criação na própria linha
-- ============================================================================
-- ⚠️ APLICAR MANUALMENTE NO PAINEL (SQL Editor). NUNCA via CLI (regra do projeto).
--
-- Co-localiza na linha da descrição (core.attraction_descriptions) a procedência
-- de como ela foi criada, para análise futura SEM fetch/join extra. O SCORE já
-- mora na linha (last_score_overall/last_score_version/last_verified_at) — sem
-- mudança aqui. O texto "inicial"/histórico é versionamento (decisão futura).
--
-- Colunas nullable sem default → ADD COLUMN é metadata-only (instantâneo, mesmo
-- com milhões de linhas). A EF generate-description já grava esses campos de
-- forma DEFENSIVA (UPDATE em try/catch), então a ordem de deploy não quebra nada.
-- ============================================================================

ALTER TABLE core.attraction_descriptions
  ADD COLUMN IF NOT EXISTS grounded boolean,
  ADD COLUMN IF NOT EXISTS generation_meta jsonb;

COMMENT ON COLUMN core.attraction_descriptions.grounded IS
  'true = descrição gerada com fontes reais (RAG passo 1 achou groundingChunks); false = SAFE MODE genérico (sem fonte); null = legado/tradução (herda do master).';
COMMENT ON COLUMN core.attraction_descriptions.generation_meta IS
  'Trilha de criação (jsonb, evolui sem ALTER). Ex.: {"kind":"master_2step","grounded":true,"sources":8,"models":"retrieve:gemini-3.1-flash-lite compose:gemini-2.5-flash-lite","safe_mode":false} ou {"kind":"translation","source_language":"pt-br","grounded":null}.';

-- Índice parcial leve p/ a consulta mais útil: "descrições NÃO-grounded a revisar".
CREATE INDEX IF NOT EXISTS idx_attr_desc_not_grounded
  ON core.attraction_descriptions (attraction_id)
  WHERE grounded IS FALSE;
