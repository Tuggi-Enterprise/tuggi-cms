-- ============================================================================
-- A COMPRA PASSA A CARREGAR O PRÓPRIO RENDIMENTO — "2 rolos, cada um de 150"
-- ============================================================================
-- ⚠️ APLICAR MANUALMENTE NO PAINEL (SQL Editor). NUNCA via CLI.
-- ⚠️ DEPENDE de `20260901_01_finance_schema.sql`.
--
-- O DEFEITO, MEDIDO EM 2026-09-01. `purchase_units` significava "quantas unidades de compra"
-- (quantos rolos) e o rendimento vinha do PRODUTO. O operador digitou `300` querendo dizer 300
-- adesivos; o sistema leu 300 ROLOS e multiplicou por 150. Somadas as três compras: 1.050 rolos
-- × 150 = 157.500 etiquetas, e a etiqueta passou a custar R$ 0,0017 em vez de R$ 0,26 — cento e
-- cinquenta vezes barato, sem erro nenhum aparecer na tela.
--
-- A CULPA É DO MODELO. Havia dois campos querendo o número 150 com significados diferentes, em
-- dois lugares distantes um do outro — o rendimento no cadastro do produto, a quantidade no
-- formulário da compra. Um formulário que exige essa divisão de cabeça vai ser preenchido
-- errado, e foi.
--
-- ── A CORREÇÃO, PROPOSTA PELO OPERADOR: "unidade e unitário" ────────────────────────────────
--
-- *"talvez precise ter unidade e unitario, para dizer que comprou 2 mais cada unidade rende 150"*
--
-- Os dois números passam a viver na COMPRA, lado a lado, e as peças deixam de ser uma conta que
-- alguém faz de cabeça: `pieces` é coluna gerada, `units × units_yield`. O banco calcula, e não
-- existe um segundo lugar onde o total possa divergir do que foi digitado.
--
-- O RENDIMENTO NA COMPRA, E NÃO SÓ NO PRODUTO, é a parte que corrige um defeito que ainda não
-- tinha acontecido: o rolo pode vir com 200 amanhã. Com o rendimento no produto, editá-lo
-- reinterpretaria TODAS as compras antigas — 2 rolos comprados quando o rolo tinha 150 passariam
-- a valer 400 etiquetas. É o mesmo defeito que a vigência de `product_recipe` evita, e aqui ele
-- se resolve melhor: a compra congela o rendimento do dia, porque foi o que veio na caixa.
--
-- `finance.products.units_per_purchase_unit` CONTINUA, e passa a ser o que sempre devia ter
-- sido: o valor que o formulário SUGERE. Ele deixa de decidir qualquer conta.
--
-- ── O QUE ISTO FAZ COM AS LINHAS QUE JÁ EXISTEM ────────────────────────────────────────────
--
-- Produtos de rendimento 1 (displays, adesivo) não mudam: 250 unidades × 1 = 250 peças.
--
-- As três compras de `qr_code` são reinterpretadas para a intenção de quem as digitou — o número
-- que ele escreveu era de ADESIVOS, não de rolos — e só onde a divisão fecha exata:
--
--     300 adesivos ÷ 150 = 2 rolos      (R$  78,00 = 2 × R$ 39,00)
--     300 adesivos ÷ 150 = 2 rolos      (R$  78,00 = 2 × R$ 39,00)
--     450 adesivos ÷ 150 = 3 rolos      (R$ 117,00 = 3 × R$ 39,00)
--
-- As três dividem exato E batem com os valores pagos, que é o que torna a leitura segura em vez
-- de um chute. Total: 7 rolos, 1.050 adesivos, R$ 273,00 → R$ 0,26 por etiqueta. Qualquer linha
-- que NÃO dividisse exato fica como está, e a conferência no fim deste arquivo a mostra.
--
-- SEGURA PARA RODAR DE NOVO. Cada passo é guardado, e a reinterpretação do rolo só alcança linha
-- com `units_yield = 1` — uma já convertida não é dividida por 150 uma segunda vez.
--
-- ROLLBACK:
--   ALTER TABLE finance.purchases DROP COLUMN pieces;
--   ALTER TABLE finance.purchases DROP COLUMN units_yield;
--   ALTER TABLE finance.purchases RENAME COLUMN units TO purchase_units;
--   -- e, se a reinterpretação do qr_code precisar voltar:
--   UPDATE finance.purchases SET purchase_units = purchase_units * 150 WHERE product_id = 'qr_code';
-- ============================================================================

-- ────────────────────────────────────────────────────────────────────────────
-- 1. OS DOIS NÚMEROS
-- ────────────────────────────────────────────────────────────────────────────

-- Guardado por `IF EXISTS` porque `ALTER ... RENAME` não aceita a cláusula, e este arquivo é
-- aplicado À MÃO — em produção, em homolog, e às vezes duas vezes por engano. Sem a guarda, a
-- segunda execução morre em "column purchase_units does not exist", que soa como estrago quando
-- na verdade é sucesso repetido. Aconteceu em 2026-09-01.
do $$
begin
  if exists (
    select 1 from information_schema.columns
     where table_schema = 'finance' and table_name = 'purchases' and column_name = 'purchase_units'
  ) then
    alter table finance.purchases rename column purchase_units to units;
  end if;

  if exists (
    select 1 from information_schema.table_constraints
     where table_schema = 'finance' and table_name = 'purchases'
       and constraint_name = 'purchases_units_ck'
  ) then
    alter table finance.purchases rename constraint purchases_units_ck to purchases_units_positive_ck;
  end if;
