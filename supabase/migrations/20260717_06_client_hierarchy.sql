-- ============================================================================
-- Migration: hierarquia de clients (coordenador → empresas) — FASE 1
-- Date: 2026-07-17
-- Depende de: 20260717_02 (SSOT de escopo) e 20260717_05 (sessão direta)
--
-- OBJETIVO
-- --------
-- Um coordenador (cliente NÃO-Tuggi) passa a ter visão administrativa sobre as
-- empresas do guarda-chuva dele: cadastra, gera QR, e vê os cadastros do app
-- atribuídos a cada uma.
--
-- Nada aqui toca POIs — por decisão explícita. Coordenadores e empresas não têm
-- acesso a POIs nesta rodada.
--
-- POR QUE A ATRIBUIÇÃO DO QR JÁ FUNCIONA (nada a fazer)
-- ----------------------------------------------------
--   tuggi-enterprise /d/[slug] → resolve o slug dinamicamente (sem allowlist,
--                                sem generateStaticParams) → grava click_fingerprints
--   tuggi-drive-v2   app-match-install → casa por IP+timezone+language (48h) e
--                                devolve o partner_id LIDO do fingerprint
--   drive.profiles.partner_id → core.clients.id  (verificado: 21/23 casam com
--                                clients, 0 com cms_users)
--   ⇒ criar a filha com slug basta: o QR dela atribui a ela sozinho.
--
-- ⚠️ APLICAR MANUALMENTE NO PAINEL. NUNCA DDL via CLI.
-- ============================================================================


-- ============================================================================
-- 1. COLUNAS
-- ============================================================================
ALTER TABLE core.clients
  ADD COLUMN IF NOT EXISTS parent_client_id uuid
    REFERENCES core.clients(id) ON DELETE RESTRICT,
  ADD COLUMN IF NOT EXISTS is_coordinator boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN core.clients.parent_client_id IS
  'Coordenador (guarda-chuva) desta empresa. ON DELETE RESTRICT: apagar um coordenador com filhas é decisão explícita — SET NULL deixaria uma filha órfã com QR vivo, ainda captando cadastros e sem ninguém a tutelando.';

-- CAPACIDADE, não estado derivado. Ver o bloco 3.
COMMENT ON COLUMN core.clients.is_coordinator IS
  'Este client pode gerenciar empresas-filhas. Setado por admin Tuggi — é decisão comercial, não emerge do dado. NÃO derivar de "tem filhas": um coordenador recém-criado tem zero filhas e nunca conseguiria criar a primeira. Espelha o idioma de is_platform_owner.';

CREATE INDEX IF NOT EXISTS idx_clients_parent_client_id
  ON core.clients(parent_client_id) WHERE parent_client_id IS NOT NULL;


-- ============================================================================
-- 2. TRAVA DE 2 NÍVEIS (mata ciclos por construção)
-- ============================================================================
-- As TRÊS direções precisam ser barradas — checar só "pai não pode ter pai" é metade.
CREATE OR REPLACE FUNCTION core.enforce_client_hierarchy_depth()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = core, pg_temp
AS $$
BEGIN
  IF NEW.parent_client_id IS NULL THEN
    RETURN NEW;
  END IF;

  -- (a) auto-referência
  IF NEW.parent_client_id = NEW.id THEN
    RAISE EXCEPTION 'client % não pode ser pai de si mesmo', NEW.id
      USING ERRCODE = '23514';
  END IF;

  -- (b) 3º nível: o pai escolhido já é filha de alguém
  IF EXISTS (SELECT 1 FROM core.clients c
              WHERE c.id = NEW.parent_client_id AND c.parent_client_id IS NOT NULL) THEN
    RAISE EXCEPTION 'hierarquia limitada a 2 níveis: o client % já é uma filha', NEW.parent_client_id
      USING ERRCODE = '23514';
  END IF;

  -- (c) inversão: este client já é pai de alguém e agora receberia um pai
  IF EXISTS (SELECT 1 FROM core.clients c WHERE c.parent_client_id = NEW.id) THEN
    RAISE EXCEPTION 'client % já tem filhas; não pode virar filha de outro', NEW.id
      USING ERRCODE = '23514';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trigger_client_hierarchy_depth ON core.clients;
