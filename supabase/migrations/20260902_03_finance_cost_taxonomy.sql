-- ============================================================================
-- O CUSTO DA OPERAÇÃO GANHA CATEGORIA, NATUREZA, VIGÊNCIA E SINAL
-- ============================================================================
-- ⚠️ APLICAR MANUALMENTE NO PAINEL (SQL Editor). NUNCA via CLI.
-- ⚠️ DEPENDE de `20260901_01_finance_schema.sql`.
--
-- O PEDIDO, 2026-09-02: *"cadastre as novas categorias e custos fixos previstos e também preveja
-- as categorias de custos variáveis no projeto. Iremos trazer para cá todo o P&L da empresa."*
--
-- O QUE FALTAVA. `finance.fixed_costs` nasceu para responder uma pergunta só — quantos parceiros
-- pagantes cobrem a estrutura — e para isso bastavam rótulo, valor, moeda e cadência. Um P&L pede
-- quatro coisas que a tabela não tinha:
--
--   1. CATEGORIA, senão "para onde vai o dinheiro?" só se responde lendo a lista inteira, e dois
--      operadores digitando "Supabase" e "supabase (banco)" produzem duas linhas que nenhum
--      agrupamento reencontra;
--   2. NATUREZA, porque um custo que cresce com o volume não é uma conta que um número de
--      parceiros "cobre" — ele já está do outro lado, dentro da margem;
--   3. VIGÊNCIA, porque uma assinatura cancelada ou reprecificada não pode continuar cobrando
--      para sempre: a Supabase passou de US$ 32,49 para US$ 40,99 entre julho e agosto de 2026, e
--      sem `ends_at` as duas linhas somariam US$ 73,48 por mês, todo mês, para sempre;
--   4. SINAL, porque metade da planilha do operador é DESCONTO E CRÉDITO — o crédito promocional
--      que hoje zera a conta de APIs de IA. Sem ele, o CMS afirmaria um desembolso de R$ 3.545,65
--      que não saiu do caixa; com ele mal modelado, a empresa não veria o custo que aparece no dia
--      em que o crédito acabar.
--
-- A TABELA CONTINUA SE CHAMANDO `fixed_costs` E O NOME AGORA É HISTÓRICO. Ela é o custo da
-- OPERAÇÃO — o que não desce para a linha de nenhum parceiro — e `nature` diz qual parte dela é
-- fixa. Renomeá-la seria um `ALTER` cosmético numa tabela viva, com o código, as rotas, os testes
-- e três arquivos de tradução atrás; a invariante que importa (custo de estrutura NÃO tem
-- `client_id`) não depende do nome e continua travada em `finance-structure.test.ts`.
--
-- TODA COLUNA ENTRA COM DEFAULT, então nenhuma linha existente vira inválida. O default de
-- `category` é `other` — que se lê como "ninguém classificou ainda", e não como uma classificação.
--
-- ROLLBACK (destrutivo, executado por humano, nunca por agente):
--   ALTER TABLE finance.fixed_costs
--     DROP COLUMN category, DROP COLUMN nature, DROP COLUMN entry_type,
--     DROP COLUMN is_payroll, DROP COLUMN ends_at;
-- ============================================================================


-- ────────────────────────────────────────────────────────────────────────────
-- 1. PARA ONDE O DINHEIRO VAI
-- ────────────────────────────────────────────────────────────────────────────
--
-- O vocabulário é o da planilha `Tuggi_PL_Breakeven_12m` que o operador já mantinha — seis
-- categorias, não uma sétima nomenclatura para ele reaprender. O SSOT em TypeScript é
-- `lib/finance/cost-taxonomy.ts`; o CHECK abaixo é a segunda cópia da MESMA lista, e existe pelo
-- motivo de sempre: o banco é a última porta, e uma categoria inventada por um cliente HTTP
-- qualquer não pode entrar por ela.

alter table finance.fixed_costs
  add column if not exists category text not null default 'other';

alter table finance.fixed_costs
  drop constraint if exists fixed_costs_category_ck;

