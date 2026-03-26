-- ============================================================================
-- Migration: Add Legal, Fiscal, and Banking fields to core.clients
-- Purpose: Support multi-region company registration (BR, EU, US)
-- Date: 2026-03-26
-- Security: Sensitive fields (banking, fiscal) restricted to admin-only via RLS
-- ============================================================================

-- ============================================
-- 1. ADD NEW COLUMNS
-- ============================================

-- Legal & Fiscal
ALTER TABLE core.clients
  ADD COLUMN IF NOT EXISTS tax_id VARCHAR(50),
  ADD COLUMN IF NOT EXISTS tax_id_type VARCHAR(20),
  ADD COLUMN IF NOT EXISTS legal_representative_name VARCHAR(255),
  ADD COLUMN IF NOT EXISTS legal_representative_role VARCHAR(100);

-- Banking & Payments
ALTER TABLE core.clients
  ADD COLUMN IF NOT EXISTS billing_email VARCHAR(255),
  ADD COLUMN IF NOT EXISTS iban VARCHAR(50),
  ADD COLUMN IF NOT EXISTS bic_swift VARCHAR(20),
  ADD COLUMN IF NOT EXISTS bank_account_number VARCHAR(50),
  ADD COLUMN IF NOT EXISTS bank_routing_number VARCHAR(30),
  ADD COLUMN IF NOT EXISTS bank_name VARCHAR(100);

-- ============================================
-- 2. INDEXES
-- ============================================
CREATE INDEX IF NOT EXISTS idx_clients_tax_id ON core.clients USING btree (tax_id);
CREATE INDEX IF NOT EXISTS idx_clients_country ON core.clients USING btree (country);

-- ============================================
-- 3. COLUMN COMMENTS (documentation)
-- ============================================
COMMENT ON COLUMN core.clients.tax_id IS 'Tax identification number: CNPJ (BR), NIPC/NIF (PT/EU), EIN (US)';
COMMENT ON COLUMN core.clients.tax_id_type IS 'Type of tax ID: cnpj, nipc, nif, vat, ein, other';
COMMENT ON COLUMN core.clients.legal_representative_name IS 'Full name of the legal representative authorized to sign';
COMMENT ON COLUMN core.clients.legal_representative_role IS 'Role/title of the legal representative (e.g. CEO, Sócio-Gerente)';
COMMENT ON COLUMN core.clients.billing_email IS 'Email for financial/billing department (separate from main contact)';
COMMENT ON COLUMN core.clients.iban IS 'IBAN for EU/BR bank transfers (SEPA)';
COMMENT ON COLUMN core.clients.bic_swift IS 'BIC/SWIFT code for international wire transfers';
COMMENT ON COLUMN core.clients.bank_account_number IS 'Bank account number (US ACH/Wire)';
COMMENT ON COLUMN core.clients.bank_routing_number IS 'ABA routing number for US bank transfers';
COMMENT ON COLUMN core.clients.bank_name IS 'Name of the financial institution';

-- ============================================
-- 4. RESTRICT RLS — Admin-only for sensitive data
-- ============================================
-- The existing SELECT policy (clients_select_policy) allows public access
-- to rows with status = 'pending'. This is fine for basic info (name, email)
-- but the new banking/fiscal columns must be restricted to admin only.
--
-- Strategy: Replace the broad SELECT policy with TWO policies:
--   1. Admin: full access to all columns and rows
--   2. Public/non-admin: can only see basic columns via a security-definer function
--
-- Since Postgres RLS operates at ROW level (not column level),
-- we protect sensitive data by:
--   a) Dropping the permissive SELECT policy for non-admins on pending rows
--   b) Creating a security-definer function that returns only safe columns
--   c) The CMS frontend uses service_role (bypasses RLS) for admin operations

-- Drop the old permissive SELECT policy
DROP POLICY IF EXISTS "clients_select_policy" ON core.clients;

-- New SELECT policy: ONLY admins and the client's own CMS user can read
CREATE POLICY "clients_select_admin_only" ON core.clients
  FOR SELECT
  USING (
    -- Admin can see all
    EXISTS (
      SELECT 1 FROM core.cms_users
      WHERE id = auth.uid()::uuid AND role = 'admin' AND is_active = true
    )
    OR
    -- Client's own linked CMS user can see their own record
    cms_user_id = auth.uid()::uuid
    OR
    -- CMS users linked via client_cms_users can see the client
    EXISTS (
      SELECT 1 FROM core.client_cms_users ccu
      WHERE ccu.client_id = core.clients.id 
        AND ccu.cms_user_id = auth.uid()::uuid
    )
  );

-- Keep the existing UPDATE and INSERT policies (already admin-restricted)
-- The UPDATE policy already checks for admin role or cms_user_id ownership

-- ============================================
-- 5. SAFE PUBLIC FUNCTION (for client self-registration lookup)
-- ============================================
-- If you need a public-facing endpoint that lets pending clients
-- check their registration status, use this function instead of
-- a direct table query. It returns ONLY safe columns.

CREATE OR REPLACE FUNCTION core.get_client_registration_status(p_email TEXT)
RETURNS TABLE (
  id UUID,
  name VARCHAR,
  email VARCHAR,
  status VARCHAR,
  created_at TIMESTAMPTZ
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = core
AS $$
BEGIN
  RETURN QUERY
  SELECT c.id, c.name, c.email, c.status, c.created_at
  FROM core.clients c
  WHERE c.email = p_email
    AND c.status = 'pending';
END;
$$;

-- Grant execute to authenticated and anon (for registration form)
GRANT EXECUTE ON FUNCTION core.get_client_registration_status TO authenticated;
GRANT EXECUTE ON FUNCTION core.get_client_registration_status TO anon;

-- ============================================
-- 6. VERIFY
-- ============================================
-- After running this migration, verify:
--   SELECT column_name, data_type FROM information_schema.columns 
--   WHERE table_schema = 'core' AND table_name = 'clients' 
--   ORDER BY ordinal_position;
