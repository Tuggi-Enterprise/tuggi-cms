# Briefing — a `Visão geral` do Financeiro

**Pedido do operador, 2026-09-02:** *"na primeira tela eu quero uma dashboard financeiro,
consolidando tudo: custo geral, número de clientes, previsão de receita para os próximos meses,
custo de aquisição, número de users pagantes — tudo o que nos passa dar um aviso financeiro do
que temos no projeto."*

Este documento é o levantamento que antecede o desenho: **de onde sai cada número, o que ele tem
o direito de afirmar, e o que ainda não existe.** Ele sobrevive ao card porque metade do trabalho
aqui é decidir o que a tela NÃO pode dizer — e essa decisão não morre quando a implementação
fecha.

Leia junto: [`financeiro-proxima-rodada.md`](financeiro-proxima-rodada.md) (o estado do módulo) e
[`briefing-design-parcerias.md`](briefing-design-parcerias.md) (as divergências de contraste já
medidas).

---

## 0. O que já está no ar — 2026-09-02

Implementado nesta rodada, com `tsc` limpo, `eslint` sem erro e **148 testes passando**
(100 do módulo + 31 novos em `tests/api/finance-overview.test.ts` + 17 da fila de material).

| Onde | O quê |
| :-- | :-- |
| `lib/finance/overview.ts` | as quatro funções puras: cascata do mês, quebra por plano, projeção e estimativa a preço declarado |
| `components/finance/OverviewPanel.tsx` | as seis faixas; entra como **primeira** seção de `/finance` |
| `app/api/finance/clients` | ganhou `month`, `mix`, `projectionBase` e `excludedPartners` — na mesma leitura da tabela |
| `app/api/finance/app-credit` | o lado B2C, `admin` para o agregado e `editor` para o catálogo de preços |
| `app/api/finance/exclusions` | marcar e desfazer conta de teste; `PATCH` desfaz, nunca `DELETE` |
| `lib/services/partner-contract-tier.ts` | passou a ler `status` — e ganhou o `chunk()` que faltava (§2.4-4 do handover) |
| `messages/{pt,en,es}.json` | 280 chaves em `Finance`, paridade conferida entre os três |

**A migration `20260902_01_finance_overview.sql` foi aplicada pelo operador em 2026-09-02.**

### Rodada 2 — o calendário da cobrança

O operador apontou que a receita precisa seguir o vencimento do dia 20. Ao ler o instrumento,
**duas premissas do pedido divergiam dele** e ficam registradas:

| O pedido dizia | O contrato (v2-2026-08) diz |
| :-- | :-- |
| contrato com validade de 1 ano | *"Este contrato vigora por prazo indeterminado"*, rescisão a qualquer tempo com aviso de 30 dias, sem prazo mínimo. No aniversário há **reajuste**, não término |
| conta a partir de quem "fechou" | a contraprestação *"somente começa a correr na data da publicação, no aplicativo"* — assinar não cobra |

**Decisões de 2026-09-02:** os doze meses viram **premissa da projeção** (o contrato fica como
está), e o marco é a **publicação, caindo para a assinatura** quando não há trilha — com a queda
marcada até a tela, porque ela antecipa o vencimento.

E havia um defeito real, agora corrigido: `assessClient` contava receita em **meses inteiros desde
`partner.clients.approved_at`** — que não é a assinatura, não é a publicação, e ignorava o dia 20.
Um parceiro aprovado em 1º de agosto e publicado em 25 aparecia com um mês faturado que ninguém
cobrou.

| Onde | O quê |
| :-- | :-- |
| `lib/finance/billing.ts` | o calendário: dia 20, primeiro vencimento no mês seguinte ao da publicação, proporcional na primeira fatura. O dia 20 é lido de `DUE_DAY_OF_MONTH`, não redeclarado |
| `lib/finance/profitability.ts` | receita = faturas **vencidas**; `undated` passou a falar do marco de cobrança; a saída carrega `billingStartsAt` e a origem dele |
| `lib/finance/structure.ts` | a mensalidade média passou a **ler** `monthlyFeeCents` em vez de dividir receita por meses — a divisão parou de devolver a mensalidade quando o proporcional entrou |
| `lib/finance/overview.ts` | a linha firme deixou de ser uma reta: é o calendário somado, mês a mês, e sobe em degraus |
| `finance-service.ts` | `loadBillingStarts` — primeira publicação em `core.audit_logs`, caindo para `accepted_at` |
| Janela | **mês vigente + 6**, e o vigente é EXATO: o dia 20 garante que nada que a premissa suponha o alcance |

