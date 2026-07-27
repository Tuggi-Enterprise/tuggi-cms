-- ============================================================================
-- 20260727_01_event_venue_link — vínculo Evento → POI anfitrião
-- ⚠️ APLICAR MANUAL NO PAINEL (SQL Editor). NUNCA via CLI (regra do projeto).
--
-- Resposta à Entrega 2 do PEDIDO_BACKEND_EVENTOS.md, com o escopo enxuto acordado:
-- por ora só criamos a POSSIBILIDADE de vínculo no CMS (vínculos manuais). O app
-- ainda só MOSTRA eventos, não os narra — então NÃO tocamos em app_get_nearby_events.
--
-- Decisões travadas (usuário, 27/jul/2026):
--   1. Evento vinculado CONTINUA na lista do app — listagem e vínculo são coisas
--      separadas. (por isso nada muda em app_get_nearby_events)
--   2. Ao vincular, os trigger points PRÓPRIOS do evento são DESATIVADOS, e o CMS
--      não oferece a criação de TP p/ evento vinculado (front). Assim o evento
--      vinculado fica sem TP ativo → app_get_nearby_events (que já agrega só
--      is_active=true) devolve trigger_points=[] naturalmente, sem regra extra.
--   3. POI sem TP: o backend não faz nada — curadoria ajeita manualmente.
-- ============================================================================

-- ── 1) Coluna do vínculo ─────────────────────────────────────────────────────
ALTER TABLE core.event_details
  ADD COLUMN IF NOT EXISTS venue_attraction_id UUID
    REFERENCES core.attractions(id) ON DELETE SET NULL;

COMMENT ON COLUMN core.event_details.venue_attraction_id IS
  'POI anfitrião onde o evento acontece (entity_kind=''poi''). NULL = evento '
  'autônomo (mantém TP/narração próprios). Preenchido: o POI é quem narra e os TPs '
  'próprios do evento são desativados (ver trigger event_venue_deactivate_tps).';

-- Um evento não pode ser sede de si mesmo.
ALTER TABLE core.event_details DROP CONSTRAINT IF EXISTS event_venue_not_self;
ALTER TABLE core.event_details
  ADD CONSTRAINT event_venue_not_self
  CHECK (venue_attraction_id IS NULL OR venue_attraction_id <> attraction_id);

-- Índice parcial: a maioria (eventos autônomos) fica NULL e não entra no índice.
-- Serve o "eventos neste POI" e o gatilho de invalidação da Entrega 3 (futuro).
CREATE INDEX IF NOT EXISTS idx_event_details_venue
  ON core.event_details (venue_attraction_id)
  WHERE venue_attraction_id IS NOT NULL;

-- ── 2) Guarda de tipo: o anfitrião TEM que ser um POI ────────────────────────
-- FK não restringe por entity_kind; trigger BEFORE faz e rejeita o resto.
CREATE OR REPLACE FUNCTION core.tg_event_venue_must_be_poi()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.venue_attraction_id IS NOT NULL
     AND NOT EXISTS (
       SELECT 1 FROM core.attractions a
       WHERE a.id = NEW.venue_attraction_id AND a.entity_kind = 'poi'
     ) THEN
    RAISE EXCEPTION 'venue_attraction_id % não é um POI (entity_kind=poi)', NEW.venue_attraction_id
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS event_venue_must_be_poi ON core.event_details;
CREATE TRIGGER event_venue_must_be_poi
  BEFORE INSERT OR UPDATE OF venue_attraction_id ON core.event_details
  FOR EACH ROW EXECUTE FUNCTION core.tg_event_venue_must_be_poi();

