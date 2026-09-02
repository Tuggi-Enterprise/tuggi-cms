-- ============================================================================
-- A COMPRA PASSA A SER CORRIGÍVEL — e por que ela é diferente de um lançamento
-- ============================================================================
-- ⚠️ APLICAR MANUALMENTE NO PAINEL (SQL Editor). NUNCA via CLI.
-- ⚠️ DEPENDE de `20260901_01_finance_schema.sql`.
--
-- O QUE EU TINHA ESCRITO, E ESTAVA ERRADO PARA ESTA TABELA. A migration 01 negou `delete` a
-- todas as tabelas de `finance` com um argumento só: *"corrigir um lançamento é lançar o oposto,
-- não apagar a linha"*. Esse argumento é bom, e é sobre LANÇAMENTO — uma linha de custo já
-- apurada contra um parceiro, que alguém leu e usou para decidir. Apagá-la faz o total daquele
-- parceiro mudar sem nada explicar.
--
-- UMA COMPRA NÃO É ISSO. Ela é o registro de uma nota fiscal, e dela se DERIVA o custo por peça
-- (`lib/finance/unit-cost.ts`). Três consequências que o argumento original não cobria:
--
--   1. não existe compra oposta. Comprar −1 bobina por −R$ 38,00 quebraria a média ponderada,
--      que divide por peças — e peças negativas não são um conceito;
--   2. uma compra digitada errada não erra uma linha: ela envenena TODA derivação futura. Em
--      2026-09-01 o formulário lia `1.000` como um real, e uma compra de R$ 0,01 teria feito
--      todo display futuro custar um centésimo do que custou;
--   3. o único conserto sem `delete` seria uma segunda compra "de correção", que mentiria sobre
--      quantas peças entraram no estoque — e o KPI de comprado-menos-consumido é lido.
--
-- O QUE ISTO **NÃO** MUDA, E É A PROTEÇÃO QUE IMPORTA. `finance.material_consumption` continua
-- sem `delete`, e o custo já congelado nela NÃO se mexe quando uma compra é editada ou apagada.
-- Corrigir a compra muda o que será derivado DAQUI PARA FRENTE; o que já foi lançado é história,
-- e história é o que aquela tabela guarda. As duas regras convivem porque falam de coisas
-- diferentes: uma é o preço que valia, a outra é a nota que alguém digitou.
--
-- ROLLBACK:
--   REVOKE DELETE ON finance.purchases FROM service_role;
-- ============================================================================

grant delete on finance.purchases to service_role;

comment on table finance.purchases is
  'A compra, em unidades de compra. O custo por peça é derivado com o rendimento do produto e '
  'calculado em lib/finance/unit-cost.ts — não há coluna de preço unitário, de propósito. '
  'ACEITA update e delete, ao contrário das tabelas de lançamento: uma nota digitada errada '
  'envenena toda derivação futura e não tem oposto. O custo já congelado em '
  'finance.material_consumption não muda quando esta linha muda.';
