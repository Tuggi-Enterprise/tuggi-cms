-- ============================================================================
-- Privilégio aberto demais no módulo Marketing
-- ----------------------------------------------------------------------------
-- ⚠️  GATILHO CLAUDE.md §2: isto mexe em privilégio →
--     `security-reviewer` ANTES do merge. Não faça merge sem ele.
--
-- Auditoria completa do schema `marketing` e da superfície `core.*` de
-- notificação, medida em 2026-09-10. O que o briefing pediu (o GRANT de
-- `estimate_newsletter_audience`) é o item MENOS grave da lista.
--
-- ── O pior: qualquer usuário logado apaga o histórico de push ───────────────
--   core.cleanup_old_notification_logs(days_old integer DEFAULT 90)
--     SECURITY DEFINER · sem portão · GRANT EXECUTE TO authenticated
--     corpo: DELETE FROM core.notification_logs WHERE sent_at < now() - N days
--   `rpc('cleanup_old_notification_logs', { days_old: 0 })` apaga as 587
--   linhas. `authenticated` são os 522 perfis do app MAIS os 39 `cms_users`
--   com role='client' (o portal do parceiro). NENHUM código do CMS a chama.
--
-- ── Apagar template alheio, por id, sem ser dono ────────────────────────────
--   core.delete_notification_template(uuid)   · DELETE · sem portão · authenticated
--   marketing.delete_newsletter_template(uuid)· DELETE · sem portão · authenticated
--
-- ── Ler o tamanho da nossa base, com filtro arbitrário ──────────────────────
--   marketing.estimate_newsletter_audience(jsonb) · sem portão · authenticated
--   É oráculo de enumeração, não só um número: dá para varrer tier, idioma e
--   data de criação e desenhar a base inteira por diferença.
--   (`core.estimate_notification_audience` tinha o mesmo defeito e já foi
--    fechada em `20260910_05_push_optout_ssot.sql`, junto do conserto do
--    predicado — as duas coisas viviam na mesma função.)
--
-- ── Disparar o cron à mão ───────────────────────────────────────────────────
--   core.process_scheduled_notifications() · authenticated
--   core.trigger_process_scheduled_notifications() · authenticated
--   (`marketing.trigger_process_scheduled_newsletters` já é só `postgres` —
--    e ainda bem: ela lê `vault.decrypted_secrets` e monta um POST com a
--    `ef_secret_key`.)
--
-- ── O que FOI conferido e está LIMPO ────────────────────────────────────────
--   • `anon` NÃO tem USAGE no schema `marketing` — os GRANTs de tabela para
--     `anon` existem mas são inalcançáveis. Revogados abaixo mesmo assim.
--   • **TRUNCATE não está concedido em NENHUMA tabela de `marketing`.** O
--     estado descrito em `reference_truncate_ignora_rls` (default privilege da
--     plataforma dando TRUNCATE/TRIGGER/REFERENCES a anon+authenticated) NÃO
--     se aplica aqui: as ACLs medidas são `arwd` (INSERT/SELECT/UPDATE/DELETE)
--     em 3 tabelas e nada nas outras 4. Nenhuma correção em massa foi feita.
--
-- ── O que NÃO foi tocado, e precisa da sua decisão ──────────────────────────
--   `core.{get,create,update}_notification_template` e
--   `marketing.{get,create,update}_newsletter_template` continuam SECURITY
--   DEFINER concedidas a `authenticated` sem portão. São CHAMADAS pelo CMS
--   (`lib/services/notification-service.ts`, `lib/services/newsletter-service.ts`),
--   o dano é escrever/ler template interno (não é dado de turista, não é chave),
--   e fechá-las é a "correção em massa" que você pediu para não fazer sozinho.
--   Ficam como achado, não como card (CLAUDE.md §4 — dano medido: 0 turista).
--
-- NOTA sobre a escolha REVOKE vs. PORTÃO: onde o CMS chama a função, um REVOKE
-- puro quebraria a tela — o CMS autentica como `authenticated`, igual ao app.
-- Nesses casos entra `core.assert_platform_admin()`, que já é o padrão das duas
-- funções mais sensíveis do módulo (`get_audience_push_tokens`,
-- `broadcast_persist_inbox`). Medido: `core.cms_users` tem 3 `admin` ativos e
-- 39 `client` — o portão não tranca ninguém que use o módulo hoje.
--
-- ⚠️  Rodar manualmente no SQL editor do painel (DDL nunca via CLI).
-- ============================================================================

-- ─────────────────────────────── UP ────────────────────────────────────────
BEGIN;

-- ----------------------------------------------------------------------------
-- 1. REVOKE — funções que o CMS nunca chama
-- ----------------------------------------------------------------------------
REVOKE EXECUTE ON FUNCTION core.cleanup_old_notification_logs(integer)     FROM authenticated, anon, PUBLIC;
REVOKE EXECUTE ON FUNCTION core.process_scheduled_notifications()          FROM authenticated, anon, PUBLIC;
REVOKE EXECUTE ON FUNCTION core.trigger_process_scheduled_notifications()  FROM authenticated, anon, PUBLIC;
REVOKE EXECUTE ON FUNCTION marketing.trigger_process_scheduled_newsletters() FROM authenticated, anon, PUBLIC;

