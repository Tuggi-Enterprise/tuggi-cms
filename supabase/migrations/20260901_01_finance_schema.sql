-- ============================================================================
-- O SCHEMA `finance` — o custo do parceiro, que até hoje não existia em lugar nenhum
-- ============================================================================
-- ⚠️ APLICAR MANUALMENTE NO PAINEL (SQL Editor). NUNCA via CLI (regra do projeto).
--
-- POR QUE EXISTE. O CMS sabia quanto um parceiro PAGA (`partner.clients.monthly_fee_cents`) e
-- quantas peças ele PEDIU (`partner.material_orders`), e as duas contas nunca se encontravam:
-- não havia produto, preço, compra nem fornecedor no repositório inteiro.
-- `summarizeMaterialQueue` conta unidades e nunca dinheiro. A pergunta "este parceiro se paga?"
-- não tinha resposta, e um parceiro que só dá prejuízo era indistinguível de um que se paga em
-- três meses.
--
-- O CUSTO FIXO NÃO MORA JUNTO DO CUSTO DO CLIENTE, e isso é a decisão estrutural deste schema.
-- A impressora de etiquetas não fica mais barata se cortarmos um parceiro, então rateá-la por
-- cliente produziria um número que não serve para decidir sobre nenhum cliente. `fixed_costs` é
-- uma tabela à parte, sem `client_id`, de propósito — ela cobre na camada MC II
-- (`lib/finance/structure.ts`) e nunca desce para a linha do parceiro. Quem quiser o número
-- simbólico de impressão tem `standard_rates`, que a tela mostra AO LADO do custo direto e nunca
-- somado dentro dele.
--
-- O RENDIMENTO É PROPRIEDADE DO PRODUTO, NÃO REGRA DA BOBINA. `products.units_per_purchase_unit`
-- diz quantas peças utilizáveis uma unidade comprada rende: 1 bobina rende N etiquetas de QR, e
-- uma caixa de 50 displays rende 50 displays. Uma coluna resolve os dois casos, e o custo
-- unitário deixa de ser digitado — ele é derivado da compra, que é o único fato que alguém tem
-- em mãos (a nota fiscal).
--
-- O GRAFO DA ESTEIRA NÃO ESTÁ AQUI. Qual status consome custo (`dispatched`, `fulfilled`, e
-- `cancelled` nunca) é decisão de `lib/finance/consumption.ts` e chega ao banco como argumento
-- da RPC. Repetir a regra num trigger seria a segunda cópia da mesma decisão — SSOT antes de
-- DRY, o mesmo motivo pelo qual `MATERIAL_TRANSITIONS` não virou CHECK em
-- `20260826_04_material_order_pipeline.sql`.
--
-- SEM POLÍTICA DE RLS E SÓ `service_role`, igual a `partner.partner_contracts` e
-- `partner.client_conferences`: nada aqui é alcançável por `anon` nem por `authenticated`, e o
-- CMS chega por rota autenticada com o cliente de serviço. `delete` não entra no grant de
-- nenhuma tabela de lançamento — corrigir um lançamento é lançar o oposto, não apagar a linha.
--
-- ROLLBACK (destrutivo, executado por humano, nunca por agente):
--   DROP SCHEMA finance CASCADE;
-- ============================================================================

create schema if not exists finance;

revoke all on schema finance from anon, authenticated;
grant usage on schema finance to service_role;

comment on schema finance is
  'Custo e rentabilidade do parceiro. Custo direto por cliente vive em material_consumption e '
  'client_cost_entries; custo de estrutura vive em fixed_costs e NUNCA desce para o cliente.';


-- ────────────────────────────────────────────────────────────────────────────
-- 1. O CATÁLOGO
-- ────────────────────────────────────────────────────────────────────────────
--
-- `role` separa o que o parceiro PEDE do que a peça CONSOME, e a separação é o que torna o QR
-- code custeável: ninguém pede um QR code na esteira, mas todo display leva alguns.
--
-- `material_kind` é o ponteiro para o vocabulário que já existe (`MATERIAL_KINDS` em
-- `lib/partner-form/fields.ts`, e o CHECK de `partner.material_order_items`). Ele é único e
-- nulável: único porque dois produtos disputando o mesmo tipo de material tornariam o custo de
-- um pedido ambíguo; nulável porque um `component` não é pedido por ninguém.

