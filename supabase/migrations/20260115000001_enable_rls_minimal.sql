-- Migration: Enable Row Level Security (RLS) on Existing Tables
-- Purpose: Implement fine-grained access control at database level
-- Date: 2026-01-15
-- Description: Protege dados de POIs e Coordinates com políticas de segurança
-- Schema: homolog (only tables that exist)
-- 
-- ⚠️ IMPORTANTE: Essa migração RLS APENAS cobre:
--   - homolog.pois ✅ Existe
--   - homolog.coordinates ✅ Existe
--
-- Tabelas que NÃO existem (removidas da migração):
--   - homolog.attraction_descriptions ❌
--   - homolog.attraction_audio ❌
--   - homolog.attraction_images ❌
--   - homolog.cms_users ❌
--   - homolog.clients (está em core, não homolog) ❌
--
-- Se precisar proteger essas tabelas, crie-as primeiro!

-- ============================================
-- ENABLE RLS ON EXISTING TABLES
-- ============================================

ALTER TABLE homolog.pois ENABLE ROW LEVEL SECURITY;
ALTER TABLE homolog.coordinates ENABLE ROW LEVEL SECURITY;

-- ============================================
-- POIS POLICIES
-- ============================================
-- Admin: Can see and edit all POIs
-- Owners: Can see and edit their own POIs (if user_id column exists)
-- Others: Can only see approved POIs

-- Policy 1: Admin sees all POIs
DROP POLICY IF EXISTS "pois_select_admin" ON homolog.pois;
CREATE POLICY "pois_select_admin" ON homolog.pois
  FOR SELECT
  USING (true);  -- Temporarily allow all for testing
  -- TODO: When cms_users table exists, use:
  -- USING (
  --   EXISTS (
  --     SELECT 1 FROM homolog.cms_users AS cu
  --     WHERE cu.id = auth.uid()::uuid AND cu.role IN ('admin', 'super_admin')
  --   )
  -- );

-- Policy 2: Owner sees their own POIs
-- (Only if user_id column exists in pois table)
DROP POLICY IF EXISTS "pois_select_owner" ON homolog.pois;
-- CREATE POLICY "pois_select_owner" ON homolog.pois
--   FOR SELECT
--   USING (
--     CASE 
--       WHEN EXISTS(SELECT 1 FROM information_schema.columns WHERE table_schema='homolog' AND table_name='pois' AND column_name='user_id')
--       THEN user_id = auth.uid()::uuid
--       ELSE false
--     END
--   );

-- Policy 3: Public sees approved POIs
-- (Only if approved column exists in pois table)
DROP POLICY IF EXISTS "pois_select_approved_public" ON homolog.pois;
-- CREATE POLICY "pois_select_approved_public" ON homolog.pois
--   FOR SELECT
--   USING (
--     CASE 
--       WHEN EXISTS(SELECT 1 FROM information_schema.columns WHERE table_schema='homolog' AND table_name='pois' AND column_name='approved')
--       THEN approved = true
--       ELSE false
--     END
--   );

-- ============================================
-- COORDINATES POLICIES
-- ============================================
-- Allow public read (coordinates are always public)

DROP POLICY IF EXISTS "coordinates_select_public" ON homolog.coordinates;
CREATE POLICY "coordinates_select_public" ON homolog.coordinates
  FOR SELECT
  USING (true);  -- Coordinates are always public

-- ============================================
-- VERIFICATION STATEMENTS
-- ============================================

-- Verify RLS is enabled on existing tables
SELECT tablename, rowsecurity 
FROM pg_tables 
WHERE schemaname = 'homolog' 
AND tablename IN ('pois', 'coordinates')
ORDER BY tablename;

-- Show all tables in homolog schema
SELECT tablename 
FROM pg_tables 
WHERE schemaname = 'homolog'
ORDER BY tablename;

-- ============================================
-- NEXT STEPS
-- ============================================
-- After deploying this, create the missing tables:
--   1. homolog.cms_users - For user management
--   2. homolog.attraction_descriptions - For POI descriptions
--   3. homolog.attraction_audio - For narration/audio
--   4. homolog.attraction_images - For POI images
--
-- Then update the RLS policies to reference cms_users for admin checks
