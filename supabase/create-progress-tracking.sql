-- Sistema de tracking de progresso para batch processing
-- Permite acompanhar o progresso mesmo se o usuário sair da página

-- Tabela para armazenar jobs de processamento
CREATE TABLE IF NOT EXISTS core.batch_processing_jobs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_email TEXT NOT NULL,
  batch_size INTEGER NOT NULL,
  total_items INTEGER NOT NULL,
  processed_items INTEGER DEFAULT 0,
  failed_items INTEGER DEFAULT 0,
  status TEXT DEFAULT 'running' CHECK (status IN ('running', 'completed', 'failed', 'cancelled')),
  started_at TIMESTAMPTZ DEFAULT NOW(),
  completed_at TIMESTAMPTZ,
  cursor_id UUID,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Tabela para armazenar detalhes de cada item processado
CREATE TABLE IF NOT EXISTS core.batch_processing_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  job_id UUID REFERENCES core.batch_processing_jobs(id) ON DELETE CASCADE,
  description_id UUID NOT NULL,
  status TEXT DEFAULT 'pending' CHECK (status IN ('pending', 'processing', 'completed', 'failed')),
  started_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,
  error_message TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Índices para performance
CREATE INDEX IF NOT EXISTS idx_batch_jobs_user_email ON core.batch_processing_jobs(user_email);
CREATE INDEX IF NOT EXISTS idx_batch_jobs_status ON core.batch_processing_jobs(status);
CREATE INDEX IF NOT EXISTS idx_batch_jobs_created_at ON core.batch_processing_jobs(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_batch_items_job_id ON core.batch_processing_items(job_id);
CREATE INDEX IF NOT EXISTS idx_batch_items_status ON core.batch_processing_items(status);

-- RLS Policies
ALTER TABLE core.batch_processing_jobs ENABLE ROW LEVEL SECURITY;
ALTER TABLE core.batch_processing_items ENABLE ROW LEVEL SECURITY;

-- Políticas para batch_processing_jobs
CREATE POLICY "Users can view their own jobs" ON core.batch_processing_jobs
  FOR SELECT USING (auth.jwt() ->> 'email' = user_email);

CREATE POLICY "Users can insert their own jobs" ON core.batch_processing_jobs
  FOR INSERT WITH CHECK (auth.jwt() ->> 'email' = user_email);

CREATE POLICY "Users can update their own jobs" ON core.batch_processing_jobs
  FOR UPDATE USING (auth.jwt() ->> 'email' = user_email);

-- Políticas para batch_processing_items
CREATE POLICY "Users can view items from their jobs" ON core.batch_processing_items
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM core.batch_processing_jobs 
      WHERE id = job_id AND user_email = auth.jwt() ->> 'email'
    )
  );

CREATE POLICY "Users can insert items to their jobs" ON core.batch_processing_items
  FOR INSERT WITH CHECK (
    EXISTS (
      SELECT 1 FROM core.batch_processing_jobs 
      WHERE id = job_id AND user_email = auth.jwt() ->> 'email'
    )
  );

CREATE POLICY "Users can update items from their jobs" ON core.batch_processing_items
  FOR UPDATE USING (
    EXISTS (
      SELECT 1 FROM core.batch_processing_jobs 
      WHERE id = job_id AND user_email = auth.jwt() ->> 'email'
    )
  );

-- Função para criar um novo job
CREATE OR REPLACE FUNCTION core.create_batch_job(
  p_user_email TEXT,
  p_batch_size INTEGER,
  p_total_items INTEGER,
  p_cursor_id UUID DEFAULT NULL
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  job_id UUID;
BEGIN
  INSERT INTO core.batch_processing_jobs (
    user_email, 
    batch_size, 
    total_items, 
    cursor_id
  ) VALUES (
    p_user_email, 
    p_batch_size, 
    p_total_items, 
    p_cursor_id
  ) RETURNING id INTO job_id;
  
  RETURN job_id;
END;
$$;

-- Função para atualizar progresso do job
CREATE OR REPLACE FUNCTION core.update_batch_progress(
  p_job_id UUID,
  p_processed_items INTEGER DEFAULT NULL,
  p_failed_items INTEGER DEFAULT NULL,
  p_status TEXT DEFAULT NULL
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  UPDATE core.batch_processing_jobs 
  SET 
    processed_items = COALESCE(p_processed_items, processed_items),
    failed_items = COALESCE(p_failed_items, failed_items),
    status = COALESCE(p_status, status),
    completed_at = CASE 
      WHEN p_status IN ('completed', 'failed', 'cancelled') THEN NOW()
      ELSE completed_at
    END
  WHERE id = p_job_id;
END;
$$;

-- Função para adicionar item ao job
CREATE OR REPLACE FUNCTION core.add_batch_item(
  p_job_id UUID,
  p_description_id UUID,
  p_status TEXT DEFAULT 'pending'
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  item_id UUID;
BEGIN
  INSERT INTO core.batch_processing_items (
    job_id, 
    description_id, 
    status
  ) VALUES (
    p_job_id, 
    p_description_id, 
    p_status
  ) RETURNING id INTO item_id;
  
  RETURN item_id;
END;
$$;

-- Função para atualizar status de um item
CREATE OR REPLACE FUNCTION core.update_batch_item_status(
  p_item_id UUID,
  p_status TEXT,
  p_error_message TEXT DEFAULT NULL
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  UPDATE core.batch_processing_items 
  SET 
    status = p_status,
    started_at = CASE WHEN p_status = 'processing' THEN NOW() ELSE started_at END,
    completed_at = CASE WHEN p_status IN ('completed', 'failed') THEN NOW() ELSE completed_at END,
    error_message = p_error_message
  WHERE id = p_item_id;
END;
$$;

-- View para obter progresso do job
CREATE OR REPLACE VIEW core.v_batch_job_progress AS
SELECT 
  j.id as job_id,
  j.user_email,
  j.batch_size,
  j.total_items,
  j.processed_items,
  j.failed_items,
  j.status,
  j.started_at,
  j.completed_at,
  j.cursor_id,
  j.created_at,
  -- Calcular progresso
  CASE 
    WHEN j.total_items = 0 THEN 0
    ELSE ROUND((j.processed_items::DECIMAL / j.total_items) * 100, 1)
  END as progress_percentage,
  -- Calcular tempo estimado
  CASE 
    WHEN j.processed_items = 0 THEN NULL
    ELSE 
      EXTRACT(EPOCH FROM (NOW() - j.started_at)) / j.processed_items * (j.total_items - j.processed_items)
  END as estimated_seconds_remaining,
  -- Calcular taxa de processamento
  CASE 
    WHEN EXTRACT(EPOCH FROM (NOW() - j.started_at)) = 0 THEN 0
    ELSE ROUND(j.processed_items / EXTRACT(EPOCH FROM (NOW() - j.started_at)) * 60, 1)
  END as items_per_minute
FROM core.batch_processing_jobs j;

-- Garantir permissões
GRANT USAGE ON SCHEMA core TO authenticated;
GRANT SELECT, INSERT, UPDATE ON core.batch_processing_jobs TO authenticated;
GRANT SELECT, INSERT, UPDATE ON core.batch_processing_items TO authenticated;
GRANT SELECT ON core.v_batch_job_progress TO authenticated;
GRANT EXECUTE ON FUNCTION core.create_batch_job TO authenticated;
GRANT EXECUTE ON FUNCTION core.update_batch_progress TO authenticated;
GRANT EXECUTE ON FUNCTION core.add_batch_item TO authenticated;
GRANT EXECUTE ON FUNCTION core.update_batch_item_status TO authenticated;
