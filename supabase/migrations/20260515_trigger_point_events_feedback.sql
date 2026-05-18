-- Feedback Loop (issue 2.5)
--
-- Cria a tabela `core.trigger_point_events` para receber eventos do app
-- (DIRECTION_BACK, AUDIO_BUSY, guide_trigger_detected) e a view materializada
-- que agrega por TP. TPs com back_rate alto entram automaticamente em review.

CREATE TABLE IF NOT EXISTS core.trigger_point_events (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  trigger_point_id uuid REFERENCES core.attraction_trigger_points(id) ON DELETE CASCADE,
  attraction_id   uuid REFERENCES core.attractions(id) ON DELETE CASCADE,
  event_type      text NOT NULL CHECK (event_type IN (
    'DIRECTION_BACK',     -- usuário no radius mas indo na direção errada
    'AUDIO_BUSY',          -- outro áudio tocando, TP perdeu o disparo
    'TRIGGER_DETECTED',    -- sucesso: áudio disparou
    'AUDIO_COMPLETED',     -- usuário ouviu até o final
    'AUDIO_INTERRUPTED'    -- usuário interrompeu ou áudio cortou
  )),
  occurred_at     timestamptz NOT NULL DEFAULT now(),
  user_id         uuid,
  metadata        jsonb,
  created_at      timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_tpe_trigger_point_id ON core.trigger_point_events(trigger_point_id);
CREATE INDEX IF NOT EXISTS idx_tpe_attraction_id ON core.trigger_point_events(attraction_id);
CREATE INDEX IF NOT EXISTS idx_tpe_event_type ON core.trigger_point_events(event_type);
CREATE INDEX IF NOT EXISTS idx_tpe_occurred_at ON core.trigger_point_events(occurred_at DESC);

-- View agregada: contagens e back_rate por TP nos últimos 30 dias
CREATE OR REPLACE VIEW core.trigger_point_health AS
SELECT
  tp.id AS trigger_point_id,
  tp.attraction_id,
  COUNT(*) FILTER (WHERE e.event_type = 'TRIGGER_DETECTED') AS triggers_fired,
  COUNT(*) FILTER (WHERE e.event_type = 'DIRECTION_BACK')   AS direction_back_count,
  COUNT(*) FILTER (WHERE e.event_type = 'AUDIO_BUSY')       AS audio_busy_count,
  COUNT(*) FILTER (WHERE e.event_type = 'AUDIO_COMPLETED')  AS audio_completed_count,
  COUNT(*) FILTER (WHERE e.event_type = 'AUDIO_INTERRUPTED') AS audio_interrupted_count,
  -- back_rate = events DIRECTION_BACK / (DIRECTION_BACK + TRIGGER_DETECTED)
  CASE
    WHEN COUNT(*) FILTER (WHERE e.event_type IN ('DIRECTION_BACK','TRIGGER_DETECTED')) > 0
    THEN COUNT(*) FILTER (WHERE e.event_type = 'DIRECTION_BACK')::float
         / NULLIF(COUNT(*) FILTER (WHERE e.event_type IN ('DIRECTION_BACK','TRIGGER_DETECTED')), 0)
    ELSE NULL
  END AS back_rate,
  MAX(e.occurred_at) AS last_event_at
FROM core.attraction_trigger_points tp
LEFT JOIN core.trigger_point_events e
  ON e.trigger_point_id = tp.id
  AND e.occurred_at >= now() - interval '30 days'
GROUP BY tp.id;

COMMENT ON VIEW core.trigger_point_health IS
  'Métricas de qualidade por TP nos últimos 30 dias. back_rate > 0.4 = problemático.';