create table if not exists finance.products (
  id text primary key,
  name text not null,

  -- `deliverable` vai para o parceiro e aparece na esteira; `component` é consumido por um
  -- deliverable através de `product_recipe` e nunca é pedido.
  role text not null,

  -- Liga o produto ao tipo que a esteira já conhece. Só para `deliverable`.
  material_kind text,

  -- Como o produto é COMPRADO — 'unidade', 'bobina', 'caixa'. Texto livre de propósito: é
  -- rótulo de nota fiscal, não vocabulário do qual alguma regra dependa.
  purchase_unit text not null default 'unidade',

  -- O RENDIMENTO. Quantas peças utilizáveis uma unidade comprada entrega.
  units_per_purchase_unit integer not null default 1,

  is_active boolean not null default true,
  notes text,
  created_at timestamptz not null default now(),
  created_by text,

  constraint products_role_ck check (role = any (array['deliverable', 'component'])),
  constraint products_material_kind_ck check (
    material_kind is null
    or material_kind = any (array['sticker', 'table_display', 'counter_display'])
  ),
  -- Um `component` não é pedido, então não pode reivindicar um tipo da esteira.
  constraint products_component_has_no_kind_ck check (
    role = 'deliverable' or material_kind is null
  ),
  constraint products_yield_ck check (units_per_purchase_unit > 0)
);

-- Único e parcial: dois produtos apontando para `table_display` tornariam o custo de um pedido
-- de display de mesa ambíguo, e a ambiguidade só apareceria depois, num total errado.
create unique index if not exists products_material_kind_uk
  on finance.products (material_kind)
  where material_kind is not null;

comment on table finance.products is
  'O catálogo. `units_per_purchase_unit` é o rendimento: 1 bobina rende N etiquetas de QR, '
  'uma caixa rende N displays. O custo unitário é DERIVADO da compra, nunca digitado.';
comment on column finance.products.material_kind is
  'Ponteiro para MATERIAL_KINDS (lib/partner-form/fields.ts). Único: dois produtos no mesmo '
  'tipo tornariam o custo de um pedido ambíguo. Nulo em todo `component`.';


-- ────────────────────────────────────────────────────────────────────────────
-- 2. A RECEITA — quantos componentes cada entregável leva
-- ────────────────────────────────────────────────────────────────────────────
--
-- COM VIGÊNCIA, e essa é a coluna que impede o defeito caro: mudar de 2 para 3 QR por display
-- não pode reescrever o custo do que já saiu pela porta. A linha de consumo congela o que valeu
-- no dia; esta tabela guarda o que passou a valer depois.

create table if not exists finance.product_recipe (
  id uuid primary key default gen_random_uuid(),
  parent_product_id text not null references finance.products (id) on delete cascade,
  component_product_id text not null references finance.products (id) on delete restrict,
  quantity numeric(12, 4) not null,
  effective_from date not null,
  notes text,
  created_at timestamptz not null default now(),
  created_by text,

  constraint product_recipe_quantity_ck check (quantity > 0),
  constraint product_recipe_not_self_ck check (parent_product_id <> component_product_id),
  constraint product_recipe_unique_uk unique (parent_product_id, component_product_id, effective_from)
);

comment on table finance.product_recipe is
  'Quantos componentes um entregável leva, com vigência. A vigência existe para que mudar a '
  'receita nunca reescreva o custo de um pedido que já foi consumido.';


-- ────────────────────────────────────────────────────────────────────────────
-- 3. O AJUSTE DO PEDIDO — quando um envio fugiu do padrão
-- ────────────────────────────────────────────────────────────────────────────
--
-- `quantity >= 0` e não `> 0`: zero é uma resposta legítima aqui — "este lote de displays saiu
-- sem QR" — e é diferente de não haver override. A ausência da linha diz "use o padrão".

create table if not exists finance.order_recipe_override (
  order_id uuid not null references partner.material_orders (id) on delete cascade,
  parent_product_id text not null references finance.products (id) on delete cascade,
  component_product_id text not null references finance.products (id) on delete cascade,
  quantity numeric(12, 4) not null,
  notes text,
  created_at timestamptz not null default now(),
  created_by text,

  primary key (order_id, parent_product_id, component_product_id),
  constraint order_recipe_override_quantity_ck check (quantity >= 0)
);

comment on table finance.order_recipe_override is
  'O envio que fugiu do padrão. Ausência da linha significa "use a receita vigente"; zero '
  'significa "saiu sem componente" — dois fatos diferentes que um default zero fundiria.';


-- ────────────────────────────────────────────────────────────────────────────
-- 4. A COMPRA
-- ────────────────────────────────────────────────────────────────────────────
--
-- `currency` por linha e NUNCA convertida. Há parceiros com NIF/NIPC/VAT no cadastro, então uma
-- compra em EUR é questão de tempo; guardar a moeda custa uma coluna, e inventar uma taxa de
-- câmbio custa um histórico que muda toda vez que alguém atualiza a taxa.

