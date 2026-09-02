-- ============================================================================
-- A PLANILHA DO OPERADOR ENTRA NO BANCO — custos de jul/2026 e ago/2026
-- ============================================================================
-- ⚠️ APLICAR MANUALMENTE NO PAINEL (SQL Editor). NUNCA via CLI.
-- ⚠️ DEPENDE de `20260902_03_finance_cost_taxonomy.sql`.
--
-- A FONTE. `Tuggi_PL_Breakeven_12m — Custos`, mantida pelo operador e entregue em 2026-09-02.
-- Ela projeta jul/2026 a ago/2027; os valores PREENCHIDOS são de julho e agosto de 2026, e as
-- colunas seguintes repetem as assinaturas — que aqui não são doze linhas, são uma linha
-- `recurring`, que é o que "repetir todo mês" significa neste schema.
--
-- ────────────────────────────────────────────────────────────────────────────────────────────
-- O QUE FOI TRADUZIDO, E O QUE FOI DEIXADO DE FORA — leia antes de conferir totais
-- ────────────────────────────────────────────────────────────────────────────────────────────
--
-- 1. LINHAS ZERADAS NÃO VIRARAM CADASTRO. A planilha lista 38 itens de custo e 22 deles estão em
--    branco (tráfego pago, freelancers, seguros, salários…). Um custo de R$ 0,00 cadastrado
--    afirma "esta conta existe e é zero"; o fato é "esta conta ainda não existe", e a diferença é
--    a mesma que este módulo defende entre `null` e zero em todo lugar. Eles não sumiram: estão
--    em `COST_ITEM_HINTS` (`lib/finance/cost-taxonomy.ts`), previstos, com categoria e natureza
--    já decididas, prontos para o dia em que tiverem valor.
--
-- 2. `Displays QR e material físico` (R$ 2.698,82 em ago/2026) FICOU DE FORA DE PROPÓSITO, e é a
--    única omissão de valor preenchido. Esse dinheiro JÁ ESTÁ NO MÓDULO, em `finance.purchases`,
--    e de lá desce para o custo direto de cada parceiro por peça entregue:
--
--        Display de mesa    500 × R$ 4,150  = R$ 2.075,00
--        QR code (adesivo) 1050 × R$ 0,279  = R$   292,95
--        Envelope           100 × R$ 0,600  = R$    60,00
--                                             ───────────
--                                             R$ 2.427,95  (+ R$ 270,87 de frete = R$ 2.698,82)
--
--    Lançá-lo TAMBÉM como custo da operação contaria a mesma compra duas vezes: uma na margem do
--    parceiro, outra na estrutura. ⚠️ CONFERIR: a diferença de R$ 270,87 bate com frete, mas isso
--    é inferência — se for outra compra, ela precisa entrar em `finance.purchases`, não aqui.
--
-- 3. A DATA É O PRIMEIRO DIA DO MÊS DE COMPETÊNCIA. A planilha é mensal e não tem dia; inventar o
--    dia 15 seria inventar. Para `recurring`, `incurred_at` é o mês em que a linha PASSA A VALER
--    nesta leitura — não necessariamente o dia em que o contrato foi assinado.
--
-- 4. OS RATEIOS MENSAIS FORAM MANTIDOS COMO O OPERADOR OS DIGITOU, com a cobrança real no `notes`.
--    Apple Developer (US$ 8,25/mês = US$ 99/ano), Google Play (US$ 2,08/mês = a taxa única de
--    US$ 25) e domínios (US$ 1,16/mês) são rateios, não cobranças mensais. Reescrevê-los como
--    `period_months = 12` daria o MESMO custo mensal e mudaria o mês em que o caixa sai — uma
--    decisão do operador, não desta migração. O `notes` guarda o fato para quando ele decidir.
--
-- 5. ⚠️ DIVERGÊNCIA CORRIGIDA, e vale conferir. Na planilha o crédito promocional está marcado
--    como abatimento de custo FIXO, mas o custo que ele cobre (APIs de IA) é VARIÁVEL. Lá isso
--    produzia um custo fixo NEGATIVO em ago/2026 (−R$ 164,67), que é um número que não existe.
--    Aqui o crédito entra com `nature = 'variable'`, abatendo o custo que ele de fato abate.
--
-- 6. MOEDA NÃO SE CONVERTE, e por isso os totais desta base NÃO batem com a coluna "TOTAL em R$"
--    da planilha. Ela converte USD a R$ 5,5862; o módulo guarda cada linha na moeda em que a
--    conta chega e devolve as outras nomeadas em `ignoredCurrencies` (`lib/finance/structure.ts`).
--    São US$ 52,48/mês fora do fixo em reais — declarar uma taxa de câmbio é a próxima decisão,
--    e ela é do operador.
--
-- RE-EXECUTÁVEL: cada linha só entra se não houver outra com o mesmo (label, incurred_at,
-- currency, entry_type). `created_by` marca a procedência — estas linhas vieram da planilha, não
-- de alguém digitando na tela.
--
-- ROLLBACK (destrutivo, executado por humano, nunca por agente):
--   DELETE FROM finance.fixed_costs WHERE created_by = 'migration:20260902_04';
-- ============================================================================

