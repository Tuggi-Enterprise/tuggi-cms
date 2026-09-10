# Retroação do bounce: suprimir quem já devolveu — escrito, NÃO executado

**Quem executa: o operador humano** (CLAUDE.md §3). O `data` escreve o comando, o impacto e o
rollback; a execução é do painel.
**Escrito em 2026-09-10** pelo `data`. Tudo abaixo foi medido no banco vivo na mesma data.

## O estado, em números

| Fato | Valor |
| :-- | --: |
| Campanhas enviadas desde 15/06/2026 | 6 |
| Linhas em `marketing.newsletter_recipients` | 921 |
| Linhas `status = 'bounced'` | 83 |
| E-mails **distintos** que deram bounce | 67 |
| Desses, **nunca suprimidos** | 66 |
| `email_unsubscribes` com `source = 'bounce'` | **0** |
| Linhas enviadas para um endereço que **já tinha dado bounce antes** | **46** |
| E-mails que deram bounce **e nunca tiveram entrega/abertura/clique** | **65** |
| E-mails que deram bounce **2 ou 3 vezes** | 14 |

## O obstáculo, e ele é decisivo

**Não dá para separar hard de soft nas 83 linhas existentes.** `supabase/functions/resend-webhook/index.ts`,
ramo `type === 'email.bounced'`, faz só `table.update({ status: 'bounced' })` e **descarta
`data.bounce.type`**, que é o campo do Resend que diz `Permanent` (hard) ou `Transient` (soft).
O dado nunca foi gravado; nenhum `UPDATE` o recupera.

A coluna para gravá-lo passa a existir em `supabase/migrations/20260910_03_newsletter_recipient_bounce_type.sql`
(`bounce_type`, `bounce_subtype`, `failed_at`) — mas ela só classifica bounce **futuro**.

Então a retroação tem de decidir hard/soft por **evidência observável**, não pelo campo do
fornecedor. É o que a Opção A abaixo faz.

## Três opções, com a contagem de cada uma

| | Critério | INSERTs esperados |
| :-- | :-- | --: |
| **A — recomendada** | deu bounce **e nunca** teve `delivered`/`opened`/`clicked` | **64** |
| B | deu bounce **2+ vezes** | 14 |
| C | deu bounce **alguma vez** | 66 |

**Por que A.** "Nunca entregou uma única vez em 6 campanhas" é a definição operacional de
endereço morto, e é o mais perto de *hard* que o dado permite. B é conservadora demais — deixa
51 endereços mortos na base porque só foram tentados uma vez. C suprime endereço que
**comprovadamente já recebeu** (2 casos): esses são caixa cheia ou indisponibilidade temporária,
que é soft por definição, e suprimir soft é jogar fora destinatário bom.

O `65 → 64` é 1 endereço que já está em `email_unsubscribes` por `footer_link`. O `ON CONFLICT`
cuida dele; a contagem de 64 já o exclui.

**Não existe regra `BR-*` sobre supressão de bounce.** Isto é benchmark de mercado (CLAUDE.md §4,
balde 1): Resend, SES e Postmark suprimem hard na primeira ocorrência. Se o operador quiser um
limiar para soft (*"N bounces consecutivos"*), ele é número de negócio e nasce em
`docs/business-rules/` — não foi inventado aqui.

## O comando — Opção A

```sql
-- Rodar no SQL editor do painel. 1 transação. INSERT puro, nada é apagado.
BEGIN;

-- 1. Confira ANTES. Tem de responder 64.
WITH dead AS (
    SELECT lower(btrim(email)) AS email
      FROM marketing.newsletter_recipients
     WHERE status = 'bounced'
    EXCEPT
    SELECT lower(btrim(email))
      FROM marketing.newsletter_recipients
     WHERE status IN ('delivered', 'opened', 'clicked')
)
SELECT count(*) AS vai_inserir
  FROM dead d
 WHERE NOT EXISTS (
       SELECT 1 FROM marketing.email_unsubscribes u
        WHERE lower(u.email) = d.email);

-- 2. O INSERT. `source = 'bounce'` é o que distingue esta supressão do
--    opt-out voluntário ('footer_link') e da denúncia de spam ('complaint').
WITH dead AS (
    SELECT lower(btrim(email)) AS email
      FROM marketing.newsletter_recipients
     WHERE status = 'bounced'
    EXCEPT
    SELECT lower(btrim(email))
      FROM marketing.newsletter_recipients
     WHERE status IN ('delivered', 'opened', 'clicked')
)
INSERT INTO marketing.email_unsubscribes (email, source, unsubscribed_at)
SELECT d.email, 'bounce', now()
  FROM dead d
ON CONFLICT (email) DO NOTHING;

-- 3. Confira DEPOIS. Tem de responder 64.
SELECT count(*) AS suprimidos_por_bounce
  FROM marketing.email_unsubscribes
 WHERE source = 'bounce';

COMMIT;
```

**Efeito imediato.** `marketing.get_newsletter_audience` e
`marketing.estimate_newsletter_audience` já fazem
`NOT EXISTS (SELECT 1 FROM marketing.email_unsubscribes …)`. Os 64 saem da audiência da
**próxima** campanha sem nenhuma mudança de código. A estimativa cai 64.

## Rollback

```sql
-- Só apaga o que ESTE comando criou: `source = 'bounce'` era 0 antes dele.
DELETE FROM marketing.email_unsubscribes WHERE source = 'bounce';
```

É um `DELETE` **com** `WHERE`, e o `WHERE` é exato — mas continua sendo ação destrutiva
(CLAUDE.md §3): **o operador executa**. Reverter não restaura nada perdido, porque nada foi
perdido: a supressão é aditiva.

## O que fica pendente depois disto

1. **O webhook precisa passar a classificar** (é do `dev`, está escrito no rodapé de
   `supabase/migrations/20260910_03_newsletter_recipient_bounce_type.sql`). Sem isso, daqui a 6
   campanhas este documento existe de novo com números maiores.
2. **A fila de envio precisa consultar a supressão por destinatário**, não só ao montar a
   audiência: uma campanha longa pode receber um bounce no meio dela mesma.
