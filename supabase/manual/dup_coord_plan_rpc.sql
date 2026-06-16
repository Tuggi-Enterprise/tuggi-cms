-- ============================================================
-- Plano de merge de duplicados por coordenada, EM LOTE por país.
-- Read-only. Roda UMA VEZ no painel (DDL). Devolve todos os grupos de (lat,lng)
-- duplicada do país, já com a contagem de conteúdo (tp/desc/grupos) de cada
-- membro — pra decidir o sobrevivente (mais conteúdo) sem puxar milhões de
-- linhas pelo cliente. Usa window count (sem re-join por coordenada, já que o
-- índice (lat,lng) foi removido no cleanup de I/O).
-- ============================================================

CREATE OR REPLACE FUNCTION core.dup_coord_plan(p_country text)
RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = core, public
SET statement_timeout = '180s' AS $$
  WITH scoped AS (
    SELECT a.id, a.name, a.category, a.created_at, c.latitude, c.longitude
    FROM core.attraction_coordinate c
    JOIN core.attractions a ON a.id = c.attraction_id
    WHERE a.country = p_country
      AND c.latitude IS NOT NULL AND c.longitude IS NOT NULL
      AND NOT (c.latitude = 0 AND c.longitude = 0)
  ),
  ranked AS (
    SELECT *, count(*) OVER (PARTITION BY latitude, longitude) AS n FROM scoped
  ),
  dups AS (SELECT * FROM ranked WHERE n > 1),
  withc AS (
    SELECT d.id, d.name, d.category, d.created_at, d.latitude, d.longitude,
      (SELECT count(*) FROM core.attraction_trigger_points t WHERE t.attraction_id = d.id) AS tp,
      (SELECT count(*) FROM core.attraction_descriptions  x WHERE x.attraction_id = d.id) AS dsc,
      (SELECT count(*) FROM core.attraction_group_members  m WHERE m.attraction_id = d.id) AS grp
    FROM dups d
  )
  SELECT coalesce(jsonb_agg(grp), '[]'::jsonb) FROM (
    SELECT jsonb_build_object(
      'lat', latitude, 'lng', longitude,
      'members', jsonb_agg(jsonb_build_object(
        'id', id, 'name', name, 'category', category, 'created_at', created_at,
        'tp', tp, 'desc', dsc, 'grp', grp))
    ) AS grp
    FROM withc
    GROUP BY latitude, longitude
  ) t;
$$;

GRANT EXECUTE ON FUNCTION core.dup_coord_plan(text) TO service_role;
NOTIFY pgrst, 'reload schema';