insert into finance.fixed_costs (
  label, category, nature, kind, amount_cents, currency,
  incurred_at, period_months, ends_at, entry_type, is_payroll, notes, created_by
)
select
  v.label, v.category, v.nature, v.kind, v.amount_cents, v.currency,
  v.incurred_at, v.period_months, v.ends_at, v.entry_type, v.is_payroll, v.notes,
  'migration:20260902_04'
from (
  values
    -- ── ASSINATURAS E CONTAS QUE VOLTAM TODO MÊS ──────────────────────────────────────────
    --
    -- A Supabase são DUAS linhas porque o preço mudou, e é para isso que `ends_at` existe: sem
    -- ela, US$ 32,49 e US$ 40,99 somariam US$ 73,48 por mês, para sempre.
    (
      'Supabase (banco + auth + storage)'::text, 'infrastructure'::text, 'fixed'::text,
      'recurring'::text, 3249::integer, 'USD'::text, '2026-07-01'::date, 1::integer,
      '2026-07-31'::date, 'cost'::text, false::boolean,
      'Preco de julho/2026. Reprecificado para US$ 40,99 a partir de agosto.'::text
    ),
    (
      'Supabase (banco + auth + storage)', 'infrastructure', 'fixed',
      'recurring', 4099, 'USD', '2026-08-01', 1,
      null, 'cost', false,
      'Plano vigente desde agosto/2026.'
    ),
    (
      'Apple Developer Program', 'infrastructure', 'fixed',
      'recurring', 825, 'USD', '2026-07-01', 1,
      null, 'cost', false,
      'Rateio mensal informado pelo operador. A cobranca real e anual: US$ 99/ano.'
    ),
    (
      'Google Play Console', 'infrastructure', 'fixed',
      'recurring', 208, 'USD', '2026-07-01', 1,
      null, 'cost', false,
      'Rateio mensal informado pelo operador. A taxa real e unica: US$ 25 no cadastro.'
    ),
    (
      'Dominios e certificados', 'infrastructure', 'fixed',
      'recurring', 116, 'USD', '2026-07-01', 1,
      null, 'cost', false,
      'Rateio mensal informado pelo operador. O registro e anual.'
    ),
    (
      'Google Workspace / e-mail', 'infrastructure', 'fixed',
      'recurring', 8180, 'BRL', '2026-07-01', 1,
      null, 'cost', false,
      null
    ),
    (
      'Assistentes de IA (Claude, ChatGPT, Cursor)', 'tools', 'fixed',
      'recurring', 110000, 'BRL', '2026-07-01', 1,
      null, 'cost', false,
      null
    ),
    (
      'Contabilidade', 'admin', 'fixed',
      'recurring', 42900, 'BRL', '2026-07-01', 1,
      null, 'cost', false,
      null
    ),

    -- ── DESEMBOLSO FIXO DATADO ────────────────────────────────────────────────────────────
    --
    -- Agosto veio R$ 65,42 acima da assinatura. Somar isso ao `recurring` faria o mês de
    -- setembro herdar um excedente que foi de agosto; uma linha `one_off` diz o que houve.
    (
      'Assistentes de IA - excedente de agosto/2026', 'tools', 'fixed',
      'one_off', 6542, 'BRL', '2026-08-01', null,
      null, 'cost', false,
      'Diferenca entre os R$ 1.165,42 lancados em agosto e a assinatura de R$ 1.100,00.'
    ),

    -- ── CUSTO VARIÁVEL DA OPERAÇÃO ────────────────────────────────────────────────────────
    --
    -- Cobrado por token gerado: um catálogo com o dobro de POIs custa o dobro. Não é do parceiro
    -- (não desce para a margem de ninguém) e não é fixo (não chega igual todo mês) — é a terceira
    -- coisa, e é por ela que `nature` existe.
    (
      'APIs de IA - geracao de conteudo de POI', 'infrastructure', 'variable',
      'one_off', 141158, 'BRL', '2026-07-01', null,
      null, 'cost', false,
      null
    ),
    (
      'APIs de IA - geracao de conteudo de POI', 'infrastructure', 'variable',
      'one_off', 213407, 'BRL', '2026-08-01', null,
      null, 'cost', false,
      null
    ),
    (
      'APIs de IA - text-to-speech / audio', 'infrastructure', 'variable',
      'one_off', 6230, 'BRL', '2026-07-01', null,
      null, 'cost', false,
      null
    ),
    (
      'APIs de IA - text-to-speech / audio', 'infrastructure', 'variable',
      'one_off', 39001, 'BRL', '2026-08-01', null,
      null, 'cost', false,
      null
    ),
    (
      'Viagens comerciais e diarias', 'marketing', 'variable',
      'one_off', 87000, 'BRL', '2026-08-01', null,
      null, 'cost', false,
      null
    ),

    -- ── O QUE NÃO SAIU DO CAIXA ───────────────────────────────────────────────────────────
    --
    -- O crédito cobre a conta de geração de POI real por real, nos dois meses. Sem estas duas
    -- linhas o CMS afirmaria um desembolso de R$ 3.545,65 que não aconteceu; sem elas marcadas
    -- como `credit`, a soma crua dobraria o custo em vez de zerá-lo.
    --
    -- ⚠️ O RÓTULO É INFERIDO. Na planilha esta linha ainda tem o texto de exemplo
    -- "(ex.: crédito promocional Google Cloud)" — o operador preencheu os valores e não trocou o
    -- nome. O valor bate real a real com a geração de POI. Confirmar o emissor.
    --
    -- SEM `ends_at`: um crédito `one_off` já é temporário por não se repetir. `ends_at` num
    -- crédito serve para o RECORRENTE — é lá que "temporário ou permanente" muda o custo
    -- estrutural, e nenhum destes dois é recorrente.
    (
      'Credito promocional - APIs de IA', 'infrastructure', 'variable',
      'one_off', 141158, 'BRL', '2026-07-01', null,
      null, 'credit', false,
      'Rotulo herdado da linha de exemplo da planilha (Google Cloud). Confirmar o emissor.'
    ),
    (
      'Credito promocional - APIs de IA', 'infrastructure', 'variable',
      'one_off', 213407, 'BRL', '2026-08-01', null,
      null, 'credit', false,
      'Rotulo herdado da linha de exemplo da planilha (Google Cloud). Confirmar o emissor.'
    )
) as v (
  label, category, nature, kind, amount_cents, currency,
  incurred_at, period_months, ends_at, entry_type, is_payroll, notes
)
where not exists (
  select 1
  from finance.fixed_costs f
  where f.label = v.label
    and f.incurred_at = v.incurred_at
    and f.currency = v.currency
    and f.entry_type = v.entry_type
);
