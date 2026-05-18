-- TP Regeneration Queue
-- Mesma lógica do processing_status no homolog, mas para o core.
-- Workers fazem claim atômico via UPDATE WHERE status='pending' LIMIT 1 SKIP LOCKED,
-- garantindo que cada POI seja processado exatamente uma vez entre N workers.

CREATE TABLE IF NOT EXISTS core.tp_regen_queue (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  attraction_id   uuid NOT NULL REFERENCES core.attractions(id) ON DELETE CASCADE,
  batch_id        text NOT NULL,              -- identifica o batch (ex: 'ny-2026-05-18')
  status          text NOT NULL DEFAULT 'pending'
                    CHECK (status IN ('pending','processing','done','failed')),
  worker_id       text,                       -- identifica qual processo/worker
  claimed_at      timestamptz,
  completed_at    timestamptz,
  error_message   text,
  tp_count        integer,                    -- quantos TPs foram salvos
  created_at      timestamptz DEFAULT now()
);

CREATE INDEX idx_tp_regen_queue_batch_status
  ON core.tp_regen_queue (batch_id, status);

CREATE UNIQUE INDEX idx_tp_regen_queue_batch_poi
  ON core.tp_regen_queue (batch_id, attraction_id);

-- RPC: claim próximo POI disponível (SKIP LOCKED = sem bloqueio entre workers)
CREATE OR REPLACE FUNCTION core.claim_next_regen(
  p_batch_id  text,
  p_worker_id text
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = core, public
AS $$
DECLARE
  v_attraction_id uuid;
BEGIN
  UPDATE core.tp_regen_queue
  SET status     = 'processing',
      worker_id  = p_worker_id,
      claimed_at = now()
  WHERE id = (
    SELECT id FROM core.tp_regen_queue
    WHERE batch_id = p_batch_id
      AND status   = 'pending'
    ORDER BY created_at
    LIMIT 1
    FOR UPDATE SKIP LOCKED
  )
  RETURNING attraction_id INTO v_attraction_id;

  RETURN v_attraction_id;
END;
$$;

GRANT EXECUTE ON FUNCTION core.claim_next_regen(text, text)
  TO authenticated, service_role;

COMMENT ON TABLE core.tp_regen_queue IS
  'Work queue for TP regeneration batches. Workers claim items atomically via claim_next_regen().';
