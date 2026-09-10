-- ============================================================================
-- marketing.scheduled_notifications — a fila que ninguém via, e o CHECK que a
-- matava em silêncio
-- ----------------------------------------------------------------------------
-- ⚠️  ACHADO QUE MUDA O CARD, medido em 2026-09-10. O agendamento NÃO ESTÁ
--     QUEBRADO POR FALTA DE TELA: ele nunca chegou a gravar.
--
--     CHECK vigente na tabela:  status ∈ {scheduled, sent, failed, cancelled}
--     `firebase-push-notification`, rota `/schedule`:   insert status: 'pending'
--     mesma EF, rota `/process-scheduled`:              .eq('status','pending')
--                                                       update status:'processing'
--                                                       update error_details: …
--
--     Ou seja: TODO agendamento novo morre com `23514` (check violation), e a
--     coluna `error_details` que a EF tenta escrever nem existe (`42703`). E os
--     144 agendamentos que existem — todos `status='scheduled'`, criados entre
--     01/04 e 12/05/2026 — são invisíveis para o drenador, que procura
--     'pending'. Fila de 144 zumbis de um lado, inserção impossível do outro.
--
--     ESCOLHA: o vocabulário do CÓDIGO vence, porque são DOIS escritores já
--     escritos nele (a EF e o cliente do `dev`, `ScheduledNotification.status`)
--     contra zero linha nova. `pending` vira o default; `scheduled` permanece
--     ACEITO para não invalidar as 144 linhas históricas.
--
--     ⚠️  E as 144 NÃO são migradas para 'pending' nesta migration, de
--     propósito: `/process-scheduled` dispararia 144 broadcasts de abril de uma
--     vez, para a base inteira. O que fazer com elas é decisão do operador e
--     está escrita em `docs/dev/fila-de-push-agendada-2026-09.md`. Enquanto
--     ninguém decide, elas ficam inertes — e agora VISÍVEIS, porque a RPC de
--     leitura devolve os dois status.
--
-- ⚠️  Rodar manualmente no SQL editor do painel (DDL nunca via CLI).
-- ============================================================================

-- ─────────────────────────────── UP ────────────────────────────────────────
BEGIN;

-- ----------------------------------------------------------------------------
-- 1. Colunas que a EF já tenta escrever, e as contagens do resultado
-- ----------------------------------------------------------------------------
ALTER TABLE marketing.scheduled_notifications
    ADD COLUMN IF NOT EXISTS error_details   text,
    ADD COLUMN IF NOT EXISTS recipient_count integer,
    ADD COLUMN IF NOT EXISTS success_count   integer,
    ADD COLUMN IF NOT EXISTS failure_count   integer,
    ADD COLUMN IF NOT EXISTS cancelled_at    timestamptz,
    ADD COLUMN IF NOT EXISTS cancelled_by    uuid;

COMMENT ON COLUMN marketing.scheduled_notifications.error_details IS
  'A EF já escrevia nesta coluna desde antes de ela existir; até 2026-09-10 a escrita respondia 42703 e o agendamento morria sem registro.';
COMMENT ON COLUMN marketing.scheduled_notifications.cancelled_by IS
  'cms_users.id de quem cancelou. Cancelar é a ÚNICA janela de desfazer do módulo — quem apertou faz parte do fato.';

-- ----------------------------------------------------------------------------
-- 2. O vocabulário que estava matando a inserção
-- ----------------------------------------------------------------------------
ALTER TABLE marketing.scheduled_notifications
    DROP CONSTRAINT IF EXISTS scheduled_notifications_status_check;
ALTER TABLE marketing.scheduled_notifications
    ADD CONSTRAINT scheduled_notifications_status_check
    CHECK (status::text = ANY (ARRAY[
        'pending',     -- na fila (default novo; é o que a EF insere)
        'processing',  -- o drenador pegou (evita gasto duplo)
        'scheduled',   -- LEGADO: as 144 linhas de abr–mai/2026. Não é escrito por ninguém novo.
        'sent',
        'failed',
        'cancelled'
    ]));

ALTER TABLE marketing.scheduled_notifications
    ALTER COLUMN status SET DEFAULT 'pending';

-- Índice do drenador: ele pergunta "pendente e já venceu?" a cada minuto.
CREATE INDEX IF NOT EXISTS scheduled_notifications_due_idx
    ON marketing.scheduled_notifications (scheduled_for)
    WHERE status IN ('pending', 'processing');

-- ----------------------------------------------------------------------------
-- 3. View de compatibilidade — MESMA armadilha da 20260910_02
-- ----------------------------------------------------------------------------
-- `core.scheduled_notifications` nomeia 15 colunas uma a uma e já estava
-- DESATUALIZADA: não tem `audience_filters`, acrescentada em 20260628. Qualquer
-- leitura pela view perdia a segmentação em silêncio.
CREATE OR REPLACE VIEW core.scheduled_notifications AS
  SELECT id, type, user_ids, topic, title, body, data, image_url, priority, ttl,
         scheduled_for, status, processed_at, created_at, updated_at,
         audience_filters, error_details, recipient_count, success_count,
         failure_count, cancelled_at, cancelled_by
    FROM marketing.scheduled_notifications;

