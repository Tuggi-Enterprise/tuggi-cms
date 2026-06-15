-- ============================================================================
-- 20260615 — Remoção da feature legada de verificação/claims de descrições
-- ============================================================================
-- Substituída pelo Google grounding. Tabelas sem dados novos desde ago/2025–jan/2026.
-- Aplicar no SQL Editor APÓS o deploy das mudanças de código (que removem os
-- leitores). Plano completo: docs/cleanup-verification-feature-removal.md
-- Backup das 7 tabelas: /tmp/verification-tables-backup.json (≤418 linhas cada).
--
-- ⚠️ Ordem: (1) reescreve funções vivas p/ pararem de ler o cluster,
--           (2) dropa funções/trigger mortos, (3) dropa FK de attractions,
--           (4) dropa tabelas (filhos primeiro).
-- ============================================================================

-- ── 1. FUNÇÕES VIVAS — remover dependência do cluster ───────────────────────

-- 1a. drive.calculate_poi_score_simple — claim_count só ia pro output, não no score
CREATE OR REPLACE FUNCTION drive.calculate_poi_score_simple(poi_uuid uuid)
 RETURNS jsonb LANGUAGE plpgsql SET search_path TO 'drive','public','extensions'
AS $function$
DECLARE
  play_count integer := 0;
  total_feedback integer := 0;
  avg_rating real := 0.0;
  final_score real := 0.5;
BEGIN
  SELECT COALESCE(ad.play_count, 0) INTO play_count
  FROM core.attraction_descriptions ad WHERE ad.attraction_id = poi_uuid LIMIT 1;

  SELECT COUNT(*), COALESCE(AVG(rating), 3.0) INTO total_feedback, avg_rating
  FROM drive.attraction_feedback af
  JOIN drive.trip_session_attractions tsa ON af.trip_session_attraction_id = tsa.id
  WHERE tsa.attraction_id = poi_uuid;

  final_score :=
    CASE WHEN play_count > 100 THEN 0.9 WHEN play_count > 50 THEN 0.8
         WHEN play_count > 10 THEN 0.7 WHEN play_count > 0 THEN 0.6 ELSE 0.5 END +
    CASE WHEN avg_rating >= 4.5 THEN 0.1 WHEN avg_rating >= 4.0 THEN 0.05 ELSE 0.0 END;
  final_score := LEAST(final_score, 1.0);

  RETURN jsonb_build_object(
    'final_score', final_score,
    'components', jsonb_build_object(
      'play_score', CASE WHEN play_count > 0 THEN 0.8 ELSE 0.5 END,
      'feedback_score', avg_rating / 5.0),
    'metrics', jsonb_build_object(
      'play_count', play_count, 'total_feedback', total_feedback, 'avg_rating', avg_rating)
  );
END;
$function$;

-- 1b. drive.calculate_poi_quality_score — claim_score (10%) vira constante neutra 0.05
CREATE OR REPLACE FUNCTION drive.calculate_poi_quality_score(poi_uuid uuid)
 RETURNS jsonb LANGUAGE plpgsql SET search_path TO 'drive','public','extensions'
AS $function$
DECLARE
  play_score real := 0.0;
  feedback_score real := 0.0;
  trip_score real := 0.0;
  claim_score real := 0.05;   -- neutro (antes vinha de core.description_claims, feature removida)
  final_score real := 0.0;
  score_breakdown jsonb;
