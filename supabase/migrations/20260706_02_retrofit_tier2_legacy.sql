-- ============================================================================
-- RETROFIT TIER 2 (BEST-EFFORT) — funções legadas / defense-in-depth
-- ============================================================================
-- ⚠️ APLICAR MANUALMENTE NO PAINEL (SQL Editor). NUNCA via CLI.
--
-- Complemento da 20260706_01 (que já cobre o caminho de leitura real do app).
-- Aqui: funções legadas ainda vivas que filtram por id de POI recebido
-- (get_poi_details, get_trigger_points_for_poi/_batch). O vazamento prático é ~nulo
-- (o app só passa ids vindos do read-model já limpo), mas aplicamos o filtro por
-- defesa em profundidade — a partir da 1ª aprovação, 'approved=true' deixa de proteger.
--
-- BEST-EFFORT: cada função é patchada se a âncora existir; caso contrário, apenas
-- RAISE NOTICE (NÃO EXCEPTION) — nada bloqueia. Rodar o bloco inteiro; ler os NOTICE
-- e tratar manualmente as que reportarem "âncora não encontrada".
-- ============================================================================

DO $mig$
DECLARE
  q      text := chr(39);
  anchor text := 'a.approved = true';
  repl   text;
  sig    text;
  src    text;
  sigs   text[] := ARRAY[
    'core.get_poi_details(uuid)',
    'core.get_trigger_points_for_poi(uuid, boolean)',
    'core.get_trigger_points_for_poi(uuid, boolean, text)',
    'core.get_trigger_points_for_pois_batch(uuid[], boolean)',
    'core.get_trigger_points_for_pois_batch(uuid[], boolean, text)'
  ];
BEGIN
  repl := anchor || ' AND a.entity_kind = ' || q || 'poi' || q;

  FOREACH sig IN ARRAY sigs LOOP
    BEGIN
      src := pg_get_functiondef(sig::regprocedure);
    EXCEPTION WHEN OTHERS THEN
      RAISE NOTICE '%: não encontrada em prod — pulando (%)', sig, SQLERRM;
      CONTINUE;
    END;

    IF position('entity_kind' in src) > 0 THEN
      RAISE NOTICE '%: já contém entity_kind — pulando', sig;
    ELSIF position(anchor in src) = 0 THEN
      RAISE NOTICE '%: âncora "a.approved = true" não encontrada — APLICAR MANUALMENTE', sig;
    ELSE
      EXECUTE replace(src, anchor, repl);
      RAISE NOTICE '%: patched OK', sig;
    END IF;
  END LOOP;
END $mig$;

-- ─────────────────────────────────────────────────────────────────────────────
-- LEGADAS RESTANTES (Tier 2 documentado na 20260703_05) — revisar/manual quando
-- forem reintroduzidas no app. Todas filtram approved=true; aplicar o mesmo
-- "AND a.entity_kind='poi'" na âncora de cada uma, no painel, se voltarem a ser
-- chamadas:
--   get_nearby_pois / _basic / _complete / _secure / _v2
--   get_nearby_trigger_points / _complete / _v2
--   fetch_attractions_within_bbox / _optimized
--   fetch_attractions_within_radius / _optimized
--   get_attractions_by_proximity_v3 / get_map_attractions_bulk_v4
--   get_city_pois / _basic / _basic_paginated / _optimized / _smart
--   pois_in_polygon / get_pois_with_trigger_coords
-- (Não incluídas por não estarem no caminho atual do app; ver relatório de exploração.)
-- ─────────────────────────────────────────────────────────────────────────────