-- ----------------------------------------------------------------------------
-- 4. RPC de LEITURA da fila
-- ----------------------------------------------------------------------------
-- Assinatura combinada com o cliente do `dev`
-- (`lib/services/notification-service.ts`, `NotificationService.getScheduled`).
-- Devolve `pending` E `scheduled`: o legado só some da tela quando o operador
-- decidir o que fazer com ele, e esconder 144 linhas é como elas duraram
-- quatro meses.
CREATE OR REPLACE FUNCTION core.get_scheduled_notifications(p_limit integer DEFAULT 50)
RETURNS SETOF marketing.scheduled_notifications
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'core', 'public', 'extensions', 'pg_temp'
AS $function$
BEGIN
    PERFORM core.assert_platform_admin();

    RETURN QUERY
    SELECT s.*
      FROM marketing.scheduled_notifications s
     WHERE s.status IN ('pending', 'processing', 'scheduled')
     ORDER BY s.scheduled_for ASC, s.id
     LIMIT GREATEST(COALESCE(p_limit, 50), 1);
END;
$function$;

GRANT EXECUTE ON FUNCTION core.get_scheduled_notifications(integer) TO authenticated;
GRANT EXECUTE ON FUNCTION core.get_scheduled_notifications(integer) TO service_role;

-- ----------------------------------------------------------------------------
-- 5. RPC de CANCELAMENTO — status, nunca DELETE (CLAUDE.md §3)
-- ----------------------------------------------------------------------------
-- A linha é o único registro de que a campanha foi planejada. Apagá-la apagaria
-- também a prova de que alguém desistiu — e cancelar é justamente o ato que
-- mais precisa de rastro.
CREATE OR REPLACE FUNCTION core.cancel_scheduled_notification(p_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'core', 'public', 'extensions', 'pg_temp'
AS $function$
DECLARE
    v_status text;
    v_actor  uuid;
BEGIN
    PERFORM core.assert_platform_admin();

    SELECT cu.id INTO v_actor
      FROM core.cms_users cu
     WHERE lower(cu.email) = lower(core.caller_email());

    -- Trava a linha: o drenador roda por cron e pode estar olhando para ela
    -- neste exato instante. Sem o FOR UPDATE, cancelar depois do `processing`
    -- viraria uma linha `cancelled` que já saiu para os aparelhos.
    SELECT s.status INTO v_status
      FROM marketing.scheduled_notifications s
     WHERE s.id = p_id
       FOR UPDATE;

    IF v_status IS NULL THEN
        RAISE EXCEPTION 'scheduled notification % not found', p_id
          USING ERRCODE = 'no_data_found';
    END IF;

    IF v_status NOT IN ('pending', 'scheduled') THEN
        RAISE EXCEPTION 'cannot cancel a notification in status %', v_status
          USING ERRCODE = '55000',
                HINT = 'only pending (or legacy scheduled) items can be cancelled; processing already left for FCM';
    END IF;

    UPDATE marketing.scheduled_notifications
       SET status       = 'cancelled',
           cancelled_at = now(),
           cancelled_by = v_actor,
           updated_at   = now()
     WHERE id = p_id;
END;
$function$;

GRANT EXECUTE ON FUNCTION core.cancel_scheduled_notification(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION core.cancel_scheduled_notification(uuid) TO service_role;

COMMIT;

-- ─────────────────────────────── DOWN ──────────────────────────────────────
-- BEGIN;
--   DROP FUNCTION IF EXISTS core.cancel_scheduled_notification(uuid);
--   DROP FUNCTION IF EXISTS core.get_scheduled_notifications(integer);
--   DROP INDEX IF EXISTS marketing.scheduled_notifications_due_idx;
--
--   ALTER TABLE marketing.scheduled_notifications ALTER COLUMN status SET DEFAULT 'scheduled';
--   ALTER TABLE marketing.scheduled_notifications
--     DROP CONSTRAINT IF EXISTS scheduled_notifications_status_check;
--   -- ⚠️ Só volta ao CHECK antigo se NENHUMA linha estiver 'pending'/'processing':
--   --    UPDATE ... SET status='scheduled' WHERE status IN ('pending','processing');
--   ALTER TABLE marketing.scheduled_notifications
--     ADD CONSTRAINT scheduled_notifications_status_check
--     CHECK (status::text = ANY (ARRAY['scheduled','sent','failed','cancelled']));
--
--   CREATE OR REPLACE VIEW core.scheduled_notifications AS
--     SELECT id, type, user_ids, topic, title, body, data, image_url, priority, ttl,
--            scheduled_for, status, processed_at, created_at, updated_at
--       FROM marketing.scheduled_notifications;
--
--   -- ⚠️ DESTRUTIVO (CLAUDE.md §3). Só o operador roda:
--   -- ALTER TABLE marketing.scheduled_notifications
--   --   DROP COLUMN error_details, DROP COLUMN recipient_count, DROP COLUMN success_count,
--   --   DROP COLUMN failure_count, DROP COLUMN cancelled_at, DROP COLUMN cancelled_by;
-- COMMIT;
