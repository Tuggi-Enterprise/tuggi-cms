-- ============================================================================
-- OS PRIMEIROS PREÇOS — o que o operador passou em 2026-09-01
-- ============================================================================
-- ⚠️ APLICAR MANUALMENTE NO PAINEL (SQL Editor). NUNCA via CLI.
-- ⚠️ DEPENDE de `20260901_01_finance_schema.sql`.
--
-- O QUE ELE DISSE, LITERALMENTE:
--   · display de mesa    — R$ 1.000,00 por 250 unidades
--   · display de balcão  — R$ 1.000,00 por 250 unidades
--   · rolo de adesivos de QR code — R$ 38,00, rolo com 150 adesivos
--   · 1 adesivo por display
--
-- O QUE ISSO VIRA, E A CONTA NÃO ESTÁ AQUI. Não existe coluna de preço unitário em lugar nenhum
-- deste schema: o custo por peça é DERIVADO em `lib/finance/unit-cost.ts`, a partir do valor da
-- compra e do rendimento do produto. Para conferência, o que ele vai devolver:
--
--   display de mesa    100.000 ÷ (250 × 1)   =   400 centavos  = R$ 4,00 por display
--   display de balcão  100.000 ÷ (250 × 1)   =   400 centavos  = R$ 4,00 por display
--   QR code              3.800 ÷ (  1 × 150) = 25,33 centavos  = R$ 0,2533 por etiqueta
--
--   um display entregue, com a etiqueta que ele leva = 425 centavos ≈ R$ 4,25
--
-- A FRAÇÃO DE CENTAVO DO QR É DE PROPÓSITO. 3.800 ÷ 150 não fecha em centavo inteiro, e
-- `unit-cost.ts` devolve o valor exato: quem arredonda é a LINHA de consumo, uma vez, depois de
-- multiplicar pela quantidade. Arredondar a etiqueta para 25 centavos erraria 50 centavos a cada
-- 150 displays — pouco, e errado de um jeito que ninguém acharia depois.
--
-- ── A ÚNICA COISA QUE EU ESCOLHI, E ELA É SUA PARA CORRIGIR ────────────────────────────────
--
-- `purchased_at = 2026-01-01`. O operador não passou as datas das notas, e a data NÃO altera o
-- custo unitário: com uma compra por produto, `(total + frete) ÷ peças` dá o mesmo número em
-- qualquer dia. O que ela decide é QUAIS pedidos podem ser custeados — `unitCost` só considera
-- compras com `purchased_at <= ` o dia em que o pedido saiu.
--
-- Escolhi uma data anterior a tudo para que `scripts/finance-backfill-consumption.ts` consiga
-- custear os pedidos que já estão em `dispatched`/`fulfilled`. Uma data de hoje deixaria todos
-- eles sem preço, e a tela leria "Custo incompleto" em cada parceiro que já recebeu material.
-- Quando as notas aparecerem, corrija com um UPDATE; o custo unitário não se mexe.
--
-- ── O ADESIVO DA ESTEIRA CONTINUA SEM PREÇO, E ISSO É CORRETO ──────────────────────────────
--
-- `MATERIAL_KINDS` tem `sticker` (adesivo) como peça que o parceiro PEDE, e o produto `adesivo`
-- existe no catálogo desde a migration anterior. O "rolo de adesivos" desta lista NÃO é ele: é o
-- QR code, que é componente e vai colado no display. Enquanto ninguém comprar `adesivo`, um
-- pedido dele entra sem preço e a tela diz "Custo incompleto" — que é a verdade.
--
-- ROLLBACK:
--   DELETE FROM finance.purchases WHERE invoice_ref = 'seed-2026-09-01';
--   DELETE FROM finance.product_recipe WHERE effective_from = '2026-01-01';
--   UPDATE finance.products SET purchase_unit = 'bobina', units_per_purchase_unit = 1
--     WHERE id = 'qr_code';
-- ============================================================================

