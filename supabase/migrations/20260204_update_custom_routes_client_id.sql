-- Migration: Make client_id optional in custom_routes
-- Date: 2026-02-04

-- 1. Alter table to make client_id nullable
ALTER TABLE core.custom_routes ALTER COLUMN client_id DROP NOT NULL;

-- 2. Update RPC to handle NULL client_id (already accepts NULL as it's a parameter, but needs logic update if it was strict)
-- The existing RPC core.upsert_custom_route can handle NULL, but the table would fail before.
-- Now it should work.

-- 3. Update security checks in the RPC to allow null if admin, or find a default client
-- For now, we allow null in the table, so the RPC logic needs to be careful with access checks.
