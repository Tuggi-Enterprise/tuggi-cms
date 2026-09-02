-- ============================================================================
-- QUANTO REALMENTE SAIU — a quantidade enviada, que não é a pedida
-- ============================================================================
-- ⚠️ APLICAR MANUALMENTE NO PAINEL (SQL Editor). NUNCA via CLI.
-- ⚠️ DEPENDE de `20260901_01_finance_schema.sql`.
--
-- POR QUE EXISTE. Até 2026-09-01 o custo era calculado sobre
-- `partner.material_order_items.quantity`, que é o que o PARCEIRO PEDIU. O operador apontou o
-- erro em uma frase: *"não é pq um parceiro pediu 40 displays, que enviamos os 40"*. Um custo
-- montado sobre o pedido superestima todo parceiro que recebeu menos do que pediu — e
-- superestima justamente na direção que faz uma parceria parecer cara.
--
-- O PEDIDO NÃO É CORRIGIDO, E ISSO É DELIBERADO. `material_order_items.quantity` continua sendo
-- o que o parceiro pediu, porque é isso que ele pediu; a esteira responde a "quanto imprimir" e
-- essa pergunta é sobre a demanda. O que saiu é OUTRO fato, com outro dono, e por isso mora aqui
-- em vez de sobrescrever aquela coluna. Ler os dois lado a lado é o que mostra a diferença.
--
-- AUSÊNCIA NÃO É ZERO E NÃO É "O PEDIDO". Um pedido despachado sem linha aqui NÃO vira custo:
-- ele aparece como pendência na tela do financeiro até alguém dizer quanto saiu. Assumir o
-- pedido seria repetir exatamente o erro que esta tabela existe para corrigir, e assumir zero
-- diria que o parceiro não custou nada. `quantity = 0` é resposta legítima e diferente das duas:
-- significa que desse item não saiu nada.
--
-- CORRIGIR A QUANTIDADE É PERMITIDO; CORRIGIR O CUSTO UNITÁRIO NÃO. O custo por peça fica
-- congelado na linha de consumo no dia em que ela nasce (`finance.material_consumption`), porque
-- é o preço que valia. A QUANTIDADE é um fato apurado por uma pessoa, e pessoas contam errado —
-- então ela pode ser corrigida, e o total é recalculado com o custo congelado.
--
-- ROLLBACK (destrutivo, executado por humano, nunca por agente):
--   DROP TABLE finance.order_shipment;
-- ============================================================================

create table if not exists finance.order_shipment (
  order_id uuid not null references partner.material_orders (id) on delete cascade,
  product_id text not null references finance.products (id) on delete restrict,

  -- Peças que de fato saíram. Zero é resposta: "deste item não foi nada".
  quantity integer not null,

  -- O que o pedido dizia no dia em que alguém informou o envio. Cópia, e de propósito: é o que
  -- permite ler "pediu 40, saíram 25" meses depois sem depender de a esteira não ter mudado.
  requested_quantity integer,

  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by text,

  primary key (order_id, product_id),
  constraint order_shipment_quantity_ck check (quantity >= 0),
  constraint order_shipment_requested_ck check (requested_quantity is null or requested_quantity >= 0)
);

create index if not exists order_shipment_product_ix
  on finance.order_shipment (product_id);

comment on table finance.order_shipment is
  'Quanto de cada produto REALMENTE saiu num pedido. Diferente de '
  'partner.material_order_items.quantity, que é o que o parceiro pediu. Ausência de linha '
  'significa "ninguém informou ainda" e impede o custo — nunca é lida como zero nem como o pedido.';
comment on column finance.order_shipment.quantity is
  'Peças enviadas. Zero é uma resposta legítima e diferente da ausência da linha.';
comment on column finance.order_shipment.requested_quantity is
  'O que o pedido dizia quando o envio foi informado. Cópia congelada, para a comparação '
  '"pediu X, saiu Y" sobreviver a qualquer mudança posterior na esteira.';

alter table finance.order_shipment enable row level security;

revoke all on finance.order_shipment from anon, authenticated;
-- `delete` entra aqui, ao contrário das tabelas de lançamento: isto é CADASTRO de um fato
-- apurado, não um lançamento de dinheiro. Apagar uma linha devolve o pedido à pendência, que é
-- a resposta certa para "informei o pedido errado".
grant select, insert, update, delete on finance.order_shipment to service_role;
