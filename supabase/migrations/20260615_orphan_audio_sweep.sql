-- ============================================================================
-- 20260615 — Varredura periódica de áudios órfãos (prevenção de reacúmulo)
-- ============================================================================
-- Aplicar no SQL Editor (DDL via painel). Idempotente.
--
-- Conserta o bug da automated_audio_cleanup() antiga, que fazia
-- `DELETE FROM storage.objects` (remove só o metadado, NÃO libera o blob no S3)
-- e só olhava o prefixo `audio/`. A remoção real precisa passar pela storage API,
-- então a varredura agora roda numa Edge Function (cleanup-orphan-audios).
--
-- Peças:
--   1. core.find_orphan_audio_paths(limit, ttl_days) — calcula órfãos server-side
--   2. core.automated_audio_cleanup() — passa a só disparar a EF via pg_net
--   3. cron job 9 repontado para semanal
-- ============================================================================

-- ── 1. RPC que calcula os paths órfãos (paginável; EF nunca bate o limite 2k) ──
-- Órfão = audio/ ou master_audio/ NÃO referenciado por audio_url,
--        + contextual_audio/ com mais de ttl_days dias (cache).
-- Estáticos (directional/welcome/route) ficam de fora.
CREATE OR REPLACE FUNCTION core.find_orphan_audio_paths(
  p_limit int DEFAULT 1000,
  p_contextual_max_age_days int DEFAULT 30
)
RETURNS TABLE(path text, bytes bigint, reason text)
LANGUAGE sql
SECURITY DEFINER
SET search_path = core, public, extensions
AS $$
  WITH referenced AS (
    SELECT regexp_replace(audio_url,'^.*/travel-app-audios/','') AS path
      FROM core.attraction_descriptions WHERE position('travel-app-audios/' in coalesce(audio_url,''))>0
    UNION
    SELECT regexp_replace(audio_url,'^.*/travel-app-audios/','') FROM core.cache_narrations
      WHERE position('travel-app-audios/' in coalesce(audio_url,''))>0
    UNION
    SELECT regexp_replace(audio_url,'^.*/travel-app-audios/','') FROM core.custom_route_descriptions
      WHERE position('travel-app-audios/' in coalesce(audio_url,''))>0
  )
  SELECT o.name,
         (o.metadata->>'size')::bigint,
         CASE WHEN split_part(o.name,'/',1)='contextual_audio' THEN 'contextual_ttl' ELSE 'unreferenced' END
  FROM storage.objects o
  WHERE o.bucket_id='travel-app-audios'
    AND (
      (split_part(o.name,'/',1) IN ('audio','master_audio')
        AND NOT EXISTS (SELECT 1 FROM referenced r WHERE r.path = o.name))
      OR
      (split_part(o.name,'/',1)='contextual_audio'
        AND o.created_at < now() - make_interval(days => p_contextual_max_age_days))
    )
  ORDER BY o.name
  LIMIT p_limit;
$$;

GRANT EXECUTE ON FUNCTION core.find_orphan_audio_paths(int,int) TO service_role;

-- ── 2. automated_audio_cleanup() agora só dispara a EF (remoção real via API) ──
-- (DROP necessário: a antiga retornava jsonb)
DROP FUNCTION IF EXISTS core.automated_audio_cleanup();

CREATE FUNCTION core.automated_audio_cleanup()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'core','public','extensions','net'
AS $$
DECLARE v_url text; v_key text;
BEGIN
  SELECT TRIM(decrypted_secret) INTO v_url FROM vault.decrypted_secrets WHERE name='SUPABASE_URL' LIMIT 1;
  SELECT TRIM(decrypted_secret) INTO v_key FROM vault.decrypted_secrets WHERE name='SERVICE_ROLE_KEY' LIMIT 1;
  IF v_url IS NULL OR v_key IS NULL THEN
    RAISE WARNING 'automated_audio_cleanup: SUPABASE_URL ou SERVICE_ROLE_KEY ausentes no Vault.';
    RETURN;
  END IF;
  v_url := rtrim(v_url,'/') || '/functions/v1/cleanup-orphan-audios';
  PERFORM net.http_post(
    url     := v_url,
    body    := '{}'::jsonb,
    headers := jsonb_build_object(
      'apikey',        v_key,
      'Authorization', 'Bearer ' || v_key,
      'Content-Type',  'application/json'
    )
  );
END;
$$;

GRANT EXECUTE ON FUNCTION core.automated_audio_cleanup() TO service_role;

-- ── 3. cron: mensal → semanal (domingo 03:00). Ajuste o jobid se divergir. ──
SELECT cron.alter_job(9, schedule := '0 3 * * 0');

NOTIFY pgrst, 'reload schema';

-- ── Verificação ──────────────────────────────────────────────────────────
-- Quantos órfãos a RPC enxerga agora (deve ser baixo após a limpeza inicial):
--   SELECT reason, count(*), pg_size_pretty(sum(bytes))
--   FROM core.find_orphan_audio_paths(100000, 30) GROUP BY reason;
-- Disparo manual da varredura (após deploy da EF):
--   SELECT core.automated_audio_cleanup();
-- Resultado:
--   SELECT * FROM core.storage_cleanup_logs ORDER BY execution_time DESC LIMIT 5;
