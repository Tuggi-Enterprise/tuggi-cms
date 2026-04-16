-- Migration: Create City Correction Progress Table
-- Date: 2026-04-16
-- Purpose: Support city correction Edge Functions with progress tracking and monitoring.

-- 1. Criar a tabela de progresso
CREATE TABLE IF NOT EXISTS core.city_correction_progress (
    progress_key TEXT PRIMARY KEY,
    progress_data JSONB NOT NULL DEFAULT '{}'::jsonb,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- 2. Adicionar índices para performance do monitor
CREATE INDEX IF NOT EXISTS idx_city_correction_progress_status ON core.city_correction_progress ((progress_data->>'status'));
CREATE INDEX IF NOT EXISTS idx_city_correction_progress_updated ON core.city_correction_progress (updated_at);

-- 3. Habilitar RLS (Segurança)
ALTER TABLE core.city_correction_progress ENABLE ROW LEVEL SECURITY;

-- 4. Permissões
GRANT ALL ON core.city_correction_progress TO service_role;
GRANT ALL ON core.city_correction_progress TO postgres;

-- 5. Comentários para documentação
COMMENT ON TABLE core.city_correction_progress IS 'Tracks the progress of background city correction jobs and batch processing.';
