-- Migration: Track Gemini token usage on attraction descriptions
-- Purpose: Persist usageMetadata returned by Gemini for cost/throughput analytics.
-- Pattern: matches add-description-generated-by.sql (nullable columns, IF NOT EXISTS).

ALTER TABLE core.attraction_descriptions
  ADD COLUMN IF NOT EXISTS input_tokens     int   NULL,
  ADD COLUMN IF NOT EXISTS output_tokens    int   NULL,
  ADD COLUMN IF NOT EXISTS llm_model        text  NULL,
  ADD COLUMN IF NOT EXISTS generation_kind  text  NULL;

COMMENT ON COLUMN core.attraction_descriptions.input_tokens IS
  'Gemini usageMetadata.promptTokenCount of the call that produced this row';
COMMENT ON COLUMN core.attraction_descriptions.output_tokens IS
  'Gemini usageMetadata.candidatesTokenCount of the call that produced this row';
COMMENT ON COLUMN core.attraction_descriptions.llm_model IS
  'Gemini model that produced this row (e.g. gemini-2.5-flash-lite, gemini-3-flash-preview)';
COMMENT ON COLUMN core.attraction_descriptions.generation_kind IS
  'master = original generation via masterPackGenerator; translation = translated from an existing description';

-- Analytics index: covers "tokens spent in window X" queries.
CREATE INDEX IF NOT EXISTS idx_descriptions_created_at_tokens
  ON core.attraction_descriptions (created_at)
  WHERE input_tokens IS NOT NULL;
