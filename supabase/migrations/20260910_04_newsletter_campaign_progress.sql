-- ============================================================================
-- marketing.newsletter_campaigns — o status para de mentir
-- ----------------------------------------------------------------------------
-- Dois defeitos, um só remédio.
--
--  A) A campanha "We are in Iceland" (08/09/2026) está gravada `sent` com
--     200 falhas em 500 destinatários — 40%. `sent` ao lado de `failed` é um
--     vocabulário de DOIS valores para um resultado de TRÊS, e o operador que
--     lê a lista não tem como saber que aquela linha foi meia campanha.
--
--  B) O laço da Edge Function só grava no FIM. Campanha que morre no meio —
--     timeout, deploy, cota do Resend estourada, que foi o caso real — fica
--     `sending` para sempre, e nada no banco sabe dizer há quanto tempo.
--
-- FORMA ESCOLHIDA, e por quê: **contagem + `started_at`, e o status DERIVA da
-- contagem.** Não um status intermediário sozinho, e não contagem sozinha.
--
--   • Status sozinho não responde "quanto"; o operador ainda teria de contar
--     `newsletter_recipients` à mão para saber o tamanho do estrago.
--   • Contagem sozinha não responde "acabou?"; `sent_count = 300` não distingue
--     campanha encerrada de campanha no meio.
--   • `partial` não tem limiar arbitrário: é `failed_count > 0 AND sent_count > 0`.
--     Não inventei "acima de X% é parcial" — X seria número de negócio e ele
--     não existe em `docs/business-rules/` (CLAUDE.md §6). Se o operador quiser
--     um limiar de alarme, ele nasce lá e o código cita o ID.
--   • `started_at` é o que torna "travada" DETECTÁVEL sem cron novo: `sending`
--     com `started_at` velho é a definição. Quantos minutos é "velho" também é
--     número de negócio — não está escrito, não foi inventado, e por isso NÃO
--     há job de varredura aqui. A tela mostra o tempo decorrido; quem decide
--     que 30min é travado é o `produto`.
--
-- ⚠️  Rodar manualmente no SQL editor do painel (DDL nunca via CLI).
-- ============================================================================

-- ─────────────────────────────── UP ────────────────────────────────────────
BEGIN;

ALTER TABLE marketing.newsletter_campaigns
    ADD COLUMN IF NOT EXISTS recipient_count integer,
    ADD COLUMN IF NOT EXISTS sent_count      integer NOT NULL DEFAULT 0,
    ADD COLUMN IF NOT EXISTS failed_count    integer NOT NULL DEFAULT 0,
    ADD COLUMN IF NOT EXISTS started_at      timestamptz;

COMMENT ON COLUMN marketing.newsletter_campaigns.recipient_count IS
  'Tamanho da audiência resolvida quando o envio COMEÇOU. Congelado: a audiência muda a cada minuto e recontar depois daria outro número.';
COMMENT ON COLUMN marketing.newsletter_campaigns.sent_count IS
  'Aceitos pelo Resend. Não é entrega: bounce e complaint acontecem DEPOIS e vivem em newsletter_recipients.';
COMMENT ON COLUMN marketing.newsletter_campaigns.failed_count IS
  'Recusados na hora do envio (o error_details do destinatário diz o motivo).';
COMMENT ON COLUMN marketing.newsletter_campaigns.started_at IS
  'Quando o laço começou. `sending` + started_at velho = campanha morta no meio; é o ÚNICO sinal que existe, porque o laço só grava no fim.';

-- Vocabulário. A coluna não tinha CHECK nenhum até aqui — `status` era text
-- livre, e text livre é como `sending` nasceu sem ninguém decidir que existia.
ALTER TABLE marketing.newsletter_campaigns
    DROP CONSTRAINT IF EXISTS newsletter_campaigns_status_check;