alter table finance.fixed_costs
  add constraint fixed_costs_category_ck check (
    category = any (array['infrastructure', 'tools', 'people', 'marketing', 'admin', 'other'])
  );

comment on column finance.fixed_costs.category is
  'Para onde o dinheiro vai. Vocabulário da planilha do operador; SSOT em '
  'lib/finance/cost-taxonomy.ts. O default `other` se lê como "ainda não classificado".';


-- ────────────────────────────────────────────────────────────────────────────
-- 2. COMO O CUSTO SE COMPORTA QUANDO A OPERAÇÃO CRESCE
-- ────────────────────────────────────────────────────────────────────────────
--
-- `fixed` chega igual com 10 ou com 500 parceiros; `variable` acompanha o volume. A mesma
-- categoria tem os dois — a Supabase é infraestrutura fixa, a API de IA é infraestrutura variável
-- — e é por isso que `category` sozinha não resolveria.
--
-- SÓ O FIXO ENTRA NO PONTO DE EQUILÍBRIO. Pôr o variável no denominador pediria parceiros para
-- pagar um custo que só existe porque os parceiros existem. Quem garante isso é
-- `lib/finance/structure.ts`, e não um trigger aqui: a regra é uma só, e ela mora no TypeScript.
--
-- NUM CRÉDITO, `nature` DIZ O QUE ELE ABATE. Um crédito de API de IA é `variable` porque o custo
-- que ele cobre é variável — mesmo que a planilha o tenha marcado como abatimento de fixo, o que
-- lá produzia um custo fixo NEGATIVO em agosto de 2026 (−R$ 164,67).
--
-- O default é `fixed`: as linhas que já existem nasceram numa tabela chamada `fixed_costs`.

alter table finance.fixed_costs
  add column if not exists nature text not null default 'fixed';

alter table finance.fixed_costs
  drop constraint if exists fixed_costs_nature_ck;

alter table finance.fixed_costs
  add constraint fixed_costs_nature_ck check (nature = any (array['fixed', 'variable']));

comment on column finance.fixed_costs.nature is
  'fixed chega igual com 10 ou 500 parceiros; variable acompanha o volume. Só fixed entra no '
  'ponto de equilíbrio. Num crédito, diz qual custo ele abate.';
comment on column finance.fixed_costs.kind is
  'CADÊNCIA, não natureza: one_off aconteceu uma vez, recurring volta a cada period_months. Uma '
  'feira é variável e acontece uma vez; a impressora é fixa e foi comprada uma vez.';


-- ────────────────────────────────────────────────────────────────────────────
-- 3. CUSTO OU CRÉDITO — e o crédito não é um custo negativo
-- ────────────────────────────────────────────────────────────────────────────
--
-- `amount_cents >= 0` CONTINUA VALENDO PARA OS DOIS. Um crédito de R$ 1.411,58 entra como 141158
-- com `entry_type = 'credit'`, nunca como −141158.
--
-- POR QUE NÃO UM VALOR NEGATIVO. Um total que soma tudo cru daria o número certo por acidente e o
-- errado assim que alguém perguntasse "quanto custa a preço cheio?" — que é a pergunta que decide
-- se a empresa sobrevive ao fim do crédito promocional. Com o sinal em coluna própria, bruto,
-- crédito e líquido são três leituras da MESMA lista, e nenhuma é uma subtração que alguém
-- precisa lembrar de fazer.
--
-- POR QUE NA MESMA TABELA. Os dois blocos da planilha do operador têm exatamente as mesmas
-- colunas — categoria, tipo, moeda, valor por mês, vigência. Uma segunda tabela seria a mesma
-- DDL, a mesma rota, o mesmo formulário e a mesma leitura, duplicados; e a única defesa que ela
-- daria (impossível somar crédito como custo) é a que `entry_type` já dá, com teste travando.

alter table finance.fixed_costs
  add column if not exists entry_type text not null default 'cost';

alter table finance.fixed_costs
  drop constraint if exists fixed_costs_entry_type_ck;

alter table finance.fixed_costs
  add constraint fixed_costs_entry_type_ck check (entry_type = any (array['cost', 'credit']));

