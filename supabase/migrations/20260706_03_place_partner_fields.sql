-- ============================================================================
-- PLACE DETAILS — campos de parceria/benefício para exibição no app
-- ============================================================================
-- ⚠️ APLICAR MANUALMENTE NO PAINEL (SQL Editor). NUNCA via CLI.
--
-- Pré-requisito: 20260703_03_place_details.
--
-- Mínimo viável para o card de Local no app:
--   • is_tuggi_partner — badge "Parceiro Tuggi".
--   • app_benefit      — cortesia curta exibida ao usuário (ex.: "10% off no café").
-- (Vínculo formal com core.clients / partner_client_id fica para quando houver
--  relação real; hoje é flag + texto livre curados no CMS.)
--
-- Herdam a RLS da tabela (SELECT só CMS; anon lê via RPC SECURITY DEFINER da
-- 20260706_04). Não requer novo GRANT.
-- ============================================================================

ALTER TABLE core.place_details
  ADD COLUMN IF NOT EXISTS is_tuggi_partner boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS app_benefit      text;

COMMENT ON COLUMN core.place_details.is_tuggi_partner IS
  'Local é parceiro Tuggi (badge no app).';
COMMENT ON COLUMN core.place_details.app_benefit IS
  'Cortesia/benefício curto exibido no app para o usuário (texto livre curado).';

-- Follow-up (fora deste plano): expor os 2 campos no PlaceFormModal do CMS
-- (components/place-management/PlaceFormModal.tsx) e no place-service.
