# Módulo Financeiro — handover para a próxima rodada

**Escrito em 2026-09-01, ao fim da entrega da Fase 1.** O que está no ar, o que ficou aberto, e
as decisões que não devem ser desfeitas sem alguém decidir desfazê-las.

---

## 1. O que existe

Commit `2f671ef` na `develop`, mergeado em `main` (`4e22503`) e empurrado. 56 arquivos.

A Fase 1 responde **"este parceiro se paga?"**: custo direto por parceiro (material + componentes
+ embalagem + avulsos) contra a receita declarada (`monthly_fee_cents`), com veredito, payback,
CAC e coorte por mês de aprovação.

| onde | o quê |
| :-- | :-- |
| `/finance` | a tela, gateada por `MODULES.FINANCE` (padrão de `/events` e `/places`) |
| `lib/finance/*` | as regras, puras, sem banco — 93 casos em `tests/api/finance-*.test.ts` |
| `lib/services/finance-service.ts` | as leituras e escritas; **não decide nada** |
| `app/api/finance/**` | 5 rotas, `withAuth({roles:['admin','editor']})` + `requireModule` |
| `supabase/migrations/20260901_01..09` | schema `finance`, **todas aplicadas à mão no painel** (a 09 em 2026-09-02) |
| `scripts/finance-backfill-consumption.ts` | preenche o que falta; `--recompute` corrige |

### Estado dos dados em 2026-09-01

```
Display de mesa    R$ 4,15/peça    comprado 500    consumido 62   estoque 438
QR code (adesivo)  R$ 0,279/peça   comprado 1050   consumido 62   estoque 988
Envelope           R$ 0,60/peça    comprado 100    consumido  2   estoque  98
Display de balcão  sem compra      comprado   0    consumido  0   estoque   0
Adesivo (esteira)  sem compra

Boteco Seu Osmar                  R$  53,75
Escritório do Chef / O Pescador   R$ 222,05
```

Regras vigentes: cada display (mesa e balcão) leva **1 QR code**; cada **50 itens entregues**
viajam em **1 envelope**.

---

## 2. O que fazer, em ordem de alavanca

### 2.1 — A RPC agregada de compras do app  ·  **maior valor**

Hoje `usersWithPurchase` e `purchasedMinutes` sobem `null`, o veredito de todo parceiro que não
paga é `unknown_return`, e metade da receita não existe. A causa é que
`drive.time_credit_grants` nega `SELECT` ao `service_role`.

**Não peça o `GRANT`.** Foi analisado em 2026-09-01 e a negação é deliberada:

- o `service_role` lê 7 das 9 tabelas de `drive` — inclusive `profiles`, `user_location_history`
  e `poi_visits`. As duas que negam são `time_credit_grants` e `product_grant_map`, exatamente as
  de monetização, cujo dono o código já declara ser outro repositório
  (`components/admin/credit/GrantCreditForm.tsx:17`, BR-MONETIZACAO-048);
- `app/api/admin/users/[userId]/credit/route.ts:85` lê o ledger com **`auth.supabase`**, o cliente
  ligado ao cookie do operador, e não com o de serviço. O motivo está no cabeçalho daquela rota:
  `grant_time_credit` grava `p_granted_by => auth.uid()`, que como `service_role` seria `NULL`. O
  ledger foi desenhado para só ser tocado por uma pessoa nomeada;
- o filtro `source='purchase'` de `finance-service.ts` é do CÓDIGO, não do grant. Nada impediria
  uma leitura futura dos grants `source='cms'`, que são as cortesias atribuídas no painel.

**Peça ao time `data` uma RPC `SECURITY DEFINER`** que receba os ids de parceiro e devolva, por
parceiro, apenas `users_with_purchase` e `purchased_minutes` — com o piso de k **dentro dela**
(ver 2.2). `GRANT EXECUTE` a `service_role`. É o padrão de `core.coordinator_city_breakdown`.

**Caminho provisório, se a RPC demorar** — funciona hoje, sem permissão nova, medido:

```
core.dashboard_metered_users(limit_count, max_balance_minutes)  → user_id + has_purchase, em lote
drive.get_time_credit_ledger(p_user_id)                         → minutos exatos de compra
drive.profiles.partner_id                                       → a quem cada comprador pertence
```

