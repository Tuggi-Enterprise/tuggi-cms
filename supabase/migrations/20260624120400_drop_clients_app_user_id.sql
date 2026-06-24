-- ============================================
-- Migration: Drop core.clients.app_user_id (superseded by drive.profiles.client_id)
-- Date: 2026-06-24
-- Description:
--   The 1:1 ownership pointer core.clients.app_user_id is replaced by the
--   many-to-one link drive.profiles.client_id (added in tuggi-drive-v2
--   20260624120300_profiles_client_id.sql), which supports N users : 1 client.
--   Dropping the column also drops its UNIQUE constraint and index.
--
-- RUN ORDER: apply this AFTER tuggi-drive-v2 20260624120300_profiles_client_id.sql
--   (that migration backfills drive.profiles.client_id from this column before it
--   is removed). Running this first would lose the existing 1:1 links.
-- ============================================

ALTER TABLE core.clients DROP COLUMN IF EXISTS app_user_id;
