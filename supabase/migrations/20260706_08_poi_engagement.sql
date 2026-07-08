-- ============================================================================
-- POI ENGAGEMENT — uma tabela: quem + contadores incrementais por (user, POI)
-- ============================================================================
-- ⚠️ APLICAR MANUALMENTE NO PAINEL (SQL Editor).
-- ⚠️ Substitui versões anteriores (core.attraction_engagement / drive.poi_engagements).
--    O bloco de limpeza abaixo dropa os objetos antigos com segurança (IF EXISTS).
--
-- Uma única tabela keyed por (user_id, poi_id) com contadores incrementais. Dá:
--   • QUEM engajou            → user_id nas linhas ("quem quis ler as histórias")
--   • quanto CADA usuário      → open_count / read_more_count / navigate_count
--   • popularidade agregada    → SUM(open_count) GROUP BY poi_id
--   • usuários únicos          → COUNT(*) das linhas de um poi_id
-- Incremental (1 linha por user×poi, sem crescer por evento).
--
-- Fora de drive.poi_visits de propósito (exploração ≠ visita de viagem; não deve
-- inflar "descobertas"/passaporte). Escrita SÓ via RPC record_poi_engagement.
-- ============================================================================

-- ── LIMPEZA das versões anteriores (contador-só / duas-tabelas) ──────────────
DROP TRIGGER IF EXISTS trg_poi_engagement_count ON drive.poi_engagements;
DROP FUNCTION IF EXISTS drive.poi_engagement_after_insert();
DROP TABLE IF EXISTS drive.poi_engagements;
DROP FUNCTION IF EXISTS drive.record_poi_engagement(uuid, text, double precision, double precision, text);
DROP FUNCTION IF EXISTS core.increment_poi_engagement(uuid, text);
DROP TABLE IF EXISTS core.attraction_engagement;

-- ── Tabela única ─────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS drive.poi_engagement (
  user_id          uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  poi_id           uuid NOT NULL REFERENCES core.attractions(id) ON DELETE CASCADE,
  open_count       integer NOT NULL DEFAULT 0,  -- aberturas do Single POI
  read_more_count  integer NOT NULL DEFAULT 0,  -- "leia mais" / "ler transcrição"
  navigate_count   integer NOT NULL DEFAULT 0,  -- "Me leva até lá"
  first_engaged_at timestamptz NOT NULL DEFAULT now(),
  last_engaged_at  timestamptz NOT NULL DEFAULT now(),
  last_latitude    double precision,
  last_longitude   double precision,
  PRIMARY KEY (user_id, poi_id)
);

CREATE INDEX IF NOT EXISTS idx_poi_engagement_poi
  ON drive.poi_engagement (poi_id);

COMMENT ON TABLE drive.poi_engagement IS
  'Engajamento de exploração por (user, POI): contadores incrementais de open/read_more/navigate. Popularidade = SUM por poi_id; únicos = COUNT das linhas.';

-- ── RPC: upsert-increment atribuído ao usuário ───────────────────────────────
-- p_user_id explícito (padrão do record_poi_visit), com fallback para auth.uid().
CREATE OR REPLACE FUNCTION drive.record_poi_engagement(
  p_poi_id         uuid,
  p_action         text,   -- 'open' | 'read_more' | 'navigate'
  p_user_id        uuid DEFAULT NULL,
  p_user_latitude  double precision DEFAULT NULL,
  p_user_longitude double precision DEFAULT NULL
) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'drive','public','extensions'
AS $$
DECLARE v_uid uuid := COALESCE(p_user_id, auth.uid());
BEGIN
  IF v_uid IS NULL THEN RETURN; END IF;                    -- precisa de usuário
  IF p_action NOT IN ('open','read_more','navigate') THEN RETURN; END IF;

  INSERT INTO drive.poi_engagement AS e (
    user_id, poi_id, open_count, read_more_count, navigate_count,
    last_latitude, last_longitude
  ) VALUES (
    v_uid, p_poi_id,
    CASE WHEN p_action = 'open'      THEN 1 ELSE 0 END,
    CASE WHEN p_action = 'read_more' THEN 1 ELSE 0 END,
    CASE WHEN p_action = 'navigate'  THEN 1 ELSE 0 END,
    p_user_latitude, p_user_longitude
  )
  ON CONFLICT (user_id, poi_id) DO UPDATE SET
    open_count      = e.open_count      + CASE WHEN p_action = 'open'      THEN 1 ELSE 0 END,
    read_more_count = e.read_more_count + CASE WHEN p_action = 'read_more' THEN 1 ELSE 0 END,
    navigate_count  = e.navigate_count  + CASE WHEN p_action = 'navigate'  THEN 1 ELSE 0 END,
    last_engaged_at = now(),
    last_latitude   = COALESCE(p_user_latitude, e.last_latitude),
    last_longitude  = COALESCE(p_user_longitude, e.last_longitude);
END;
$$;
GRANT EXECUTE ON FUNCTION drive.record_poi_engagement(uuid, text, uuid, double precision, double precision)
  TO anon, authenticated, service_role;

-- ── RLS: usuário lê o próprio; escrita só via RPC (SECURITY DEFINER bypassa) ──
ALTER TABLE drive.poi_engagement ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS poi_engagement_select_own ON drive.poi_engagement;
CREATE POLICY poi_engagement_select_own ON drive.poi_engagement
  FOR SELECT USING (user_id = auth.uid());

GRANT SELECT ON drive.poi_engagement TO authenticated;
GRANT ALL ON drive.poi_engagement TO service_role;

-- ────────────────────────────────────────────────────────────────────────────
-- Consultas:
--   Popularidade:        SELECT poi_id, sum(open_count) opens, sum(read_more_count) reads,
--                        sum(navigate_count) navs, count(*) unique_users
--                        FROM drive.poi_engagement GROUP BY poi_id ORDER BY opens DESC;
--   Quem leu histórias:  SELECT user_id FROM drive.poi_engagement
--                        WHERE poi_id = :id AND read_more_count > 0;
--   Perfil de usuário:   SELECT poi_id, open_count, read_more_count, navigate_count
--                        FROM drive.poi_engagement WHERE user_id = :uid;
-- ============================================================================
