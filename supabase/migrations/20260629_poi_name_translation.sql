-- ============================================================================
-- POI NAME TRANSLATION — schema + read-model exposure
-- ============================================================================
-- ⚠️ APLICAR MANUALMENTE NO PAINEL (SQL Editor). NUNCA via CLI (regra do projeto).
--
-- Objetivo: nome do POI traduzido por idioma, junto da descrição daquele idioma
-- (SSOT: core.attraction_descriptions.name). O app mostra o nome no idioma do
-- usuário em cima e o nome real embaixo. Backfill é lazy (name-only) pelo app.
--
-- O nome é INDEPENDENTE de gênero: fica redundante entre as linhas male/female
-- do mesmo (attraction_id, language) — aceito (espelha custom_route_descriptions).
-- ============================================================================

-- 1) Coluna do nome traduzido (SSOT) -----------------------------------------
ALTER TABLE core.attraction_descriptions
  ADD COLUMN IF NOT EXISTS name text;

COMMENT ON COLUMN core.attraction_descriptions.name IS
  'Nome do POI traduzido para `language` (exônimo/transliteração). NULL = ainda não traduzido; o app faz fallback para attractions.name.';


-- 2) Read model: incluir `name` no audio_descriptions ------------------------
-- Alimenta o cone do guide (app_get_pois_by_cone lê de core.app_poi_read).
-- Corpo IDÊNTICO ao de 20260622_app_read_model.sql — a ÚNICA mudança é a linha
-- `'name', d.name` no jsonb_build_object do bloco `aud` (marcada com ⬅️).
CREATE OR REPLACE FUNCTION core.app_poi_read_build(p_ids uuid[] DEFAULT NULL)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'core','public','extensions'
AS $$
BEGIN
  -- Remove os que não estão (mais) visíveis (no escopo de p_ids, ou em tudo no full).
  DELETE FROM core.app_poi_read r
  WHERE (p_ids IS NULL OR r.id = ANY(p_ids))
    AND NOT EXISTS (
      SELECT 1
      FROM core.attractions a
      JOIN core.attraction_coordinate ac ON ac.attraction_id = a.id
      WHERE a.id = r.id
        AND a.approved = true
        AND COALESCE(ac.show_in_map, true) = true
        AND ac.location_geography IS NOT NULL
    );

  -- Upsert dos visíveis.
  INSERT INTO core.app_poi_read AS r (
    id, name, description, city, country, category, type,
    latitude, longitude, centroid_geog, match_geog, priority_level,
    business_status, schedule, has_boundary, boundary_area_m2, boundary_geojson,
    has_audio, audio_descriptions, trigger_points, refreshed_at
  )
  SELECT
    a.id, a.name, a.description, a.city, a.country,
    a.category::text, a.type::text,
    ac.latitude, ac.longitude,
    ac.location_geography AS centroid_geog,
    CASE
      WHEN tp.tp_collect IS NULL THEN ac.location_geography
      ELSE ST_Collect(ac.location_geography::geometry, tp.tp_collect)::geography
    END AS match_geog,
    a.priority_level,
    a.business_status,
    COALESCE(a.schedule, '[]'::jsonb) AS schedule,
    (ac.boundary_geometry IS NOT NULL) AS has_boundary,
    ac.boundary_area_m2::double precision,
    CASE WHEN ac.boundary_geometry IS NOT NULL
         THEN ST_AsGeoJSON(ac.boundary_geometry::geometry)::text END AS boundary_geojson,
    COALESCE(aud.has_audio, false) AS has_audio,
    COALESCE(aud.audio_descriptions, '[]'::jsonb) AS audio_descriptions,
    COALESCE(tp.trigger_points, '[]'::jsonb) AS trigger_points,
    now()
  FROM core.attractions a
  JOIN core.attraction_coordinate ac ON ac.attraction_id = a.id
  LEFT JOIN LATERAL (
    SELECT
      ST_Collect(t.location::geometry) AS tp_collect,
      jsonb_agg(jsonb_build_object(
        'id', t.id,
        'attraction_id', t.attraction_id,
        'name', COALESCE(t.name, 'Trigger Point'),
        'latitude', ST_Y(t.location::geometry),
        'longitude', ST_X(t.location::geometry),
        'radius', t.radius_meters,
        'type', t.type,
        'priority', t.priority,
        'expected_bearing', t.expected_bearing,
        'is_active', t.is_active,
        'direction', t.direction
      )) AS trigger_points
    FROM core.attraction_trigger_points t
    WHERE t.attraction_id = a.id AND t.is_active = true
  ) tp ON true
  LEFT JOIN LATERAL (
    SELECT
      bool_or(d.audio_url IS NOT NULL) AS has_audio,
      jsonb_agg(jsonb_build_object(
        'id', d.id,
        'language', d.language,
        'audio_url', d.audio_url,
        'description', d.description,
        'description_hash', d.description_hash,
        'name', d.name                       -- ⬅️ ÚNICA MUDANÇA: nome traduzido (pode ser NULL)
      ) ORDER BY CASE WHEN d.language='pt-br' THEN 1 WHEN d.language='pt' THEN 2 ELSE 3 END)
        FILTER (WHERE d.audio_url IS NOT NULL) AS audio_descriptions
    FROM core.attraction_descriptions d
    WHERE d.attraction_id = a.id
  ) aud ON true
  WHERE a.approved = true
    AND COALESCE(ac.show_in_map, true) = true
    AND ac.location_geography IS NOT NULL
    AND (p_ids IS NULL OR a.id = ANY(p_ids))
  ON CONFLICT (id) DO UPDATE SET
    name=EXCLUDED.name, description=EXCLUDED.description, city=EXCLUDED.city,
    country=EXCLUDED.country, category=EXCLUDED.category, type=EXCLUDED.type,
    latitude=EXCLUDED.latitude, longitude=EXCLUDED.longitude,
    centroid_geog=EXCLUDED.centroid_geog, match_geog=EXCLUDED.match_geog,
    priority_level=EXCLUDED.priority_level, business_status=EXCLUDED.business_status,
    schedule=EXCLUDED.schedule, has_boundary=EXCLUDED.has_boundary,
    boundary_area_m2=EXCLUDED.boundary_area_m2, boundary_geojson=EXCLUDED.boundary_geojson,
    has_audio=EXCLUDED.has_audio, audio_descriptions=EXCLUDED.audio_descriptions,
    trigger_points=EXCLUDED.trigger_points, refreshed_at=now();
