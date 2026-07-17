-- ============================================================================
-- app_poi_read — sincronização EVENT-DRIVEN (fila + triggers + wake via pg_net)
-- ============================================================================
-- ⚠️ APLICAR MANUALMENTE NO PAINEL (SQL Editor). NUNCA via CLI. REVISAR antes.
--
-- PROBLEMA: o read-model core.app_poi_read é uma cópia materializada que o app
-- consome (app_get_pois_by_cone / app_get_nearby_pois). Ele só era atualizado por
-- core.refresh_app_poi_read(false) num cron por WATERMARK (delta desde last_run).
-- Quando o import Espanha/Canadá sujou ~570k POIs, o delta ficou grande demais →
-- o build monolítico estoura o statement_timeout → o watermark nunca avança →
-- o cron falha PARA SEMPRE (loop auto-perpetuante). Além disso, áudio/descrição
-- recém-gerados ficavam invisíveis ao disparo até o (falho) cron rodar.
--
-- SOLUÇÃO (event-driven, sem cron ocioso, bulk-safe):
--   1. FILA   core.app_poi_read_dirty (1 linha por POI sujo; PK dedup/coalesce)
--   2. ENQUEUE trigger ROW-level barato em attractions + 3 tabelas-filhas →
--      só marca o id como sujo (ON CONFLICT DO NOTHING). Bulk de 500k = 500k
--      upserts baratos, NÃO 500k rebuilds.
--   3. WAKE    trigger STATEMENT-level → net.http_post acorda a EF drenadora
--      (async, não bloqueia a escrita). "Só roda quando algo muda."
--   4. DRAIN   core.drain_app_poi_read_dirty(batch) reconstrói em LOTES LIMITADOS
--      (claim atômico via FOR UPDATE SKIP LOCKED) → nunca estoura timeout.
--   5. A EF drain-app-poi-read chama o DRAIN em loop e se re-acorda se sobrar.
--
-- Substitui o cron por watermark (desligado no fim). O reindex das 570k paradas
-- é o 1º cliente da fila (seed no fim, opcional).
-- Relacionado: 20260622_app_read_model.sql, 20260708_01_events_narration_payload.sql
-- ============================================================================

-- ── 1. FILA ─────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS core.app_poi_read_dirty (
  attraction_id uuid PRIMARY KEY,
  enqueued_at   timestamptz NOT NULL DEFAULT now()
);
COMMENT ON TABLE core.app_poi_read_dirty IS
  'Fila de POIs a re-materializar em core.app_poi_read. Populada por triggers; drenada por core.drain_app_poi_read_dirty. PK = coalescência (1 linha por POI).';
CREATE INDEX IF NOT EXISTS idx_app_poi_read_dirty_enqueued
  ON core.app_poi_read_dirty (enqueued_at);
GRANT SELECT, INSERT, UPDATE, DELETE ON core.app_poi_read_dirty TO service_role;

-- ── 2. ENQUEUE (row-level, barato) ──────────────────────────────────────────
-- Duas funções p/ evitar to_jsonb por linha na tabela quente de TPs:
--   _self  → tabela attractions (id)      | _child → tabelas-filhas (attraction_id)
CREATE OR REPLACE FUNCTION core.tg_enqueue_dirty_self()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'core' AS $$
DECLARE v_id uuid := COALESCE(NEW.id, OLD.id);
BEGIN
  IF v_id IS NOT NULL THEN
    INSERT INTO core.app_poi_read_dirty(attraction_id) VALUES (v_id)
    ON CONFLICT (attraction_id) DO NOTHING;
  END IF;
  RETURN NULL;
END $$;

CREATE OR REPLACE FUNCTION core.tg_enqueue_dirty_child()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'core' AS $$
DECLARE v_id uuid := COALESCE(NEW.attraction_id, OLD.attraction_id);
BEGIN
  IF v_id IS NOT NULL THEN
    INSERT INTO core.app_poi_read_dirty(attraction_id) VALUES (v_id)
    ON CONFLICT (attraction_id) DO NOTHING;
  END IF;
  RETURN NULL;
END $$;