**Receita realizada não tem horizonte.** Quem tem quatorze faturas vencidas faturou quatorze; os
doze meses cortam só a projeção. É onde o contrato e a premissa se separam, e o código diz isso
em `assessClient` (`horizonInvoices: null`) e na rota (`HORIZON_INVOICES = 12`).

165 testes passando — 34 novos em `finance-billing.test.ts` e `finance-overview.test.ts`.

**Continua pendente**, e cada uma tem dono fora desta rodada:

1. a RPC por parceiro do §2.1 de [`financeiro-proxima-rodada.md`](financeiro-proxima-rodada.md);
2. `drive.profiles.is_test` na origem — sem ele o agregado do app ainda conta a conta de teste,
   e a tela diz isso em vez de fingir que alcançou;
3. a decisão sobre a permissão das RPCs de `entitlement`: hoje a faixa B2C aparece só para
   `admin`, e o editor lê a razão escrita.

---

## 1. A pergunta que a tela responde

As três seções de hoje respondem por **um parceiro** (`Parceiros`), por **um produto**
(`Catálogo`) e pela **operação** (`Estrutura`). Nenhuma responde a pergunta de dono:

> **Quanto dinheiro entra, quanto sai, e daqui a quantos meses isso vira?**

A `Visão geral` entra como **primeira seção** do trilho, antes de `Parceiros`, e é a única que
mistura B2B (mensalidade de parceiro) com B2C (compra de minutos no app) — mistura que só é
honesta porque cada lado carrega o seu rótulo de origem.

---

## 2. As três decisões do operador — 2026-09-02

| Decisão | O que muda |
| :-- | :-- |
| **Preço do passe é declarado no CMS** | Nova tabela `finance.pass_prices`. A receita do app passa a existir em R$ como **estimativa a preço declarado**, nunca somada a um fato. Desbloqueia o passivo de comissão e o LTV |
| **Previsão = base contratada + premissa digitada** | A curva firme é contrato assinado e vivo. Duas premissas (novos/mês, churn %) são do operador, ficam **impressas ao lado do gráfico**, e nunca viram default silencioso |
| **Só competência, com rótulo honesto** | O CMS não confere pagamento. Toda receita da tela é `contratado, por competência`, e a tela diz isso em uma linha — não se cria registro de recebimento nesta rodada |
| **Hora contratada ≠ cortesia ≠ teste** | A base é `source = 'purchase'`; as outras cinco portas são cortesia e vivem em linha separada. Contas de teste ganham uma lista nomeada no CMS e um pedido de flag na origem — ver §3-bis |

---

## 3. As seis faixas, número por número

Notação: **pronto** = sai do que a `/api/finance/clients` já devolve; **cálculo novo** = os dados
já viajam, falta a conta; **dado novo** = precisa de coluna, tabela ou RPC.

### Faixa 1 — O mês, em cascata

A `Estrutura` já é uma cascata no código e a rodada de design anterior pediu que ela fosse
desenhada como tal. Aqui a mesma cascata é **mensal**, e não acumulada desde sempre:

```
  Receita recorrente contratada (MRR)
− Custo variável do mês          (material_consumption do mês, por consumed_at)
− Custo fixo mensal normalizado  (structure.monthlyFixedCents)
= Resultado do mês
```

| Número | Fonte | Estado |
| :-- | :-- | :-- |
| MRR contratado | Σ `monthly_fee_cents` dos pagantes com contrato `signed` e não `terminated` | **dado novo** (ler `status`, hoje só se lê `tier`) |
| Custo variável do mês | `consumption` filtrado por `consumedAt` + `client_cost_entries` do mês | **cálculo novo** (`consumedAt` já sobe; `incurred_at` falta no `select` de `loadCostEntries`) |
| Custo fixo mensal | `structure.monthlyFixedCents` | **pronto** |
| Desembolso único do mês | `structure.oneOffCents` | **pronto** — e fica **fora** da cascata, com a razão escrita ao lado (a impressora não é conta que volta) |
| Taxa de impressão | `summary.standardCostCents` | **pronto** — linha própria, jamais dentro do custo direto |

