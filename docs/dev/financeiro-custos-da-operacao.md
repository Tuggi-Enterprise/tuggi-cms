# O custo da operação — a planilha do operador entra no CMS

**Escrito em 2026-09-02, rodada 3.** O pedido foi: *"cadastre as novas categorias e custos fixos
previstos e também preveja as categorias de custos variáveis no projeto. Iremos trazer para cá
todo o P&L da empresa."* Este documento diz o que entrou, o que ficou de fora **de propósito**, e
as três divergências encontradas na planilha que valem uma decisão do operador.

Continuação de [`financeiro-proxima-rodada.md`](./financeiro-proxima-rodada.md), cujas invariantes
seguem todas valendo.

---

## 1. O que passou a existir

| onde | o quê |
| :-- | :-- |
| `lib/finance/cost-taxonomy.ts` | o SSOT: 6 categorias, 2 naturezas, 2 sinais, e os **33 itens previstos** |
| `supabase/migrations/20260902_03_...taxonomy.sql` | `category`, `nature`, `entry_type`, `is_payroll`, `ends_at` em `finance.fixed_costs` |
| `supabase/migrations/20260902_04_...baseline.sql` | as 16 linhas de jul/2026 e ago/2026 da planilha |
| `lib/finance/structure.ts` | custo estrutural × custo de caixa, base do fator R, e o "para onde vai o dinheiro" |
| `lib/finance/overview.ts` | o mês passou a ter custo variável **da operação** e créditos |
| `components/finance/StructurePanel.tsx` | as duas colunas (todo mês / no período), a tabela por categoria e o formulário com item previsto |

**As duas migrações ainda NÃO foram aplicadas** — elas são aplicadas à mão no painel, nunca por
CLI, como todas as outras deste repositório. Aplicar a 03 antes da 04.

### Os quatro eixos, e por que não são um só

`category` diz **para onde** o dinheiro vai. `nature` diz **como ele se comporta** quando a
operação cresce. `kind` diz a **cadência**. `entry_type` diz o **sinal**. A mesma categoria tem as
duas naturezas — a Supabase é infraestrutura fixa, a API de IA é infraestrutura variável — e é por
isso que uma coluna só não resolveria.

**Só o fixo entra no ponto de equilíbrio.** Um custo variável cresce junto com o que os parceiros
trazem, então ele já está do outro lado, dentro da margem. Pôr as APIs de IA no denominador
pediria parceiros para pagar um custo que só existe porque os parceiros existem.

### Custo estrutural × custo de caixa

São duas leituras do mesmo mês, e a diferença entre elas é a data em que um crédito acaba:

```
monthlyFixedNetCents  = preço cheio − TODOS os créditos vigentes   → o que sai do caixa
monthlyFixedCents     = preço cheio − créditos PERMANENTES         → o que a estrutura custa
```

O **ponto de equilíbrio usa o estrutural**. Um crédito promocional que expira em três meses não é
estrutura; contar com ele diria "a operação já se paga" para uma empresa que ficaria no vermelho
no dia em que o crédito acabasse. Um crédito é permanente quando não tem `ends_at`.

---

## 2. As três divergências da planilha — decisões do operador

### 2.1 — O crédito promocional abatia a linha ERRADA

Na planilha o crédito de APIs de IA está marcado como abatimento de custo **Fixo**, mas o custo
que ele cobre é **Variável**. O efeito lá era um **custo fixo negativo em ago/2026: −R$ 164,67**,
um número que não existe.

**Corrigido no seed**: o crédito entra com `nature = 'variable'`. E `summarizeStructure` e
`summarizeMonth` ganharam piso em zero, para que nenhum cadastro futuro reproduza um fixo negativo.

### 2.2 — `Displays QR e material físico` ficaria contado DUAS VEZES

R$ 2.698,82 em ago/2026 na planilha. Esse dinheiro **já está no módulo**, em `finance.purchases`,
e de lá desce para o custo direto de cada parceiro por peça entregue:

```
Display de mesa    500 × R$ 4,150  = R$ 2.075,00
QR code (adesivo) 1050 × R$ 0,279  = R$   292,95
Envelope           100 × R$ 0,600  = R$    60,00
                                     ───────────
                                     R$ 2.427,95   + R$ 270,87 = R$ 2.698,82
```

