-- ============================================================================
-- PLACE DETAILS — extensão 1:1 de core.attractions para o módulo Locais/Comércios
-- ============================================================================
-- ⚠️ APLICAR MANUALMENTE NO PAINEL (SQL Editor). NUNCA via CLI (regra do projeto).
--
-- Pré-requisito: 20260703_01_entity_kind (coluna entity_kind).
--
-- Locais reusam MUITO de core.attractions — por isso esta tabela é enxuta:
--   • horário de funcionamento  -> attractions.opening_hours / schedule /
--     schedule_exceptions + RPC core.is_poi_open_now(opening_hours, check_time)
--   • acessibilidade            -> attractions.wheelchair_*, accessibility_*,
--     pet_friendly, parking_capacity, public_transport
--   • contato / redes / pagamento / operator / brand / entrance_fee -> attractions
-- Só entra aqui o que NÃO existe em attractions.
--
-- Regra: antes de adicionar coluna aqui, verificar se já existe em attractions.
-- ============================================================================

CREATE TABLE IF NOT EXISTS core.place_details (
  attraction_id     UUID PRIMARY KEY REFERENCES core.attractions(id) ON DELETE CASCADE,

  -- Tipo de comércio / classificação
  place_type        TEXT,      -- 'restaurant','bar','cafe','shop','hotel','service', ...
  cuisine           TEXT[] NOT NULL DEFAULT '{}',  -- gastronomia (food venues)
  price_range       SMALLINT CHECK (price_range BETWEEN 1 AND 4),  -- $ .. $$$$

  -- Reserva / pedidos (attractions não tem esses links)
  reservation_url      TEXT,
  menu_url             TEXT,
  delivery_url         TEXT,
  order_online_url     TEXT,
  accepts_reservations BOOLEAN,

  -- Comodidades que NÃO existem em attractions
  has_wifi             BOOLEAN,
  has_outdoor_seating  BOOLEAN,
  has_delivery         BOOLEAN,
  has_takeaway         BOOLEAN,
  serves_alcohol       BOOLEAN,

  -- Taxonomia
  tags              TEXT[] NOT NULL DEFAULT '{}',

  -- Auditoria padrão Tuggi
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_by UUID REFERENCES core.cms_users(id) ON DELETE SET NULL,
  updated_by UUID REFERENCES core.cms_users(id) ON DELETE SET NULL
);

COMMENT ON TABLE core.place_details IS
  'Campos específicos de Locais/Comércios, 1:1 com core.attractions (entity_kind=''place''). Horário/acessibilidade/contato reusam attractions; localização/boundary/TP/descrições reusam os satélites.';

CREATE INDEX IF NOT EXISTS idx_place_details_type ON core.place_details (place_type);
CREATE INDEX IF NOT EXISTS idx_place_details_tags ON core.place_details USING GIN (tags);

-- updated_at automático
DROP TRIGGER IF EXISTS handle_updated_at ON core.place_details;
CREATE TRIGGER handle_updated_at BEFORE UPDATE ON core.place_details
  FOR EACH ROW EXECUTE FUNCTION core.handle_updated_at();

-- RLS (idêntico a event_details) --------------------------------------------
ALTER TABLE core.place_details ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS place_details_select ON core.place_details;
CREATE POLICY place_details_select ON core.place_details
  FOR SELECT USING (core.is_active_cms_user());

DROP POLICY IF EXISTS place_details_write ON core.place_details;
CREATE POLICY place_details_write ON core.place_details
  FOR ALL USING (core.is_active_cms_editor_or_admin())
          WITH CHECK (core.is_active_cms_editor_or_admin());

-- Grants: authenticated (gated por RLS) + service_role (bypass). NUNCA anon.
GRANT SELECT, INSERT, UPDATE, DELETE ON core.place_details TO authenticated;
GRANT ALL ON core.place_details TO service_role;
