-- ============================================================================
-- ENTITY KIND — discriminador em core.attractions (poi | event | place)
-- ============================================================================
-- ⚠️ APLICAR MANUALMENTE NO PAINEL (SQL Editor). NUNCA via CLI (regra do projeto).
--
-- Objetivo: reusar todo o substrato de POI (coordenada, boundary, trigger points,
-- descrições/áudio, imagens, mapas) para duas novas seções — Eventos e Locais —
-- diferenciando cada linha de core.attractions por entity_kind. Campos específicos
-- de cada tipo vivem em tabelas de extensão 1:1 (core.event_details / place_details),
-- sem poluir attractions.
--
-- Backfill: NOT NULL DEFAULT 'poi' preenche todas as linhas existentes com 'poi'.
-- Nada muda para POIs. As RPCs de leitura de POI ganham WHERE entity_kind='poi'
-- na migration 20260703_05_retrofit_poi_rpcs (aplicar em seguida, MESMA janela),
-- senão eventos/locais vazam nas listagens de POI e no app Drive.
-- ============================================================================

-- 1) Discriminador -----------------------------------------------------------
ALTER TABLE core.attractions
  ADD COLUMN IF NOT EXISTS entity_kind TEXT NOT NULL DEFAULT 'poi'
  CHECK (entity_kind IN ('poi','event','place'));

COMMENT ON COLUMN core.attractions.entity_kind IS
  'Tipo de entidade: poi (padrão, consumido pelo app Drive), event, place. Campos específicos em core.event_details / core.place_details.';

-- 2) Índices -----------------------------------------------------------------
-- Listagens por tipo usam keyset (created_at DESC, id DESC), como cms_list_pois.
CREATE INDEX IF NOT EXISTS idx_attractions_kind_created
  ON core.attractions (entity_kind, created_at DESC, id DESC);

-- Índices parciais: cada módulo varre só suas linhas (attractions é ~99% 'poi').
CREATE INDEX IF NOT EXISTS idx_attractions_event
  ON core.attractions (created_at DESC) WHERE entity_kind = 'event';
CREATE INDEX IF NOT EXISTS idx_attractions_place
  ON core.attractions (created_at DESC) WHERE entity_kind = 'place';
