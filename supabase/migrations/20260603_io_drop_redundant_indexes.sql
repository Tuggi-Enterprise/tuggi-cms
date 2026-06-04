-- ============================================================================
-- Reduzir write I/O em core.attractions: dropar índices redundantes.
-- Aplicar MANUALMENTE. Um DROP INDEX CONCURRENTLY por vez (fora de transação).
--
-- Os compostos da Fase 1b (col, created_at DESC, id DESC) servem tanto o filtro
-- por igualdade (coluna líder) quanto filtro+sort. Logo os índices simples da
-- Fase 1 viraram redundantes — só amplificam a escrita do backfill/migração.
-- DROP INDEX CONCURRENTLY não bloqueia leituras/escritas.
-- ============================================================================

DROP INDEX CONCURRENTLY IF EXISTS core.idx_attractions_country;
DROP INDEX CONCURRENTLY IF EXISTS core.idx_attractions_state;
DROP INDEX CONCURRENTLY IF EXISTS core.idx_attractions_city;
DROP INDEX CONCURRENTLY IF EXISTS core.idx_attractions_category;

-- idx_attractions_approved_active (approved, is_active) NÃO ajuda o sort por
-- created_at; provavelmente coberto por idx_attractions_approved_created. Confirme
-- idx_scan no diagnóstico (consulta B) antes de dropar:
-- DROP INDEX CONCURRENTLY IF EXISTS core.idx_attractions_approved_active;
