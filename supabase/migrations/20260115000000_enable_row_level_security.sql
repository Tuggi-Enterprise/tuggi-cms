-- Migration: Enable Row Level Security (RLS) on Homolog Tables
-- Purpose: Implement fine-grained access control at database level
-- Date: 2026-01-15
-- Description: Protege dados de POIs, descrições, áudio e imagens com políticas de segurança
-- Schema: homolog (all tables are in homolog, not core)

-- ============================================
-- ENABLE RLS ON ALL TABLES
-- ============================================

ALTER TABLE homolog.pois ENABLE ROW LEVEL SECURITY;
ALTER TABLE homolog.attraction_descriptions ENABLE ROW LEVEL SECURITY;
ALTER TABLE homolog.attraction_audio ENABLE ROW LEVEL SECURITY;
ALTER TABLE homolog.attraction_images ENABLE ROW LEVEL SECURITY;
ALTER TABLE homolog.cms_users ENABLE ROW LEVEL SECURITY;
ALTER TABLE homolog.clients ENABLE ROW LEVEL SECURITY;

-- ============================================
-- CMS_USERS POLICIES
-- ============================================
-- Admin can see all users
-- Users can see only themselves

DROP POLICY IF EXISTS "cms_users_admin_select" ON homolog.cms_users;
CREATE POLICY "cms_users_admin_select" ON homolog.cms_users
  FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM homolog.cms_users AS cu
      WHERE cu.id = auth.uid()::uuid AND cu.role = 'admin'
    )
  );

DROP POLICY IF EXISTS "cms_users_self_select" ON homolog.cms_users;
CREATE POLICY "cms_users_self_select" ON homolog.cms_users
  FOR SELECT
  USING (id = auth.uid()::uuid);

DROP POLICY IF EXISTS "cms_users_admin_update" ON homolog.cms_users;
CREATE POLICY "cms_users_admin_update" ON homolog.cms_users
  FOR UPDATE
  USING (
    EXISTS (
      SELECT 1 FROM homolog.cms_users AS cu
      WHERE cu.id = auth.uid()::uuid AND cu.role = 'admin'
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM homolog.cms_users AS cu
      WHERE cu.id = auth.uid()::uuid AND cu.role = 'admin'
    )
  );

DROP POLICY IF EXISTS "cms_users_self_update" ON homolog.cms_users;
CREATE POLICY "cms_users_self_update" ON homolog.cms_users
  FOR UPDATE
  USING (id = auth.uid()::uuid)
  WITH CHECK (id = auth.uid()::uuid);

-- ============================================
-- POIS POLICIES
-- ============================================
-- Admin: Can see and edit all POIs
-- Owners: Can see and edit their own POIs
-- Others: Can only see approved POIs

DROP POLICY IF EXISTS "pois_select_admin" ON homolog.pois;
CREATE POLICY "pois_select_admin" ON homolog.pois
  FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM homolog.cms_users AS cu
      WHERE cu.id = auth.uid()::uuid AND cu.role IN ('admin', 'super_admin')
    )
  );

DROP POLICY IF EXISTS "pois_select_owner" ON homolog.pois;
CREATE POLICY "pois_select_owner" ON homolog.pois
  FOR SELECT
  USING (user_id = auth.uid()::uuid);

DROP POLICY IF EXISTS "pois_select_approved_public" ON homolog.pois;
CREATE POLICY "pois_select_approved_public" ON homolog.pois
  FOR SELECT
  USING (approved = true);

DROP POLICY IF EXISTS "pois_insert_authenticated" ON homolog.pois;
CREATE POLICY "pois_insert_authenticated" ON homolog.pois
  FOR INSERT
  WITH CHECK (
    auth.uid()::uuid IS NOT NULL
    AND user_id = auth.uid()::uuid
  );

DROP POLICY IF EXISTS "pois_update_admin" ON homolog.pois;
CREATE POLICY "pois_update_admin" ON homolog.pois
  FOR UPDATE
  USING (
    EXISTS (
      SELECT 1 FROM homolog.cms_users AS cu
      WHERE cu.id = auth.uid()::uuid AND cu.role IN ('admin', 'super_admin')
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM homolog.cms_users AS cu
      WHERE cu.id = auth.uid()::uuid AND cu.role IN ('admin', 'super_admin')
    )
  );

DROP POLICY IF EXISTS "pois_update_owner" ON homolog.pois;
CREATE POLICY "pois_update_owner" ON homolog.pois
  FOR UPDATE
  USING (user_id = auth.uid()::uuid)
  WITH CHECK (user_id = auth.uid()::uuid);

DROP POLICY IF EXISTS "pois_delete_admin" ON homolog.pois;
CREATE POLICY "pois_delete_admin" ON homolog.pois
  FOR DELETE
  USING (
    EXISTS (
      SELECT 1 FROM homolog.cms_users AS cu
      WHERE cu.id = auth.uid()::uuid AND cu.role IN ('admin', 'super_admin')
    )
  );

