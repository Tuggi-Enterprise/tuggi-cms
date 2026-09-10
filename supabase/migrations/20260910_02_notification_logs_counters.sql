-- ============================================================================
-- marketing.notification_logs — os números do push param de ser descartados
-- ----------------------------------------------------------------------------
-- A Edge Function `firebase-push-notification` conta `stats.success` /
-- `stats.failure` token a token e joga no `console.log` porque não há coluna.
-- 587 linhas de histórico sem um único número: o operador vê "sent" e não sabe
-- se foram 500 aparelhos ou 3.
--
-- 4 colunas novas + o vocabulário `partial`, porque um envio com 200 falhas em
-- 500 não é `sent` nem `failed` e marcá-lo de qualquer um dos dois é o status
-- MENTINDO (foi o que aconteceu com a campanha de 08/09).
--
-- ⚠️  DUAS armadilhas neste arquivo, as duas medidas no banco em 2026-09-10:
--
--  1) `core.notification_logs` é uma VIEW com a lista de colunas CONGELADA
--     (`SELECT id, type, ... created_at FROM marketing.notification_logs`, 10
--     colunas nomeadas uma a uma). `core.get_notification_logs` é
--     `RETURNS SETOF marketing.notification_logs` e faz `SELECT * ` dessa view.
--     Acrescentar coluna à TABELA sem recriar a VIEW quebra a RPC em produção
--     com `42804` (structure of query does not match function result type) —
--     o histórico de push inteiro para de abrir. Por isso a view é recriada
--     aqui, no mesmo arquivo, e a RPC passa a ler a TABELA direto.
--
--  2) `p_limit` fixo em 50 com a busca feita no NAVEGADOR sobre esses 50: a
--     campanha 51 era inalcançável e a caixa de busca mentia em silêncio sobre
--     isso. A assinatura larga já está assumida pelo cliente do `dev`
--     (`lib/services/notification-service.ts`, `NotificationService.getLogs`).
--
-- ⚠️  Rodar manualmente no SQL editor do painel (DDL nunca via CLI).
-- ============================================================================

-- ─────────────────────────────── UP ────────────────────────────────────────
BEGIN;

-- 1. Colunas. Conferido em 2026-09-10: NENHUMA das quatro existia.
--    NULL e não 0: 587 linhas antigas não têm contagem, e `0` afirmaria que
--    zero aparelho aceitou — número inventado é pior que ausência. O tipo do
--    cliente já é `number | null | undefined`.
ALTER TABLE marketing.notification_logs
    ADD COLUMN IF NOT EXISTS success_count    integer,
    ADD COLUMN IF NOT EXISTS failure_count    integer,
    ADD COLUMN IF NOT EXISTS recipient_count  integer,
    ADD COLUMN IF NOT EXISTS audience_filters jsonb;

COMMENT ON COLUMN marketing.notification_logs.success_count IS
  'Tokens que o FCM ACEITOU. Não é entrega e não é abertura.';
COMMENT ON COLUMN marketing.notification_logs.failure_count IS
  'Tokens que o FCM recusou nesta chamada.';
COMMENT ON COLUMN marketing.notification_logs.recipient_count IS
  'Tamanho da audiência resolvida ANTES de o FCM ver um token. success+failure pode ser menor: token repetido é deduplicado.';
COMMENT ON COLUMN marketing.notification_logs.audience_filters IS
  'A segmentação que o operador de fato enviou. NULL = desconhecida (linha anterior a esta migration); {} = base inteira.';

-- 2. Vocabulário de status: entra `partial`.
--    `sent` passa a significar "nenhuma falha", e é isso que o operador lê.
ALTER TABLE marketing.notification_logs
    DROP CONSTRAINT IF EXISTS notification_logs_status_check;
ALTER TABLE marketing.notification_logs
    ADD CONSTRAINT notification_logs_status_check
    CHECK (status::text = ANY (ARRAY['sent','partial','failed','scheduled']));

-- 3. A VIEW de compatibilidade, recriada com as 4 colunas no MESMO fim de
--    lista da tabela. Sem isto, o item (1) do cabeçalho acontece.
CREATE OR REPLACE VIEW core.notification_logs AS
  SELECT id, type, title, body, data, user_ids, topic, status, sent_at, created_at,
         success_count, failure_count, recipient_count, audience_filters
    FROM marketing.notification_logs;

-- 4. A RPC do histórico: página + busca NO BANCO, e portão de admin.
--    Assinatura combinada com o `dev` (getLogs). A antiga de 1 argumento tem de
--    SAIR: mantê-la ao lado desta torna `rpc(p_limit)` ambíguo (42725).
DROP FUNCTION IF EXISTS core.get_notification_logs(integer);
DROP FUNCTION IF EXISTS public.get_notification_logs(integer);

CREATE FUNCTION core.get_notification_logs(
    p_limit  integer DEFAULT 25,
    p_offset integer DEFAULT 0,
    p_search text    DEFAULT NULL
)
RETURNS SETOF marketing.notification_logs
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'core', 'public', 'extensions', 'pg_temp'
AS $function$
BEGIN
    PERFORM core.assert_platform_admin();

    RETURN QUERY
    SELECT l.*
      FROM marketing.notification_logs l
     WHERE p_search IS NULL
        OR btrim(p_search) = ''
        OR l.title ILIKE '%' || btrim(p_search) || '%'
        OR l.body  ILIKE '%' || btrim(p_search) || '%'
     ORDER BY l.sent_at DESC, l.id DESC
     LIMIT  GREATEST(COALESCE(p_limit, 25), 1)
    OFFSET GREATEST(COALESCE(p_offset, 0), 0);
END;
$function$;

GRANT EXECUTE ON FUNCTION core.get_notification_logs(integer, integer, text) TO authenticated;
GRANT EXECUTE ON FUNCTION core.get_notification_logs(integer, integer, text) TO service_role;

COMMIT;

-- ─────────────────────────────── DOWN ──────────────────────────────────────
-- BEGIN;
--   DROP FUNCTION IF EXISTS core.get_notification_logs(integer, integer, text);
--
--   CREATE FUNCTION core.get_notification_logs(p_limit integer DEFAULT 50)
--   RETURNS SETOF marketing.notification_logs
--   LANGUAGE plpgsql SECURITY DEFINER
--   SET search_path TO 'core', 'public', 'extensions'
--   AS $$ BEGIN
--     RETURN QUERY SELECT * FROM core.notification_logs ORDER BY sent_at DESC LIMIT p_limit;
--   END; $$;
--   GRANT EXECUTE ON FUNCTION core.get_notification_logs(integer) TO authenticated, service_role;
--
--   ALTER TABLE marketing.notification_logs DROP CONSTRAINT IF EXISTS notification_logs_status_check;
--   ALTER TABLE marketing.notification_logs ADD CONSTRAINT notification_logs_status_check
--     CHECK (status::text = ANY (ARRAY['sent','failed','scheduled']));
--
--   -- A view TEM de voltar a 10 colunas ANTES do DROP COLUMN, senão o DROP
--   -- cascatearia nela.
--   CREATE OR REPLACE VIEW core.notification_logs AS
--     SELECT id, type, title, body, data, user_ids, topic, status, sent_at, created_at
--       FROM marketing.notification_logs;
--
--   -- ⚠️ DESTRUTIVO (CLAUDE.md §3): apaga contagem já gravada. Só o operador roda.
--   -- ALTER TABLE marketing.notification_logs
--   --   DROP COLUMN success_count, DROP COLUMN failure_count,
--   --   DROP COLUMN recipient_count, DROP COLUMN audience_filters;
-- COMMIT;
