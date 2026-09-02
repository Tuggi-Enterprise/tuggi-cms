-- ============================================================================
-- A TAXA DECLARADA — o dólar é volátil, o custo da operação não pode ser
-- ============================================================================
-- ⚠️ APLICAR MANUALMENTE NO PAINEL (SQL Editor). NUNCA via CLI.
-- ⚠️ DEPENDE de `20260901_01_finance_schema.sql`.
--
-- O PEDIDO, 2026-09-02: *"o problema do dólar é que ele é volátil. Vamos pegar a média dos
-- últimos meses e previsões para poder fixar um valor médio, assim não precisamos calcular dólar
-- todos os meses."*
--
-- O QUE ESTA TABELA É, E O QUE ELA NÃO É. Ela é uma PREMISSA DE PLANEJAMENTO, não uma cotação.
-- Uma cotação responde "quanto custa comprar dólar agora"; esta taxa responde "com que número a
-- empresa planeja". Ela é fixa de propósito: se o custo fixo mensal mudasse toda vez que o câmbio
-- se mexesse, o ponto de equilíbrio mudaria junto — e um KPI que oscila sozinho para de ser lido.
--
-- POR ISSO NÃO HÁ API DE CÂMBIO NESTE MÓDULO, e não deve haver. Uma taxa que muda sozinha entre
-- duas leituras faz dois relatórios do MESMO mês discordarem, e ninguém sabe dizer qual dos dois
-- estava certo. Aqui a taxa é uma linha digitada, com a procedência escrita ao lado.
--
-- TROCAR A TAXA É INSERIR LINHA NOVA — o mesmo desenho de `pass_prices` e `standard_rates`, e por
-- isso NÃO HÁ `grant update`. A taxa de hoje não pode reprecificar o custo de julho: se em janeiro
-- alguém declarar R$ 5,40, a conta da Supabase de julho continua convertida pelo número que valia
-- em julho. O histórico não se move porque a premissa de hoje mudou.
--
-- ROLLBACK (destrutivo, executado por humano, nunca por agente):
--   DROP TABLE finance.fx_rates;
-- ============================================================================


create table if not exists finance.fx_rates (
  id uuid primary key default gen_random_uuid(),

  -- A moeda de ORIGEM. `BRL` é recusado: ela é a base, e uma taxa de real para real seria uma
  -- linha que nenhuma leitura consulta e que alguém acabaria editando para 1,05.
  currency text not null,

  -- Quantos REAIS vale UMA unidade da moeda. 5.200000 = US$ 1,00 vale R$ 5,20.
  --
  -- `numeric` E NÃO INTEIRO DE CENTAVOS, porque taxa não é dinheiro: ela multiplica dinheiro. Seis
  -- casas cobrem a precisão que qualquer fonte publica, e `numeric` não tem o erro binário que
  -- faria 5.1097 virar 5.109699999 depois de mil multiplicações.
  rate_to_brl numeric(14, 6) not null,

  effective_from date not null,

  -- OBRIGATÓRIO. Uma taxa sem procedência é um chute com cara de fato, e daqui a seis meses
  -- ninguém vai lembrar se 5,20 veio do Focus, do extrato do cartão ou de um palpite.
  source text not null,

  notes text,
  created_at timestamptz not null default now(),
  created_by text,

  constraint fx_rates_currency_ck check (currency ~ '^[A-Z]{3}$' and currency <> 'BRL'),
  constraint fx_rates_rate_ck check (rate_to_brl > 0),
  constraint fx_rates_source_ck check (length(btrim(source)) > 0),
  constraint fx_rates_unique_uk unique (currency, effective_from)
);

create index if not exists fx_rates_currency_ix
  on finance.fx_rates (currency, effective_from desc);

comment on table finance.fx_rates is
  'Taxa de câmbio DECLARADA pelo operador — premissa de planejamento, não cotação de mercado. '
  'Fixa de propósito: um custo fixo que oscila com o câmbio faz o ponto de equilíbrio oscilar '
  'junto. Trocar é inserir linha nova; a taxa de hoje não reprecifica o mês passado.';
comment on column finance.fx_rates.rate_to_brl is
  'Quantos reais vale UMA unidade da moeda. 5.200000 = US$ 1,00 vale R$ 5,20.';
comment on column finance.fx_rates.source is
  'De onde o número veio. Obrigatório: uma taxa sem procedência é um chute com cara de fato.';


-- ────────────────────────────────────────────────────────────────────────────
-- RLS E GRANTS — nada alcançável por anon/authenticated
-- ────────────────────────────────────────────────────────────────────────────