-- ============================================
-- ATTRACTION_DESCRIPTIONS POLICIES
-- ============================================
-- Admin: Can see and edit all descriptions
-- Owners (via POI): Can see and edit descriptions for their POIs
-- Others: Can only see descriptions for approved POIs

DROP POLICY IF EXISTS "descriptions_select_admin" ON homolog.attraction_descriptions;
CREATE POLICY "descriptions_select_admin" ON homolog.attraction_descriptions
  FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM homolog.cms_users AS cu
      WHERE cu.id = auth.uid()::uuid AND cu.role IN ('admin', 'super_admin')
    )
  );

DROP POLICY IF EXISTS "descriptions_select_owner" ON homolog.attraction_descriptions;
CREATE POLICY "descriptions_select_owner" ON homolog.attraction_descriptions
  FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM homolog.pois p
      WHERE p.id = attraction_id AND p.user_id = auth.uid()::uuid
    )
  );

DROP POLICY IF EXISTS "descriptions_select_public" ON homolog.attraction_descriptions;
CREATE POLICY "descriptions_select_public" ON homolog.attraction_descriptions
  FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM homolog.pois p
      WHERE p.id = attraction_id AND p.approved = true
    )
  );

DROP POLICY IF EXISTS "descriptions_update_admin" ON homolog.attraction_descriptions;
CREATE POLICY "descriptions_update_admin" ON homolog.attraction_descriptions
  FOR UPDATE
  USING (
    EXISTS (
      SELECT 1 FROM homolog.cms_users AS cu
      WHERE cu.id = auth.uid()::uuid AND cu.role IN ('admin', 'super_admin')
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM homolog.cms_users AS cu
      WHERE cu.id = auth.uid()::uuid AND cu.role IN ('admin', 'super_admin')
    )
  );

DROP POLICY IF EXISTS "descriptions_update_owner" ON homolog.attraction_descriptions;
CREATE POLICY "descriptions_update_owner" ON homolog.attraction_descriptions
  FOR UPDATE
  USING (
    EXISTS (
      SELECT 1 FROM homolog.pois p
      WHERE p.id = attraction_id AND p.user_id = auth.uid()::uuid
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM homolog.pois p
      WHERE p.id = attraction_id AND p.user_id = auth.uid()::uuid
    )
  );

DROP POLICY IF EXISTS "descriptions_insert_owner" ON homolog.attraction_descriptions;
CREATE POLICY "descriptions_insert_owner" ON homolog.attraction_descriptions
  FOR INSERT
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM homolog.pois p
      WHERE p.id = attraction_id AND p.user_id = auth.uid()::uuid
    )
  );

DROP POLICY IF EXISTS "descriptions_delete_admin" ON homolog.attraction_descriptions;
CREATE POLICY "descriptions_delete_admin" ON homolog.attraction_descriptions
  FOR DELETE
  USING (
    EXISTS (
      SELECT 1 FROM homolog.cms_users AS cu
      WHERE cu.id = auth.uid()::uuid AND cu.role IN ('admin', 'super_admin')
    )
  );

-- ============================================
-- ATTRACTION_AUDIO POLICIES
-- ============================================
-- Admin: Can see and edit all audio
-- Owners (via POI): Can see and edit audio for their POIs
-- Others: Can only see audio for approved POIs

DROP POLICY IF EXISTS "audio_select_admin" ON homolog.attraction_audio;
CREATE POLICY "audio_select_admin" ON homolog.attraction_audio
  FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM homolog.cms_users AS cu
      WHERE cu.id = auth.uid()::uuid AND cu.role IN ('admin', 'super_admin')
    )
  );

DROP POLICY IF EXISTS "audio_select_owner" ON homolog.attraction_audio;
CREATE POLICY "audio_select_owner" ON homolog.attraction_audio
  FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM homolog.pois p
      WHERE p.id = attraction_id AND p.user_id = auth.uid()::uuid
    )
  );

DROP POLICY IF EXISTS "audio_select_public" ON homolog.attraction_audio;
CREATE POLICY "audio_select_public" ON homolog.attraction_audio
  FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM homolog.pois p
      WHERE p.id = attraction_id AND p.approved = true
    )
  );

DROP POLICY IF EXISTS "audio_update_admin" ON homolog.attraction_audio;
CREATE POLICY "audio_update_admin" ON homolog.attraction_audio
  FOR UPDATE
  USING (
    EXISTS (
      SELECT 1 FROM homolog.cms_users AS cu
      WHERE cu.id = auth.uid()::uuid AND cu.role IN ('admin', 'super_admin')
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM homolog.cms_users AS cu
      WHERE cu.id = auth.uid()::uuid AND cu.role IN ('admin', 'super_admin')
    )
  );

