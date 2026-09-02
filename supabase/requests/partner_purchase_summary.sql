-- ============================================================================
-- PARA O TIME `data` — a janela que o CMS precisa, sem a chave do cofre
-- ============================================================================
-- ⚠️ ESTE ARQUIVO NÃO É UMA MIGRAÇÃO DESTE PROJETO, e por isso mora em `supabase/requests/` e
-- não em `supabase/migrations/` — quem aplicar as migrações do CMS em ordem não deve esbarrar
-- nele. A função pertence ao schema `drive`, cujo dono é o outro repositório
-- (BR-MONETIZACAO-048). Ele existe aqui só para viajar junto com o pedido.
--
-- ────────────────────────────────────────────────────────────────────────────────────────────
-- O PEDIDO, EM UMA FRASE
-- ────────────────────────────────────────────────────────────────────────────────────────────
--
-- O módulo Financeiro do CMS precisa responder "este parceiro trouxe gente que comprou?" e hoje
-- não consegue. Ele lê `drive.profiles` (sabe quem se cadastrou por qual parceiro), mas
-- `drive.time_credit_grants` nega `SELECT` ao `service_role` — medido em 2026-09-01.
--
-- **NÃO ESTAMOS PEDINDO O `GRANT` NAQUELA TABELA.** A negação foi analisada e é deliberada: das
-- 9 tabelas de `drive`, o `service_role` lê 7; as duas que negam são exatamente as de
-- monetização. E o ledger registra QUEM concedeu cada crédito — ele foi desenhado para ser
-- tocado por uma pessoa nomeada, e uma conta de serviço gravaria `NULL` ali. Abrir a tabela
-- resolveria o sintoma desfazendo uma decisão que está certa.
--
-- O pedido é esta função: ela recebe ids de parceiro e devolve DOIS NÚMEROS por parceiro. O CMS
-- nunca vê uma linha do ledger. É o mesmo padrão de `core.coordinator_city_breakdown`.
--
-- ────────────────────────────────────────────────────────────────────────────────────────────
-- O QUE A FUNÇÃO DEVOLVE, E POR QUE CADA DECISÃO ESTÁ AQUI DENTRO
-- ────────────────────────────────────────────────────────────────────────────────────────────
--
-- 1. UMA LINHA POR PARCEIRO PEDIDO, INCLUSIVE OS DE ZERO. Isto não é detalhe: no CMS, `null` e
--    zero são fatos diferentes e nunca se confundem. Parceiro ausente da resposta significaria
--    "não sei"; parceiro presente com `0` significa "não trouxe comprador nenhum". Devolver só
--    quem tem compra apagaria a diferença, e o veredito de todo parceiro sem compra voltaria a
--    ser "Sem dado de retorno" — que é justamente o que este pedido existe para resolver.
--
-- 2. O PISO DE k=5 MORA AQUI DENTRO, e não do lado do CMS. Um parceiro com 1 usuário adquirido e
--    1 comprador não publica uma estatística: publica a compra de UMA pessoa identificável, ao
--    lado do nome do bar onde ela esteve. `core.coordinator_city_breakdown` já enfrentou isso e
--    resolveu com k=5; este é o mesmo piso sobre o mesmo tipo de dado.
--
--    Com menos de 5 adquiridos, `users_with_purchase` colapsa em 1 (lê-se "≥ 1") e
--    `purchased_minutes` vira `NULL`. Não é arbitrário: o veredito do CMS lê daquela coluna
--    APENAS o booleano `> 0`, então nenhum parceiro muda de julgamento por causa do piso — e os
--    minutos são a coluna que mais vaza e a única que não decide nada.
--
--    O CMS aplica o mesmo piso hoje, em `lib/finance/profitability.ts`. Quando esta função
--    existir, aquela chamada vira redundante e inofensiva: ela nunca suprime o que já está
--    suprimido. Ter o piso dos dois lados é de propósito — o de lá é defesa em profundidade.
--
-- 3. `suppressed` VIAJA NA RESPOSTA porque um piso silencioso é um piso vestido de fato. A tela
--    escreve "≥ 1" em vez de "1" quando esta coluna é verdadeira, e o total do topo se anuncia
--    como piso. Sem ela, a soma de valores colapsados sairia impressa com cara de conta fechada.
--
-- 4. `security definer` COM `set search_path = ''` E NOMES QUALIFICADOS. O `search_path` vazio é
--    o que impede um schema plantado no caminho de sequestrar `profiles` ou `time_credit_grants`
--    numa função que roda com o privilégio do dono. Este repositório aprendeu isso em
--    `20260901_09_finance_consumption_invoker.sql`; a lição vale mais ainda aqui, porque esta
--    função é `definer` de verdade e não tem como não ser.
--
-- 5. `stable`, e não `volatile`: ela só lê. Isso permite ao planejador reusá-la dentro de uma
--    consulta maior sem reexecutar por linha.
--
-- ────────────────────────────────────────────────────────────────────────────────────────────
-- O QUE ELA NÃO FAZ, DE PROPÓSITO
-- ────────────────────────────────────────────────────────────────────────────────────────────
--
-- NÃO DEVOLVE DINHEIRO, só minutos. O preço do passe não está em `time_credit_grants`, e o CMS
-- não converte minuto em real em lugar nenhum (BR-MONETIZACAO-048). Se um dia a receita por
-- parceiro for desejada, ela é outra função e outra conversa — não um campo a mais nesta.
--
-- NÃO DEVOLVE `user_id` NENHUM. Se a resposta trouxesse a lista de compradores, o piso de k não
-- serviria para nada: bastaria contá-la.
--
-- NÃO FILTRA POR DATA. O CMS pergunta pelo acumulado; recortar por período aqui obrigaria a
-- decidir qual período, e essa decisão é da tela.
--
-- ────────────────────────────────────────────────────────────────────────────────────────────
-- COMO O CMS VAI CHAMAR
-- ────────────────────────────────────────────────────────────────────────────────────────────
--
--   select * from drive.partner_purchase_summary(array['<uuid>', '<uuid>']::uuid[]);
--
-- Em lotes de até ~500 parceiros (o teto de leitura do módulo). Hoje são 12.
--
-- ROLLBACK:
--   DROP FUNCTION drive.partner_purchase_summary(uuid[]);
-- ============================================================================


