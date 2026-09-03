-- ============================================================================
-- ENCERRAR E REMOVER SÃO DUAS COISAS — e por isso são duas colunas
-- ============================================================================
-- ⚠️ APLICAR MANUALMENTE NO PAINEL (SQL Editor). NUNCA via CLI.
-- ⚠️ DEPENDE de `20260902_03_finance_cost_taxonomy.sql`.
--
-- O PEDIDO, 2026-09-03: *"possibilidade de encerrar ou deletar um custo"*. São dois verbos na
-- frase e dois fatos diferentes no mundo, e juntá-los num botão só destruiria um dos dois.
--
--   ENCERRAR  A assinatura acabou. O custo EXISTIU, foi pago, e continua contando em todo mês
--             em que valeu. Já tem coluna desde 2026-09-02: `ends_at`. Nada a fazer aqui.
--
--   REMOVER   A linha foi um erro — valor errado, item duplicado, mês trocado. Ela nunca
--             deveria ter contado, em mês nenhum. É esta migração.
--
-- CONFUNDIR OS DOIS CUSTA CARO NAS DUAS DIREÇÕES. Remover uma assinatura que de fato acabou
-- apagaria custo real do histórico e faria março parecer mais barato do que foi. Encerrar uma
-- linha digitada errada a deixaria cobrando até a data do encerramento — um custo fantasma que
-- ninguém pagou, dentro do ponto de equilíbrio.
--
-- ────────────────────────────────────────────────────────────────────────────────────────────
-- NÃO APAGA, MARCA — e a razão é a mesma de `finance.excluded_accounts`
-- ────────────────────────────────────────────────────────────────────────────────────────────
--
-- `DELETE` continua fora do grant, como em toda tabela de lançamento deste schema. Uma linha de
-- dinheiro que some sem deixar rastro é indistinguível de uma leitura que falhou pela metade:
-- quem abrir o relatório de agosto no mês que vem e achar um total diferente do que leu hoje não
-- terá como saber se alguém corrigiu um erro ou se o banco perdeu uma linha.
--
-- Marcada, a linha sai de toda conta E continua auditável: quem removeu, quando, e POR QUÊ.
-- `void_reason` é obrigatório pelo mesmo motivo que `excluded_accounts.reason` é: "por que esta
-- linha não conta" é a informação, não um enfeite.
--
-- E DESFAZER É LIMPAR A MARCA, não inserir de novo. Por isso não há `delete` e há `update`.
--
-- ROLLBACK (destrutivo, executado por humano, nunca por agente):
--   ALTER TABLE finance.fixed_costs
--     DROP COLUMN voided_at, DROP COLUMN voided_by, DROP COLUMN void_reason;
-- ============================================================================


alter table finance.fixed_costs
  add column if not exists voided_at timestamptz;

alter table finance.fixed_costs
  add column if not exists voided_by text;

alter table finance.fixed_costs
  add column if not exists void_reason text;

alter table finance.fixed_costs
  drop constraint if exists fixed_costs_void_ck;

-- A RAZÃO É EXIGIDA JUNTO COM A MARCA, e proibida sem ela. Uma linha viva carregando "motivo da
-- remoção" é um rascunho de decisão que alguém vai ler como decisão tomada.
alter table finance.fixed_costs
  add constraint fixed_costs_void_ck check (
    (voided_at is null and void_reason is null and voided_by is null)
    or (voided_at is not null and length(btrim(void_reason)) > 0)
  );

comment on column finance.fixed_costs.voided_at is
  'A linha foi REMOVIDA por ter sido um erro: ela sai de toda conta, em todo mes. Diferente de '
  'ends_at, que diz que um custo REAL acabou numa data e segue contando nos meses em que valeu.';
comment on column finance.fixed_costs.void_reason is
  'Obrigatorio junto com voided_at. "Por que esta linha nao conta" e a informacao, nao enfeite.';


-- ────────────────────────────────────────────────────────────────────────────
-- O ÍNDICE QUE A LEITURA USA
-- ────────────────────────────────────────────────────────────────────────────
--
-- Toda leitura do módulo passou a filtrar `voided_at is null`. O índice é PARCIAL porque é a
-- lista viva que se lê o tempo todo; as removidas só aparecem quando alguém as procura.

create index if not exists fixed_costs_live_ix
  on finance.fixed_costs (category, incurred_at desc)
  where voided_at is null;
