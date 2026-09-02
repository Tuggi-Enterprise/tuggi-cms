-- ============================================================================
-- A VISÃO GERAL — o preço declarado do passe, e as contas que não entram na conta
-- ============================================================================
-- ⚠️ APLICAR MANUALMENTE NO PAINEL (SQL Editor). NUNCA via CLI.
-- ⚠️ DEPENDE de `20260901_01_finance_schema.sql`.
--
-- Duas tabelas, dois pedidos do operador em 2026-09-02, e nenhuma delas decide nada sozinha:
-- as regras continuam no TypeScript, testadas sem banco.
--
-- ROLLBACK (destrutivo, executado por humano, nunca por agente):
--   DROP TABLE finance.excluded_accounts;
--   DROP TABLE finance.pass_prices;
-- ============================================================================


-- ────────────────────────────────────────────────────────────────────────────
-- 1. O PREÇO DECLARADO DO PASSE
-- ────────────────────────────────────────────────────────────────────────────
--
-- POR QUE ELE EXISTE AQUI, sendo que o catálogo de verdade vive noutro repositório. O ledger
-- `drive.time_credit_grants` guarda MINUTOS, e o preço de cada passe está em
-- `drive.product_grant_map`, cujo dono é outro time (BR-MONETIZACAO-048). Enquanto for assim, o
-- CMS tem duas saídas honestas: não falar de receita do app, ou falar do preço que o OPERADOR
-- declara. O operador escolheu a segunda em 2026-09-02.
--
-- E É POR ISSO QUE A COLUNA SE CHAMA `price_cents` E A TELA ESCREVE `estimativa`. Este número
-- nunca entra na cascata do mês ao lado de uma mensalidade contratada: um preço digitado e um
-- contrato assinado são fatos de qualidade diferente, e somá-los produziria um total que parece
-- apurado. Quem garante isso é `lib/finance/overview.ts`, não esta tabela.
--
-- VIGÊNCIA, PELO MESMO MOTIVO DA RECEITA E DA EMBALAGEM: o preço de hoje não pode reprecificar a
-- compra de junho. Uma alteração é uma LINHA NOVA com `effective_from` posterior — nunca um
-- UPDATE. Por isso não há `grant update` abaixo.
--
-- `product_id` NÃO REFERENCIA `finance.products`. Aquele catálogo é de material impresso — display,
-- QR, envelope. Aqui o id é o do passe no app (`drive.product_grant_map.product_id`), que este
-- banco não enxerga. Uma FK para uma tabela de outro schema que o service_role nem lê seria uma
-- promessa que ninguém pode cumprir.

create table if not exists finance.pass_prices (
  id uuid primary key default gen_random_uuid(),

  -- O id do passe como o app o conhece — o mesmo que volta em `last_purchase_product_id`.
  product_id text not null,

  -- O rótulo que o operador reconhece ("Passe 2 h"). Sem ele a tela imprimiria um UUID.
  label text not null,

  price_cents integer not null,
  currency text not null default 'BRL',

  -- Quantos minutos o passe concede. Serve para a tela conferir o preço contra o ledger, e para
  -- ninguém declarar R$ 29,90 num passe de 2 h e R$ 29,90 num de 5 h sem perceber.
  minutes integer,

  effective_from date not null,
  notes text,
  created_at timestamptz not null default now(),
  created_by text,

  constraint pass_prices_price_ck check (price_cents >= 0),
  constraint pass_prices_minutes_ck check (minutes is null or minutes > 0),
  constraint pass_prices_unique_uk unique (product_id, effective_from)
);

create index if not exists pass_prices_product_ix
  on finance.pass_prices (product_id, effective_from desc);

comment on table finance.pass_prices is
  'O preço que o OPERADOR declara para cada passe do app. O catálogo real é '
  'drive.product_grant_map, de outro repositório (BR-MONETIZACAO-048). Toda receita calculada a '
  'partir daqui é ESTIMATIVA e nunca soma com mensalidade contratada.';
comment on column finance.pass_prices.effective_from is
  'Vigência. Alterar preço é inserir linha nova, nunca UPDATE: o preço de hoje não reprecifica a '
  'compra do mês passado.';


-- ────────────────────────────────────────────────────────────────────────────
-- 2. AS CONTAS QUE NÃO ENTRAM NA CONTA
-- ────────────────────────────────────────────────────────────────────────────
--
-- O PEDIDO, 2026-09-02: *"podemos marcar usuários como testes e esses não entram na conta"*.
--
-- O QUE ELA ALCANÇA, E O QUE NÃO. Ela exclui onde o CMS conta sozinho: parceiro fora da contagem,
-- do MRR, do CAC; usuário do app fora das listas que trazem `user_id`. Os agregados que chegam
-- SOMADOS do banco (`core.dashboard_entitlement_overview`) não podem ser corrigidos aqui — para
-- esses, a marca precisa existir na origem, e a tela diz isso em vez de fingir que alcançou.
--
-- NÃO APAGA, MARCA. Uma conta que some de um número financeiro sem deixar rastro é a mesma classe
-- de defeito que `delete` numa tabela de lançamento. Desfazer é preencher `removed_at`, e a linha
-- fica — com quem marcou, quando, e por quê. Por isso há `grant update` e não há `grant delete`.
--
-- `subject_id` É TEXTO E NÃO UUID de propósito: `kind = 'client'` guarda um uuid de
-- `partner.clients`, e `kind = 'app_user'` guarda o id de um usuário do app, que este schema não
-- referencia. Uma FK que só vale para metade das linhas não é uma FK.

create table if not exists finance.excluded_accounts (
  id uuid primary key default gen_random_uuid(),

  kind text not null,
  subject_id text not null,

  -- Obrigatório: "por que esta conta não conta" é a informação, não um enfeite.
  reason text not null,

  created_at timestamptz not null default now(),
  created_by text,

  -- Desfazer é isto, e não um DELETE.
  removed_at timestamptz,
  removed_by text,

  constraint excluded_accounts_kind_ck check (kind = any (array['app_user', 'client'])),
  constraint excluded_accounts_reason_ck check (length(btrim(reason)) > 0)
);

-- Um mesmo assunto pode voltar à lista depois de ter saído dela, então a unicidade vale só
-- entre as marcas VIVAS. Índice parcial, e não constraint.
create unique index if not exists excluded_accounts_live_uk
  on finance.excluded_accounts (kind, subject_id)
  where removed_at is null;

comment on table finance.excluded_accounts is
  'Contas de teste e demonstração, fora de toda conta que o CMS faz sozinho. Alcança parceiro e '
  'usuário do app; NÃO alcança agregado que chega somado do banco — para esse, a marca tem de '
  'existir na origem. Desfazer é preencher removed_at: a linha nunca é apagada.';


-- ────────────────────────────────────────────────────────────────────────────
-- RLS E GRANTS — nada alcançável por anon/authenticated
-- ────────────────────────────────────────────────────────────────────────────

alter table finance.pass_prices enable row level security;
alter table finance.excluded_accounts enable row level security;

revoke all on finance.pass_prices from anon, authenticated;
revoke all on finance.excluded_accounts from anon, authenticated;

-- `pass_prices` é histórico de preço: insere e lê, nunca reescreve.
grant select, insert on finance.pass_prices to service_role;
-- `excluded_accounts` aceita update porque desfazer é escrever `removed_at`.
grant select, insert, update on finance.excluded_accounts to service_role;