comment on column finance.fixed_costs.entry_type is
  'cost = o que se paga; credit = desconto ou crédito que abate. O valor é SEMPRE positivo: o '
  'sinal é esta coluna. Somar a lista crua sem lê-la é o defeito que ela existe para impedir.';


-- ────────────────────────────────────────────────────────────────────────────
-- 4. A BASE DO FATOR R
-- ────────────────────────────────────────────────────────────────────────────
--
-- Folha ÷ receita bruta dos últimos 12 meses. Cruzando 28%, a empresa migra do Anexo V do Simples
-- (alíquota inicial de 15,5%) para o Anexo III (6%) — uma diferença que muda o resultado mais do
-- que quase qualquer corte de custo desta tabela.
--
-- A MARCA É DO ITEM, NÃO DA CATEGORIA. Benefícios (VR, VT, plano) são "Pessoas" e NÃO entram na
-- base; estagiário sob a Lei 11.788 também não. Ler `category = 'people'` como "é folha" inflaria
-- o índice e faria a empresa se planejar para um anexo que ela não alcançou.

alter table finance.fixed_costs
  add column if not exists is_payroll boolean not null default false;

comment on column finance.fixed_costs.is_payroll is
  'Entra na base do fator R (pró-labore, salário, FGTS, provisão de férias e 13º). Benefício e '
  'estagiário são Pessoas e ficam de fora: a marca é do item, nunca da categoria.';


-- ────────────────────────────────────────────────────────────────────────────
-- 5. A VIGÊNCIA — porque assinatura cancelada não cobra para sempre
-- ────────────────────────────────────────────────────────────────────────────
--
-- MEDIDO NA PLANILHA DO OPERADOR: a Supabase custou US$ 32,49 em julho de 2026 e US$ 40,99 de
-- agosto em diante. Reprecificar é encerrar uma linha e abrir outra — o mesmo desenho de
-- `pass_prices.effective_from` e de `standard_rates`, porque o preço de hoje não pode
-- reprecificar o mês passado. Sem `ends_at`, as duas linhas somariam para sempre.
--
-- NULO SIGNIFICA "AINDA VIGENTE", e é diferente de zero: uma assinatura sem data de fim não é uma
-- assinatura que termina hoje.
--
-- NUM CRÉDITO, `ends_at` É EXATAMENTE A COLUNA "TEMPORÁRIO OU PERMANENTE" DA PLANILHA. Crédito
-- com data de fim é benefício temporário e sai do custo ESTRUTURAL; crédito sem data é desconto
-- permanente e fica. É essa distinção que responde "o que a empresa vai pagar quando o crédito
-- promocional acabar?" sem ninguém precisar refazer a conta à mão.

alter table finance.fixed_costs
  add column if not exists ends_at date;

alter table finance.fixed_costs
  drop constraint if exists fixed_costs_ends_at_ck;

alter table finance.fixed_costs
  add constraint fixed_costs_ends_at_ck check (ends_at is null or ends_at >= incurred_at);

comment on column finance.fixed_costs.ends_at is
  'Última data em que a linha vale. NULO = ainda vigente, e isso não é zero. Num crédito, é o '
  '"temporário ou permanente" da planilha: com data sai do custo estrutural, sem data fica.';


-- ────────────────────────────────────────────────────────────────────────────
-- 6. O ÍNDICE QUE A TELA USA
-- ────────────────────────────────────────────────────────────────────────────
--
-- A leitura do módulo é sempre a mesma: tudo que vale hoje, agrupado por categoria. Ordenar por
-- `incurred_at` já existia; a categoria é o que passou a agrupar.

create index if not exists fixed_costs_category_ix
  on finance.fixed_costs (category, incurred_at desc);


comment on table finance.fixed_costs is
  'Custo da OPERAÇÃO — o nome é histórico, `nature` diz qual parte é fixa. NÃO tem client_id de '
  'propósito: rateá-lo por cliente produziria um número que não serve para decidir sobre cliente '
  'nenhum. O fixo cobre na camada MC II; o variável já está dentro da margem.';