-- ── 3. WAKE (statement-level, 1x por statement, async via pg_net) ────────────
-- GUC de escape p/ bulk: `SET LOCAL app.skip_readmodel_wake='on'` no import →
-- enfileira sem acordar (o backstop drena). Wake por-statement + DRAIN idempotente
-- (SKIP LOCKED) tornam wakes redundantes num no-op instantâneo.
CREATE OR REPLACE FUNCTION core.tg_wake_poi_drainer()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'core','net','extensions','public' AS $$
DECLARE v_url text; v_key text;
BEGIN
  IF COALESCE(current_setting('app.skip_readmodel_wake', true), '') = 'on' THEN
    RETURN NULL;
  END IF;
  -- auth via Vault (mesmo padrão do trigger de push) — EF fica verify_jwt=true.
  SELECT TRIM(decrypted_secret) INTO v_url FROM vault.decrypted_secrets WHERE name='SUPABASE_URL' LIMIT 1;
  SELECT TRIM(decrypted_secret) INTO v_key FROM vault.decrypted_secrets WHERE name='SERVICE_ROLE_KEY' LIMIT 1;
  IF v_url IS NULL OR v_key IS NULL THEN RETURN NULL; END IF;  -- backstop cobre
  PERFORM net.http_post(                                       -- ASYNC (pg_net): não bloqueia a escrita
    url     := rtrim(v_url,'/') || '/functions/v1/drain-app-poi-read',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'apikey', v_key,
      'Authorization', 'Bearer ' || v_key
    ),
    body    := '{}'::jsonb
  );
  RETURN NULL;
EXCEPTION WHEN OTHERS THEN
  -- nunca deixar o wake derrubar a escrita de origem; o backstop cobre.
  RETURN NULL;
END $$;

-- ── 4. TRIGGERS nas 4 fontes ────────────────────────────────────────────────
-- attractions (id)
DROP TRIGGER IF EXISTS trg_enqueue_dirty ON core.attractions;
CREATE TRIGGER trg_enqueue_dirty AFTER INSERT OR UPDATE OR DELETE ON core.attractions
  FOR EACH ROW EXECUTE FUNCTION core.tg_enqueue_dirty_self();
DROP TRIGGER IF EXISTS trg_wake_drainer ON core.attractions;
CREATE TRIGGER trg_wake_drainer AFTER INSERT OR UPDATE OR DELETE ON core.attractions
  FOR EACH STATEMENT EXECUTE FUNCTION core.tg_wake_poi_drainer();

-- attraction_coordinate (attraction_id)
DROP TRIGGER IF EXISTS trg_enqueue_dirty ON core.attraction_coordinate;
CREATE TRIGGER trg_enqueue_dirty AFTER INSERT OR UPDATE OR DELETE ON core.attraction_coordinate
  FOR EACH ROW EXECUTE FUNCTION core.tg_enqueue_dirty_child();
DROP TRIGGER IF EXISTS trg_wake_drainer ON core.attraction_coordinate;
CREATE TRIGGER trg_wake_drainer AFTER INSERT OR UPDATE OR DELETE ON core.attraction_coordinate
  FOR EACH STATEMENT EXECUTE FUNCTION core.tg_wake_poi_drainer();

-- attraction_descriptions (attraction_id) — áudio, texto, novo idioma
DROP TRIGGER IF EXISTS trg_enqueue_dirty ON core.attraction_descriptions;
CREATE TRIGGER trg_enqueue_dirty AFTER INSERT OR UPDATE OR DELETE ON core.attraction_descriptions
  FOR EACH ROW EXECUTE FUNCTION core.tg_enqueue_dirty_child();
DROP TRIGGER IF EXISTS trg_wake_drainer ON core.attraction_descriptions;
CREATE TRIGGER trg_wake_drainer AFTER INSERT OR UPDATE OR DELETE ON core.attraction_descriptions
  FOR EACH STATEMENT EXECUTE FUNCTION core.tg_wake_poi_drainer();

-- attraction_trigger_points (attraction_id)
DROP TRIGGER IF EXISTS trg_enqueue_dirty ON core.attraction_trigger_points;
CREATE TRIGGER trg_enqueue_dirty AFTER INSERT OR UPDATE OR DELETE ON core.attraction_trigger_points
  FOR EACH ROW EXECUTE FUNCTION core.tg_enqueue_dirty_child();
DROP TRIGGER IF EXISTS trg_wake_drainer ON core.attraction_trigger_points;
CREATE TRIGGER trg_wake_drainer AFTER INSERT OR UPDATE OR DELETE ON core.attraction_trigger_points
  FOR EACH STATEMENT EXECUTE FUNCTION core.tg_wake_poi_drainer();

