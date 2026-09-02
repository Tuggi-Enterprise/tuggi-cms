-- ============================================================================
-- O RENDIMENTO SAI DO PRODUTO — ele não decide mais nada, e um campo assim é armadilha
-- ============================================================================
-- ⚠️ APLICAR MANUALMENTE NO PAINEL (SQL Editor). NUNCA via CLI.
-- ⚠️ DEPENDE de `20260901_05_finance_purchase_pieces.sql` — é ela que move o rendimento para a
--    compra. Aplicar esta antes daquela apaga o número sem ter para onde levá-lo.
--
-- POR QUE ELE SAI. Desde a 05 o rendimento vive na COMPRA (`purchases.units_yield`, congelado no
-- dia) e `finance.purchases.pieces` é coluna gerada. `products.units_per_purchase_unit` deixou de
-- participar de qualquer conta: sobrou como sugestão de formulário.
--
-- E SUGESTÃO ELE É UMA RUIM. Ele aparecia na tela do catálogo, editável, na coluna ao lado de
-- "Custo por peça" — parecendo decidir o custo. Não decidia. Um número que não decide nada mas se
-- apresenta como se decidisse é a mesma armadilha que fez 300 adesivos virarem 45.000, só que
-- mais discreta: alguém edita 150 ali esperando o custo mudar, e nada acontece.
--
-- O QUE SUBSTITUI. O formulário passa a sugerir o rendimento da ÚLTIMA COMPRA daquele produto.
-- É melhor que um cadastro por dois motivos: nunca envelhece — se o rolo vier com 200, a primeira
-- compra já ensina o formulário — e não existe um segundo lugar para alguém manter atualizado.
-- Produto sem compra nenhuma sugere 1, que é o caso da esmagadora maioria.
--
-- DADO QUE NINGUÉM LÊ É O ESPELHO DE CÓDIGO QUE NINGUÉM CHAMA (CLAUDE.md §6): ele afirma que o
-- produto sabe algo que ele não sabe mais. Por isso a coluna sai em vez de ficar comentada como
-- obsoleta — obsoleto que permanece é lido por alguém, um dia.
--
-- NADA SE PERDE. O rendimento de toda compra já existente foi gravado em `purchases.units_yield`
-- pela migration 05.
--
-- ROLLBACK (o valor volta da compra mais recente de cada produto):
--   ALTER TABLE finance.products
--     ADD COLUMN units_per_purchase_unit integer NOT NULL DEFAULT 1
--     CHECK (units_per_purchase_unit > 0);
--   UPDATE finance.products p SET units_per_purchase_unit = last_buy.units_yield
--     FROM (SELECT DISTINCT ON (product_id) product_id, units_yield
--             FROM finance.purchases ORDER BY product_id, purchased_at DESC) last_buy
--    WHERE last_buy.product_id = p.id;
-- ============================================================================

alter table finance.products drop column if exists units_per_purchase_unit;

comment on table finance.products is
  'O catálogo: o que existe, o que é entregável e o que é componente. NÃO guarda rendimento — '
  'ele é fato da COMPRA (purchases.units_yield), congelado no dia, porque o rolo de 150 de hoje '
  'não pode reinterpretar o rolo de 200 de amanhã. O formulário sugere o da última compra.';
