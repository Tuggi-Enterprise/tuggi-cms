-- ============================================================================
-- SETUP COMPLETO PARA ENRIQUECIMENTO OSM
-- ============================================================================
-- Este arquivo contém todo o setup necessário para o sistema de enriquecimento
-- de POIs com dados do OpenStreetMap
-- 
-- Versão: Final - Produção
-- Data: 2025-08-29
-- ============================================================================

-- Primeiro, aplicar os campos OSM básicos (se não existirem)
-- (Conteúdo do add-osm-enrichment-fields.sql já aplicado)

-- ============================================================================
-- NOVOS CAMPOS OSM DE ALTA PRIORIDADE
-- ============================================================================

-- Links e referências OSM
ALTER TABLE core.attractions 
ADD COLUMN IF NOT EXISTS osm_wikidata_id text,
ADD COLUMN IF NOT EXISTS osm_wikipedia_url text,
ADD COLUMN IF NOT EXISTS contact_phone text,
ADD COLUMN IF NOT EXISTS contact_email text,
ADD COLUMN IF NOT EXISTS operator_name text;

-- ============================================================================
-- RELAXAR CONSTRAINTS MUITO RESTRITIVAS
-- ============================================================================

-- Dropar constraints que limitam dados do OSM
ALTER TABLE core.attractions 
DROP CONSTRAINT IF EXISTS attractions_monument_type_check;

ALTER TABLE core.attractions 
DROP CONSTRAINT IF EXISTS attractions_museum_type_check;

ALTER TABLE core.attractions 
DROP CONSTRAINT IF EXISTS attractions_park_type_check;

-- ============================================================================
-- ÍNDICES PARA OS NOVOS CAMPOS
-- ============================================================================

-- Índices para melhorar performance de busca
CREATE INDEX IF NOT EXISTS idx_attractions_osm_wikidata ON core.attractions (osm_wikidata_id);
CREATE INDEX IF NOT EXISTS idx_attractions_operator_name ON core.attractions (operator_name);
CREATE INDEX IF NOT EXISTS idx_attractions_contact_phone ON core.attractions (contact_phone);

-- ============================================================================
-- COMENTÁRIOS PARA DOCUMENTAÇÃO
-- ============================================================================

COMMENT ON COLUMN core.attractions.osm_wikidata_id IS 'ID do Wikidata para dados estruturados adicionais';
COMMENT ON COLUMN core.attractions.osm_wikipedia_url IS 'URL da Wikipedia para mais informações';
COMMENT ON COLUMN core.attractions.contact_phone IS 'Telefone de contato do local (fonte: OSM)';
COMMENT ON COLUMN core.attractions.contact_email IS 'Email de contato do local (fonte: OSM)';
COMMENT ON COLUMN core.attractions.operator_name IS 'Nome do operador/administrador do local';

-- Atualizar comentários dos campos sem constraints
COMMENT ON COLUMN core.attractions.monument_type IS 'Tipo de monumento (sem restrições - baseado em dados OSM)';
COMMENT ON COLUMN core.attractions.museum_type IS 'Tipo de museu (sem restrições - baseado em dados OSM)';
COMMENT ON COLUMN core.attractions.park_type IS 'Tipo de parque (sem restrições - baseado em dados OSM)';

-- ============================================================================
-- FINALIZAÇÃO
-- ============================================================================

-- Este script configura completamente o sistema de enriquecimento OSM
-- Os seguintes componentes devem estar em produção:
--
-- Backend:
-- - app/api/pois/enrich-osm/route.ts (API principal)
--
-- Frontend: 
-- - app/verification/enrich-osm/page.tsx (Interface CMS)
-- - components/ui/Sidebar.tsx (navegação atualizada)
--
-- Documentação:
-- - docs/osm-enrichment-usage-guide.md (guia de uso)
-- - docs/osm-enrichment-recommendations.md (recomendações técnicas)
