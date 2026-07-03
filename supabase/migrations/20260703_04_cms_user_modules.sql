-- ============================================================================
-- CMS USER MODULES — entitlements de módulo por usuário
-- ============================================================================
-- ⚠️ APLICAR MANUALMENTE NO PAINEL (SQL Editor). NUNCA via CLI (regra do projeto).
--
-- Objetivo: ativar/desativar módulos do CMS por usuário (ex.: um usuário pode ter
-- Locais mas não Eventos). Um admin liga/desliga por usuário em admin/users.
--
-- Coluna array (não tabela de junção) porque:
--   • o middleware já faz UM select de linha única de cms_users por request —
--     adicionar a coluna é custo zero; junção exigiria join no hot path;
--   • o universo de módulos é pequeno e é constante de código em lib/modules
--     ('events','places','marketing'), como o gate existente de marketing.
-- Trade-off assumido: sem metadados por concessão (granted_by/at/expires/seats).
-- Se um dia forem necessários, migrar para core.cms_user_modules (junção).
--
-- Admin NÃO precisa de módulos no array: os gates tratam admin como onipotente
-- por código (lib/modules) — o array de admin fica vazio e mesmo assim vê tudo.
-- ============================================================================

ALTER TABLE core.cms_users
  ADD COLUMN IF NOT EXISTS enabled_modules TEXT[] NOT NULL DEFAULT '{}';

COMMENT ON COLUMN core.cms_users.enabled_modules IS
  'Módulos do CMS habilitados p/ este usuário (ex.: {events,places}). Admin ignora (vê tudo por código). Identificadores são constantes em lib/modules.';
