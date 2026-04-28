-- Migration: Add Top Content Generators RPC
-- Description: Returns the top users who generated content (descriptions) in the platform.

CREATE OR REPLACE FUNCTION core.dashboard_top_generators(limit_count int DEFAULT 10)
RETURNS TABLE (
  user_id uuid,
  nickname text,
  content_count bigint
) LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
  RETURN QUERY
  SELECT 
    ad.generated_by_user_id as user_id,
    COALESCE(p.nickname, p.full_name, 'Unknown') as nickname,
    COUNT(*)::bigint as content_count
  FROM core.attraction_descriptions ad
  LEFT JOIN drive.profiles p ON p.id = ad.generated_by_user_id
  WHERE ad.generated_by_user_id IS NOT NULL
  GROUP BY ad.generated_by_user_id, p.nickname, p.full_name
  ORDER BY content_count DESC
  LIMIT limit_count;
END;
$$;

GRANT EXECUTE ON FUNCTION core.dashboard_top_generators(int) TO authenticated, service_role;