create or replace function drive.partner_purchase_summary(p_partner_ids uuid[])
returns table (
  partner_id uuid,
  users_with_purchase integer,
  purchased_minutes integer,
  suppressed boolean
)
language sql
stable
security definer
set search_path = ''
as $$
  with requested as (
    -- Uma linha por parceiro PEDIDO. É daqui que sai a garantia de que zero volta como zero, e
    -- não como ausência.
    select distinct id from unnest(p_partner_ids) as id
  ),

  acquired as (
    -- Quantas pessoas cada parceiro trouxe. É o denominador do piso de k — e é `partner_id`, não
    -- `client_id`: quem entrou pelo QR do parceiro, não quem é da equipe do estabelecimento.
    select p.partner_id as pid, count(*)::integer as users
    from drive.profiles p
    where p.partner_id = any (p_partner_ids)
    group by p.partner_id
  ),

  buyers as (
    -- `source = 'purchase'` separa compra de cortesia. Boas-vindas, cupom e crédito concedido no
    -- painel entram no ledger com outra origem, e contá-los aqui diria que um parceiro trouxe
    -- comprador quando ele trouxe alguém que ganhou minutos.
    --
    -- `count(distinct g.user_id)` porque uma pessoa que comprou três vezes é UM comprador. Os
    -- minutos, esses, somam as três.
    --
    -- ⚠️ A ÚNICA SUPOSIÇÃO DESTE ARQUIVO, e vale conferir: que `drive.profiles.id` é o mesmo id
    -- de `drive.time_credit_grants.user_id`. É assim que o CMS já correlaciona os dois hoje
    -- (`lib/services/finance-service.ts`, na leitura que hoje falha por permissão). Se houver
    -- uma coluna de ligação diferente, é esta linha que muda — e só ela.
    select
      p.partner_id as pid,
      count(distinct g.user_id)::integer as buyers,
      coalesce(sum(g.minutes_granted), 0)::integer as minutes
    from drive.time_credit_grants g
    join drive.profiles p on p.id = g.user_id
    where p.partner_id = any (p_partner_ids)
      and g.source = 'purchase'
    group by p.partner_id
  )

  select
    r.id,

    -- Sem comprador, zero — e zero é um fato. Com comprador e coorte pequena, colapsa em 1, que
    -- a tela imprime como "≥ 1".
    case
      when coalesce(b.buyers, 0) = 0 then 0
      when coalesce(a.users, 0) < 5 then 1
      else b.buyers
    end,

    -- Os minutos somem na coorte pequena. `NULL` aqui significa "omitido", e o CMS já sabe ler
    -- ausência sem transformá-la em zero.
    case
      when coalesce(b.buyers, 0) = 0 then 0
      when coalesce(a.users, 0) < 5 then null
      else b.minutes
    end,

    coalesce(b.buyers, 0) > 0 and coalesce(a.users, 0) < 5

  from requested r
  left join acquired a on a.pid = r.id
  left join buyers b on b.pid = r.id;
$$;


comment on function drive.partner_purchase_summary(uuid[]) is
  'Compra de app agregada por parceiro, para o modulo Financeiro do CMS. Existe para o '
  'service_role responder "este parceiro trouxe comprador?" SEM ler drive.time_credit_grants, '
  'cujo GRANT e negado de proposito. Devolve uma linha por parceiro pedido (zero e um fato, '
  'ausencia nao), com piso de k=5 aplicado aqui dentro e anunciado em `suppressed`.';


-- ────────────────────────────────────────────────────────────────────────────
-- GRANTS — só o service_role, e nada para anon/authenticated
-- ────────────────────────────────────────────────────────────────────────────
--
-- `revoke from public` PRIMEIRO: uma função nasce executável por `public`, e uma `security
-- definer` que qualquer papel executa é a própria brecha que ela deveria fechar.

revoke all on function drive.partner_purchase_summary(uuid[]) from public;
revoke all on function drive.partner_purchase_summary(uuid[]) from anon, authenticated;
grant execute on function drive.partner_purchase_summary(uuid[]) to service_role;


-- ────────────────────────────────────────────────────────────────────────────
-- CONFERÊNCIA SUGERIDA, antes de liberar
-- ────────────────────────────────────────────────────────────────────────────
--
-- Medido pelo CMS em 2026-09-01, pelo caminho provisório: 40 usuários com histórico de crédito,
-- 4 compradores, 1 deles com `partner_id`. Então a resposta esperada para a base de hoje é UM
-- parceiro com compra — e, como quase nenhum parceiro tem 5 adquiridos, muito provavelmente com
-- `suppressed = true` e `purchased_minutes = null`.
--
--   -- 1. todo parceiro pedido volta, mesmo sem compra
--   select count(*) from drive.partner_purchase_summary(
--     array(select id from partner.clients limit 12)
--   );                                            -- esperado: 12
--
--   -- 2. o piso de k está de pé
--   select * from drive.partner_purchase_summary(array(select id from partner.clients))
--   where suppressed;                             -- minutos devem vir NULL nestas linhas
--
--   -- 3. cortesia não conta como compra
--   --    (comparar com o total do ledger sem o filtro de source: tem de ser MENOR)
