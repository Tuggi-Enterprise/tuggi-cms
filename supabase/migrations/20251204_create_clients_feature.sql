-- Migration: Create Clients Feature
-- Purpose: Support client registration, approval, and management
-- Date: 2025-12-04

-- ============================================
-- 1. CREATE CLIENTS TABLE
-- ============================================
CREATE TABLE IF NOT EXISTS core.clients (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  
  -- Basic info
  name VARCHAR(255) NOT NULL,
  email VARCHAR(255) NOT NULL UNIQUE,
  phone VARCHAR(20),
  company_name VARCHAR(255),
  
  -- Address/Location
  address VARCHAR(500),
  city VARCHAR(100),
  state VARCHAR(100),
  country VARCHAR(100),
  postal_code VARCHAR(20),
  
  -- Business info
  industry VARCHAR(100),
  website VARCHAR(255),
  
  -- Registration and approval
  status VARCHAR(50) NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected')),
  rejection_reason TEXT,
  approved_by UUID REFERENCES core.cms_users(id) ON DELETE SET NULL,
  
  -- Associated CMS user (created when approved)
  cms_user_id UUID UNIQUE REFERENCES core.cms_users(id) ON DELETE SET NULL,
  
  -- Tracking
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  approved_at TIMESTAMPTZ,
  
  -- Metadata
  metadata JSONB DEFAULT '{}',
  notes TEXT
);

-- Create index for faster lookups
CREATE INDEX IF NOT EXISTS idx_clients_status ON core.clients(status);
CREATE INDEX IF NOT EXISTS idx_clients_email ON core.clients(email);
CREATE INDEX IF NOT EXISTS idx_clients_cms_user_id ON core.clients(cms_user_id);
CREATE INDEX IF NOT EXISTS idx_clients_created_at ON core.clients(created_at DESC);

-- ============================================
-- 2. CREATE CLIENT_CMS_USERS JUNCTION TABLE
-- ============================================
-- Allows multiple CMS users (with role 'client') to be associated with a single client
CREATE TABLE IF NOT EXISTS core.client_cms_users (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  
  client_id UUID NOT NULL REFERENCES core.clients(id) ON DELETE CASCADE,
  cms_user_id UUID NOT NULL REFERENCES core.cms_users(id) ON DELETE CASCADE,
  
  -- Role of the CMS user within this client (owner, manager, viewer)
  client_role VARCHAR(50) NOT NULL DEFAULT 'viewer' CHECK (client_role IN ('owner', 'manager', 'viewer')),
  
  -- Tracking
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  linked_by UUID REFERENCES core.cms_users(id) ON DELETE SET NULL,
  
  -- Unique constraint: each cms_user can only be linked once per client
  UNIQUE(client_id, cms_user_id)
);

CREATE INDEX IF NOT EXISTS idx_client_cms_users_client ON core.client_cms_users(client_id);
CREATE INDEX IF NOT EXISTS idx_client_cms_users_cms_user ON core.client_cms_users(cms_user_id);
CREATE INDEX IF NOT EXISTS idx_client_cms_users_client_role ON core.client_cms_users(client_role);

-- ============================================
-- 3. DRIVERS - REMOVED FOR NOW
-- ============================================
-- Will be added in a future migration

-- ============================================
-- 5. CREATE RLS POLICIES
-- ============================================

-- Enable RLS
ALTER TABLE core.clients ENABLE ROW LEVEL SECURITY;
ALTER TABLE core.client_cms_users ENABLE ROW LEVEL SECURITY;

-- Clients: Public can read pending registrations (for form), Admin can see all
CREATE POLICY "clients_select_policy" ON core.clients
  FOR SELECT
  USING (
    -- Admin can see all
    EXISTS (
      SELECT 1 FROM core.cms_users
      WHERE id = auth.uid()::uuid AND role = 'admin'
    )
    OR
    -- Public can see their own pending registration (by email)
    status = 'pending'
  );

CREATE POLICY "clients_insert_policy" ON core.clients
  FOR INSERT
  WITH CHECK (
    -- Public can insert (create own registration)
    true
  );

CREATE POLICY "clients_update_policy" ON core.clients
  FOR UPDATE
  USING (
    -- Admin can update any client
    EXISTS (
      SELECT 1 FROM core.cms_users
      WHERE id = auth.uid()::uuid AND role = 'admin'
    )
    OR
    -- Client owner can update their own client
    cms_user_id = auth.uid()::uuid
  )
  WITH CHECK (
    -- Admin can update any client
    EXISTS (
      SELECT 1 FROM core.cms_users
      WHERE id = auth.uid()::uuid AND role = 'admin'
    )
    OR
    -- Client owner can update their own client
    cms_user_id = auth.uid()::uuid
  );

-- client_cms_users: Only accessible by admin or the involved client/cms user
CREATE POLICY "client_cms_users_select_policy" ON core.client_cms_users
  FOR SELECT
  USING (
    -- Admin can see all
    EXISTS (
      SELECT 1 FROM core.cms_users
      WHERE id = auth.uid()::uuid AND role = 'admin'
    )
    OR
    -- Client owner can see linked users
    EXISTS (
      SELECT 1 FROM core.clients
      WHERE id = client_id AND cms_user_id = auth.uid()::uuid
    )
    OR
    -- Linked CMS user can see the link
    cms_user_id = auth.uid()::uuid
  );

CREATE POLICY "client_cms_users_insert_policy" ON core.client_cms_users
  FOR INSERT
  WITH CHECK (
    -- Admin can link users
    EXISTS (
      SELECT 1 FROM core.cms_users
      WHERE id = auth.uid()::uuid AND role = 'admin'
    )
    OR
    -- Client owner can link users
    EXISTS (
      SELECT 1 FROM core.clients
      WHERE id = client_id AND cms_user_id = auth.uid()::uuid
    )
  );

-- Drivers policies removed - to be added in future migration

-- ============================================
-- 6. GRANT PERMISSIONS
-- ============================================
GRANT SELECT, INSERT, UPDATE ON core.clients TO authenticated;
GRANT SELECT, INSERT, UPDATE ON core.client_cms_users TO authenticated;

GRANT ALL ON core.clients TO service_role;
GRANT ALL ON core.client_cms_users TO service_role;

-- ============================================
-- 7. CREATE AUDIT TRIGGER
-- ============================================
CREATE OR REPLACE FUNCTION core.update_clients_timestamp()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trigger_update_clients_timestamp ON core.clients;
CREATE TRIGGER trigger_update_clients_timestamp
  BEFORE UPDATE ON core.clients
  FOR EACH ROW
  EXECUTE FUNCTION core.update_clients_timestamp();

-- Drivers trigger removed - to be added in future migration
