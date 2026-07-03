-- ============================================================================
-- EVENT DETAILS — extensão 1:1 de core.attractions para o módulo Eventos
-- ============================================================================
-- ⚠️ APLICAR MANUALMENTE NO PAINEL (SQL Editor). NUNCA via CLI (regra do projeto).
--
-- Pré-requisito: 20260703_01_entity_kind (coluna entity_kind).
--
-- Contém SÓ o que não existe em core.attractions. Localização, boundary e trigger
-- points vêm dos satélites de attractions (attraction_coordinate,
-- attraction_trigger_points), reusando os índices GiST e todo o motor de
-- TP/áudio/tradução. Descrições multi-idioma + áudio vêm de attraction_descriptions.
-- Uma linha de event_details é 1:1 com a attraction de entity_kind='event'.
--
-- RLS espelha attractions (curadoria CMS; SEM leitura anon/app — o app Drive não
-- deve enxergar detalhes de evento). Escritas reais passam por RPCs SECURITY
-- DEFINER / service_role.
-- ============================================================================

CREATE TABLE IF NOT EXISTS core.event_details (
  attraction_id     UUID PRIMARY KEY REFERENCES core.attractions(id) ON DELETE CASCADE,

  -- Calendário (razão de existir do módulo; attractions não tem datas de evento)
  starts_at         TIMESTAMPTZ NOT NULL,
  ends_at           TIMESTAMPTZ,
  timezone          TEXT NOT NULL DEFAULT 'America/Sao_Paulo',  -- IANA tz
  all_day           BOOLEAN NOT NULL DEFAULT FALSE,

  -- Recorrência (RFC 5545 RRULE; NULL = ocorrência única)
  rrule             TEXT,
  recurrence_end    TIMESTAMPTZ,

  -- Ciclo de vida
  status            TEXT NOT NULL DEFAULT 'scheduled'
                    CHECK (status IN ('scheduled','rescheduled','cancelled','postponed','sold_out','completed')),

  -- Organizador / promotor
  organizer_name    TEXT,
  organizer_url     TEXT,
  organizer_contact TEXT,

  -- Ingressos / preço
  ticket_url        TEXT,
  is_free           BOOLEAN NOT NULL DEFAULT FALSE,
  price_min         NUMERIC(10,2),
  price_max         NUMERIC(10,2),
  currency          CHAR(3) DEFAULT 'BRL',
  capacity          INTEGER,
  age_restriction   TEXT,   -- 'all_ages','16+','18+', ...

  -- Apresentação / taxonomia
  poster_url        TEXT,   -- cartaz/hero (distinto da galeria attraction_image)
  event_category    TEXT,   -- 'music','sports','festival','theatre','conference','fair'
  tags              TEXT[] NOT NULL DEFAULT '{}',

  -- Auditoria padrão Tuggi
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_by UUID REFERENCES core.cms_users(id) ON DELETE SET NULL,
  updated_by UUID REFERENCES core.cms_users(id) ON DELETE SET NULL,

  CONSTRAINT event_dates_ok CHECK (ends_at IS NULL OR ends_at >= starts_at),
  CONSTRAINT event_price_ok CHECK (price_max IS NULL OR price_min IS NULL OR price_max >= price_min)
);

COMMENT ON TABLE core.event_details IS
  'Campos específicos de Eventos, 1:1 com core.attractions (entity_kind=''event''). Localização/boundary/TP/descrições reusam os satélites de attractions.';

CREATE INDEX IF NOT EXISTS idx_event_details_starts ON core.event_details (starts_at);
CREATE INDEX IF NOT EXISTS idx_event_details_status ON core.event_details (status);
CREATE INDEX IF NOT EXISTS idx_event_details_tags   ON core.event_details USING GIN (tags);

-- updated_at automático (mesmo trigger de attractions)
DROP TRIGGER IF EXISTS handle_updated_at ON core.event_details;
CREATE TRIGGER handle_updated_at BEFORE UPDATE ON core.event_details
  FOR EACH ROW EXECUTE FUNCTION core.handle_updated_at();

-- RLS -----------------------------------------------------------------------
ALTER TABLE core.event_details ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS event_details_select ON core.event_details;
CREATE POLICY event_details_select ON core.event_details
  FOR SELECT USING (core.is_active_cms_user());

DROP POLICY IF EXISTS event_details_write ON core.event_details;
CREATE POLICY event_details_write ON core.event_details
  FOR ALL USING (core.is_active_cms_editor_or_admin())
          WITH CHECK (core.is_active_cms_editor_or_admin());

-- Grants: authenticated (gated por RLS) + service_role (bypass). NUNCA anon.
GRANT SELECT, INSERT, UPDATE, DELETE ON core.event_details TO authenticated;
GRANT ALL ON core.event_details TO service_role;