-- ----------------------------------------------------------------------------
-- 2. PORTÃO — funções que o CMS chama
-- ----------------------------------------------------------------------------
-- Corpos lidos do banco em 2026-09-10 e preservados; entra o portão e, de
-- brinde, o `SET search_path` que faltava nas três (SECURITY DEFINER sem
-- search_path fixo é o advisor `function_search_path_mutable` do Supabase, e
-- aqui era real: `estimate_newsletter_audience` resolve `core.*` e `auth.*`
-- pelo search_path da sessão do chamador).

CREATE OR REPLACE FUNCTION marketing.estimate_newsletter_audience(p_filters jsonb)
RETURNS bigint
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'marketing', 'public', 'extensions', 'pg_temp'
AS $function$
DECLARE
    v_count BIGINT;
BEGIN
    PERFORM core.assert_platform_admin();
    EXECUTE
        'SELECT count(DISTINCT p.id)
           FROM drive.profiles p
           JOIN auth.users au ON au.id = p.id
          WHERE au.email IS NOT NULL
            AND NOT EXISTS (
                SELECT 1 FROM marketing.email_unsubscribes u
                 WHERE lower(u.email) = lower(au.email)
            )' || core.build_audience_filter(p_filters)
    INTO v_count;
    RETURN COALESCE(v_count, 0);
END;
$function$;

REVOKE EXECUTE ON FUNCTION marketing.estimate_newsletter_audience(jsonb) FROM anon, PUBLIC;
GRANT  EXECUTE ON FUNCTION marketing.estimate_newsletter_audience(jsonb) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION core.delete_notification_template(p_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'core', 'public', 'extensions', 'pg_temp'
AS $function$
BEGIN
    PERFORM core.assert_platform_admin();
    DELETE FROM core.notification_templates WHERE id = p_id;
END;
$function$;

REVOKE EXECUTE ON FUNCTION core.delete_notification_template(uuid) FROM anon, PUBLIC;
GRANT  EXECUTE ON FUNCTION core.delete_notification_template(uuid) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION marketing.delete_newsletter_template(p_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'marketing', 'public', 'extensions', 'pg_temp'
AS $function$
BEGIN
    PERFORM core.assert_platform_admin();
    DELETE FROM marketing.newsletter_templates WHERE id = p_id;
END;
$function$;

REVOKE EXECUTE ON FUNCTION marketing.delete_newsletter_template(uuid) FROM anon, PUBLIC;
GRANT  EXECUTE ON FUNCTION marketing.delete_newsletter_template(uuid) TO authenticated, service_role;

-- ----------------------------------------------------------------------------
-- 3. Tabelas — o acesso ao módulo é por RPC, não por PostgREST direto
-- ----------------------------------------------------------------------------
-- `anon` é inalcançável (sem USAGE) e `authenticated` já é barrado pela RLS
-- (as policies de `notification_logs` e `scheduled_notifications` são
-- `auth.role() = 'service_role'`). Revogar mesmo assim é o que faz o próximo
-- `ENABLE`/`DISABLE` de RLS deixar de ser um passo de tudo-ou-nada.
REVOKE ALL ON marketing.notification_logs        FROM anon, authenticated;
REVOKE ALL ON marketing.scheduled_notifications  FROM anon, authenticated;
REVOKE ALL ON marketing.notification_templates   FROM anon;

-- `notification_templates` MANTÉM o acesso de `authenticated`: existem 4
-- policies de dono (`auth.uid() = created_by`) e uma de leitura
-- (`is_active = true`) que dependem dele. Tirar o GRANT aqui apagaria uma
-- superfície que hoje funciona — se for para fechar, fecha pela policy.

COMMIT;

-- ─────────────────────────────── DOWN ──────────────────────────────────────
-- BEGIN;
--   GRANT EXECUTE ON FUNCTION core.cleanup_old_notification_logs(integer)      TO authenticated;
--   GRANT EXECUTE ON FUNCTION core.process_scheduled_notifications()           TO authenticated;
--   GRANT EXECUTE ON FUNCTION core.trigger_process_scheduled_notifications()   TO authenticated;
--   GRANT EXECUTE ON FUNCTION marketing.estimate_newsletter_audience(jsonb)    TO anon;
--   GRANT SELECT, INSERT, UPDATE, DELETE ON marketing.notification_logs        TO anon, authenticated;
--   GRANT SELECT, INSERT, UPDATE, DELETE ON marketing.scheduled_notifications  TO anon, authenticated;
--   GRANT SELECT, INSERT, UPDATE, DELETE ON marketing.notification_templates   TO anon;
--   -- e recriar as 3 funções do item 2 sem o `PERFORM core.assert_platform_admin();`
-- COMMIT;

-- ─────────────────────── ÓRFÃO ENCONTRADO NO CAMINHO ───────────────────────
-- `core.process_scheduled_notifications()` marca `status='processing'` e depois
-- `status='sent'` SEM MANDAR NADA — o corpo tem o comentário
-- "Here you would call the Edge Function". Quem drena de verdade é a rota
-- `/process-scheduled` da EF. A função é código que mente sobre o que o produto
-- faz (CLAUDE.md §6) e devia SAIR; remover função é ato do operador e não entra
-- aqui. Fica registrado em `docs/dev/fila-de-push-agendada-2026-09.md`.
