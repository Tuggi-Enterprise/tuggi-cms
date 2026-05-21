-- Migration: Performance + Security for custom_route_descriptions
--
-- Problems addressed:
--   1. No RLS — table exposed to direct API without access control
--   2. idx_route_descriptions_route_lang covers (route_id, language) only,
--      missing gender — the RPC JOIN on (route_id, language, gender) can't use it
--   3. No partial index for the hot path: status = 'ready' (99% of RPC queries)
--
-- Follows the same patterns as:
--   - core.attraction_descriptions  (RLS policies)
--   - core.custom_routes            (RLS + indexes)
-- Date: 2026-05-21

-- ============================================================
-- 1. PERFORMANCE — Fix indexes
-- ============================================================

-- Drop outdated index: (route_id, language) without gender.
-- The unique constraint already creates a full (route_id, language, gender) B-tree.
-- This partial duplicate wastes space and can confuse the query planner.
DROP INDEX IF EXISTS core.idx_route_descriptions_route_lang;

-- Partial index for the hot RPC path:
--   LEFT JOIN ... WHERE status = 'ready' AND language = X AND gender = Y
-- Covers ~95% of queries (the completed translations the RPCs serve).
-- Much smaller than a full index — faster reads, less I/O.
CREATE INDEX IF NOT EXISTS idx_route_descriptions_ready
  ON core.custom_route_descriptions (route_id, language, gender)
  WHERE status = 'ready';

-- Partial index for monitoring/admin queries:
--   "show me all routes currently generating or failed"
-- Kept small by partial predicate — production will be mostly 'ready'.
CREATE INDEX IF NOT EXISTS idx_route_descriptions_in_progress
  ON core.custom_route_descriptions (route_id, status, updated_at DESC)
  WHERE status IN ('generating', 'failed');

-- Drop the old status index (now superseded by the two partial indexes above)
DROP INDEX IF EXISTS core.idx_route_descriptions_status;

-- ============================================================
-- 2. SECURITY — Enable RLS
-- ============================================================

ALTER TABLE core.custom_route_descriptions ENABLE ROW LEVEL SECURITY;

-- ── Policy 1: Admin full access ───────────────────────────────────────────────
-- Admins and super_admins can do everything (same as attraction_descriptions).
-- The Edge Function uses service role (bypasses RLS entirely).
DROP POLICY IF EXISTS "route_descriptions_admin_all" ON core.custom_route_descriptions;
CREATE POLICY "route_descriptions_admin_all"
  ON core.custom_route_descriptions
  FOR ALL
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM core.cms_users cu
      WHERE cu.email = current_setting('request.jwt.claims.email', true)
        AND cu.role IN ('admin', 'super_admin')
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM core.cms_users cu
      WHERE cu.email = current_setting('request.jwt.claims.email', true)
        AND cu.role IN ('admin', 'super_admin')
    )
  );

-- ── Policy 2: Route owner can read + write translations ───────────────────────
-- Client editors can manage translations for routes they own.
-- Mirrors "attraction_descriptions_owner_manage" for the route context.
DROP POLICY IF EXISTS "route_descriptions_owner_manage" ON core.custom_route_descriptions;
CREATE POLICY "route_descriptions_owner_manage"
  ON core.custom_route_descriptions
  FOR ALL
  TO authenticated
  USING (
    EXISTS (
      SELECT 1
      FROM core.custom_routes cr
      JOIN core.cms_users cu ON cr.created_by = cu.id
      WHERE cr.id = core.custom_route_descriptions.route_id
        AND cu.email = current_setting('request.jwt.claims.email', true)
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1
      FROM core.custom_routes cr
      JOIN core.cms_users cu ON cr.created_by = cu.id
      WHERE cr.id = core.custom_route_descriptions.route_id
        AND cu.email = current_setting('request.jwt.claims.email', true)
    )
  );

-- ── Policy 3: Client members can read translations for their client's routes ──
-- Users belonging to a client can read (but not write) translations for
-- that client's routes. Needed for the CMS translations panel (read-only view
-- for non-owners).
DROP POLICY IF EXISTS "route_descriptions_client_select" ON core.custom_route_descriptions;
CREATE POLICY "route_descriptions_client_select"
  ON core.custom_route_descriptions
  FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1
      FROM core.custom_routes cr
      JOIN core.client_cms_users ccu ON cr.client_id = ccu.client_id
      JOIN core.cms_users cu ON ccu.cms_user_id = cu.id
      WHERE cr.id = core.custom_route_descriptions.route_id
        AND cu.email = current_setting('request.jwt.claims.email', true)
    )
  );