**O rótulo obrigatório da faixa:** `contratado, por competência — o CMS não confere pagamento`.

### Faixa 2 — Base de clientes (B2B)

| Número | Fonte | Estado |
| :-- | :-- | :-- |
| Parceiros, total | `summary.partners` | **pronto** |
| Quebra: paga / cortesia / gratuito / sem plano declarado | `derivePartnerPlan().kind` — a mesma função de quatro outras superfícies | **cálculo novo** (o `plan` é decidido no servidor e hoje não sobe para a tela) |
| Encerrados | `partner_contracts.status = 'terminated'` | **dado novo** |
| Ticket médio dos pagantes | `structure.averageMonthlyFeeCents` | **pronto** |
| Novos por mês, 6 meses | `cohorts.lines[].clients` | **pronto** |
| Ponto de equilíbrio | `structure.breakEvenPartners` | **pronto** — vira **frase**, não caixinha: *"faltam N pagantes na mensalidade média para cobrir R$ X de estrutura"* |

Medido em 2026-09-01: **52 parceiros, 49 com custo zero**, custo direto total **R$ 1.934,59**. A
quebra por plano é o número que hoje ninguém vê e que explica os 49.

### Faixa 3 — Usuários do app (B2C)

**A base é quem COMPROU. Cortesia é outra linha, nunca a mesma** (ver §4-bis).

| Número | Fonte | Estado |
| :-- | :-- | :-- |
| Usuários totais / com saldo / em saldo baixo | `core.dashboard_entitlement_overview` | **pronto** — mas **RPC de `admin`** (ver §5.4) |
| **Compradores** (users pagantes) | `dashboard_entitlement_overview.purchased_users` | **pronto** — e é o número global, que **não depende** da RPC por parceiro que falta |
| **Cortesia** (não infla a base) | `granted_users` do mesmo agregado | **pronto** — linha separada, com a origem escrita |
| Assinaturas por loja, churn 7d | `core.dashboard_subscription_stats` | **pronto**, mesma ressalva de permissão |
| Horas **contratadas** consumidas | `consumed_minutes_paid` (`source = 'purchase'`) | **pronto** — `null` é ausência de coluna, nunca zero |
| Horas **de cortesia** consumidas | `consumed_minutes_granted` (as outras cinco portas) | **pronto** |
| **Receita B2C estimada** | `last_purchase_product_id` × `finance.pass_prices`, **só sobre `purchase`** | **dado novo** (a tabela de preços) |

A receita estimada mora **fora** da cascata da Faixa 1 e carrega selo `estimativa, a preço
declarado`. Somá-la ao MRR produziria um total que mistura contrato assinado com preço digitado.

### Faixa 4 — Aquisição

| Número | Fonte | Estado |
| :-- | :-- | :-- |
| Vieram pelo QR | `summary.acquiredUsers` (`drive.profiles.partner_id`) | **pronto** |
| Equipe do parceiro | `summary.teamUsers` (`client_id`) | **pronto** — e **nunca somada** à aquisição |
| CAC | `summary.cacCents` | **pronto** |
| **CAC de aquisição limpo** | idem, contando só `reason = 'first_delivery'` | **cálculo novo** — `reason` já sobe, e separa custo de crescimento de custo de retrabalho (`replacement`, `loss`, `gift`) |
| CAC por coorte | `cohorts.lines[]` (custo ÷ adquiridos do mês) | **cálculo novo** |
| Conversão compradores ÷ adquiridos | `summary.usersWithPurchase / acquiredUsers` | **pronto**, com o piso de k (`≥`) |
| **Passivo de comissão** | `commission_rate` × receita B2C dos adquiridos daquele parceiro | **dado novo** (depende de `pass_prices`) |

A comissão é **dinheiro que sai** — 20% da receita líquida dos turistas que chegam pelo QR
(cláusula `commission`; medido em 20% em 10 dos 11 clientes, 50% em um). Hoje ela não aparece em
lugar nenhum do CMS, e é a única linha de custo do modelo de negócio que a tela ainda ignora.

