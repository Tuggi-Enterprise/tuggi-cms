# QA — gate único das rotas `/api/*` (CARD-CMS-01)

Ferramentas de teste para o card [#41 CARD-CMS-01](https://github.com/Tuggi-Enterprise/tuggi-app/issues/41).
Nenhum arquivo aqui é lido pela aplicação em produção — é insumo de teste, roda por fora do build.

## Por que isto existe

O card exige, na fase de integração HTTP, três contas reais no mesmo projeto Supabase que
produção usa (`tysnkzmljlmmqpbotkxv`) — não há projeto de teste/staging separado hoje (ver
`docs/dev/2026-08-05-qa-contas-de-teste-gate-api.md`). Todo o conteúdo aqui foi desenhado para
não poluir dado real:

- e-mail com domínio `@qa-test.tuggi.app` (não existe de verdade, não recebe e-mail — as contas
  são criadas com `email_confirm: true`, então nunca disparam envio);
- prefixo `card-cms-01-` no local-part, para filtrar/auditar/limpar com um `ilike`;
- script de limpeza dedicado (`cleanup-test-accounts.ts`), idempotente.

## Arquivos

| Arquivo | O que faz |
| :-- | :-- |
| `seed-test-accounts.ts` | Cria (ou reaproveita, se já existirem) os usuários de **Supabase Auth** das três personas do card. **Não** escreve em `core.cms_users` nem em `core.clients` — ver a lacuna abaixo. |
| `cleanup-test-accounts.ts` | Remove os três usuários de Auth criados pelo seed. Idempotente — rodar em cima de nada já limpo não é erro. |
| `lib/session-cookie.ts` | Faz login (`signInWithPassword`) e devolve o cookie de sessão exatamente como o `@supabase/ssr` do próprio CMS o serializaria (chunking + `base64-` incluídos), usando a própria lib do pacote em vez de reimplementar o formato. Usado pelo harness e pelo seed (para provar que o login funciona). |
| `route-gate-harness.ts` | O harness de integração HTTP do card: dispara cada rota do inventário nos quatro estados (anônimo, autenticado-sem-cms-user, `client`, `admin`) contra um `next dev` (ou preview) rodando, e compara com a política declarada. |
| `.test-accounts.local.json` | Gerado pelo seed. **Não é commitado** (está no `.gitignore`) — tem e-mail, id de Auth e senha de cada persona. |

## A lacuna que só o `data` fecha

O seed cria o usuário de **Auth** das três personas, mas duas delas — `admin` e `client` — só
viram o que o nome diz depois de uma linha em `core.cms_users` (e a `client` também precisa de
uma linha em `core.clients` para preencher `client_id`). Escrever nessas tabelas é escopo do
`data` (dono de "qualquer SQL executado", `CLAUDE.md` §1). O `seed-test-accounts.ts` imprime,
ao final, o insert que falta, pronto para o `data` revisar e executar — ele não o executa.

Até essa linha existir:
- a persona `admin` e a persona `client` autenticam (têm sessão válida), mas hoje se comportam
  **exatamente como a persona `authenticated-sem-cms-user`** (a checagem em `core.cms_users`
  falha do mesmo jeito para as três) — o que aliás é o comportamento correto a testar em
  `withAuth`/`lib/auth-middleware.ts:48-53`;
- o harness roda mesmo assim, mas os estados `client` e `admin` aparecem como `SKIPPED` no
  relatório, não como falha silenciosa.

## Como rodar

```bash
# 1. cria as 3 contas de Auth (idempotente — roda de novo sem duplicar)
npx tsx --env-file=.env scripts/qa/seed-test-accounts.ts

# 2. com `npm run dev` rodando em outro terminal (porta 3000 por padrão)
npx tsx --env-file=.env scripts/qa/route-gate-harness.ts

# 3. quando terminar de usar as contas
npx tsx --env-file=.env scripts/qa/cleanup-test-accounts.ts
```
