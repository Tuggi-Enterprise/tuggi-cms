-- ============================================================
-- RPC de deleção para DEDUP de POIs (sem arquivar/blacklistar)
-- Roda UMA VEZ no painel (é DDL). Depois o CMS/scripts chamam via rpc.
--
-- Por que existe: o trigger BEFORE DELETE core.tr_poi_delete_archive arquiva
-- cada POI deletado em core.poi_exclusions (INSERT ... ON CONFLICT) e faz
-- OLD.osm_id::BIGINT. Em deleção de duplicados isso (a) não é desejado
-- (blacklista o osm_id), (b) estoura quando osm_id é sintético/não-numérico,
-- (c) colide em lock com a ingestão em massa que escreve em poi_exclusions.
-- O trigger já prevê o escape `tuggi.skip_archive='true'` ("for deduplication").
-- set_config(...,true) = SET LOCAL: vale só nesta transação.
-- ============================================================

CREATE OR REPLACE FUNCTION core.dedup_delete_pois(p_ids uuid[])
RETURNS integer
LANGUAGE plpgsql
AS $$
DECLARE
  n integer;
BEGIN
  PERFORM set_config('tuggi.skip_archive', 'true', true);  -- no-op no trigger de archive
  -- Falhar RÁPIDO se alguma linha-filho estiver travada pela geração de TPs ativa,
  -- em vez de esperar os 8s do statement_timeout. O caller re-tenta os que sobram.
  SET LOCAL lock_timeout = '1500ms';
  DELETE FROM core.attractions WHERE id = ANY(p_ids);
  GET DIAGNOSTICS n = ROW_COUNT;
  RETURN n;
END;
$$;

-- Permitir que o service_role (chave secreta usada pelos scripts) execute:
GRANT EXECUTE ON FUNCTION core.dedup_delete_pois(uuid[]) TO service_role;

-- Recarrega o cache de schema do PostgREST p/ a função aparecer via rpc:
NOTIFY pgrst, 'reload schema';
