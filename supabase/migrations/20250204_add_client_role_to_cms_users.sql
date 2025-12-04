-- Migration: Add 'client' role to cms_users table role constraint
-- Purpose: Support the new 'client' role in addition to existing roles
-- Date: 2025-12-04

-- First, drop the existing CHECK constraint on the role column
ALTER TABLE core.cms_users
DROP CONSTRAINT IF EXISTS cms_users_role_check;

-- Add the new CHECK constraint that includes 'client' role
ALTER TABLE core.cms_users
ADD CONSTRAINT cms_users_role_check CHECK (role IN ('admin', 'editor', 'viewer', 'client'));

-- Grant appropriate permissions (if not already granted)
-- This ensures the table remains accessible to authenticated users
GRANT SELECT, INSERT, UPDATE ON core.cms_users TO authenticated;
GRANT SELECT, INSERT, UPDATE ON core.cms_users TO service_role;