alter table finance.fx_rates enable row level security;
revoke all on finance.fx_rates from anon, authenticated;

-- Sem `update` e sem `delete`: histórico de taxa se corrige com linha nova, igual a pass_prices.
grant select, insert on finance.fx_rates to service_role;


-- ────────────────────────────────────────────────────────────────────────────
-- AS TAXAS DECLARADAS EM 2026-09-02 — como cada número foi obtido
-- ────────────────────────────────────────────────────────────────────────────
--
-- ⚠️ SÃO PREMISSAS, E O OPERADOR É O DONO DELAS. Estão aqui com a conta aberta justamente para
-- ele poder discordar do método, não só do resultado.
--
-- DÓLAR — R$ 5,20
--
--   realizado, média dos últimos 6 meses (Wise, em 2026-09-02) .... R$ 5,1097
--   projeção Focus/BCB para o fim de 2026 ......................... R$ 5,20
--   projeção Focus/BCB para o fim de 2027 ......................... R$ 5,28
--                                                                   ─────────
--   média dos três .................................................R$ 5,1966  →  R$ 5,20
--
--   O horizonte da planilha vai de jul/2026 a ago/2027, então ela atravessa as duas projeções —
--   e por isso as duas entram na média, não só a do ano corrente. O número final coincide com a
--   mediana do próprio Focus para 2026, o que é conveniente e não é o motivo: se as três pontas
--   dessem 5,17, o valor declarado seria 5,17.
--
--   Ele é levemente CONSERVADOR contra o realizado de hoje (5,11), e isso é intencional: numa
--   premissa de custo, errar para cima custa uma surpresa boa e errar para baixo custa uma ruim.
--
-- EURO — R$ 5,96
--
--   realizado, média dos últimos 6 meses (Wise, em 2026-09-02) .... R$ 5,9128
--   projeção implícita, mantendo o cruzamento EUR/USD de 1,1572
--   sobre o dólar declarado de R$ 5,20 ............................ R$ 6,0173
--                                                                   ─────────
--   média das duas ................................................ R$ 5,9650  →  R$ 5,96
--
--   O Focus NÃO projeta o euro — ele é uma pesquisa sobre a economia brasileira. Por isso a
--   projeção do euro é derivada: mantém-se o cruzamento EUR/USD observado e aplica-se o dólar
--   já declarado. É a forma padrão de carregar uma projeção de dólar para outra moeda, e está
--   escrita aqui porque uma premissa derivada de outra premissa merece ser dita.
--
--   O EURO IMPORTA MAIS DO QUE PARECE: dos 3 assinantes de loja ativos em 2026-09-02, 2 estão em
--   fuso europeu (ver `20260902_02_finance_prices_by_currency.sql`). A receita do app é onde o
--   euro entra, não o custo.
--
-- ⚠️ A PLANILHA DO OPERADOR USA R$ 5,5862, bem acima destes números. Nos custos em dólar da
-- planilha (US$ 726,30 no horizonte de 14 meses) a diferença é de R$ 4.057,04 para R$ 3.776,76 —
-- R$ 280 a menos. A planilha superestima o custo em dólar; nada aqui foi ajustado para bater com
-- ela, porque bater com a planilha não é o objetivo — estar certo é.
--
-- A VIGÊNCIA COMEÇA EM 2026-01-01, e não hoje. Uma taxa média fixa vale para o LIVRO INTEIRO: se
-- ela começasse em setembro, os custos de julho e agosto que já estão cadastrados ficariam sem
-- taxa e sairiam de toda soma em reais — exatamente o problema que ela veio resolver.
--
-- Re-executável: `on conflict do nothing` sobre (currency, effective_from).

insert into finance.fx_rates (currency, rate_to_brl, effective_from, source, notes, created_by)
values
  (
    'USD', 5.200000, '2026-01-01',
    'Media entre o realizado de 6 meses (Wise, 5,1097) e as projecoes Focus/BCB para 2026 (5,20) e 2027 (5,28)',
    'Premissa de planejamento declarada pelo operador. Levemente conservadora contra o realizado de 5,11.',
    'migration:20260902_05'
  ),
  (
    'EUR', 5.960000, '2026-01-01',
    'Media entre o realizado de 6 meses (Wise, 5,9128) e a projecao implicita pelo cruzamento EUR/USD de 1,1572 sobre o dolar declarado (6,0173)',
    'O Focus nao projeta o euro. A projecao e derivada do dolar declarado mantendo o cruzamento observado.',
    'migration:20260902_05'
  )
on conflict do nothing;