end $$;

-- Quantas peças CADA unidade comprada rende, no dia em que foi comprada. Default 1 porque a
-- esmagadora maioria dos produtos é comprada por peça — o rolo é a exceção, não a regra.
alter table finance.purchases
  add column if not exists units_yield integer not null default 1;

do $$
begin
  if not exists (
    select 1 from information_schema.table_constraints
     where table_schema = 'finance' and table_name = 'purchases'
       and constraint_name = 'purchases_units_yield_ck'
  ) then
    alter table finance.purchases
      add constraint purchases_units_yield_ck check (units_yield > 0);
  end if;
end $$;

comment on column finance.purchases.units is
  'Quantas unidades de compra entraram: 2 rolos, 250 displays. NÃO é o total de peças.';
comment on column finance.purchases.units_yield is
  'Quantas peças CADA unidade rende, congelado no dia da compra. O rolo de 150 de hoje não '
  'reinterpreta o rolo de 200 de amanhã — é a mesma razão pela qual product_recipe tem vigência. '
  'finance.products.units_per_purchase_unit apenas SUGERE este valor no formulário.';


-- ────────────────────────────────────────────────────────────────────────────
-- 2. AS COMPRAS DE ROLO, LIDAS COMO QUEM AS DIGITOU QUIS DIZER
-- ────────────────────────────────────────────────────────────────────────────
-- Antes da coluna gerada existir, porque ela vai congelar o produto destas duas.
-- Só onde a divisão fecha exata: o resto fica como está, para ninguém arredondar dinheiro.

-- `units_yield = 1` no WHERE é o que torna esta reinterpretação IRREPETÍVEL: uma linha já
-- convertida tem o rendimento do rolo gravado, e uma segunda execução dividiria 2 rolos por 150
-- de novo. E o `if exists` da coluna cobre o caso de a migration 06 já ter rodado.
do $$
begin
  if exists (
    select 1 from information_schema.columns
     where table_schema = 'finance' and table_name = 'products'
       and column_name = 'units_per_purchase_unit'
  ) then
    update finance.purchases p
       set units_yield = pr.units_per_purchase_unit,
           units = p.units / pr.units_per_purchase_unit
      from finance.products pr
     where pr.id = p.product_id
       and p.units_yield = 1
       and pr.units_per_purchase_unit > 1
       and p.units % pr.units_per_purchase_unit = 0
       and p.units >= pr.units_per_purchase_unit;
  end if;
end $$;


-- ────────────────────────────────────────────────────────────────────────────
-- 3. AS PEÇAS, CALCULADAS PELO BANCO
-- ────────────────────────────────────────────────────────────────────────────
-- Gerada, e não uma terceira coluna que alguém preenche: `units × units_yield` é uma conta com
-- uma resposta só, e uma cópia dela seria a promessa de que um dia as duas discordam.

alter table finance.purchases
  add column if not exists pieces integer
  generated always as (units * units_yield) stored;

comment on column finance.purchases.pieces is
  'units × units_yield, calculado pelo banco. É o denominador do custo por peça em '
  'lib/finance/unit-cost.ts, e o numerador do KPI de comprado-menos-consumido.';


-- ────────────────────────────────────────────────────────────────────────────
-- CONFERÊNCIA — rode depois e compare
-- ────────────────────────────────────────────────────────────────────────────
--
--   select product_id,
--          sum(units)  as unidades,
--          sum(pieces) as pecas,
--          sum(total_cents + freight_cents) as centavos,
--          round(sum(total_cents + freight_cents)::numeric / nullif(sum(pieces), 0), 4)
--            as centavos_por_peca
--     from finance.purchases
--    group by product_id
--    order by product_id;
--
-- Esperado para o qr_code: 7 unidades, 1.050 peças, 27.300 centavos, ~26 centavos por etiqueta.
--
-- ── LIMITAÇÃO CONHECIDA ────────────────────────────────────────────────────────────────────
--
-- As linhas de `finance.material_consumption` gravadas ANTES desta migration congelaram o custo
-- do QR em 0,17 centavo. Elas NÃO são reescritas: aquilo é o preço que o sistema derivou no dia,
-- e reescrever custo apurado é precisamente o que aquela tabela existe para impedir. Em
-- 2026-09-01 isso alcança um pedido só — Boteco Seu Osmar, cujo componente ficou em R$ 0,00 em
-- vez de R$ 3,04, numa conta de R$ 51,04. Se incomodar, o conserto é apagar aquelas duas linhas
-- de consumo à mão e rodar `scripts/finance-backfill-consumption.ts`, que as regrava com o preço
-- corrigido — e é um ato deliberado, não um efeito colateral desta migration.