Em 2026-09-01: 40 usuários com histórico de crédito, **4 compradores**, 1 deles com `partner_id`.
Atenção: `minutes_granted_total` do primeiro RPC mistura compra com boas-vindas e cupom (780 vs
600 reais de compra) — só o ledger separa.

### 2.2 — k-anonimato nas colunas de compra  ·  **FEITO em 2026-09-01 (rodada 2)**

`suppressSmallCohortPurchases` em `lib/finance/profitability.ts` (k=5, `PURCHASE_MIN_COHORT`),
aplicada em `loadFinanceOverview` **antes** de `assessClient`. A linha ganhou
`purchaseSuppressed` e o resumo ganhou `purchaseIsFloor`; a tela escreve `≥ 1` em vez de `1`,
porque a soma de pisos é piso e este módulo não veste piso de fato.

Só suprime o que há para esconder: com `usersWithPurchase` em `0` não existe pessoa exposta, e
com `null` a leitura não respondeu — `null` segue sendo ausência de leitura, nunca "omitido".
Quando a RPC de 2.1 chegar com o piso **dentro** dela, esta chamada vira redundante e inofensiva:
ela nunca suprime o que já está suprimido.

O raciocínio original, que continua sendo a razão de a regra existir:

Um parceiro com 1 usuário adquirido e 1 comprador expõe, na prática, a compra de **uma pessoa
identificável**. `core.coordinator_city_breakdown` já usa **k=5** para o mesmo tipo de dado.

Suprimir `purchasedMinutes` e colapsar `usersWithPurchase` em `0` / `≥1` quando
`linkedByPartnerId < 5` — **no servidor**, em `loadFinanceOverview`, não no componente.

O veredito não muda: `lib/finance/profitability.ts` só lê o booleano `usersWithPurchase > 0`,
nunca o valor dos minutos. A coluna de minutos é a que mais vaza e a única que não decide nada.

### 2.3 — O portão que concede o módulo é mais fraco que o módulo  ·  **FEITO em parte (rodada 2)**

`app/api/admin/users/[userId]/route.ts` foi reescrita: os três métodos passam por
`withAuth({roles:['admin']})`, e `enabled_modules` é validado contra `TOGGLEABLE_MODULES` **e**
contra `MODULE_MIN_ROLES` — gravar `finance` num `client` agora é 400, não um entitlement que
toda porta recusa depois. O POST irmão (`app/api/admin/users/route.ts`) nem aceita o campo.

**O que NÃO foi feito, e é o card próprio:** existem **62 rotas** em `app/api` autorizando por
`getSession()`. Esta rodada corrigiu a que concede módulo, porque um portão de entrada mais fraco
que a sala torna a força da sala decorativa. As outras 61 seguem como estavam.

O texto original, incluindo a correção de premissa sobre `check:routes`:

`app/api/admin/users/[userId]/route.ts` é a rota que **escreve `enabled_modules`**, ou seja, a que
concede o Financeiro. Ela **não passa por `withAuth`** e autoriza com `getSession()` — a chamada
que o cabeçalho de `lib/auth-middleware.ts` diz em palavras que não pode embasar autorização.

**Correção de premissa, e ela vale para todo o repositório:** `npm run check:routes` **NÃO trava o
build**. Não está em `check-all`, nem em `pre-build`, nem em `.github/workflows/deploy-producao.yml`.
**118 de 171** arquivos de rota ainda exportam função simples. Comentários do módulo financeiro
afirmam o contrário — corrija-os junto (ver 2.4).

Ela também aceita `enabled_modules` sem validar contra `MODULES`.

### 2.4 — Pendências pequenas, todas do módulo