### Faixa 5 — Projeção, 6 meses

Um gráfico, duas camadas e duas premissas visíveis:

- **camada firme** — MRR de contratos assinados e vivos, achatado nos próximos 6 meses;
- **camada de premissa** — novos parceiros/mês × ticket médio, menos churn %/mês;
- **linha de custo** — fixo mensal + custo variável médio por parceiro novo (kit de material);
- **o cruzamento marcado**: *"equilíbrio em `<mês>`, sob a premissa de N novos/mês"*.

As duas premissas são **campos**, com o valor impresso junto do gráfico. Sem premissa digitada, o
gráfico mostra só a camada firme — que é a leitura conservadora e continua verdadeira.

O B2C **não é extrapolado**: entra na projeção apenas se houver preço declarado, e como camada
tracejada rotulada.

### Faixa 6 — O que torna tudo acima um piso

O módulo já tem esse vocabulário; a `Visão geral` precisa dele mais do que as outras, porque um
número consolidado é o que mais convida a ser lido como fato fechado:

| Pendência | Fonte | Efeito escrito ao lado |
| :-- | :-- | :-- |
| Pedidos sem envio informado | `summary.ordersAwaitingShipment` | **27 em 2026-09-01** — nenhum custo é lançado sobre eles |
| Linhas sem preço | `summary.unpricedLines` | o custo do parceiro é piso |
| Compras do app não respondidas | `purchasesAnswered` | o retorno de quem não paga é `não sei`, não `não rendeu` |
| Teto de leitura | `truncated` (500 parceiros / 2000 linhas) | todo número vira `≥` |
| Compras suprimidas por k=5 | `summary.purchaseIsFloor` | compradores é piso, minutos foram omitidos |

---

## 3-bis. Hora contratada, cortesia e conta de teste

**Pedido do operador, 2026-09-02:** *"precisamos conseguir distinguir também o que são horas
contratadas de verdade e o que são horas de cortesia, para não inflar a base com dados irreais —
e ter a possibilidade de marcar usuários como teste, e esses não entram na conta."*

### O corte de cortesia já existe no dado

`drive.time_credit_grants.source` tem **seis portas** (BR-MONETIZACAO-047, tipadas em
`lib/credit/entitlement.ts`), e **só uma é dinheiro**:

| Porta | O que é | Entra na base? |
| :-- | :-- | :-- |
| `purchase` | passe comprado pelo turista | **sim — é a base** |
| `welcome` | brinde de cadastro | não |
| `coupon` | campanha | não |
| `cms` | cortesia atribuída no painel, por uma pessoa nomeada | não |
| `partner` | crédito vindo do parceiro | não |
| `transfer` | movimentação entre contas | não — e nem é entrada nova |

O agregado do banco **já vem cortado nos dois lados**: `purchased_users` × `granted_users`, e
`consumed_minutes_paid` × `consumed_minutes_granted`. Então a Faixa 3 nasce podendo dizer a
verdade sem dado novo nenhum — o que falta hoje é a tela **fazer** o corte em vez de somar tudo
num total de usuários.

**A regra de desenho:** o número grande é sempre o de `purchase`. Cortesia aparece ao lado, na
mesma faixa, com peso menor e a origem escrita. Elas **nunca** compartilham uma barra empilhada
que sugira um total único — um total de "usuários com saldo" é exatamente o número irreal que
este pedido existe para impedir. E a receita estimada só multiplica `purchase`: cortesia a preço
de tabela seria inventar faturamento.

### Conta de teste não existe em lugar nenhum

Não há `is_test`, `is_internal` nem equivalente em `drive.profiles`, nem coluna alguma no CMS.
São dados a criar, e **o lugar decide o que a exclusão consegue fazer**:

| Onde marcar | O que dá para excluir | Custo |
| :-- | :-- | :-- |
| **Origem — `drive.profiles.is_test`, pedido ao time `data`** | **tudo**, porque as RPCs já saem somadas do banco: agregado, listas, aquisição por parceiro | depende de outra equipe |
| **CMS — `finance.excluded_accounts`** (`subject_id`, `kind`, `reason`, `created_by`) | só onde o CMS vê o id: a lista de `dashboard_metered_users` (teto 1000) e a contagem de parceiros. **O agregado continua sujo** | uma tabela e uma tela |

