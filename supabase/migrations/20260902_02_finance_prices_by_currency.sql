-- ============================================================================
-- O PREÇO É POR MOEDA — e o catálogo declarado do app entra
-- ============================================================================
-- ⚠️ APLICAR MANUALMENTE NO PAINEL (SQL Editor). NUNCA via CLI.
-- ⚠️ DEPENDE de `20260902_01_finance_overview.sql`.
--
-- POR QUE A UNICIDADE MUDA. `finance.pass_prices` nasceu com
-- `unique (product_id, effective_from)`, o que só admite UM preço por produto por data. Mas o
-- mesmo passe custa **R$ 9,99, US$ 2,99 e € 2,99** no mesmo dia — e a moeda é de quem compra, não
-- da empresa: quem assina na Play Store em Roma é cobrado em euro pela loja. Com a chave antiga,
-- declarar a segunda moeda era um 23505.
--
-- MEDIDO EM 2026-09-02, e é o que torna isto urgente: dos 3 assinantes de loja ativos, **2 estão
-- em fuso europeu** e 1 em São Paulo. Um número único em reais superestimaria a receita do app em
-- quase dois terços dela.
--
-- `kind` SEPARA O QUE VOLTA DO QUE NÃO VOLTA. Um passe é receita de uma vez; uma assinatura é
-- receita recorrente. Sem a coluna, somar os dois daria um "mensal" que inclui compra avulsa.
--
-- ROLLBACK (destrutivo, executado por humano, nunca por agente):
--   ALTER TABLE finance.pass_prices DROP COLUMN kind;
--   DROP INDEX finance.pass_prices_unique_uk;
-- ============================================================================


-- ────────────────────────────────────────────────────────────────────────────
-- 1. A MOEDA ENTRA NA CHAVE
-- ────────────────────────────────────────────────────────────────────────────

alter table finance.pass_prices
  drop constraint if exists pass_prices_unique_uk;

create unique index if not exists pass_prices_unique_uk
  on finance.pass_prices (product_id, currency, effective_from);


-- ────────────────────────────────────────────────────────────────────────────
-- 2. PASSE E ASSINATURA SÃO COISAS DIFERENTES
-- ────────────────────────────────────────────────────────────────────────────

alter table finance.pass_prices
  add column if not exists kind text not null default 'pass';

alter table finance.pass_prices
  drop constraint if exists pass_prices_kind_ck;

alter table finance.pass_prices
  add constraint pass_prices_kind_ck check (kind = any (array['pass', 'subscription']));

comment on column finance.pass_prices.kind is
  'pass = compra de uma vez (créditos de hora). subscription = ciclo de 30 dias da loja. Somar '
  'os dois num "mensal" incluiria compra avulsa na receita recorrente.';
comment on column finance.pass_prices.currency is
  'A moeda de QUEM COMPRA. O mesmo produto tem três preços no mesmo dia, e a loja cobra na moeda '
  'do comprador — por isso ela entra na chave de unicidade.';


-- ────────────────────────────────────────────────────────────────────────────
-- 3. O CATÁLOGO DECLARADO — preços do operador, 2026-09-02
-- ────────────────────────────────────────────────────────────────────────────
--
-- OS IDS SÃO OS DE PRODUÇÃO, não inventados aqui: `tuggi_hours_10` e `tuggi_hours_45` foram lidos
-- de `core.dashboard_metered_users.last_purchase_product_id` em 2026-09-02 (3 compras do primeiro,
-- 1 do segundo). `tuggi_hours_25` entra pela lista do operador e ainda não apareceu em compra
-- nenhuma — se o id real for outro, ele volta em `unpricedProducts` na tela, nomeado.
--
-- ⚠️ DIVERGÊNCIA A CONFERIR: o operador informou o passe de **40 horas** a R$ 29,99, e o produto
-- que aparece nas compras é `tuggi_hours_45`. O preço abaixo foi lançado no id REAL. Se forem
-- produtos diferentes, falta declarar o de 40.
--
-- ⚠️ A FAIXA `pro` FICOU SEM PREÇO: o operador declarou um valor de assinatura (R$ 49,99), e há
-- duas faixas ativas em `drive.subscription_tiers` (`premium` e `pro`). O preço abaixo foi lançado
-- em `premium`, que é onde estão os 3 assinantes de loja. `pro` tem 1 assinante, de `admin`, que
-- não conta como receita por decisão do operador.
--
-- Re-executável: `on conflict do nothing` sobre a chave (product_id, currency, effective_from).

insert into finance.pass_prices (product_id, label, price_cents, currency, minutes, kind, effective_from, notes)
values
  -- Passes de crédito, por hora comprada.
  ('tuggi_hours_10', 'Passe 10 horas',  999, 'BRL',  600, 'pass', '2026-09-02', 'Declarado pelo operador'),
  ('tuggi_hours_10', 'Passe 10 horas',  299, 'USD',  600, 'pass', '2026-09-02', 'Declarado pelo operador'),
  ('tuggi_hours_10', 'Passe 10 horas',  299, 'EUR',  600, 'pass', '2026-09-02', 'Declarado pelo operador'),

  ('tuggi_hours_25', 'Passe 25 horas', 1999, 'BRL', 1500, 'pass', '2026-09-02', 'Declarado pelo operador; id ainda nao visto em compra'),
  ('tuggi_hours_25', 'Passe 25 horas',  499, 'USD', 1500, 'pass', '2026-09-02', 'Declarado pelo operador; id ainda nao visto em compra'),
  ('tuggi_hours_25', 'Passe 25 horas',  499, 'EUR', 1500, 'pass', '2026-09-02', 'Declarado pelo operador; id ainda nao visto em compra'),

  ('tuggi_hours_45', 'Passe 45 horas', 2999, 'BRL', 2700, 'pass', '2026-09-02', 'Operador informou 40 h; id de producao e 45 h — conferir'),
  ('tuggi_hours_45', 'Passe 45 horas',  999, 'USD', 2700, 'pass', '2026-09-02', 'Operador informou 40 h; id de producao e 45 h — conferir'),
  ('tuggi_hours_45', 'Passe 45 horas',  999, 'EUR', 2700, 'pass', '2026-09-02', 'Operador informou 40 h; id de producao e 45 h — conferir'),

  -- A assinatura. O id é o NOME DA FAIXA em `drive.subscription_tiers`, e não o id da loja:
  -- `com.tuggi.premium.monthly` e `premium_monthly` são o mesmo produto em duas lojas, e a
  -- receita é a mesma. Declarar por loja duplicaria o preço e convidaria a somar os dois.
  ('premium', 'Assinatura Premium · 30 dias', 4999, 'BRL', null, 'subscription', '2026-09-02', 'Ciclo de 30 dias, nao mes civil'),
  ('premium', 'Assinatura Premium · 30 dias', 1999, 'USD', null, 'subscription', '2026-09-02', 'Ciclo de 30 dias, nao mes civil'),
  ('premium', 'Assinatura Premium · 30 dias', 1999, 'EUR', null, 'subscription', '2026-09-02', 'Ciclo de 30 dias, nao mes civil')
on conflict do nothing;