-- ── 3) Ao vincular, desativar os TPs próprios do evento ──────────────────────
-- Desativa (is_active=false), não apaga: reversível se o vínculo for desfeito.
-- Só age quando o vínculo REALMENTE muda para não-nulo (IS DISTINCT FROM cobre NULL).
CREATE OR REPLACE FUNCTION core.tg_event_venue_deactivate_tps()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.venue_attraction_id IS NOT NULL
     AND NEW.venue_attraction_id IS DISTINCT FROM OLD.venue_attraction_id THEN
    UPDATE core.attraction_trigger_points
       SET is_active = false
     WHERE attraction_id = NEW.attraction_id
       AND is_active = true;
  END IF;
  RETURN NEW;
END;
$$;

-- OLD é NULL no INSERT (a comparação IS DISTINCT FROM continua correta).
DROP TRIGGER IF EXISTS event_venue_deactivate_tps ON core.event_details;
CREATE TRIGGER event_venue_deactivate_tps
  AFTER INSERT OR UPDATE OF venue_attraction_id ON core.event_details
  FOR EACH ROW EXECUTE FUNCTION core.tg_event_venue_deactivate_tps();

-- ── 4) get_event_details: expor o vínculo + o NOME do POI anfitrião ──────────
-- event_details já é to_jsonb(ed.*), então venue_attraction_id vem de graça.
-- Só mesclamos `venue_name` p/ o CMS exibir o vínculo sem um segundo fetch.
-- Assinatura de retorno INALTERADA (event_details continua jsonb) → CREATE OR REPLACE.
CREATE OR REPLACE FUNCTION core.get_event_details(p_event_id uuid) RETURNS TABLE(
  id uuid, name text, description text, city text, state text, country text,
  approved boolean, is_active boolean, priority_level smallint,
  image_url text, created_at timestamptz, updated_at timestamptz,
  latitude double precision, longitude double precision,
  event_details jsonb, audio_descriptions jsonb
)
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path TO 'core', 'public', 'extensions'
AS $$
BEGIN
  IF NOT core.is_active_cms_user() THEN RETURN; END IF;
  RETURN QUERY
  SELECT
    a.id, a.name, a.description, a.city, a.state, a.country,
    a.approved, a.is_active, a.priority_level,
    a.image_url, a.created_at, a.updated_at,
    ac.latitude, ac.longitude,
    to_jsonb(ed.*) || jsonb_build_object('venue_name', va.name) AS event_details,
    COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'id', ad.id, 'language', ad.language, 'audio_url', ad.audio_url,
        'description', ad.description, 'name', ad.name, 'gender', ad.gender))
      FROM core.attraction_descriptions ad WHERE ad.attraction_id = a.id
    ), '[]'::jsonb) AS audio_descriptions
  FROM core.attractions a
  JOIN core.event_details ed ON ed.attraction_id = a.id
  LEFT JOIN core.attraction_coordinate ac ON ac.attraction_id = a.id
  LEFT JOIN core.attractions va ON va.id = ed.venue_attraction_id
  WHERE a.id = p_event_id AND a.entity_kind = 'event';
END;
$$;
GRANT EXECUTE ON FUNCTION core.get_event_details(uuid) TO authenticated, service_role;

-- ── VERIFICAÇÃO (no painel) ──────────────────────────────────────────────────
--   -- vincular um evento a um POI e conferir que os TPs do evento desativam:
--   UPDATE core.event_details SET venue_attraction_id = '<poi_id>'
--    WHERE attraction_id = '<event_id>';
--   SELECT count(*) FILTER (WHERE is_active) AS ativos
--     FROM core.attraction_trigger_points WHERE attraction_id = '<event_id>';  -- => 0
--   -- get_event_details deve trazer venue_attraction_id + venue_name:
--   SELECT (event_details->>'venue_attraction_id'), (event_details->>'venue_name')
--     FROM core.get_event_details('<event_id>');
--   -- guarda de tipo (deve FALHAR):
--   UPDATE core.event_details SET venue_attraction_id = '<outro_event_id>'
--    WHERE attraction_id = '<event_id>';   -- ERRO: não é um POI
-- ============================================================================
