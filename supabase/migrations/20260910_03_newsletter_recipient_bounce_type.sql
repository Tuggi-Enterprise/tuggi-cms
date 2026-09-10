-- ============================================================================
-- marketing.newsletter_recipients — separar hard de soft bounce
-- ----------------------------------------------------------------------------
-- ⚠️  CORREÇÃO DE UM FATO DO BRIEFING, medida no banco em 2026-09-10:
--     a coluna de erro **JÁ EXISTE** — `error_details text`, e está preenchida
--     em 200 de 200 linhas `failed`. As 200 falhas do "We are in Iceland" não
--     estavam invisíveis: todas dizem, palavra por palavra,
--         "You have exceeded your daily email sending quota."
--     Ou seja: não foi defeito de código, foi COTA DIÁRIA do Resend estourada
--     no meio de um envio de 500. Nada a criar aqui.
--
--     O que de fato não existe é a CLASSIFICAÇÃO do bounce. `resend-webhook`
--     (`index.ts`, ramo `email.bounced`) grava só `status = 'bounced'` e
--     descarta `data.bounce.type` / `data.bounce.subType`, que é exatamente o
--     campo que separa endereço morto (hard) de caixa cheia (soft).
--
--     Consequência já materializada: 83 linhas `bounced` em 67 e-mails
--     distintos, 66 deles NUNCA suprimidos, e 46 linhas de envio posterior
--     para endereço que já tinha dado bounce. `email_unsubscribes` com
--     `source='bounce'` = ZERO. Reputação de domínio se paga com isso.
--
-- Benchmark de mercado, não regra do Tuggi (CLAUDE.md §4, balde 1): todo ESP
-- — Resend, SES, Postmark — suprime hard bounce na primeira ocorrência e soft
-- só depois de N consecutivos. O N é número de negócio e NÃO está escrito em
-- `docs/business-rules/`: esta migration guarda o dado para que ele possa ser
-- escrito, e não inventa o limite.
--
-- ⚠️  Rodar manualmente no SQL editor do painel (DDL nunca via CLI).
-- ============================================================================

-- ─────────────────────────────── UP ────────────────────────────────────────
BEGIN;

ALTER TABLE marketing.newsletter_recipients
    ADD COLUMN IF NOT EXISTS bounce_type    text,
    ADD COLUMN IF NOT EXISTS bounce_subtype text,
    ADD COLUMN IF NOT EXISTS failed_at      timestamptz;

-- Vocabulário fechado. NULL é legítimo e significa "o webhook não disse" —
-- é o estado das 83 linhas que já existem, e nenhuma delas pode ser
-- reclassificada por adivinhação.
ALTER TABLE marketing.newsletter_recipients
    DROP CONSTRAINT IF EXISTS newsletter_recipients_bounce_type_check;
ALTER TABLE marketing.newsletter_recipients
    ADD CONSTRAINT newsletter_recipients_bounce_type_check
    CHECK (bounce_type IS NULL OR bounce_type IN ('hard', 'soft'));

COMMENT ON COLUMN marketing.newsletter_recipients.bounce_type IS
  'hard = endereço não existe (Resend bounce.type = Permanent). soft = temporário (Transient). NULL = webhook não classificou; as 83 linhas anteriores a 2026-09-10 são todas NULL e não há como recuperá-las.';
COMMENT ON COLUMN marketing.newsletter_recipients.bounce_subtype IS
  'Resend data.bounce.subType cru (ex.: General, NoEmail, MailboxFull, Suppressed). Guardado sem vocabulário fechado: quem fecha o vocabulário é o fornecedor, e ele muda sem avisar.';
COMMENT ON COLUMN marketing.newsletter_recipients.failed_at IS
  'Quando a falha foi registrada. `error_details` diz o quê; esta coluna diz quando — sem ela não dá para separar cota estourada de hoje de cota estourada em junho.';

-- Índice da SUPRESSÃO: é a pergunta que a fila de envio precisa fazer por
-- destinatário ("este e-mail já deu hard bounce?"). Parcial porque hard bounce
-- é a minoria e o índice cheio pagaria por 921 linhas para responder por 67.
CREATE INDEX IF NOT EXISTS newsletter_recipients_hard_bounce_email_idx
    ON marketing.newsletter_recipients (lower(email))
    WHERE bounce_type = 'hard';

-- Índice da leitura por campanha + status, que é como a tela do operador lê.
CREATE INDEX IF NOT EXISTS newsletter_recipients_campaign_status_idx
    ON marketing.newsletter_recipients (campaign_id, status);

COMMIT;

-- ─────────────────────────────── DOWN ──────────────────────────────────────
-- BEGIN;
--   DROP INDEX IF EXISTS marketing.newsletter_recipients_hard_bounce_email_idx;
--   DROP INDEX IF EXISTS marketing.newsletter_recipients_campaign_status_idx;
--   ALTER TABLE marketing.newsletter_recipients
--     DROP CONSTRAINT IF EXISTS newsletter_recipients_bounce_type_check;
--   -- ⚠️ DESTRUTIVO (CLAUDE.md §3): apaga classificação já gravada pelo webhook.
--   -- ALTER TABLE marketing.newsletter_recipients
--   --   DROP COLUMN bounce_type, DROP COLUMN bounce_subtype, DROP COLUMN failed_at;
-- COMMIT;

-- ─────────────────────── O QUE O `dev` PRECISA FAZER ───────────────────────
-- `supabase/functions/resend-webhook/index.ts`, ramo `type === 'email.bounced'`,
-- hoje: `table.update({ status: 'bounced' })`. Passa a gravar também:
--     bounce_type    = payload.data?.bounce?.type === 'Permanent' ? 'hard' : 'soft'
--     bounce_subtype = payload.data?.bounce?.subType ?? null
--     failed_at      = now
-- e, quando `hard`, fazer o upsert em `marketing.email_unsubscribes` com
-- `source: 'bounce'` — exatamente o que o ramo `email.complained` já faz com
-- `source: 'complaint'`. O ramo do complained é o modelo pronto ao lado.
-- Confirmar o nome do campo na doc oficial do Resend na versão em uso antes de
-- codar: memória não é fonte (CLAUDE.md §4).
