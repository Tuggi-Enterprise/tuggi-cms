-- ============================================================================
-- A PLANILHA FOI REVISADA — o banco acompanha
-- ============================================================================
-- ⚠️ APLICAR MANUALMENTE NO PAINEL (SQL Editor). NUNCA via CLI.
-- ⚠️ DEPENDE de `20260902_04_finance_cost_baseline.sql`.
--
-- O operador revisou `Tuggi_PL_Breakeven_12m` em 2026-09-03 e entregou a versão nova. Esta
-- migração é o diff, e nada além dele: as linhas que não aparecem aqui continuam como estavam.
--
-- POR QUE `UPDATE` E NÃO CONTRA-LANÇAMENTO. Em tabela de LEDGER, corrigir é lançar o oposto — é
-- a regra de `material_consumption`, e é por isso que ela não tem `delete`. Estas linhas são
-- outra coisa: são a transcrição de uma PREVISÃO que o operador reescreveu. A conta anual da
-- Apple nunca foi paga em doze parcelas de US$ 8,25; aquilo era um rateio que ele digitou e
-- desfez. Corrigir uma previsão é reescrevê-la, e `fixed_costs` tem `grant update` desde o
-- primeiro dia exatamente para isso.
--
-- ROLLBACK: não há um que sirva — o valor anterior era a transcrição antiga. Para reverter,
-- reaplicar `20260902_04` sobre linhas apagadas à mão. Não é operação de agente.
-- ============================================================================


-- ────────────────────────────────────────────────────────────────────────────
-- 1. OS TRÊS RATEIOS VIRAM A COBRANÇA QUE ELES SEMPRE FORAM
-- ────────────────────────────────────────────────────────────────────────────
--
-- `20260902_04` registrou Apple, Google Play e domínios como recorrentes mensais porque foi
-- assim que a planilha os trazia, e deixou o fato real escrito no `notes` de cada um: a Apple
-- cobra US$ 99 por ano, o Google Play cobra US$ 25 uma vez, o domínio se renova anualmente. O
-- operador leu aquelas notas e reescreveu a planilha. Agora as linhas concordam com a fatura.
--
-- O QUE ISSO MUDA NA LEITURA, e é mais do que parece: os três saem do CUSTO FIXO MENSAL. Um
-- desembolso datado não é conta que chega todo mês, e o ponto de equilíbrio para de pedir
-- parceiros para cobrir US$ 11,49/mês que ninguém paga por mês. Eles passam a aparecer no mês em
-- que de fato saem — jan, fev e mar de 2027.
--
-- SÃO DATAS FUTURAS, e o módulo lida com isso sozinho: `summarizeStructure` filtra o datado pela
-- janela e `summarizeMonth` o conta no mês dele. Até janeiro, estas três linhas existem no banco
-- e não entram em número nenhum — que é o comportamento certo para um desembolso que não
-- aconteceu. (A separação formal entre previsto e realizado continua sendo o card aberto §4.2 de
-- `docs/dev/financeiro-custos-da-operacao.md`.)

update finance.fixed_costs
set kind = 'one_off',
    period_months = null,
    amount_cents = 9900,
    incurred_at = '2027-01-01',
    ends_at = null,
    notes = 'Licenca anual do programa. Corrigido em 2026-09-03: estava como rateio mensal de US$ 8,25.'
where label = 'Apple Developer Program';

update finance.fixed_costs
set kind = 'one_off',
    period_months = null,
    amount_cents = 2500,
    incurred_at = '2027-02-01',
    ends_at = null,
    notes = 'Taxa unica de cadastro. Corrigido em 2026-09-03: estava como rateio mensal de US$ 2,08.'
where label = 'Google Play Console';

update finance.fixed_costs
set kind = 'one_off',
    period_months = null,
    amount_cents = 1500,
    incurred_at = '2027-03-01',
    ends_at = null,
    notes = 'Renovacao anual do registro. Corrigido em 2026-09-03: estava como rateio mensal de US$ 1,16.'
where label = 'Dominios e certificados';


-- ────────────────────────────────────────────────────────────────────────────
-- 2. OS ASSISTENTES DE IA CONTINUAM FIXOS — e a planilha é que diverge
-- ────────────────────────────────────────────────────────────────────────────
--
-- ESTA MIGRAÇÃO NÃO RECLASSIFICA NADA AQUI, e a ausência é a decisão. A planilha revisada marcou
-- "Assistentes de IA" como Variável; o banco mantém `fixed`, e o motivo precisa estar escrito
-- porque as duas fontes vão divergir até alguém corrigir a planilha.
--
-- O RACIOCÍNIO DO OPERADOR, 2026-09-03: *"ele é como um funcionário e indispensável; coloquei
-- como variável porque o valor que pagamos pode mudar dependendo da estratégia. Mas ele precisa
-- estar na conta que iremos pagar mensalmente."*
--
-- E ELE DESCREVEU UM CUSTO FIXO. "Fixo" neste eixo não quer dizer valor igual todo mês — quer
-- dizer que NÃO VARIA COM O VOLUME. O teste é este:
--
--   sem NENHUM parceiro novo no mês que vem, a conta chega igual?   sim  → fixo
--   dobrando o número de parceiros, ela dobra?                      não  → fixo
--
-- A linha vizinha responde o contrário: dobrando o catálogo, a conta de tokens de geração de POI
-- dobra. É essa a diferença que `nature` guarda.
--
-- O que ele descreveu tem nome próprio: CUSTO FIXO DISCRICIONÁRIO, em oposição ao comprometido
-- (contabilidade, domínio). A variação é por decisão, não por volume.
--
-- POR QUE ISSO NÃO É NOMENCLATURA. `nature` alimenta o ponto de equilíbrio. Um custo
-- indispensável que chega todo mês É estrutura, e as margens precisam cobri-lo. Como variável,
-- o equilíbrio pediria R$ 724/mês em vez de R$ 1.824 — menos de um terço dos parceiros que a
-- operação de fato exige. É o tipo de erro que só aparece quando o dinheiro acaba.
--
-- E O VALOR QUE VARIA JÁ ESTÁ MODELADO, sem coluna nova: base recorrente de R$ 1.100,00 mais um
-- lançamento DATADO de R$ 65,42 para o excedente de agosto. É o tratamento clássico de custo
-- misto — o que se repete é recorrente, a variação é um fato datado no mês em que aconteceu.
-- Mudança de patamar se registra encerrando a linha com `ends_at` e abrindo outra, como foi feito
-- com a Supabase de US$ 32,49 para US$ 40,99.
--
-- A nota abaixo existe para que quem ler a linha no banco encontre a divergência explicada, em
-- vez de "corrigi-la" de volta para variável por achar que o banco está atrasado em relação à
-- planilha.