**Ficou de fora do seed.** É a única linha preenchida que não entrou. ⚠️ A diferença de R$ 270,87
bate com frete, mas isso é inferência — **se for outra compra, ela precisa entrar em
`finance.purchases`**, não em `fixed_costs`.

### 2.3 — Três rateios mensais que não são cobranças mensais

| item | como está | como a cobrança de fato acontece |
| :-- | :-- | :-- |
| Apple Developer Program | US$ 8,25/mês | US$ 99 **por ano** |
| Google Play Console | US$ 2,08/mês | US$ 25, **taxa única de cadastro** |
| Domínios e certificados | US$ 1,16/mês | registro **anual** |

**Mantidos como o operador digitou**, com o fato real no `notes` de cada linha. Reescrevê-los como
`period_months = 12` daria o **mesmo** custo mensal e mudaria o mês em que o caixa sai — é decisão
do operador, não da migração. O Google Play, em particular, é provavelmente um `one_off` já pago.

---

## 3. O que NÃO virou cadastro, e por quê

**As 22 linhas zeradas da planilha.** Tráfego pago, freelancers, seguros, salários, FGTS,
influenciadores, feiras. Um custo de R$ 0,00 cadastrado afirma "esta conta existe e é zero"; o
fato é "esta conta ainda não existe" — a mesma diferença que este módulo defende entre `null` e
zero em todo lugar.

Elas não sumiram: estão em `COST_ITEM_HINTS`, **previstas, com categoria e natureza já decididas**.
O formulário as oferece agrupadas por categoria; escolher "Tráfego pago" já traz `marketing` +
`variable` + BRL. É a resposta à pergunta *"quais custos variáveis vamos ter?"* — ela está escrita
antes de o primeiro real ser gasto.

**Os 12 itens variáveis previstos:** APIs de IA (conteúdo e TTS), Google Maps Platform,
RevenueCat, freelancers e PJ, tráfego pago, influenciadores rev-share, displays QR, feiras e
eventos, viagens comerciais, produção de conteúdo, consultorias.

---

## 4. O que falta, em ordem de alavanca

### 4.1 — A taxa de câmbio · **FEITO na rodada 4** (ver § 6)

### 4.2 — Previsto × realizado

A planilha projeta 14 meses; o que entrou foi o **realizado de jul e ago** mais as assinaturas que
seguem vigentes. Não existe, hoje, onde guardar "o que esperamos gastar em nov/2026" sem que isso
vire um fato. A `MonthlyCascade` já separa passado de futuro por `realized`; o custo ainda não.

### 4.3 — Receita, para o P&L fechar

O módulo tem receita de parceiro (contrato) e do app (loja, em `pass_prices`). O que falta para um
P&L de verdade é o **imposto** — e é aí que `is_payroll` já está pronto: a base do fator R está
somada e publicada em `payrollMonthlyCents`. Falta o outro lado da razão (receita bruta de 12
meses) e a alíquota do anexo.

### 4.4 — Editar e encerrar pela tela

`ends_at` existe no banco e na leitura, mas **só se preenche no cadastro**. Encerrar uma assinatura
que já está lá exige abrir o banco. O `grant update` já existe em `fixed_costs`; falta a rota
`PATCH` e o botão. É o mesmo tipo de buraco que a seção 2.5 do handover anterior descreve para
Envios, e ele vai doer no dia em que a primeira assinatura for cancelada.

---

## 5. Verificação (2026-09-02)

```
npx tsc --noEmit --skipLibCheck --incremental false                          # 0 erros
npx eslint app components lib scripts tests                                  # 0 erros
npx tsx --experimental-test-module-mocks --test tests/api/finance-*.test.ts  # 208 (era 168)
```

Os 40 casos novos travam, entre outras coisas: crédito somado como custo, crédito temporário
entrando no equilíbrio, assinatura reprecificada somando com a antiga, variável no denominador do
equilíbrio, categoria lida como folha, e as duas cópias do vocabulário (CHECK do banco e
TypeScript) divergindo. E, na rodada 4: taxa futura reprecificando o passado, conversão sem taxa
declarada, cotação buscada em rede, e a Estrutura divergindo do total de Parceiros.

---

## 6. Rodada 4 — a taxa declarada (2026-09-02)