ALTER TABLE marketing.newsletter_campaigns
    ADD CONSTRAINT newsletter_campaigns_status_check
    CHECK (status IN ('draft', 'scheduled', 'sending', 'sent', 'partial', 'failed', 'cancelled'));

-- Guarda de coerência: a soma nunca pode passar da audiência congelada.
-- Barata (só compara três inteiros) e pega na hora o laço que conta duas vezes.
ALTER TABLE marketing.newsletter_campaigns
    DROP CONSTRAINT IF EXISTS newsletter_campaigns_counts_within_audience_check;
ALTER TABLE marketing.newsletter_campaigns
    ADD CONSTRAINT newsletter_campaigns_counts_within_audience_check
    CHECK (recipient_count IS NULL OR sent_count + failed_count <= recipient_count);

-- Retroação das 6 campanhas já enviadas, a partir da única fonte que sobrou
-- (`newsletter_recipients`). UPDATE com WHERE explícito; nada é apagado.
-- Contagens esperadas em 2026-09-10:
--   We are in Iceland          → recipient 500, sent 300, failed 200  → partial
--   Explore na sua lingua      → recipient 219, sent 219, failed   0  → sent
--   Pedido de Feedback - Users → recipient  73, sent  73, failed   0  → sent
--   feedback-en                → recipient  64, sent  64, failed   0  → sent
--   Pular história             → recipient  54, sent  54, failed   0  → sent
--   freeback-it                → recipient  11, sent  11, failed   0  → sent
-- (`bounced` NÃO conta como falha de envio: o Resend aceitou e devolveu depois.)
WITH tally AS (
    SELECT campaign_id,
           count(*)                                    AS total,
           count(*) FILTER (WHERE status <> 'failed')  AS ok,
           count(*) FILTER (WHERE status =  'failed')  AS ko
      FROM marketing.newsletter_recipients
     GROUP BY campaign_id
)
UPDATE marketing.newsletter_campaigns c
   SET recipient_count = t.total,
       sent_count      = t.ok,
       failed_count    = t.ko,
       started_at      = COALESCE(c.started_at, c.sent_at),
       status          = CASE WHEN t.ko > 0 AND t.ok > 0 THEN 'partial'
                              WHEN t.ko > 0 AND t.ok = 0 THEN 'failed'
                              ELSE c.status END
  FROM tally t
 WHERE t.campaign_id = c.id
   AND c.recipient_count IS NULL;

COMMIT;

-- ─────────────────────────────── DOWN ──────────────────────────────────────
-- BEGIN;
--   ALTER TABLE marketing.newsletter_campaigns
--     DROP CONSTRAINT IF EXISTS newsletter_campaigns_counts_within_audience_check,
--     DROP CONSTRAINT IF EXISTS newsletter_campaigns_status_check;
--   UPDATE marketing.newsletter_campaigns SET status = 'sent'
--    WHERE status = 'partial' AND sent_at IS NOT NULL;   -- desfaz a reclassificação
--   -- ⚠️ DESTRUTIVO (CLAUDE.md §3): apaga contagem já gravada. Só o operador roda.
--   -- ALTER TABLE marketing.newsletter_campaigns
--   --   DROP COLUMN recipient_count, DROP COLUMN sent_count,
--   --   DROP COLUMN failed_count,    DROP COLUMN started_at;
-- COMMIT;

-- ─────────────────────── O QUE O `dev` PRECISA FAZER ───────────────────────
-- `supabase/functions/send-newsletter/index.ts`:
--  1. ANTES do laço: status='sending', started_at=now(), recipient_count=<audiência>.
--  2. DENTRO do laço, a cada lote: sent_count/failed_count acumulados. Sem isto
--     o item (B) do cabeçalho continua: o `started_at` só diz que começou.
--  3. NO FIM: 'sent' se failed_count=0; 'partial' se falhou e enviou; 'failed'
--     se nada saiu. NÃO reintroduzir limiar de porcentagem — ele não existe.