END;
$$;
GRANT EXECUTE ON FUNCTION core.app_poi_read_build(uuid[]) TO service_role;

-- ⛔ NÃO rodar `SELECT core.refresh_app_poi_read(true)` aqui — rebuild FULL de
-- ~1.5M POIs estoura o statement_timeout. E é desnecessário: a coluna `name`
-- acabou de nascer (tudo NULL), então um full agora só gravaria 'name':null.
-- O read model se atualiza sozinho pelo DELTA incremental: refresh_app_poi_read(false)
-- (cron) reconstrói só os POIs com attraction_descriptions.updated_at > watermark.
-- Como os EFs setam updated_at ao gravar o nome, cada POI traduzido entra no
-- read model no próximo delta — sem rebuild em massa.
--
-- (Opcional) Para materializar um POI específico na hora, rode o build escopado:
--   SELECT core.app_poi_read_build(ARRAY['<attraction_id>']::uuid[]);


-- 3a) Detalhe do POI (tap) — FUNÇÃO USADA PELO APP (fetchPOIById → 'get_poi_details')
--     Corpo verbatim do db-clone/01_schema.sql; ÚNICA mudança = linha `'name', ad.name`.
CREATE OR REPLACE FUNCTION core.get_poi_details(p_poi_id uuid)
RETURNS TABLE(id uuid, name text, description text, city text, country text, state text,
  category text, rating numeric, image_url text, google_types text[],
  latitude double precision, longitude double precision, audio_descriptions jsonb,
  approved boolean, created_at timestamp with time zone, updated_at timestamp with time zone)