**O pedido:** *"o problema do dólar é que ele é volátil. Vamos pegar a média dos últimos meses e
previsões para poder fixar um valor médio, assim não precisamos calcular dólar todos os meses. Os
valores em dólar, euro ou outras moedas precisam ser convertidas para reais."*

### 6.1 — O que ela é

`finance.fx_rates` guarda uma **premissa de planejamento**, não uma cotação. Ela é fixa de
propósito: um custo fixo que oscila com o câmbio faz o ponto de equilíbrio oscilar junto, e um KPI
que se mexe sozinho para de ser lido.

**Não há API de câmbio no módulo, e não deve haver.** Uma taxa que muda sozinha entre duas
leituras faz dois relatórios do MESMO mês discordarem, e ninguém sabe dizer qual estava certo.
`finance-fx.test.ts` trava a ausência de `fetch` e de qualquer número de câmbio escrito no código.

**Trocar a taxa é inserir linha nova** — sem `grant update`, igual a `pass_prices`. A taxa de hoje
não reprecifica o custo de julho, e uma taxa declarada com vigência futura não vale para o passado.

### 6.2 — Como cada número foi obtido

| | dólar | euro |
| :-- | --: | --: |
| realizado, média de 6 meses (Wise, 2026-09-02) | R$ 5,1097 | R$ 5,9128 |
| projeção Focus/BCB fim de 2026 | R$ 5,20 | — |
| projeção Focus/BCB fim de 2027 | R$ 5,28 | — |
| projeção implícita (cruzamento EUR/USD de 1,1572) | — | R$ 6,0173 |
| **declarado** | **R$ 5,20** | **R$ 5,96** |

O horizonte da planilha vai de jul/2026 a ago/2027 e atravessa as duas projeções — por isso as
duas entram na média. O Focus não projeta o euro (é uma pesquisa sobre a economia brasileira), e
por isso a projeção do euro é derivada do dólar declarado mantendo o cruzamento observado.

O número do dólar é levemente **conservador** contra o realizado de hoje (5,11): numa premissa de
custo, errar para cima custa uma surpresa boa.

⚠️ **A planilha usa R$ 5,5862** — bem acima. Nos US$ 726,30 de custo do horizonte, a diferença é
de R$ 4.057,04 para R$ 3.776,76: a planilha **superestima** o custo em dólar em cerca de R$ 280.

### 6.3 — Onde a conversão entrou

| leitura | o que passou a converter |
| :-- | :-- |
| `summarizeStructure` | custo da operação, margem e mensalidade de parceiro em outra moeda |
| `summarizeMonth` / `monthlySeries` | a cascata do mês e a série inteira |
| `appRevenueByMonth` | **a receita do app** — onde o euro de fato vive |
| `summarizeFinance` | o total de Parceiros, pela MESMA taxa da Estrutura |

A receita do app é a maior mudança de leitura: dos 3 assinantes de loja ativos, 2 estão em fuso
europeu, então a linha em reais desenhava **um terço** da receita e parecia a receita inteira.
Isso derrubou a invariante *"nada aqui converte moeda"* de `app-revenue.ts` — de propósito, por
decisão do operador, e o teste foi reescrito para travar a regra nova: converter **só** pela taxa
declarada.

`summarizeFinance` entrou junto porque duas superfícies da mesma tela somando a mesma lista com
câmbios diferentes é como um total acima passa a discordar da linha abaixo. Há teste travando a
igualdade entre as duas.

### 6.4 — O que NÃO mudou

**Moeda sem taxa declarada continua fora de toda soma**, nomeada em `ignoredCurrencies`. `null` de
taxa nunca vira zero de custo. E **todo número convertido diz que foi convertido**: `appliedRates`
sobe até a tela com a taxa, a vigência e a procedência, porque um total em reais que embute
dólar a uma premissa não é o mesmo fato que um total nascido em reais.

### 6.5 — Quando revisar

Quando o realizado se afastar da premissa a ponto de mudar uma decisão — na prática, uns 5% de
desvio sustentado, ou a virada de ano com o Focus já apontando outro patamar. Revisar é uma linha:

```sql
insert into finance.fx_rates (currency, rate_to_brl, effective_from, source)
values ('USD', 5.40, '2027-01-01', 'Focus de 2026-12-15, mediana para o fim de 2027');
```

O histórico não se move: julho continua convertido pelo número que valia em julho.
