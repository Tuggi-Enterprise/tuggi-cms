-- ============================================================================
-- RETROFIT TIER 2 (BLOQUEADOR) — caminho de LEITURA do app Drive
-- ============================================================================
-- ⚠️ APLICAR MANUALMENTE NO PAINEL (SQL Editor). NUNCA via CLI (regra do projeto).
-- ⚠️ RODAR ANTES de aprovar QUALQUER evento/local (entity_kind != 'poi'), senão
--    eles vazam nas RPCs de POI do app.
--
-- Escopo: garante que o caminho de leitura do app só enxerga entity_kind='poi'.
-- Cobre, de uma vez, as 3 RPCs que o app moderno chama:
--   • app_get_nearby_pois  ─┐
--   • app_get_pois_by_cone  ├─ leem core.app_poi_read → basta o BUILD filtrar 'poi'
--   • (indireto)            ─┘
--   • app_get_poi_details   → lê core.attractions direto → patch próprio
--
-- Técnica (idempotente e à prova de drift, como 20260703_05): lê a definição VIVA
-- (pg_get_functiondef), injeta o predicado numa âncora estável e re-executa.
-- Fail-closed: se a âncora mudou, RAISE EXCEPTION (nada é corrompido) e aplicar
-- manualmente. As funções legadas/defense-in-depth ficam na 20260706_02 (best-effort).
-- ============================================================================


-- ─────────────────────────────────────────────────────────────────────────────
-- A.1 — core.app_poi_read_build(uuid[]): filtra entity_kind='poi'
--   O predicado 'a.approved = true' ocorre 2x (DELETE-keep NOT EXISTS + INSERT
--   WHERE); AMBAS precisam do filtro para (a) nunca materializar evento/local e
--   (b) remover qualquer linha que deixou de ser POI. Replace global cobre as duas.
-- ─────────────────────────────────────────────────────────────────────────────
DO $mig$
DECLARE q text := chr(39); src text; anchor text; repl text; n int;
BEGIN
  src := pg_get_functiondef('core.app_poi_read_build(uuid[])'::regprocedure);
  IF position('entity_kind' in src) > 0 THEN
    RAISE NOTICE 'app_poi_read_build: já contém entity_kind — pulando';
  ELSE
    anchor := 'a.approved = true';
    repl   := 'a.approved = true AND a.entity_kind = ' || q || 'poi' || q;
    n := (length(src) - length(replace(src, anchor, ''))) / length(anchor);
    IF n < 2 THEN
      RAISE EXCEPTION 'app_poi_read_build: âncora "a.approved = true" encontrada %x (esperado 2) — corpo divergiu; aplicar manualmente', n;
    END IF;
    EXECUTE replace(src, anchor, repl);
    RAISE NOTICE 'app_poi_read_build: patched OK (% ocorrências)', n;
  END IF;
END $mig$;


-- ─────────────────────────────────────────────────────────────────────────────
-- A.2 — Expurga linhas não-POI já materializadas em core.app_poi_read.
--   DELETE dirigido (barato) — não precisa do full rebuild pesado. Se nenhum
--   evento/local foi aprovado ainda, afeta 0 linhas (garantia idempotente).
-- ─────────────────────────────────────────────────────────────────────────────
DELETE FROM core.app_poi_read r
USING core.attractions a
WHERE a.id = r.id
  AND a.entity_kind <> 'poi';


-- ─────────────────────────────────────────────────────────────────────────────
-- A.3 — core.app_get_poi_details(uuid): lê core.attractions direto (single-row
--   por PK, sem passar pelo read-model). Precisa do filtro próprio.
--   Âncora: 'a.id = p_poi_id AND a.approved = true' (WHERE do single-row).
-- ─────────────────────────────────────────────────────────────────────────────
DO $mig$
DECLARE q text := chr(39); src text; anchor text; repl text;
BEGIN
  src := pg_get_functiondef('core.app_get_poi_details(uuid)'::regprocedure);
  IF position('entity_kind' in src) > 0 THEN
    RAISE NOTICE 'app_get_poi_details: já contém entity_kind — pulando';
  ELSE
    anchor := 'a.id = p_poi_id AND a.approved = true';
    repl   := 'a.id = p_poi_id AND a.approved = true AND a.entity_kind = ' || q || 'poi' || q;
    IF position(anchor in src) = 0 THEN
      RAISE EXCEPTION 'app_get_poi_details: âncora não encontrada — corpo divergiu (prod pode ter drift); aplicar manualmente';
    END IF;
    EXECUTE replace(src, anchor, repl);
    RAISE NOTICE 'app_get_poi_details: patched OK';
  END IF;
END $mig$;


-- ─────────────────────────────────────────────────────────────────────────────
-- VERIFICAÇÃO (rodar depois de aprovar 1 evento + 1 local de teste)
-- ─────────────────────────────────────────────────────────────────────────────
-- 1) Read-model limpo (deve dar 0):
--    SELECT count(*) FROM core.app_poi_read r
--    JOIN core.attractions a ON a.id = r.id WHERE a.entity_kind <> 'poi';
-- 2) app_get_nearby_pois NÃO retorna o evento/local de teste (mesma coordenada).
-- 3) app_get_poi_details(<id do evento>) retorna 0 linhas.