create table if not exists finance.purchases (
  id uuid primary key default gen_random_uuid(),
  product_id text not null references finance.products (id) on delete restrict,

  -- Quantas UNIDADES DE COMPRA (2 bobinas), não quantas peças. As peças saem do rendimento.
  purchase_units integer not null,

  total_cents integer not null,
  freight_cents integer not null default 0,
  currency text not null default 'BRL',
  purchased_at date not null,

  supplier text,
  invoice_ref text,
  notes text,
  created_at timestamptz not null default now(),
  created_by text,

  constraint purchases_units_ck check (purchase_units > 0),
  constraint purchases_total_ck check (total_cents >= 0),
  constraint purchases_freight_ck check (freight_cents >= 0)
);

create index if not exists purchases_product_date_ix
  on finance.purchases (product_id, purchased_at);

comment on table finance.purchases is
  'A compra, em unidades de compra. O custo por peça é derivado com o rendimento do produto e '
  'calculado em lib/finance/unit-cost.ts — não há coluna de preço unitário, de propósito.';


-- ────────────────────────────────────────────────────────────────────────────
-- 5. A TAXA PADRÃO — o valor simbólico de impressão
-- ────────────────────────────────────────────────────────────────────────────
--
-- Isto é `standard costing`, e ele existe para dar um número à impressora sem rateá-la. Vive
-- numa tabela própria e chega à linha de consumo numa coluna própria (`standard_cost_cents`),
-- nunca somado dentro de `unit_cost_cents` — a tela mostra os dois lado a lado, e um teste
-- (`finance-profitability.test.ts`) garante que ele nunca entra no custo direto.

create table if not exists finance.standard_rates (
  id uuid primary key default gen_random_uuid(),
  rate_id text not null,
  applies_to text not null references finance.products (id) on delete cascade,
  amount_cents integer not null,
  currency text not null default 'BRL',
  effective_from date not null,
  notes text,
  created_at timestamptz not null default now(),
  created_by text,

  constraint standard_rates_amount_ck check (amount_cents >= 0),
  constraint standard_rates_unique_uk unique (rate_id, effective_from)
);

comment on table finance.standard_rates is
  'Custo padrão por peça produzida (ex.: R$ 0,10 por QR impresso). Chega à linha de consumo em '
  'coluna separada e nunca entra no custo direto — é o que permite usar o número simbólico sem '
  'perder o número marginal.';


-- ────────────────────────────────────────────────────────────────────────────
-- 6. O CUSTO FIXO — a impressora, e tudo que não é do cliente
-- ────────────────────────────────────────────────────────────────────────────
--
-- SEM `client_id`, E ISSO É A TABELA INTEIRA. A impressora não fica mais barata se cortarmos um
-- parceiro; um rateio dela por cliente produziria um número que não serve para decidir sobre
-- nenhum cliente. Ela cobre na camada MC II, contra a soma das margens, e o KPI que ela alimenta
-- é o ponto de equilíbrio: quantos parceiros pagantes cobrem a estrutura.

create table if not exists finance.fixed_costs (
  id uuid primary key default gen_random_uuid(),
  label text not null,

  -- `one_off` é a impressora comprada uma vez; `recurring` é a assinatura que volta.
  kind text not null,

  amount_cents integer not null,
  currency text not null default 'BRL',
  incurred_at date not null,

  -- Só para `recurring`: a cada quantos meses o valor volta. Nulo em `one_off`.
  period_months integer,

  notes text,
  created_at timestamptz not null default now(),
  created_by text,

  constraint fixed_costs_kind_ck check (kind = any (array['one_off', 'recurring'])),
  constraint fixed_costs_amount_ck check (amount_cents >= 0),
  constraint fixed_costs_period_ck check (
    (kind = 'recurring' and period_months is not null and period_months > 0)
    or (kind = 'one_off' and period_months is null)
  )
);

comment on table finance.fixed_costs is
  'Custo de estrutura. NÃO tem client_id de propósito: rateá-lo por cliente produziria um '
  'número que não serve para decidir sobre cliente nenhum. Cobre na camada MC II.';


