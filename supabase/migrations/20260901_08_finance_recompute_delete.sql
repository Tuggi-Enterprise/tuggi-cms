-- ============================================================================
-- O RECÁLCULO PODE APAGAR UMA LINHA QUE DEIXOU DE EXISTIR — e por que isso não fere a regra
-- ============================================================================
-- ⚠️ APLICAR MANUALMENTE NO PAINEL (SQL Editor). NUNCA via CLI.
-- ⚠️ DEPENDE de `20260901_01_finance_schema.sql`.
--
-- O QUE EU ESCREVI NA 01, E CONTINUA VALENDO NO ESSENCIAL: *"corrigir um lançamento é lançar o
-- oposto, não apagar a linha"*. Uma linha de custo que some faz o total de um parceiro mudar sem
-- nada explicar, e o log de auditoria passa a apontar para algo que não existe mais.
--
-- ONDE ELE NÃO ALCANÇA. `material_consumption` não é um lançamento que alguém DIGITOU: é uma
-- DERIVAÇÃO de três fatos — o pedido, o envio informado e as regras vigentes. Quando o envio de
-- um produto passa a ser zero, a linha daquele produto não vira um custo errado: ela vira uma
-- linha que a derivação de hoje não produz mais. Não há oposto a lançar, porque não houve
-- consumo nenhum.
--
-- Aconteceu em 2026-09-01: o Boteco Seu Osmar não recebeu display de balcão — foram 12 displays
-- de mesa. Corrigir o envio para `display_balcao = 0` deixava a linha de R$ 8,56 órfã, sem
-- caminho de saída, inflando o custo do parceiro para sempre.
--
-- O QUE PROTEGE ISTO DE VIRAR PORTA DOS FUNDOS:
--
--   1. só `recomputeConsumption` apaga, e ela só apaga o que o plano de hoje NÃO produz;
--   2. ela é chamada por um ato explícito — `scripts/finance-backfill-consumption.ts
--      --recompute` — e nunca pelo fluxo normal, que segue só PREENCHENDO o que falta;
--   3. nenhuma rota de `app/api/finance/**` apaga custo, e `finance-surface.test.ts` trava isso;
--   4. `client_cost_entries`, `fixed_costs` e `standard_rates` continuam SEM `delete`: aqueles
--      sim são lançamentos digitados por alguém, e o argumento original vale inteiro para eles.
--
-- ROLLBACK:
--   REVOKE DELETE ON finance.material_consumption FROM service_role;
-- ============================================================================

grant delete on finance.material_consumption to service_role;

comment on table finance.material_consumption is
  'A saída de material, com o custo congelado no dia. unit_cost_cents NULO significa "consumido '
  'antes de existir compra com preço" e a tela conta como pendência — nunca como zero. '
  'ACEITA delete APENAS pelo recálculo explícito (recomputeConsumption), e apenas para a linha '
  'que a derivação de hoje não produz mais — envio que foi a zero. Nenhuma rota apaga custo.';
