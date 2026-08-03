-- 20260716_01_priority_control_layer.sql
-- ⚠️ APLICAR NO PAINEL (SQL Editor) — não rodar DDL por CLI.
--
-- CAMADA DE CONTROLE DE PRIORIDADE
-- Separa a BASE algorítmica (priority_level, derivada por regra/taxonomia) das DECISÕES:
--   • priority_override : decisão AUTORITÁRIA (humano ou IA-aceita). Vence tudo; o backfill NUNCA a sobrescreve.
--   • priority_ai       : sugestão do juiz LLM (Gemini). Não altera o app até virar override.
-- Resolução efetiva:  priority_level = COALESCE(priority_override, base_algorítmica).
-- Isso resolve o medo do "Lago do Taboão": curadoria/override nunca mais é rebaixada por rebackfill cego.

ALTER TABLE core.attractions
  ADD COLUMN IF NOT EXISTS priority_override  smallint,
  ADD COLUMN IF NOT EXISTS priority_ai        smallint,
  ADD COLUMN IF NOT EXISTS priority_ai_reason text,
  ADD COLUMN IF NOT EXISTS priority_ai_conf   char(1),      -- 'a' alta · 'm' média · 'b' baixa
  ADD COLUMN IF NOT EXISTS priority_ai_at     timestamptz,
  ADD COLUMN IF NOT EXISTS priority_source    text;         -- 'manual' | 'ai' | 'algorithm'

DO $$ BEGIN
  ALTER TABLE core.attractions ADD CONSTRAINT attractions_priority_override_chk CHECK (priority_override IS NULL OR priority_override IN (1,2,3));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE core.attractions ADD CONSTRAINT attractions_priority_ai_chk CHECK (priority_ai IS NULL OR priority_ai IN (1,2,3));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE INDEX IF NOT EXISTS idx_attractions_priority_override ON core.attractions(priority_override) WHERE priority_override IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_attractions_priority_ai       ON core.attractions(priority_ai)       WHERE priority_ai IS NOT NULL;

-- (RECOMENDADO) formalizar a curadoria humana JÁ existente como override — protege do backfill cego.
-- Só as elevações (N1/N2) manuais; N3 manual = default, não precisa travar.
UPDATE core.attractions
  SET priority_override = priority_level,
      priority_source   = 'manual'
  WHERE source_type IN ('manual','manual_premium_rescue','manual_rescue','rescue_mission')
    AND priority_level IN (1,2)
    AND priority_override IS NULL;

-- Depois de aplicar: o backfill (rescue) passa a rodar como
--   UPDATE ... SET priority_level = <computed> WHERE priority_override IS NULL;
-- e o runner do juiz grava priority_ai/_reason/_conf e, nas promoções, seta priority_override + priority_level.