-- ────────────────────────────────────────────────────────────────────────────
-- 7. O CONSUMO — a saída, com o custo congelado
-- ────────────────────────────────────────────────────────────────────────────
--
-- UMA LINHA POR (PEDIDO, PRODUTO), e o `unique` é onde a idempotência mora: a esteira pode
-- passar por `dispatched` e depois `fulfilled`, e o custo é gasto uma vez só. A RPC escreve com
-- `on conflict do nothing`, então a segunda transição não duplica nada e também não falha.
--
-- `unit_cost_cents` É NULÁVEL, e nulo NÃO é zero. Um pedido consumido antes de a compra ser
-- cadastrada entra sem preço e a tela o conta como pendência, do mesmo jeito que
-- `pendingWithoutDestination` conta o pedido sem endereço. Somar zero ali seria transformar
-- "não sei o custo" em "não custou nada" — a linha mais barata do módulo e a mais mentirosa.
--
-- `components` É SNAPSHOT, NÃO CONSULTA. Guarda qual receita valeu e a que custo unitário, para
-- a linha continuar auditável depois de a receita mudar. É o único jsonb do schema, e ele é
-- congelado: nada aqui é lido por dentro em WHERE nenhum.

create table if not exists finance.material_consumption (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references partner.material_orders (id) on delete cascade,
  client_id uuid not null references partner.clients (id) on delete cascade,
  product_id text not null references finance.products (id) on delete restrict,

  quantity integer not null,

  unit_cost_cents integer,
  component_cost_cents integer not null default 0,
  standard_cost_cents integer not null default 0,
  components jsonb not null default '[]'::jsonb,
  currency text not null default 'BRL',

  -- Separa custo de crescimento de custo de retrabalho. A esteira trata reposição como um
  -- pedido novo indistinguível de uma primeira entrega; aqui os dois se separam.
  reason text not null default 'first_delivery',

  consumed_at timestamptz not null default now(),
  consumed_status text not null,
  created_by text,

  constraint material_consumption_quantity_ck check (quantity > 0),
  constraint material_consumption_unit_cost_ck check (unit_cost_cents is null or unit_cost_cents >= 0),
  constraint material_consumption_component_cost_ck check (component_cost_cents >= 0),
  constraint material_consumption_standard_cost_ck check (standard_cost_cents >= 0),
  constraint material_consumption_reason_ck check (
    reason = any (array['first_delivery', 'replacement', 'loss', 'gift'])
  ),
  constraint material_consumption_status_ck check (
    consumed_status = any (array['dispatched', 'fulfilled'])
  ),
  constraint material_consumption_order_product_uk unique (order_id, product_id)
);

create index if not exists material_consumption_client_ix
  on finance.material_consumption (client_id, consumed_at);

comment on table finance.material_consumption is
  'A saída de material, com o custo congelado no dia. unit_cost_cents NULO significa "consumido '
  'antes de existir compra com preço" e a tela conta como pendência — nunca como zero.';
comment on column finance.material_consumption.components is
  'Snapshot congelado da receita que valeu e do custo unitário de cada componente. Auditoria, '
  'nunca consulta: nenhum WHERE lê por dentro dele.';


-- ────────────────────────────────────────────────────────────────────────────
-- 8. O CUSTO AVULSO DO CLIENTE
-- ────────────────────────────────────────────────────────────────────────────
--
-- O que é do cliente mas não é unidade de material: frete extra, brinde, uma feira. Entra no
-- custo direto e portanto na margem — diferente de `fixed_costs`, que é da estrutura.

create table if not exists finance.client_cost_entries (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references partner.clients (id) on delete cascade,
  label text not null,
  amount_cents integer not null,
  currency text not null default 'BRL',
  incurred_at date not null,
  notes text,
  created_at timestamptz not null default now(),
  created_by text,

  constraint client_cost_entries_amount_ck check (amount_cents >= 0)
);

create index if not exists client_cost_entries_client_ix
  on finance.client_cost_entries (client_id, incurred_at);

comment on table finance.client_cost_entries is
  'Custo do cliente que não é unidade de material (frete extra, brinde, feira). Entra na margem '
  'do parceiro — ao contrário de fixed_costs, que é estrutura e não desce para o cliente.';


-- ────────────────────────────────────────────────────────────────────────────
-- RLS E GRANTS — nada alcançável por anon/authenticated
-- ────────────────────────────────────────────────────────────────────────────

alter table finance.products enable row level security;
alter table finance.product_recipe enable row level security;
alter table finance.order_recipe_override enable row level security;
alter table finance.purchases enable row level security;
alter table finance.standard_rates enable row level security;
alter table finance.fixed_costs enable row level security;
alter table finance.material_consumption enable row level security;
alter table finance.client_cost_entries enable row level security;

revoke all on all tables in schema finance from anon, authenticated;