DROP POLICY IF EXISTS "audio_update_owner" ON homolog.attraction_audio;
CREATE POLICY "audio_update_owner" ON homolog.attraction_audio
  FOR UPDATE
  USING (
    EXISTS (
      SELECT 1 FROM homolog.pois p
      WHERE p.id = attraction_id AND p.user_id = auth.uid()::uuid
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM homolog.pois p
      WHERE p.id = attraction_id AND p.user_id = auth.uid()::uuid
    )
  );

DROP POLICY IF EXISTS "audio_insert_owner" ON homolog.attraction_audio;
CREATE POLICY "audio_insert_owner" ON homolog.attraction_audio
  FOR INSERT
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM homolog.pois p
      WHERE p.id = attraction_id AND p.user_id = auth.uid()::uuid
    )
  );

DROP POLICY IF EXISTS "audio_delete_admin" ON homolog.attraction_audio;
CREATE POLICY "audio_delete_admin" ON homolog.attraction_audio
  FOR DELETE
  USING (
    EXISTS (
      SELECT 1 FROM homolog.cms_users AS cu
      WHERE cu.id = auth.uid()::uuid AND cu.role IN ('admin', 'super_admin')
    )
  );

-- ============================================
-- ATTRACTION_IMAGES POLICIES
-- ============================================
-- Admin: Can see and edit all images
-- Owners (via POI): Can see and edit images for their POIs
-- Others: Can only see images for approved POIs

DROP POLICY IF EXISTS "images_select_admin" ON homolog.attraction_images;
CREATE POLICY "images_select_admin" ON homolog.attraction_images
  FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM homolog.cms_users AS cu
      WHERE cu.id = auth.uid()::uuid AND cu.role IN ('admin', 'super_admin')
    )
  );

DROP POLICY IF EXISTS "images_select_owner" ON homolog.attraction_images;
CREATE POLICY "images_select_owner" ON homolog.attraction_images
  FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM homolog.pois p
      WHERE p.id = attraction_id AND p.user_id = auth.uid()::uuid
    )
  );

DROP POLICY IF EXISTS "images_select_public" ON homolog.attraction_images;
CREATE POLICY "images_select_public" ON homolog.attraction_images
  FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM homolog.pois p
      WHERE p.id = attraction_id AND p.approved = true
    )
  );

DROP POLICY IF EXISTS "images_update_admin" ON homolog.attraction_images;
CREATE POLICY "images_update_admin" ON homolog.attraction_images
  FOR UPDATE
  USING (
    EXISTS (
      SELECT 1 FROM homolog.cms_users AS cu
      WHERE cu.id = auth.uid()::uuid AND cu.role IN ('admin', 'super_admin')
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM homolog.cms_users AS cu
      WHERE cu.id = auth.uid()::uuid AND cu.role IN ('admin', 'super_admin')
    )
  );

DROP POLICY IF EXISTS "images_update_owner" ON homolog.attraction_images;
CREATE POLICY "images_update_owner" ON homolog.attraction_images
  FOR UPDATE
  USING (
    EXISTS (
      SELECT 1 FROM homolog.pois p
      WHERE p.id = attraction_id AND p.user_id = auth.uid()::uuid
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM homolog.pois p
      WHERE p.id = attraction_id AND p.user_id = auth.uid()::uuid
    )
  );

DROP POLICY IF EXISTS "images_insert_owner" ON homolog.attraction_images;
CREATE POLICY "images_insert_owner" ON homolog.attraction_images
  FOR INSERT
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM homolog.pois p
      WHERE p.id = attraction_id AND p.user_id = auth.uid()::uuid
    )
  );

DROP POLICY IF EXISTS "images_delete_admin" ON homolog.attraction_images;
CREATE POLICY "images_delete_admin" ON homolog.attraction_images
  FOR DELETE
  USING (
    EXISTS (
      SELECT 1 FROM homolog.cms_users AS cu
      WHERE cu.id = auth.uid()::uuid AND cu.role IN ('admin', 'super_admin')
    )
  );

-- ============================================
-- CLIENTS POLICIES (Already have RLS, keep existing)
-- ============================================
-- Admin: Can see all clients
-- Users: Can only see their own client
-- Public: Can't see any clients (except through specific endpoints)

-- Keep existing client policies from 20251204_create_clients_feature.sql
-- No changes needed

-- ============================================
-- VERIFICATION STATEMENTS
-- ============================================

-- Verify RLS is enabled
SELECT tablename, rowsecurity 
FROM pg_tables 
WHERE schemaname = 'core' 
AND tablename IN ('pois', 'attraction_descriptions', 'attraction_audio', 'attraction_images', 'cms_users', 'clients')
ORDER BY tablename;