-- ────────────────────────────────────────────────────────────────────────────
-- 1. O RENDIMENTO DO ROLO — 1 rolo entrega 150 etiquetas
-- ────────────────────────────────────────────────────────────────────────────
-- `rolo` e não `bobina`: é a palavra que o operador usou, e `purchase_unit` é rótulo de nota
-- fiscal — nenhuma regra depende do texto, só o operador lê.

update finance.products
   set purchase_unit = 'rolo',
       units_per_purchase_unit = 150,
       name = 'QR code (adesivo)'
 where id = 'qr_code';

-- ────────────────────────────────────────────────────────────────────────────
-- 2. A RECEITA — 1 etiqueta por display, nos dois tipos
-- ────────────────────────────────────────────────────────────────────────────
-- Com vigência de 2026-01-01 pelo mesmo motivo da data da compra: o backfill precisa alcançar os
-- pedidos que já saíram. Se um dia o display passar a levar 2, cadastre uma vigência NOVA — a
-- antiga fica, e é ela que explica quanto o display custava antes.

insert into finance.product_recipe
  (parent_product_id, component_product_id, quantity, effective_from, notes)
values
  ('display_mesa',   'qr_code', 1, '2026-01-01', 'Operador, 2026-09-01: 1 adesivo por display'),
  ('display_balcao', 'qr_code', 1, '2026-01-01', 'Operador, 2026-09-01: 1 adesivo por display')
on conflict (parent_product_id, component_product_id, effective_from) do nothing;

-- ────────────────────────────────────────────────────────────────────────────
-- 3. AS COMPRAS
-- ────────────────────────────────────────────────────────────────────────────
-- `invoice_ref = 'seed-2026-09-01'` é o que torna estas três linhas reconhecíveis e o rollback
-- possível. Não é número de nota, e não finge ser: quando a nota real chegar, ela substitui.

insert into finance.purchases
  (product_id, purchase_units, total_cents, freight_cents, currency, purchased_at, invoice_ref, notes)
select * from (values
  ('display_mesa',   250, 100000, 0, 'BRL', date '2026-01-01', 'seed-2026-09-01',
   'Operador, 2026-09-01: R$ 1.000,00 por 250 unidades. Data estimada — ver cabeçalho.'),
  ('display_balcao', 250, 100000, 0, 'BRL', date '2026-01-01', 'seed-2026-09-01',
   'Operador, 2026-09-01: R$ 1.000,00 por 250 unidades. Data estimada — ver cabeçalho.'),
  ('qr_code',          1,   3800, 0, 'BRL', date '2026-01-01', 'seed-2026-09-01',
   'Operador, 2026-09-01: rolo de R$ 38,00 com 150 adesivos. Data estimada — ver cabeçalho.')
) as seed(product_id, purchase_units, total_cents, freight_cents, currency, purchased_at, invoice_ref, notes)
-- Idempotente: rodar de novo não duplica a compra, e uma compra duplicada mudaria a média
-- ponderada sem ninguém perceber.
where not exists (
  select 1 from finance.purchases p
   where p.product_id = seed.product_id
     and p.invoice_ref = 'seed-2026-09-01'
);

-- ────────────────────────────────────────────────────────────────────────────
-- CONFERÊNCIA — rode depois e compare com o cabeçalho
-- ────────────────────────────────────────────────────────────────────────────
--
--   select p.id,
--          p.units_per_purchase_unit as rendimento,
--          sum(c.total_cents + c.freight_cents) as gasto_centavos,
--          sum(c.purchase_units * p.units_per_purchase_unit) as pecas,
--          round(
--            sum(c.total_cents + c.freight_cents)::numeric
--            / nullif(sum(c.purchase_units * p.units_per_purchase_unit), 0),
--            4
--          ) as centavos_por_peca
--     from finance.products p
--     join finance.purchases c on c.product_id = p.id
--    group by p.id, p.units_per_purchase_unit
--    order by p.id;
--
-- Esperado: display_balcao 400 · display_mesa 400 · qr_code 25,3333
