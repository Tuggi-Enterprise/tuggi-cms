-- ============================================================================
-- O CHECK DE `void_reason` NÃO EXIGIA NADA — lógica de três valores
-- ============================================================================
-- ⚠️ APLICAR MANUALMENTE NO PAINEL (SQL Editor). NUNCA via CLI.
-- ⚠️ DEPENDE de `20260903_02_finance_cost_lifecycle.sql`.
--
-- ACHADO PELO QA EM 2026-09-03, e é um daqueles defeitos que só existem em SQL.
--
-- O constraint escrito ontem foi este:
--
--   check (
--     (voided_at is null and void_reason is null and voided_by is null)
--     or (voided_at is not null and length(btrim(void_reason)) > 0)
--   )
--
-- Para uma linha com `voided_at = now()` e `void_reason = NULL`:
--
--   ramo 1 .... false                      (voided_at não é null)
--   ramo 2 .... true AND NULL  =  NULL     (`length(btrim(NULL))` é NULL, e NULL > 0 é NULL)
--   resultado . false OR NULL  =  NULL
--
-- E UM CHECK QUE AVALIA `NULL` PASSA. A regra do Postgres é que o constraint só recusa quando o
-- resultado é FALSE — `NULL` é tratado como aceito. Ou seja: o banco vinha aceitando uma remoção
-- sem motivo, exatamente o contrário do que dois comentários deste repositório afirmavam
-- ("a RAZÃO É OBRIGATÓRIA e o CHECK do banco a exige junto com a marca").
--
-- Na prática ninguém conseguiu inserir uma dessas: a rota exige o motivo antes de escrever. Mas a
-- rota é uma porta, e o CHECK é a parede — um backfill em SQL, uma migração futura ou um script
-- passariam direto. A defesa em profundidade só é profunda se a camada de baixo existir.
--
-- A CORREÇÃO É UMA CLÁUSULA: `void_reason is not null` ANTES do `length`. Com ela, o ramo 2 vira
-- `true AND false AND ...` = false, e `false OR false` = false — que é o resultado que recusa.
--
-- As outras duas direções já funcionavam e continuam: razão sem marca, e `voided_by` sem marca,
-- fazem o ramo 1 dar false com operandos não nulos, e o ramo 2 dar false por `voided_at is null`.
--
-- ROLLBACK: reaplicar o constraint anterior — mas ele não recusa o que promete recusar.
-- ============================================================================

alter table finance.fixed_costs
  drop constraint if exists fixed_costs_void_ck;

alter table finance.fixed_costs
  add constraint fixed_costs_void_ck check (
    (voided_at is null and void_reason is null and voided_by is null)
    or (
      voided_at is not null
      and void_reason is not null
      and length(btrim(void_reason)) > 0
    )
  );

comment on column finance.fixed_costs.void_reason is
  'Obrigatorio junto com voided_at, e o CHECK de fato o exige desde 20260903_03 - a versao '
  'anterior avaliava NULL e por isso aceitava remocao sem motivo. "Por que esta linha nao conta" '
  'e a informacao, nao enfeite.';