-- `delete` fica de fora de toda tabela de LANÇAMENTO: corrigir um lançamento é lançar o oposto,
-- não apagar a linha. Catálogo, receita e override aceitam `delete` porque são cadastro, não
-- histórico — e o consumo já congelou o que precisava sobreviver a eles.
grant select, insert, update, delete on finance.products to service_role;
grant select, insert, update, delete on finance.product_recipe to service_role;
grant select, insert, update, delete on finance.order_recipe_override to service_role;
grant select, insert, update on finance.purchases to service_role;
grant select, insert, update on finance.standard_rates to service_role;
grant select, insert, update on finance.fixed_costs to service_role;
grant select, insert, update on finance.material_consumption to service_role;
grant select, insert, update on finance.client_cost_entries to service_role;


-- ────────────────────────────────────────────────────────────────────────────
-- A RPC DE CONSUMO — as linhas de um pedido entram num ato só
-- ────────────────────────────────────────────────────────────────────────────
--
-- EXISTE PELO MESMO MOTIVO DE `partner.create_material_order`: PostgREST não dá transação entre
-- duas requisições, e um pedido de três produtos não pode virar custo pela metade porque a rede
-- caiu no meio.
--
-- O QUE ELA NÃO DECIDE: quais status consomem, qual receita valeu, qual o custo unitário. Tudo
-- isso chega pronto em `p_lines`, decidido por `lib/finance/consumption.ts`. A função é o ato
-- atômico, não a regra — a regra tem um dono só, e ele está no TypeScript, testado sem banco.
--
-- DEVOLVE QUANTAS LINHAS REALMENTE ENTRARAM. Zero é a resposta honesta para "este pedido já
-- tinha sido consumido", e é o que deixa a chamada ser repetida sem medo.

create or replace function finance.record_material_consumption(
  p_order_id uuid,
  p_client_id uuid,
  p_status text,
  p_lines jsonb,
  p_created_by text default null
)
returns integer
language plpgsql
security definer
set search_path = finance, partner, public
as $$
declare
  v_inserted integer;
begin
  if p_lines is null or jsonb_typeof(p_lines) <> 'array' or jsonb_array_length(p_lines) = 0 then
    return 0;
  end if;

  insert into finance.material_consumption (
    order_id, client_id, product_id, quantity,
    unit_cost_cents, component_cost_cents, standard_cost_cents,
    components, currency, reason, consumed_status, created_by
  )
  select
    p_order_id,
    p_client_id,
    line ->> 'product_id',
    (line ->> 'quantity')::integer,
    nullif(line ->> 'unit_cost_cents', '')::integer,
    coalesce((line ->> 'component_cost_cents')::integer, 0),
    coalesce((line ->> 'standard_cost_cents')::integer, 0),
    coalesce(line -> 'components', '[]'::jsonb),
    coalesce(line ->> 'currency', 'BRL'),
    coalesce(line ->> 'reason', 'first_delivery'),
    p_status,
    p_created_by
  from jsonb_array_elements(p_lines) as line
  on conflict (order_id, product_id) do nothing;

  get diagnostics v_inserted = row_count;
  return v_inserted;
end;
$$;

revoke all on function finance.record_material_consumption(uuid, uuid, text, jsonb, text)
  from anon, authenticated, public;
grant execute on function finance.record_material_consumption(uuid, uuid, text, jsonb, text)
  to service_role;

comment on function finance.record_material_consumption(uuid, uuid, text, jsonb, text) is
  'Grava as linhas de custo de UM pedido num ato só. Não decide nada: status, receita e custo '
  'chegam prontos de lib/finance/consumption.ts. Devolve quantas linhas entraram — zero '
  'significa que o pedido já havia sido consumido, e é por isso que repetir a chamada é seguro.';


-- ────────────────────────────────────────────────────────────────────────────
-- SEED DO CATÁLOGO
-- ────────────────────────────────────────────────────────────────────────────
--
-- Os três entregáveis que a esteira já conhece, mais o QR code. Os RENDIMENTOS e os PREÇOS não
-- estão aqui: rendimento de bobina e valor de compra são fato do operador, e entram por
-- `finance.purchases` na tela — inventar um número aqui seria plantar um custo falso que ninguém
-- lembraria de conferir. `units_per_purchase_unit` fica em 1 e o operador corrige o do QR code
-- quando cadastrar a primeira bobina.

insert into finance.products (id, name, role, material_kind, purchase_unit, units_per_purchase_unit)
values
  ('display_mesa',   'Display de mesa',   'deliverable', 'table_display',   'unidade', 1),
  ('display_balcao', 'Display de balcão', 'deliverable', 'counter_display', 'unidade', 1),
  ('adesivo',        'Adesivo',           'deliverable', 'sticker',         'unidade', 1),
  ('qr_code',        'QR code',           'component',   null,              'bobina',  1)
on conflict (id) do nothing;
