-- ============================================
-- Migration: Professional driver clients
-- Date: 2026-06-24
-- Purpose: Allow app users (rideshare/Uber/99/transfer drivers) to self-register
--          as a "driver" client directly from the app, owning a core.clients row.
--          Adds:
--            1. app_user_id  → link from an APP user (auth.users / drive.profiles)
--               to the core.clients row they own. NOT the same as cms_user_id
--               (that is the CMS identity space). NOT the same as
--               drive.profiles.partner_id (that is attribution = who referred a user).
--            2. suppress_passenger_trial → when true, passengers attributed to this
--               client (drive.profiles.partner_id = this client) do NOT get the 24h
--               free trial. Default false table-wide so existing partners are
--               unaffected; the registration RPC sets it true only on driver rows.
--            3. client_type 'driver'.
--
-- SEQUENCING: This migration (core schema) MUST be applied BEFORE the drive-schema
--             migration 20260624120100_professional_driver.sql in tuggi-drive-v2,
--             which references core.clients.app_user_id and suppress_passenger_trial.
-- ============================================

-- 1. App-user ownership link ----------------------------------------------------
ALTER TABLE core.clients
  ADD COLUMN IF NOT EXISTS app_user_id UUID UNIQUE REFERENCES auth.users(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_clients_app_user_id
  ON core.clients (app_user_id);

COMMENT ON COLUMN core.clients.app_user_id IS
  'App user (auth.users) that OWNS this client row — used for driver self-registration. Distinct from cms_user_id (CMS identity) and from drive.profiles.partner_id (attribution).';

-- 2. Passenger trial suppression flag -------------------------------------------
ALTER TABLE core.clients
  ADD COLUMN IF NOT EXISTS suppress_passenger_trial BOOLEAN NOT NULL DEFAULT false;

COMMENT ON COLUMN core.clients.suppress_passenger_trial IS
  'When true, app users whose drive.profiles.partner_id points to this client do NOT see the 24h free trial (they already experienced the app via this partner). Default false; set true for driver clients.';

-- 3. Extend client_type CHECK to include 'driver' -------------------------------
ALTER TABLE core.clients
  DROP CONSTRAINT IF EXISTS clients_client_type_check;

ALTER TABLE core.clients
  ADD CONSTRAINT clients_client_type_check
    CHECK (client_type IN ('business', 'influencer', 'hotel', 'partner', 'creator', 'driver'));

COMMENT ON COLUMN core.clients.client_type IS
  'Categoria do relacionamento. business = empresa B2B (default). influencer/hotel/partner/creator = parceiros consumer-facing. driver = motorista de aplicativo auto-cadastrado pelo app (Pro comped 90d + QR).';

-- 4. Privileges for the drive-schema SECURITY DEFINER functions ------------------
-- drive.register_professional_driver_v1 and drive.get_user_profile_v1 run as their
-- owner and write/read core.clients cross-schema. Grant the migration/owner role
-- access. (Adjust the role name if functions are owned by a non-postgres role.)
GRANT USAGE ON SCHEMA core TO postgres;
GRANT SELECT, INSERT, UPDATE ON core.clients TO postgres;