BEGIN
  SELECT CASE WHEN ad.play_count = 0 THEN 0.1 WHEN ad.play_count > 100 THEN 1.0
              ELSE (ad.play_count::real / 100.0) END * 0.25
  INTO play_score
  FROM core.attraction_descriptions ad WHERE ad.attraction_id = poi_uuid LIMIT 1;

  WITH feedback_analysis AS (
    SELECT COUNT(*) as total_feedback, AVG(rating) as avg_rating,
           COUNT(*) FILTER (WHERE rating >= 4) as positive_feedback,
           COUNT(*) FILTER (WHERE feedback_type = 'like') as likes
    FROM drive.attraction_feedback af WHERE af.attraction_id = poi_uuid)
  SELECT CASE WHEN total_feedback = 0 THEN 0.5
              ELSE ((avg_rating/5.0)*0.6 + (positive_feedback::real/total_feedback)*0.3
                    + (likes::real/NULLIF(total_feedback,0))*0.1) END * 0.40
  INTO feedback_score FROM feedback_analysis;

  WITH trip_analysis AS (
    SELECT COUNT(DISTINCT ts.user_id) as unique_users,
           COUNT(tsa.id) FILTER (WHERE tsa.was_skipped = false) as total_plays,
           COUNT(tsa.id) FILTER (WHERE tsa.was_skipped = true) as total_skips
    FROM drive.trip_sessions ts
    JOIN drive.trip_session_attractions tsa ON ts.id = tsa.trip_session_id
    WHERE tsa.attraction_id = poi_uuid AND ts.start_time >= NOW() - INTERVAL '180 days')
  SELECT CASE WHEN total_plays + total_skips = 0 THEN 0.3
              ELSE ((unique_users::real/20.0)*0.4
                    + (total_plays::real/NULLIF(total_plays+total_skips,0))*0.6) END * 0.25
  INTO trip_score FROM trip_analysis;

  final_score := COALESCE(play_score,0.0)+COALESCE(feedback_score,0.0)
                 +COALESCE(trip_score,0.0)+COALESCE(claim_score,0.0);

  score_breakdown := jsonb_build_object(
    'final_score', LEAST(final_score,1.0),
    'components', jsonb_build_object('play_score',COALESCE(play_score,0.0),
      'feedback_score',COALESCE(feedback_score,0.0),'trip_score',COALESCE(trip_score,0.0),
      'claim_score',COALESCE(claim_score,0.0)),
    'raw_metrics', jsonb_build_object(
      'play_count',(SELECT play_count FROM core.attraction_descriptions WHERE attraction_id=poi_uuid LIMIT 1),
      'total_feedback',(SELECT COUNT(*) FROM drive.attraction_feedback WHERE attraction_id=poi_uuid),
      'avg_rating',(SELECT AVG(rating) FROM drive.attraction_feedback WHERE attraction_id=poi_uuid),
      'unique_users',(SELECT COUNT(DISTINCT ts.user_id) FROM drive.trip_sessions ts
        JOIN drive.trip_session_attractions tsa ON ts.id=tsa.trip_session_id WHERE tsa.attraction_id=poi_uuid)),
    'calculated_at', now());
  RETURN score_breakdown;
END;
$function$;

-- 1c. core.cms_get_poi_stats — remove os branches score_filter (description_scores).
--     Mantém o parâmetro score_filter (aceito e ignorado) p/ não quebrar a assinatura.
CREATE OR REPLACE FUNCTION core.cms_get_poi_stats(search_term text DEFAULT NULL::text, status_filter text DEFAULT 'all'::text, country_filter text DEFAULT NULL::text, state_filter text DEFAULT NULL::text, city_filter text DEFAULT NULL::text, google_types_filter text DEFAULT NULL::text, category_filter text DEFAULT NULL::text, content_status_filter text DEFAULT NULL::text, group_status_filter text DEFAULT NULL::text, score_filter text DEFAULT NULL::text, trigger_points_filter text DEFAULT NULL::text)
 RETURNS TABLE(total_count bigint, approved_count bigint, pending_count bigint, with_description_count bigint, with_audio_count bigint, with_trigger_points_count bigint, complete_count bigint)
 LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'core','public','extensions'
AS $function$
DECLARE
  where_conditions TEXT[] := '{}';
  filter_clause TEXT := '';