update finance.fixed_costs
set notes = 'Custo fixo DISCRICIONARIO: o valor muda por decisao, nunca por volume - sem parceiro '
            'novo a conta chega igual. A planilha de 2026-09-03 marca Variavel; o banco mantem '
            'fixo de proposito (ver a migracao 20260903_01). A variacao de valor entra como '
            'lancamento datado, e a mudanca de patamar como ends_at + linha nova.'
where label = 'Assistentes de IA (Claude, ChatGPT, Cursor)'
  and nature = 'fixed';


-- ────────────────────────────────────────────────────────────────────────────
-- 3. O CRÉDITO GANHA O NOME DA CONTA QUE ELE ABATE
-- ────────────────────────────────────────────────────────────────────────────
--
-- `20260902_04` avisou que o rótulo era inferido: a planilha ainda trazia o texto de exemplo
-- "(ex.: crédito promocional Google Cloud)", e ficou registrado que o emissor precisava ser
-- confirmado. Na revisão o operador nomeou a linha pelo custo que ela cobre. É melhor assim —
-- crédito e custo passam a ler como par, e `entry_type` é quem os distingue.

update finance.fixed_costs
set label = 'APIs de IA - geracao de conteudo de POI',
    notes = 'Credito temporario que cobre a conta de geracao de POI real por real. Nomeado pelo operador em 2026-09-03.'
where label = 'Credito promocional - APIs de IA'
  and entry_type = 'credit';


-- ────────────────────────────────────────────────────────────────────────────
-- 4. O CRÉDITO DE TEXT-TO-SPEECH, QUE NÃO EXISTIA
-- ────────────────────────────────────────────────────────────────────────────
--
-- Linha nova na revisão: a conta de TTS também é coberta por crédito, nos dois meses.
--
-- ⚠️ E AQUI O BANCO DIVERGE DA PLANILHA DE PROPÓSITO — CONFERIR. Na planilha, o valor de julho
-- está digitado como `62,30`, com VÍRGULA, e a célula virou TEXTO: ela não entra em soma
-- nenhuma. Por isso o total de descontos de lá é R$ 3.935,66 quando a intenção somava
-- R$ 3.997,96, e julho aparece com R$ 62,30 de crédito a menos do que o operador quis lançar.
--
-- O valor bate real a real com o custo de TTS de julho (R$ 62,30), e o de agosto bate com o de
-- agosto (R$ 390,01) — a intenção é inequívoca: o crédito cobre os dois meses inteiros. As duas
-- linhas entram aqui. Se a intenção era outra, é a linha de julho que sai.

insert into finance.fixed_costs (
  label, category, nature, kind, amount_cents, currency,
  incurred_at, period_months, ends_at, entry_type, is_payroll, notes, created_by
)
select
  v.label, v.category, v.nature, v.kind, v.amount_cents, v.currency,
  v.incurred_at, v.period_months, v.ends_at, v.entry_type, v.is_payroll, v.notes,
  'migration:20260903_01'
from (
  values
    (
      'APIs de IA - text-to-speech / audio'::text, 'infrastructure'::text, 'variable'::text,
      'one_off'::text, 6230::integer, 'BRL'::text, '2026-07-01'::date, null::integer,
      null::date, 'credit'::text, false::boolean,
      'Credito temporario de TTS. Na planilha julho esta como texto (62,30 com virgula) e nao soma la; o valor bate com o custo de TTS de julho.'::text
    ),
    (
      'APIs de IA - text-to-speech / audio', 'infrastructure', 'variable',
      'one_off', 39001, 'BRL', '2026-08-01', null,
      null, 'credit', false,
      'Credito temporario de TTS.'
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


-- ────────────────────────────────────────────────────────────────────────────
-- 5. O QUE CONTINUA FORA, E CONTINUA SENDO DE PROPÓSITO
-- ────────────────────────────────────────────────────────────────────────────
--
-- `Displays QR e material fisico` (R$ 2.698,82 em ago/2026) segue na planilha e segue fora daqui.
-- Esse dinheiro já está em `finance.purchases` e desce para o custo direto de cada parceiro por
-- peça entregue; lançá-lo também como custo da operação contaria a mesma compra duas vezes — uma
-- na margem do parceiro, outra na estrutura. A conta que mostra isso está em `20260902_04`.