1. **FEITO (rodada 2). `proxy.ts:105-127` era cego a role.** O piso passou a morar no SSOT:
   `MODULE_MIN_ROLES` em `lib/modules/index.ts`, aplicado dentro de `isModuleEnabled` — que é o
   que o middleware, o `requireModule` e a navegação já consultavam. O proxy agora só mapeia
   prefixo → módulo e pergunta; `finance` exige `editor`, `events` e `places` seguem abertos a
   qualquer não-admin com a checkbox (endurecê-los expulsaria usuário que hoje entra, sem defeito
   que peça). `UserFormAdmin` deixou de oferecer a caixa fora de alcance **e** de enviá-la, para
   um `client` com `finance` gravado de antes não travar em 400 ao ter o nome editado.
   Texto original: O bloco `MODULE_PREFIXES` roda ANTES da checagem de
   `isClient` e faz `return res`. Um `client` (um parceiro!) ou `viewer` com `finance` marcado
   carrega a casca de `/finance`. Os dados ficam protegidos — a API responde 403 por role — mas os
   dois portões discordam sobre quem entra. Uma linha: exigir `role === 'editor'` ali, ou não
   oferecer a checkbox para `client`/`viewer` em `UserFormAdmin.tsx:296`.
2. **`loadConsumption` tem teto 2000** (`finance-service.ts`) e o `truncated` do overview só olha
   parceiros. Acima disso o custo **sub-reporta em silêncio** — o "piso vestido de fato" que este
   módulo existe para impedir. Propagar para `truncated`.
3. **Comentário falso sobre `check:routes`** em `app/api/finance/clients/route.ts` (e na mensagem
   do commit `2f671ef`). Dizem que ele falha o build. Não falha.
4. **`loadLiveContractTiers`** (`lib/services/partner-contract-tier.ts`) faz `.in()` com até 500
   UUIDs sem chunking — o modo de falha que `chunk()` em `finance-service.ts` foi escrito para
   evitar, com comentário e tudo.
5. **`logAuditEvent` é best-effort** e `sanitizeDescription` apaga a descrição inteira se casar
   `/password|token|secret/i`. Um fornecedor "Token Papelaria" some do log de um lançamento de
   dinheiro. O commit afirma "todo lançamento é auditado"; na prática é "quase sempre".
6. **FEITO E APLICADO (rodada 2, aplicada em 2026-09-02).**
   `supabase/migrations/20260901_09_finance_consumption_invoker.sql` trocou por
   `security invoker` + `set search_path = ''`, com o corpo idêntico linha por linha.

   **Verificado em produção sem escrever nada.** A troca só falha em tempo de EXECUÇÃO, e o
   chamador engole o erro (`if (writeError) return null`, `finance-service.ts:1061`) — um
   defeito ali pararia de gravar custo em silêncio. Chamar com `p_lines: []` não serviria: a
   função retorna 0 antes do INSERT, e o PL/pgSQL só planeja um comando na primeira vez que o
   executa, então o `insert into finance.material_consumption` nunca seria resolvido — que é
   justamente o que o `search_path` vazio poderia quebrar. O teste usou um par
   `(order_id, product_id)` JÁ EXISTENTE: o INSERT foi planejado e executado, o
   `on conflict do nothing` gravou zero linhas, a função devolveu 0, e a tabela seguiu com 57
   linhas antes e depois. Se precisar repetir, o roteiro está aqui neste parágrafo.

   Texto original:
   **`finance.record_material_consumption`**: `security definer` é desnecessário (o único grantee é
   `service_role`, que já tem `insert`), e o `search_path` inclui `public`. Trocar por
   `security invoker`, ou `set search_path = ''` com nomes qualificados. Não é explorável hoje.

### 2.5 — A tela de Envios  ·  **a que mais dói no dia a dia**

Não existe caminho para informar o envio de um pedido antigo nem para **corrigir** um envio já
fechado — o diálogo só aparece na transição de status em `/admin/materials`. Por isso foi
preciso abrir o banco à mão duas vezes em 2026-09-01.

**27 pedidos** seguem sem envio informado, em 27 parceiros, e todos aparecem como
"Custo incompleto". Uma seção `Envios` no Financeiro, listando pedidos despachados sem envio e
permitindo editar os já informados, resolve as duas coisas.

### 2.6 — Layout

O operador pediu explicitamente para olhar layout na próxima rodada. A tela segue o dialeto A do
CMS (trilho 18% / conteúdo 82%, cartão de vidro), com a tinta `text-primary-800 dark:text-tuggi-blue`
e `variant="cta"` nos botões — ver `docs/dev/briefing-design-parcerias.md` para as divergências de
contraste já medidas (D-001, D-C, D-D).

---

## 3. Invariantes que NÃO devem ser desfeitas