LANGUAGE plpgsql STABLE
SET search_path TO 'core', 'public', 'extensions'
AS $$
BEGIN
  RETURN QUERY
  SELECT
    a.id, a.name, a.description, a.city, a.country, a.state, a.category,
    a.rating, a.image_url, a.google_types, ac.latitude, ac.longitude,
    COALESCE(
      jsonb_agg(
        jsonb_build_object(
          'id', ad.id,
          'language', ad.language,
          'audio_url', ad.audio_url,
          'description', ad.description,
          'play_count', ad.play_count,
          'last_played_at', ad.last_played_at,
          'gender', ad.gender,
          'name', ad.name                    -- ⬅️ ÚNICA MUDANÇA: nome traduzido (pode ser NULL)
        ) ORDER BY
          CASE WHEN ad.language = 'pt-br' THEN 1
               WHEN ad.language = 'pt' THEN 2
               ELSE 3 END
      ) FILTER (WHERE ad.id IS NOT NULL),
      '[]'::jsonb
    ) AS audio_descriptions,
    a.approved, a.created_at, a.updated_at
  FROM core.attractions a
  INNER JOIN core.attraction_coordinate ac ON a.id = ac.attraction_id
  LEFT JOIN core.attraction_descriptions ad ON a.id = ad.attraction_id
    AND ad.audio_url IS NOT NULL
  WHERE a.id = p_poi_id AND a.approved = true
  GROUP BY a.id, a.name, a.description, a.city, a.country, a.state,
           a.category, a.rating, a.image_url, a.google_types,
           ac.latitude, ac.longitude, a.approved, a.created_at, a.updated_at;
END;
$$;
GRANT ALL ON FUNCTION core.get_poi_details(uuid) TO authenticated, service_role;

-- 3b) Variante read-model core.app_get_poi_details (se estiver em uso) — mesma
--     mudança de 1 linha. Pode pular se não houver consumidor.
CREATE OR REPLACE FUNCTION core.app_get_poi_details(p_poi_id uuid)
RETURNS TABLE(
  id uuid, name text, description text, city text, country text, state text,
  category text, rating numeric, image_url text, google_types text[],
  latitude double precision, longitude double precision, audio_descriptions jsonb,
  approved boolean, created_at timestamptz, updated_at timestamptz)
LANGUAGE plpgsql STABLE
SECURITY DEFINER
SET search_path TO 'core','public','extensions'
AS $$
BEGIN
  RETURN QUERY
  SELECT a.id, a.name, a.description, a.city, a.country, a.state, a.category,
         a.rating, a.image_url, a.google_types, ac.latitude, ac.longitude,
         COALESCE(jsonb_agg(jsonb_build_object(
           'id', ad.id, 'language', ad.language, 'audio_url', ad.audio_url,
           'description', ad.description, 'play_count', ad.play_count,
           'last_played_at', ad.last_played_at, 'gender', ad.gender,
           'name', ad.name                    -- ⬅️ nome traduzido (pode ser NULL)
         ) ORDER BY CASE WHEN ad.language='pt-br' THEN 1 WHEN ad.language='pt' THEN 2 ELSE 3 END)
           FILTER (WHERE ad.id IS NOT NULL), '[]'::jsonb) AS audio_descriptions,
         a.approved, a.created_at, a.updated_at
  FROM core.attractions a
  JOIN core.attraction_coordinate ac ON ac.attraction_id = a.id
  LEFT JOIN core.attraction_descriptions ad ON ad.attraction_id = a.id AND ad.audio_url IS NOT NULL
  WHERE a.id = p_poi_id AND a.approved = true
  GROUP BY a.id, a.name, a.description, a.city, a.country, a.state, a.category,
           a.rating, a.image_url, a.google_types, ac.latitude, ac.longitude,
           a.approved, a.created_at, a.updated_at;
END;
$$;
GRANT EXECUTE ON FUNCTION core.app_get_poi_details(uuid) TO anon, authenticated, service_role;

-- Nota: core.app_get_nearby_pois (mapa/explorar) retorna audio_descriptions = NULL
-- de propósito (payload enxuto). O marcador usa o nome canônico — sem mudança.