**Recomendação, e ela é das duas coisas:** criar `finance.excluded_accounts` agora — resolve o
lado B2B por inteiro (parceiro de teste some da contagem, do MRR e do CAC, porque essas contas o
CMS faz sozinho) e o lado B2C na lista — **e** pedir o flag na origem, que é o único jeito de o
agregado deixar de contar a conta do próprio operador. Enquanto o flag não existir, todo número
que vier do agregado carrega a ressalva `inclui contas de teste`, escrita, e não uma nota de
rodapé que ninguém lê.

A exclusão é **nomeada e reversível**: quem excluiu, quando e por quê. Uma conta que some de um
número financeiro sem deixar rastro é a mesma classe de defeito que `delete` em tabela de
lançamento — por isso `finance.excluded_accounts` guarda linha, e não apaga.

---

## 4. As invariantes que o desenho não pode quebrar

Cada uma custou um defeito real. As nove estão em `financeiro-proxima-rodada.md` §3; estas cinco
são as que uma tela consolidada tende a atropelar:

1. **`null` nunca é zero.** Travessão com legenda, jamais um `0` que acusa.
2. **Piso nunca se veste de fato.** `≥` quando há supressão ou teto — inclusive nos totais.
3. **Minutos não viram reais** — exceto na linha explicitamente rotulada `estimativa, a preço
   declarado`, que nunca entra na mesma soma que um fato.
4. **Custo fixo não se rateia por cliente.** A cascata tem duas camadas (MC I → MC II) e elas não
   se fundem numa só.
5. **Receita é competência, não caixa.** Nenhuma palavra `recebido` nesta tela.
6. **Cortesia não soma com compra.** Nem em barra empilhada, nem em total de usuários, nem em
   receita estimada. As seis portas de `source` viram dois números, e o grande é `purchase`.

E duas do design system, já medidas: micro-caps em `text-gray-500` e não `gray-400` (D-C, 2,51:1
reprova SC 1.4.3), e `variant="cta"` nos botões (D-D, o `default` mede 2,70:1).

---

## 5. O que precisa existir antes — a lista de implementação

1. **`finance.pass_prices`** (`product_id`, `price_cents`, `currency`, `effective_from`), editável
   no Catálogo, lida contra `MeteredUser.last_purchase_product_id`. Preço é **fato da data**, como
   `purchases.units_yield` já é — versionado, não sobrescrito.
2. **Ler `partner_contracts.status`** em `loadLiveContractTiers` (hoje só `tier`), para separar MRR
   firme de cadastro sem contrato e para enxergar `terminated`. Aproveitar para corrigir o `.in()`
   sem chunking apontado em `financeiro-proxima-rodada.md` §2.4-4.
3. **`incurred_at` no `select` de `loadCostEntries`** — sem ele não há corte mensal dos avulsos.
4. **Permissão.** `dashboard_entitlement_overview` e `dashboard_subscription_stats` são `admin`
   e usam o JWT do operador; o Financeiro abre para `editor` (`MODULE_MIN_ROLES`). Ou a Faixa 3
   aparece só para `admin`, ou nasce uma leitura própria. **É decisão pendente, e o desenho deve
   prever a faixa ausente sem buraco na página.**
5. **`finance.excluded_accounts`** (`subject_id`, `kind` = `app_user` | `client`, `reason`,
   `created_by`, `created_at`) e o pedido de `drive.profiles.is_test` ao time `data` — ver
   §3-bis. Sem os dois, a Faixa 3 é honesta mas inclui a conta do próprio operador.
6. **A RPC por parceiro** de `financeiro-proxima-rodada.md` §2.1 continua sendo a maior alavanca:
   enquanto ela não existir, a conversão por parceiro é piso e o passivo de comissão é aproximado.

---

## 6. Moeda

A tela escolhe **uma** moeda — a dominante entre os parceiros, mesma regra de `summarizeFinance` —
e as outras voltam **nomeadas** em `Fora da soma`, nunca convertidas. Uma taxa de câmbio cadastrada
faria o histórico depender de quando alguém a atualizou pela última vez.
