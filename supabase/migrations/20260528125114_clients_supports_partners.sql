-- ============================================
-- Migration: Extend core.clients for partner/influencer/hotel categorization
-- Date: 2026-05-28
-- Purpose: Reuse the existing clients registry as the single source of truth
--          for any third party Tuggi works with — influencers (Neymar),
--          hotels, generic partners, content creators. Used by the new
--          coupon system (drive.coupons.owner_client_id → core.clients.id)
--          for owner attribution on the consumer-facing success screen.
-- ============================================

ALTER TABLE core.clients
  ADD COLUMN IF NOT EXISTS client_type TEXT NOT NULL DEFAULT 'business'
    CHECK (client_type IN ('business', 'influencer', 'hotel', 'partner', 'creator'));

ALTER TABLE core.clients
  ADD COLUMN IF NOT EXISTS avatar_url TEXT,
  ADD COLUMN IF NOT EXISTS social_handle TEXT,
  ADD COLUMN IF NOT EXISTS bio_one_line TEXT;

CREATE INDEX IF NOT EXISTS idx_clients_client_type
  ON core.clients (client_type);

COMMENT ON COLUMN core.clients.client_type IS
  'Categoria do relacionamento. business = empresa B2B (default existente). influencer/hotel/partner/creator = parceiros consumer-facing referenciados em telas do app (ex: atribuição de cupom).';

COMMENT ON COLUMN core.clients.avatar_url IS
  'Foto pública (Supabase Storage). Renderizada em telas de atribuição.';

COMMENT ON COLUMN core.clients.social_handle IS
  'Handle social (ex: @neymarjr). Pode ser usado em upsell pós-resgate de cupom.';

COMMENT ON COLUMN core.clients.bio_one_line IS
  'Bio curta (1 linha) para telas consumer-facing.';
