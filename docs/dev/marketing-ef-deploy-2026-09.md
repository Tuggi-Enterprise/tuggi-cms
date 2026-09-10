# Deploy das três EFs do Marketing (#346) — o que só o operador pode fazer

Escrito pelo `dev` em 2026-09-10. Está aqui, e não no card, porque **sobrevive ao card**: uma das
linhas é uma flag de deploy que, se esquecida, quebra em silêncio meses depois.

## 1. A flag que não pode ser esquecida

```bash
supabase functions deploy send-newsletter --no-verify-jwt
```

**Sem `--no-verify-jwt` o descadastro em um clique não funciona, e ninguém percebe.** O
`POST /unsubscribe` é chamado pelo Gmail/Yahoo **sem chave nenhuma** (RFC 8058); com
`verify_jwt` ligado o gateway responde 401 antes do nosso código rodar. O Gmail não avisa: ele
só deixa de considerar que temos one-click, e o efeito aparece na reputação, não num log nosso.

Isso **não** abre a função. A autorização passou a ser do corpo (`requireAdmin`), e é por isso que
dá para desligar o gateway — a ordem anterior era a inversa, com o gateway aparentando proteger
enquanto a chave publicável o atravessava.

As outras duas:

```bash
supabase functions deploy firebase-push-notification   # verify_jwt padrão, tudo bem
supabase functions deploy resend-webhook --no-verify-jwt   # já era assim
```

## 2. Ordem, e por que ela é frouxa de propósito

**Migrations do `data` primeiro** (`docs/dev/marketing-migrations-2026-09.md`), EFs depois. Mas a
ordem inversa **não quebra nada**, e isso é deliberado: as colunas novas
(`notification_logs.success_count/failure_count/recipient_count/audience_filters`,
`newsletter_recipients.bounce_type/bounce_subtype/failed_at`,
`newsletter_campaigns.recipient_count/sent_count/failed_count/started_at`) chegam por migration
manual no painel, e o PostgREST recusa o **UPDATE/INSERT inteiro** com `PGRST204` quando uma
coluna é desconhecida.

Se as EFs subirem antes, cada escrita cai para a forma antiga e grita no log:

```
🚨 notification_logs is missing the count columns — the migration ... has not run
🚨 newsletter_recipients is missing bounce_type/bounce_subtype/failed_at
🚨 newsletter_campaigns is missing recipient_count/sent_count/failed_count/started_at
```

Perde-se a contagem daquele envio; **não** se perde a linha do log, o registro do bounce nem a
saída da campanha de `sending`. Foi montado assim porque a alternativa — deixar o `PGRST204`
derrubar a escrita — trocaria um defeito por outro pior: campanha presa em `sending` para sempre
é exatamente o que este card veio consertar.

Quando as migrations rodarem, as mensagens acima somem sozinhas. **Se continuarem aparecendo
depois delas, é defeito**, não ruído.

## 3. Segredo novo

`PUBLIC_FUNCTIONS_URL` — opcional. É a origem que compõe o `List-Unsubscribe`; ausente, a função
usa `${SUPABASE_URL}/functions/v1`, que é o valor de produção. Só configure num ambiente de
homologação que precise mandar e-mail apontando para outro lugar.

## 4. Pendências que não são minhas

- **`/unsubscribe` do site descadastra no GET.**
  `tuggi-enterprise/src/app/[locale]/unsubscribe/page.tsx` é Server Component e faz o upsert
  **durante o render**: qualquer GET — scanner de link de antivírus, prefetch de URL-defense,
  unfurl de mensageiro — grava um descadastro que ninguém pediu. Card do `tuggi-enterprise`.
  Esta fatia contornou o problema (o cabeçalho aponta para a EF, que só aceita POST), mas o
  link visível no rodapé continua sendo essa página.
- **`send-transactional` continua sem autorização.** Todos os chamadores dela já apresentam
  chave de máquina — conferido em 2026-09-10, está na tabela de `docs/contracts/edge-functions.md`,
  seção `send-transactional`, item 5. A armadilha para quem fechar: a chave do servidor Next
  (`SUPABASE_SECRET_KEY`) é uma **terceira** chave, que `isOwnMachineKey` ainda não conhece.
