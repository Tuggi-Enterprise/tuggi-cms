-- Migration: Remove client-related fields from cms_users
-- Date: 2026-02-04
-- Reason: Client fields now live in core.clients; cms_users links via client_id

ALTER TABLE IF EXISTS core.cms_users
  DROP COLUMN IF EXISTS address,
  DROP COLUMN IF EXISTS city,
  DROP COLUMN IF EXISTS company_name,
  DROP COLUMN IF EXISTS country,
  DROP COLUMN IF EXISTS industry,
  DROP COLUMN IF EXISTS postal_code,
  DROP COLUMN IF EXISTS state,
  DROP COLUMN IF EXISTS website;

ALTER TABLE IF EXISTS homolog.cms_users
  DROP COLUMN IF EXISTS address,
  DROP COLUMN IF EXISTS city,
  DROP COLUMN IF EXISTS company_name,
  DROP COLUMN IF EXISTS country,
  DROP COLUMN IF EXISTS industry,
  DROP COLUMN IF EXISTS postal_code,
  DROP COLUMN IF EXISTS state,
  DROP COLUMN IF EXISTS website;
