-- Migration: Add address column to cms_users for compatibility
-- Date: 2026-01-22

-- Add nullable address column to core.cms_users if missing
ALTER TABLE IF EXISTS core.cms_users
  ADD COLUMN IF NOT EXISTS address TEXT;

-- Add nullable address column to homolog.cms_users if missing
ALTER TABLE IF EXISTS homolog.cms_users
  ADD COLUMN IF NOT EXISTS address TEXT;


ALTER TABLE IF EXISTS core.cms_users
  ADD COLUMN IF NOT EXISTS city TEXT;


ALTER TABLE IF EXISTS core.cms_users
  ADD COLUMN IF NOT EXISTS company_name TEXT;

ALTER TABLE IF EXISTS core.cms_users
  ADD COLUMN IF NOT EXISTS country TEXT;

ALTER TABLE IF EXISTS core.cms_users
  ADD COLUMN IF NOT EXISTS industry TEXT;

ALTER TABLE IF EXISTS core.cms_users
  ADD COLUMN IF NOT EXISTS phone TEXT;

ALTER TABLE IF EXISTS core.cms_users
  ADD COLUMN IF NOT EXISTS postal_code TEXT;

ALTER TABLE IF EXISTS core.cms_users
  ADD COLUMN IF NOT EXISTS state TEXT;

ALTER TABLE IF EXISTS core.cms_users
  ADD COLUMN IF NOT EXISTS website TEXT;

-- No-op if column already exists; safe migration for backward compatibility

-- Note: This is a compatibility fix to address runtime errors from policies
-- or functions that reference cms_users.address. If this is unintended, we
-- should later find and correct the root object to remove the invalid reference.