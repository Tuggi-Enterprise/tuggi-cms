-- ─────────────────────────────────────────────────────────────────────────────
-- 20260715_01 — app_poi_read_build: parar de esconder descrições SEM áudio
--
-- BUG (confirmado em prod)
-- O LATERAL `aud` agregava audio_descriptions com `FILTER (WHERE d.audio_url IS NOT NULL)`.
-- Uma descrição **só-texto** (gerada, mas ainda sem áudio) ficava INVISÍVEL para o app:
--   • o payload chegava sem a linha do idioma do usuário;
--   • matchByLanguage (exato→fuzzy, NUNCA cruza idiomas) não achava nada;
--   • o app concluía "não tem descrição" e chamava a EF generate-description,
--     REGERANDO conteúdo que já existia.
--
-- Caso real: POI 75e27b48 (Parque Natural Municipal Lago dos Padres) — descrição
-- pt-br existia desde 2025-11-25 SEM áudio; en/es/fr/it tinham áudio. Um usuário
-- pt-br abriu o single em 2026-07-15 e o app regerou o texto do zero (1082 in +
-- 571 out tokens). Sistêmico: acontece com QUALQUER POI que tenha texto sem áudio
-- no idioma do usuário — a cada abertura.
--
-- FIX
-- Remover o FILTER. É seguro por construção: o app já filtra do lado dele —
--   • quer ÁUDIO  → matchByLanguage(list, lang, d => !!d.audio_url)  (ListenCard/pickAudioDesc)
--   • quer TEXTO  → matchByLanguage(list, lang, d => !!d.description) (getDisplayDescription)
-- e `has_audio` (bool_or) continua sendo o flag correto de "existe áudio".
--
-- DRIFT
-- Corpo derivado do `pg_get_functiondef` de PROD (esta função é patchada direto em
-- prod — ver memória app_get_nearby_pois_prod_drift). ÚNICA mudança vs prod: o FILTER.
-- Preservado o resto INTACTO — inclusive a ausência de 'access' no trigger_points
-- (a 20260701_tp_access_default_drive NÃO está aplicada em prod; não é escopo aqui).
--
-- APÓS APLICAR: rebuild do read-model (ver bloco no fim) para re-materializar as
-- descrições só-texto nas linhas existentes.
-- ─────────────────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION core.app_poi_read_build(p_ids uuid[] DEFAULT NULL::uuid[])
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'core', 'public', 'extensions'
AS $function$
BEGIN
  -- Remove os que não estão (mais) visíveis (no escopo de p_ids, ou em tudo no full).
  DELETE FROM core.app_poi_read r
  WHERE (p_ids IS NULL OR r.id = ANY(p_ids))
    AND NOT EXISTS (
      SELECT 1
      FROM core.attractions a
      JOIN core.attraction_coordinate ac ON ac.attraction_id = a.id
      WHERE a.id = r.id
        AND a.approved = true AND a.entity_kind = 'poi'
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
        'name', d.name
      ) ORDER BY CASE WHEN d.language='pt-br' THEN 1 WHEN d.language='pt' THEN 2 ELSE 3 END)
        AS audio_descriptions   -- ⬅️ ÚNICA MUDANÇA: FILTER (WHERE d.audio_url IS NOT NULL) REMOVIDO.
                                --    Linhas só-texto agora viajam; o app filtra por audio_url
                                --    quando quer áudio e por description quando quer texto.
    FROM core.attraction_descriptions d
    WHERE d.attraction_id = a.id
  ) aud ON true
  WHERE a.approved = true AND a.entity_kind = 'poi'
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
$function$;

-- ─────────────────────────────────────────────────────────────────────────────
-- REBUILD (rodar APÓS aplicar — re-materializa as descrições só-texto)
--
-- 1) Teste no POI do caso real (deve passar a listar a pt-br sem áudio):
--      SELECT core.app_poi_read_build(ARRAY['75e27b48-363f-36cf-998f-3bff9bfb4b7c']::uuid[]);
--      SELECT jsonb_pretty(audio_descriptions) FROM core.app_poi_read
--       WHERE id='75e27b48-363f-36cf-998f-3bff9bfb4b7c';
--    Esperado: 5 entradas (pt-br com "audio_url": null + en/es/fr/it), has_audio = true.
--
-- 2) Rebuild completo (pode demorar — roda fora de pico):
--      SELECT core.app_poi_read_build(NULL);
--
-- VERIFICAÇÃO (quantos POIs ganham texto que estava escondido):
--   SELECT count(*) FROM core.attraction_descriptions d
--    WHERE d.audio_url IS NULL AND d.description IS NOT NULL;
-- ─────────────────────────────────────────────────────────────────────────────
