# Módulo Marketing — o que o operador roda no painel (2026-09-10)

Sete migrations, escritas pelo `data` e **não aplicadas**: DDL neste projeto é manual no SQL
editor do painel. Este documento é o roteiro, os números esperados e o que sobrevive ao card.
As migrations trazem o próprio `-- DOWN` comentado no rodapé.

**Gatilho CLAUDE.md §2:** as migrations `05` (consentimento/dado pessoal) e `07` (privilégio)
exigem **`security-reviewer` antes do merge**.

## Passo 0 — capture o estado ANTES (isto É o rollback)

O banco está à frente das migrations: várias funções têm, só no banco, coisa que o arquivo de
origem não tem (a recusa `TGU43` em `build_audience_filter`, o `assert_platform_admin` em
`get_audience_push_tokens`, o `SET search_path` em várias). O `-- DOWN` de cada arquivo aponta
para cá. **Salve a saída disto num arquivo antes de rodar qualquer UP:**

```sql
SELECT n.nspname || '.' || p.proname AS fn,
       pg_get_functiondef(p.oid)     AS def
  FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
 WHERE (n.nspname, p.proname) IN (
        ('core','build_audience_filter'), ('core','get_audience_push_tokens'),
        ('core','estimate_notification_audience'), ('core','get_notification_logs'),
        ('core','delete_notification_template'), ('drive','update_profile_v1'),
        ('drive','register_fcm_token'), ('drive','unregister_fcm_token'),
        ('drive','sync_fcm_token_to_profile'),
        ('marketing','estimate_newsletter_audience'), ('marketing','delete_newsletter_template'))
 ORDER BY 1;
```

## Ordem, e o que esperar de cada uma

Rodar **nesta ordem**. Cada arquivo é uma transação; se uma falhar, pare e reporte.

| # | Arquivo | O que muda | Número esperado |
| :-- | :-- | :-- | :-- |
| 1 | `20260910_01_audience_filter_last_active_before.sql` | `core.build_audience_filter` ganha `last_active_before` (winback/sunset) | 1 função recriada |
| 2 | `20260910_02_notification_logs_counters.sql` | 4 colunas em `notification_logs`, status `partial`, view `core.notification_logs` recriada, `get_notification_logs` com página+busca | 587 linhas ficam com contagem `NULL` (honesto: não existia) |
| 3 | `20260910_03_newsletter_recipient_bounce_type.sql` | `bounce_type` / `bounce_subtype` / `failed_at` + 2 índices | 83 linhas `bounced` ficam `bounce_type = NULL` |
| 4 | `20260910_04_newsletter_campaign_progress.sql` | contagens na campanha + vocabulário de status + retroação | **6 campanhas** atualizadas; "We are in Iceland" vira `partial` (500/300/200) |
| 5 | `20260910_05_push_optout_ssot.sql` | ⚠️ o vazamento de opt-out | **50 perfis** → `push_notifications_enabled = false`; **30** perdem o `push_token` órfão |
| 6 | `20260910_06_scheduled_notifications_queue.sql` | vocabulário de status da fila + 6 colunas + 2 RPCs | as **144** linhas legado ficam **intocadas** (ver abaixo) |
| 7 | `20260910_07_marketing_privileges.sql` | ⚠️ REVOKE + portão de admin | 4 REVOKE de função, 3 funções ganham portão, 3 tabelas perdem GRANT |

### Conferência depois de rodar a 05 (a que importa)

```sql
-- Tem de responder 0. Qualquer número maior é o vazamento ainda aberto.
SELECT count(*) FROM drive.profiles
 WHERE push_token IS NOT NULL
   AND (push_notifications_enabled = false OR push_denied IS TRUE);

-- Tem de responder 50.
SELECT count(*) FROM drive.profiles WHERE push_notifications_enabled = false;
```

## O que sobrevive ao card

### 1. As 144 notificações agendadas de abril/maio, e por que NÃO foram migradas

`marketing.scheduled_notifications` tem **144 linhas, todas `status = 'scheduled'`**, criadas
entre 01/04 e 12/05/2026. O drenador (`firebase-push-notification`, rota `/process-scheduled`)
procura `status = 'pending'` — nunca as viu, nunca as verá.

A migration `06` faz `pending` virar o default e mantém `scheduled` **aceito**, de propósito:
**migrar as 144 para `pending` dispararia 144 broadcasts de abril para a base inteira, de uma
vez.** Ninguém quer isso e ninguém decidiu isso.

Elas agora aparecem na tela (a RPC `core.get_scheduled_notifications` devolve os dois status) e
podem ser canceladas uma a uma pelo botão. Se a decisão for cancelar todas de uma vez:

```sql
-- UPDATE com WHERE explícito. Esperado: 144 linhas.
UPDATE marketing.scheduled_notifications
   SET status = 'cancelled', cancelled_at = now(), updated_at = now()
 WHERE status = 'scheduled'
   AND scheduled_for < '2026-06-01';
-- Rollback: SET status='scheduled' WHERE status='cancelled' AND scheduled_for < '2026-06-01';
```

**Decisão do operador. O `data` não executa** (CLAUDE.md §3).

### 2. Por que `/schedule` nunca gravou nada desde que foi escrita

Não é falta de tela. `CHECK` da tabela: `{scheduled, sent, failed, cancelled}`. A EF insere
`status: 'pending'` → **`23514`**, sempre. E escreve `error_details`, coluna que não existia →
`42703`. A migration `06` conserta os dois lados. **O `dev` não precisa mudar a EF** — o
vocabulário do código foi adotado como canônico justamente para isso.

### 3. `core.process_scheduled_notifications()` é órfã e mente

Marca `processing` e depois `sent` **sem mandar nada** (o corpo tem o comentário
*"Here you would call the Edge Function"*). Quem drena de verdade é a EF. É código que mente
sobre o que o produto faz (CLAUDE.md §6) e devia sair. `DROP FUNCTION` é ato do operador:

```sql
-- Confira que ninguém chama (grep no CMS: 0 chamadas fora de scripts/check-db-settings.ts):
DROP FUNCTION IF EXISTS core.process_scheduled_notifications();
```

### 4. Alternativa descartada: reaproveitar `drive.profiles.notifications_opt_in`

Existe uma coluna `notifications_opt_in jsonb` em `drive.profiles`. **Não foi usada.** Medido:
NULL em 522 de 522 linhas, e **nenhuma função no banco a lê ou escreve**. É órfã, e é `jsonb`
onde a preferência é um booleano. Reaproveitá-la só teria transportado um nome vago para dentro
de um conserto de consentimento. Se for para limpar, é `DROP COLUMN` — ato do operador.

### 5. Incompatibilidade entre versões em campo

`push_notifications_enabled` volta para a allowlist de `drive.update_profile_v1` **no mesmo
commit** em que a coluna nasce — é a armadilha nomeada em `docs/contracts/app-para-banco.md`
(chave sem coluna é descartada **sem erro**, o defeito #719). O app publicado (1.3.x, 1.4.x) já
manda a chave; no dia em que a `05` rodar, ela passa a gravar sem release de loja. `DEFAULT true`
mantém o comportamento atual para quem nunca se manifestou, e `drive.get_user_profile_v1`
responde `to_jsonb(p.*)`, então a coluna nova entra no payload de login de todas as versões — o
formato é inócuo, como as sete colunas do #720 já foram.