Cada uma custou um defeito real para existir. Há teste travando quase todas em
`tests/api/finance-surface.test.ts`.

1. **O custo sai do que foi ENVIADO** (`finance.order_shipment`), nunca do que foi pedido. Pedido
   sem envio informado **não vira custo** — vira pendência. Nunca cair para a quantidade pedida.
2. **O rendimento é fato da COMPRA** (`purchases.units_yield`), congelado no dia. Ele já morou no
   produto, e por isso "300 adesivos" digitados viraram 45.000 etiquetas.
3. **Receita é POR PEÇA; embalagem é do ENVIO.** `ceil(peças / capacidade)`. Cadastrar envelope
   como receita daria 0,02 envelope por display — número que não existe na gaveta.
4. **Custo fixo não se rateia por cliente.** `finance.fixed_costs` não tem `client_id`. Decisão de
   manter ou cortar parceiro é marginal, e se toma com margem de contribuição. A taxa padrão de
   impressão viaja em coluna própria, ao lado do custo direto e **nunca dentro** dele.
5. **`null` nunca é zero.** Sem compra, sem `approved_at`, sem leitura do ledger — cada ausência
   tem veredito próprio, e nenhuma vira "não rendeu". `unknown_return` existe exatamente para não
   acusar um parceiro por causa de uma permissão que falta.
6. **Nenhuma leitura de custo devolve lista vazia quando o banco recusa.** Um custo zero por erro
   afirma que os parceiros saíram de graça.
7. **Minutos não viram reais na Fase 1.** O valor da compra do app não existe no CMS
   (BR-MONETIZACAO-048).
8. **`delete` em `finance.material_consumption` tem uma porta só**: `recomputeConsumption`, e só
   para a linha que o plano de hoje não produz. Nenhuma rota apaga custo. As tabelas de lançamento
   digitado — `client_cost_entries`, `fixed_costs`, `standard_rates` — seguem sem `delete`.
9. **O recálculo nunca troca um custo conhecido por `null`.** Se hoje não dá para precificar, o que
   está lá permanece.

---

## 4. Armadilhas do ambiente (esta máquina)

- **Node 20.18.** O CI usa 22. Consequências: `npm run check:routes` quebra (`fs/promises.glob`),
  366 testes com module-mocks falham, e alguns testes comparam caminhos com `/` contra `\`.
  **Nada disso é defeito de código.**
- **Scripts com `supabase-js` não rodam** sem `WebSocket` global. Preload descartável:
  `--require ./scripts/_ws-shim.cjs` com
  `globalThis.WebSocket = require('undici').WebSocket`.
- **`npm install` reescreve `yarn.lock`** trocando entradas de macOS por Windows. **Não commite.**
- **Heredoc do bash quebra** com conteúdo TSX grande. Use a ferramenta Write, ou python.
- **Um `//` contendo `/*`** (ex.: escrever `/admin/*` num comentário de linha) abre um bloco que
  engole o arquivo no lint semântico dos testes. Já existe em `Header.tsx:341` e `proxy.ts:127`.
- **Migrations são aplicadas À MÃO no painel**, nunca por CLI. Escreva-as guardadas por
  `IF EXISTS` — as 05 e 06 já foram corrigidas para serem re-executáveis.

---

## 5. Verificação

```
npx tsc --noEmit --skipLibCheck --incremental false     # 0 erros no repositório inteiro
npx eslint app components lib scripts tests              # 0 erros (2557 warnings, a baseline)
npx tsx --experimental-test-module-mocks --test tests/api/finance-*.test.ts   # 100 (era 93)
npx tsx --experimental-test-module-mocks --test tests/api/material-queue.test.ts  # 17
```

`tests/api/auth-middleware.test.ts` falha 13/13 nesta máquina, com e sem as mudanças da rodada 2
(`ERR_INVALID_URL_SCHEME`). É a armadilha do Node 20 da seção 4, não defeito de código.

O commit `2f671ef` saiu como `feat(cms):`, **sem número de issue e sem código `BR-`**, fora da
convenção do repositório. Não foram inventados de propósito: um `BR-` novo tem dono, e um `#`
errado aponta para o card de outra pessoa. Se os dois existirem, vale um amend.