CREATE TRIGGER trigger_client_hierarchy_depth
  BEFORE INSERT OR UPDATE OF parent_client_id ON core.clients
  FOR EACH ROW EXECUTE FUNCTION core.enforce_client_hierarchy_depth();

-- NB (dívida conhecida): duas transações concorrentes ainda podem criar um 3º nível
-- (cada uma lê antes de a outra commitar). Com 6 clients é aceitável; se virar problema,
-- a correção é um constraint trigger DEFERRABLE ou lock na linha do pai.


-- ============================================================================
-- 3. client_scope_ids — AGORA RECURSIVO
-- ============================================================================
-- A 02 criou esta função devolvendo só o próprio client (não havia hierarquia).
-- Trocar só o CORPO aqui propaga a hierarquia para TODO call site de uma vez:
-- resolve_dashboard_scope, caller_client_ids e os 4 dashboard_* já a usam.
-- Nenhuma outra função muda.
--
-- Recursiva mesmo com o limite de 2 níveis: o limite mora no trigger (um lugar só).
-- UNION (não UNION ALL) dedupa ⇒ termina mesmo se um ciclo escapar; depth < 5 é o
-- cinto além do suspensório. Custo irrelevante com 6 clients.
CREATE OR REPLACE FUNCTION core.client_scope_ids(p_root uuid)
RETURNS TABLE (client_id uuid)
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = core, public, extensions, pg_temp
AS $$
  WITH RECURSIVE tree AS (
    SELECT c.id, 1 AS depth
      FROM core.clients c
     WHERE c.id = p_root
    UNION
    SELECT c.id, t.depth + 1
      FROM core.clients c
      JOIN tree t ON c.parent_client_id = t.id
     WHERE t.depth < 5
  )
  SELECT id FROM tree;
$$;

COMMENT ON FUNCTION core.client_scope_ids(uuid) IS
  'Escopo de um client: ele + descendentes. SSOT — todo filtro de escopo usa esta função em vez de "= caller_client_id", para que a hierarquia não fique assada em cada call site.';

NOTIFY pgrst, 'reload schema';


-- ============================================================================
-- VERIFICAÇÃO (rodar no painel — a sessão direta é admin, ver migration 05)
-- ============================================================================
-- 1) Trava de 2 níveis — os três devem FALHAR:
--      UPDATE core.clients SET parent_client_id = id WHERE slug='torel-boutiques';
--      -- ERRO: não pode ser pai de si mesmo
--
--      -- monta coordenador → filha e tenta um 3º nível:
--      UPDATE core.clients SET is_coordinator = true WHERE slug='tuggi-demo';
--      UPDATE core.clients SET parent_client_id = (SELECT id FROM core.clients WHERE slug='tuggi-demo')
--       WHERE slug='torel-boutiques';
--      UPDATE core.clients SET parent_client_id = (SELECT id FROM core.clients WHERE slug='torel-boutiques')
--       WHERE slug='masana-algarve';
--      -- ERRO: hierarquia limitada a 2 níveis
--
--      UPDATE core.clients SET parent_client_id = (SELECT id FROM core.clients WHERE slug='masana-algarve')
--       WHERE slug='tuggi-demo';
--      -- ERRO: já tem filhas; não pode virar filha
--
-- 2) Escopo recursivo:
--      SELECT count(*) FROM core.client_scope_ids((SELECT id FROM core.clients WHERE slug='tuggi-demo'));
--      -- 2 = ele + Torel
--      SELECT count(*) FROM core.client_scope_ids((SELECT id FROM core.clients WHERE slug='torel-boutiques'));
--      -- 1 = só ela (a filha NÃO enxerga o pai nem irmãs)
--
-- 3) ⭐ A hierarquia propagou sozinha para os dashboards?
--      SELECT total_users FROM core.dashboard_user_analytics(
--        (SELECT id FROM core.clients WHERE slug='tuggi-demo'));
--      -- 2 = 0 (Tuggi Demo) + 2 (Torel)  ← consolidado do coordenador, sem código novo
--      SELECT total_users FROM core.dashboard_user_analytics(
--        (SELECT id FROM core.clients WHERE slug='torel-boutiques'));
--      -- 2 = só Torel
--
-- 4) Desfazer o teste:
--      UPDATE core.clients SET parent_client_id = NULL WHERE slug IN ('torel-boutiques','masana-algarve');
--      UPDATE core.clients SET is_coordinator = false WHERE slug='tuggi-demo';
