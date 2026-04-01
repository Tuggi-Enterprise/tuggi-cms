CREATE OR REPLACE FUNCTION core.dashboard_recent_guide_activations(limit_count int DEFAULT 5)
RETURNS TABLE (
  user_id uuid,
  name text,
  activated_at timestamptz,
  client_name text,
  platform text
) LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
  RETURN QUERY
  SELECT 
    pv.user_id,
    COALESCE(p.nickname, p.full_name, 'Anonymous') as name,
    pv.visit_timestamp as activated_at,
    cl.name as client_name,
    pv.platform
  FROM drive.poi_visits pv
  JOIN core.clients cl ON cl.welcome_poi_id = pv.poi_id
  LEFT JOIN drive.profiles p ON p.id = pv.user_id
  ORDER BY pv.visit_timestamp DESC
  LIMIT limit_count;
END;
$$;

GRANT EXECUTE ON FUNCTION core.dashboard_recent_guide_activations(int) TO authenticated;
GRANT EXECUTE ON FUNCTION core.dashboard_recent_guide_activations(int) TO service_role;