BEGIN
  IF search_term IS NOT NULL AND search_term != '' THEN
    where_conditions := array_append(where_conditions,
      '(LOWER(a.name) LIKE LOWER(''%' || search_term || '%'') OR LOWER(a.city) LIKE LOWER(''%' || search_term || '%'') OR LOWER(a.country) LIKE LOWER(''%' || search_term || '%''))');
  END IF;
  IF status_filter != 'all' THEN
    IF status_filter = 'approved' THEN where_conditions := array_append(where_conditions, 'a.approved = true');
    ELSIF status_filter = 'pending' THEN where_conditions := array_append(where_conditions, 'a.approved = false');
    END IF;
  END IF;
  IF country_filter IS NOT NULL AND country_filter != '' THEN where_conditions := array_append(where_conditions, 'a.country = ''' || country_filter || ''''); END IF;
  IF state_filter IS NOT NULL AND state_filter != '' THEN where_conditions := array_append(where_conditions, 'a.state = ''' || state_filter || ''''); END IF;
  IF city_filter IS NOT NULL AND city_filter != '' THEN where_conditions := array_append(where_conditions, 'a.city = ''' || city_filter || ''''); END IF;
  IF google_types_filter IS NOT NULL AND google_types_filter != '' THEN where_conditions := array_append(where_conditions, '''' || google_types_filter || ''' = ANY(a.google_types)'); END IF;
  IF category_filter IS NOT NULL AND category_filter != '' THEN where_conditions := array_append(where_conditions, 'a.category = ''' || category_filter || ''''); END IF;
  IF content_status_filter = 'with_description' THEN where_conditions := array_append(where_conditions, 'EXISTS (SELECT 1 FROM core.attraction_descriptions ad WHERE ad.attraction_id = a.id AND ad.description IS NOT NULL AND ad.description != '''')');
  ELSIF content_status_filter = 'without_description' THEN where_conditions := array_append(where_conditions, 'NOT EXISTS (SELECT 1 FROM core.attraction_descriptions ad WHERE ad.attraction_id = a.id AND ad.description IS NOT NULL AND ad.description != '''')');
  ELSIF content_status_filter = 'with_audio' THEN where_conditions := array_append(where_conditions, 'EXISTS (SELECT 1 FROM core.attraction_descriptions ad WHERE ad.attraction_id = a.id AND ad.audio_url IS NOT NULL AND ad.audio_url != '''')');
  ELSIF content_status_filter = 'without_audio' THEN where_conditions := array_append(where_conditions, 'NOT EXISTS (SELECT 1 FROM core.attraction_descriptions ad WHERE ad.attraction_id = a.id AND ad.audio_url IS NOT NULL AND ad.audio_url != '''')');
  ELSIF content_status_filter = 'complete' THEN where_conditions := array_append(where_conditions, 'EXISTS (SELECT 1 FROM core.attraction_descriptions ad WHERE ad.attraction_id = a.id AND ad.description IS NOT NULL AND ad.description != '''' AND ad.audio_url IS NOT NULL AND ad.audio_url != '''')');
  END IF;
  IF group_status_filter = 'grouped' THEN where_conditions := array_append(where_conditions, 'EXISTS (SELECT 1 FROM core.attraction_group_members agm WHERE agm.attraction_id = a.id)');
  ELSIF group_status_filter = 'ungrouped' THEN where_conditions := array_append(where_conditions, 'NOT EXISTS (SELECT 1 FROM core.attraction_group_members agm WHERE agm.attraction_id = a.id)');
  ELSIF group_status_filter = 'group_main' THEN where_conditions := array_append(where_conditions, 'EXISTS (SELECT 1 FROM core.attraction_group_members agm WHERE agm.attraction_id = a.id AND agm.group_role = ''main'')');
  ELSIF group_status_filter = 'group_member' THEN where_conditions := array_append(where_conditions, 'EXISTS (SELECT 1 FROM core.attraction_group_members agm WHERE agm.attraction_id = a.id AND agm.group_role = ''member'')');
  END IF;
  -- (score_filter removido — feature de verificação descontinuada; parâmetro mantido e ignorado)
  IF trigger_points_filter = 'with_trigger_points' THEN where_conditions := array_append(where_conditions, 'EXISTS (SELECT 1 FROM core.attraction_trigger_points atp WHERE atp.attraction_id = a.id)');
  ELSIF trigger_points_filter = 'without_trigger_points' THEN where_conditions := array_append(where_conditions, 'NOT EXISTS (SELECT 1 FROM core.attraction_trigger_points atp WHERE atp.attraction_id = a.id)');
  END IF;
  IF array_length(where_conditions, 1) > 0 THEN filter_clause := ' WHERE ' || array_to_string(where_conditions, ' AND '); END IF;
  RETURN QUERY EXECUTE format('
    SELECT
      (SELECT COUNT(*) FROM core.attractions a %s) as total_count,
      (SELECT COUNT(*) FROM core.attractions a %s AND a.approved = true) as approved_count,
      (SELECT COUNT(*) FROM core.attractions a %s AND a.approved = false) as pending_count,
      (SELECT COUNT(*) FROM core.attractions a %s AND EXISTS (SELECT 1 FROM core.attraction_descriptions ad WHERE ad.attraction_id = a.id AND ad.description IS NOT NULL AND ad.description != '''')) as with_description_count,
      (SELECT COUNT(*) FROM core.attractions a %s AND EXISTS (SELECT 1 FROM core.attraction_descriptions ad WHERE ad.attraction_id = a.id AND ad.audio_url IS NOT NULL AND ad.audio_url != '''')) as with_audio_count,
      (SELECT COUNT(*) FROM core.attractions a %s AND EXISTS (SELECT 1 FROM core.attraction_trigger_points atp WHERE atp.attraction_id = a.id)) as with_trigger_points_count,
      (SELECT COUNT(*) FROM core.attractions a %s AND EXISTS (SELECT 1 FROM core.attraction_descriptions ad WHERE ad.attraction_id = a.id AND ad.description IS NOT NULL AND ad.description != '''' AND ad.audio_url IS NOT NULL AND ad.audio_url != '''')) as complete_count
  ', filter_clause, filter_clause, filter_clause, filter_clause, filter_clause, filter_clause, filter_clause);
END;
$function$;

-- ── 2. FUNÇÕES MORTAS + TRIGGER ─────────────────────────────────────────────
-- (o trigger trg_scores_mirror cai junto com o DROP TABLE description_scores na
--  seção 4 — não dropar explicitamente: "DROP TRIGGER ... ON <tabela>" quebra se
--  a tabela já não existir, pois o IF EXISTS cobre o trigger e não a tabela)
DROP FUNCTION IF EXISTS core.fn_update_description_score_mirror();
DROP FUNCTION IF EXISTS core.save_description_verification_result(uuid, uuid, text, numeric, boolean, text[], text[], text[], text, boolean);
DROP FUNCTION IF EXISTS core.get_descriptions_for_batch_processing(integer, uuid, text);
DROP FUNCTION IF EXISTS core.get_sources_for_country(text);
DROP FUNCTION IF EXISTS core.get_verification_sources_layered(text, text, integer);

-- ── 3. FK da tabela ATIVA attractions p/ import_batches ─────────────────────
ALTER TABLE core.attractions DROP CONSTRAINT IF EXISTS fk_attractions_import_batch;

-- ── 4. TABELAS (filhos primeiro) ────────────────────────────────────────────
DROP TABLE IF EXISTS core.description_claim_evidence;
DROP TABLE IF EXISTS core.description_claims;
DROP TABLE IF EXISTS core.description_scores;
DROP TABLE IF EXISTS core.city_source_search_configs;
DROP TABLE IF EXISTS core.city_verification_sources;
DROP TABLE IF EXISTS core.country_verification_sources;
DROP TABLE IF EXISTS core.import_batches;

-- ── 5. (OPCIONAL) Colunas vestigiais em tabelas ativas ──────────────────────
-- Só após confirmar que o código não lê mais (fases de código já removeram).
-- ALTER TABLE core.attractions DROP COLUMN IF EXISTS import_batch_id;
-- ALTER TABLE core.attraction_descriptions
--   DROP COLUMN IF EXISTS last_score_overall,
--   DROP COLUMN IF EXISTS last_score_version,
--   DROP COLUMN IF EXISTS last_verified_at;

NOTIFY pgrst, 'reload schema';
