-- ============================================================================
-- App user <-> client link — read RPCs for the client-side "App Users" tab
--
-- Lets the ClientEditorModal list the app users linked to a client and search
-- app users to link. Writes still go through core.admin_set_app_user_client
-- (via PATCH /api/admin/users/[userId]/client).
--
-- Run manually in the Supabase SQL editor (no DDL via CLI).
-- ============================================================================

-- 1. App users currently linked to a given client (drive.profiles.client_id).
CREATE OR REPLACE FUNCTION core.client_app_users(target_client_id uuid)
RETURNS TABLE(
  user_id uuid,
  full_name text,
  nickname text,
  email text
)
LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'core', 'public', 'extensions'
AS $$
BEGIN
  RETURN QUERY
  SELECT
    p.id as user_id,
    p.full_name,
    p.nickname,
    au.email::text
  FROM drive.profiles p
  LEFT JOIN auth.users au ON au.id = p.id
  WHERE p.client_id = target_client_id
  ORDER BY p.full_name NULLS LAST, au.email;
END; $$;

GRANT EXECUTE ON FUNCTION core.client_app_users(uuid) TO authenticated, service_role;


-- 2. Search app users (by name / nickname / email) to pick one to link.
CREATE OR REPLACE FUNCTION core.admin_search_app_users(
  search text DEFAULT '',
  limit_count int DEFAULT 20
)
RETURNS TABLE(
  user_id uuid,
  full_name text,
  nickname text,
  email text,
  client_id uuid
)
LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'core', 'public', 'extensions'
AS $$
BEGIN
  RETURN QUERY
  SELECT
    p.id as user_id,
    p.full_name,
    p.nickname,
    au.email::text,
    p.client_id
  FROM drive.profiles p
  LEFT JOIN auth.users au ON au.id = p.id
  WHERE search IS NULL OR search = ''
     OR p.full_name ILIKE '%' || search || '%'
     OR p.nickname ILIKE '%' || search || '%'
     OR au.email ILIKE '%' || search || '%'
  ORDER BY p.full_name NULLS LAST, au.email
  LIMIT GREATEST(limit_count, 1);
END; $$;

GRANT EXECUTE ON FUNCTION core.admin_search_app_users(text, int) TO authenticated, service_role;

-- Reload PostgREST schema cache so the new RPCs are callable.
NOTIFY pgrst, 'reload schema';
