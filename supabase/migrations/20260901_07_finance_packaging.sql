-- ============================================================================
-- A EMBALAGEM — o custo que é do ENVIO, e não da peça
-- ============================================================================
-- ⚠️ APLICAR MANUALMENTE NO PAINEL (SQL Editor). NUNCA via CLI.
-- ⚠️ DEPENDE de `20260901_01_finance_schema.sql`.
--
-- O PEDIDO DO OPERADOR, 2026-09-01: *"sempre terá pelo menos 1 envelope, com limite de 50 itens.
-- 51 itens, 2 envelopes."*
--
-- POR QUE ISTO NÃO É UMA RECEITA. `finance.product_recipe` diz quanto CADA PEÇA leva junto — 1 QR
-- por display — e a conta é por peça. Um envelope não é assim: ele embala o ENVIO inteiro, e a
-- quantidade sobe em degrau. Forçá-lo na receita significaria cadastrar 1/50 = 0,02 envelope por
-- display, e então 10 displays consumiriam 0,2 envelope — um número que não existe no mundo, num
-- estoque de envelopes que nunca fecharia com o que há na gaveta.
--
--     envelopes = ceil(peças enviadas no pedido / capacidade)
--
-- O "PELO MENOS 1" NÃO PRECISA DE COLUNA. `ceil` já entrega 1 para qualquer envio de 1 a 50 itens,
-- e entrega 0 apenas quando nada foi enviado — que é a resposta certa: pedido sem saída não gasta
-- envelope. Uma coluna `minimo` seria um segundo lugar dizendo o que o teto já diz.
--
-- QUAIS PEÇAS CONTAM. As ENTREGÁVEIS — display de mesa, display de balcão, adesivo. Os
-- componentes não: o QR code viaja colado no display, não ocupa lugar no envelope.
--
-- VIGÊNCIA, pelo mesmo motivo da receita: o envelope de 50 de hoje não pode reinterpretar o envio
-- que saiu quando ele cabia 30. O custo já congelado em `material_consumption` não se mexe, e a
-- regra que valia naquele dia é a que a linha usou.
--
-- ROLLBACK (destrutivo, executado por humano, nunca por agente):
--   DROP TABLE finance.packaging_rule;
-- ============================================================================

create table if not exists finance.packaging_rule (
  id uuid primary key default gen_random_uuid(),

  -- O produto que É a embalagem. `component` no catálogo: ninguém pede um envelope na esteira.
  product_id text not null references finance.products (id) on delete restrict,

  -- Quantas peças entregues cabem em UMA embalagem. 51 itens em envelope de 50 dão 2 envelopes.
  capacity integer not null,

  effective_from date not null,
  notes text,
  created_at timestamptz not null default now(),
  created_by text,

  constraint packaging_rule_capacity_ck check (capacity > 0),
  constraint packaging_rule_unique_uk unique (product_id, effective_from)
);

comment on table finance.packaging_rule is
  'A embalagem do ENVIO: ceil(peças entregues no pedido / capacidade). Diferente de '
  'product_recipe, que é por peça — um envelope embala o pedido inteiro e sobe em degrau. '
  'Só peças ENTREGÁVEIS contam; componentes viajam colados nelas.';
comment on column finance.packaging_rule.capacity is
  'Quantas peças entregues cabem em uma embalagem. O "pelo menos 1" sai do ceil e não de uma '
  'coluna: 1 a 50 itens dão 1 envelope, e 0 item dá 0.';

alter table finance.packaging_rule enable row level security;

revoke all on finance.packaging_rule from anon, authenticated;
-- `delete` entra: isto é CADASTRO de regra, não lançamento de dinheiro. Uma regra cadastrada
-- errada não tem oposto, e o custo que ela já produziu está congelado em material_consumption.
grant select, insert, update, delete on finance.packaging_rule to service_role;


-- ────────────────────────────────────────────────────────────────────────────
-- O ENVELOPE
-- ────────────────────────────────────────────────────────────────────────────
-- O produto entra aqui e o PREÇO não: preço é fato de nota fiscal, e entra por
-- `finance.purchases` na tela. Semear um valor seria plantar um custo que ninguém conferiu.

insert into finance.products (id, name, role, material_kind, purchase_unit)
values ('envelope', 'Envelope', 'component', null, 'unidade')
on conflict (id) do nothing;

insert into finance.packaging_rule (product_id, capacity, effective_from, notes)
values ('envelope', 50, '2026-01-01', 'Operador, 2026-09-01: 1 envelope a cada 50 itens')
on conflict (product_id, effective_from) do nothing;

-- ────────────────────────────────────────────────────────────────────────────
-- CONFERÊNCIA
-- ────────────────────────────────────────────────────────────────────────────
--   select p.name, r.capacity, r.effective_from
--     from finance.packaging_rule r join finance.products p on p.id = r.product_id;
--
-- E, depois de cadastrar a compra dos envelopes na tela, um pedido de 51 itens deve lançar
-- 2 envelopes; um de 50, apenas 1.