-- ── 5. DRAIN (lote LIMITADO, atômico) ───────────────────────────────────────
CREATE OR REPLACE FUNCTION core.drain_app_poi_read_dirty(batch integer DEFAULT 500)
RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'core','public','extensions'
AS $$
DECLARE v_ids uuid[];
BEGIN
  -- claim atômico: remove da fila os ids que ESTE run vai processar (SKIP LOCKED
  -- deixa runs concorrentes pegarem lotes disjuntos). Se o build abaixo falhar, a
  -- transação inteira faz rollback → os ids voltam pra fila (retry no próximo run).
  WITH claimed AS (
    SELECT attraction_id FROM core.app_poi_read_dirty
    ORDER BY enqueued_at
    FOR UPDATE SKIP LOCKED
    LIMIT GREATEST(batch, 1)
  ), del AS (
    DELETE FROM core.app_poi_read_dirty d
    USING claimed c WHERE d.attraction_id = c.attraction_id
    RETURNING d.attraction_id
  )
  SELECT array_agg(attraction_id) INTO v_ids FROM del;

  IF v_ids IS NULL THEN RETURN 0; END IF;
  PERFORM core.app_poi_read_build(v_ids);
  RETURN array_length(v_ids, 1);
END $$;
GRANT EXECUTE ON FUNCTION core.drain_app_poi_read_dirty(integer) TO service_role;

-- ── 6. BACKSTOP cron (OPCIONAL — seguro p/ wake perdido) ─────────────────────
-- Só acorda a EF se a fila NÃO estiver vazia → 99% do tempo custa ~1ms e não faz
-- trabalho nenhum. Se você quer ZERO cron, comente este bloco.
SELECT cron.schedule('app-poi-read-drain-backstop', '*/5 * * * *', $CRON$
  DO $b$
  DECLARE v_url text; v_key text;
  BEGIN
    IF EXISTS (SELECT 1 FROM core.app_poi_read_dirty LIMIT 1) THEN
      SELECT TRIM(decrypted_secret) INTO v_url FROM vault.decrypted_secrets WHERE name='SUPABASE_URL' LIMIT 1;
      SELECT TRIM(decrypted_secret) INTO v_key FROM vault.decrypted_secrets WHERE name='SERVICE_ROLE_KEY' LIMIT 1;
      IF v_url IS NOT NULL AND v_key IS NOT NULL THEN
        PERFORM net.http_post(
          url     := rtrim(v_url,'/')||'/functions/v1/drain-app-poi-read',
          headers := jsonb_build_object('Content-Type','application/json',
                       'apikey',v_key,'Authorization','Bearer '||v_key),
          body    := '{}'::jsonb
        );
      END IF;
    END IF;
  END $b$;
$CRON$);

-- ── 7. APOSENTAR o cron por watermark (a fonte do loop de falha) ─────────────
DO $$
DECLARE r record;
BEGIN
  FOR r IN SELECT jobid FROM cron.job WHERE command ILIKE '%refresh_app_poi_read%' LOOP
    PERFORM cron.unschedule(r.jobid);
    RAISE NOTICE 'unscheduled cron jobid % (refresh_app_poi_read por watermark)', r.jobid;
  END LOOP;
END $$;

NOTIFY pgrst, 'reload schema';

-- ── 8. SEED do backlog das 570k (OPCIONAL) ───────────────────────────────────
-- Rode DEPOIS de deployar a EF drain-app-poi-read. Set-based (rápido no painel).
-- O drenador esvazia sozinho em lotes. (Alternativa: rebuild via CLI — ver script.)
--   INSERT INTO core.app_poi_read_dirty (attraction_id)
--   SELECT id FROM core.attractions WHERE updated_at > '2026-06-29 11:59:55+00'
--   ON CONFLICT (attraction_id) DO NOTHING;
--   -- dispara 1x (o backstop de 5min também drena sozinho):
--   DO $seed$ DECLARE v_url text; v_key text; BEGIN
--     SELECT TRIM(decrypted_secret) INTO v_url FROM vault.decrypted_secrets WHERE name='SUPABASE_URL' LIMIT 1;
--     SELECT TRIM(decrypted_secret) INTO v_key FROM vault.decrypted_secrets WHERE name='SERVICE_ROLE_KEY' LIMIT 1;
--     PERFORM net.http_post(url:=rtrim(v_url,'/')||'/functions/v1/drain-app-poi-read',
--       headers:=jsonb_build_object('Content-Type','application/json','apikey',v_key,'Authorization','Bearer '||v_key),
--       body:='{}'::jsonb);
--   END $seed$;
