-- ============================================================================
-- finance.record_material_consumption — tira o `security definer` que ela nunca precisou
-- ============================================================================
--
-- NÃO É EXPLORÁVEL HOJE, e é por isso que esta migration existe agora e não depois de um
-- incidente. `security definer` faz a função rodar com os privilégios de quem a CRIOU, e com
-- `search_path` incluindo `public` — um schema onde, no Postgres, criar objeto é historicamente
-- mais fácil do que deveria. A combinação das duas coisas é a receita clássica de escalada por
-- sequestro de search_path: basta um objeto plantado em `public` com o nome de algo que a função
-- resolve sem qualificar, e o corpo passa a executar código de outra pessoa como dono.
--
-- POR QUE ELA NÃO PRECISA DISSO. O único grantee é `service_role`, e ele JÁ tem `insert` em
-- `finance.material_consumption` por grant próprio (ver `20260901_01`, bloco de GRANTS). O
-- `definer` não estava concedendo nada: estava apenas ampliando o que um defeito futuro poderia
-- alcançar. `security invoker` faz a função rodar com os privilégios de quem chama — que aqui é
-- exatamente quem já podia gravar.
--
-- E `search_path = ''` FECHA A OUTRA METADE. Com o caminho vazio, nada resolve por nome curto:
-- toda referência do corpo é qualificada (`finance.material_consumption`), e as funções e tipos
-- que sobram (`jsonb_array_elements`, `uuid`, `integer`) vivem em `pg_catalog`, que o Postgres
-- consulta sempre, independentemente do `search_path`. Não há mais nome ambíguo para sequestrar.
--
-- `partner` saiu do caminho junto: o corpo nunca tocou nada daquele schema.
--
-- O CORPO É O MESMO, LINHA POR LINHA. Esta migration muda quem executa e como os nomes são
-- resolvidos — não muda o que é gravado. `create or replace` a torna re-executável, como as
-- `05` e `06` já foram corrigidas para ser.
-- ============================================================================

create or replace function finance.record_material_consumption(
  p_order_id uuid,
  p_client_id uuid,
  p_status text,
  p_lines jsonb,
  p_created_by text default null
)
returns integer
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_inserted integer;
begin
  if p_lines is null or jsonb_typeof(p_lines) <> 'array' or jsonb_array_length(p_lines) = 0 then
    return 0;
  end if;

  insert into finance.material_consumption (
    order_id, client_id, product_id, quantity,
    unit_cost_cents, component_cost_cents, standard_cost_cents,
    components, currency, reason, consumed_status, created_by
  )
  select
    p_order_id,
    p_client_id,
    line ->> 'product_id',
    (line ->> 'quantity')::integer,
    nullif(line ->> 'unit_cost_cents', '')::integer,
    coalesce((line ->> 'component_cost_cents')::integer, 0),
    coalesce((line ->> 'standard_cost_cents')::integer, 0),
    coalesce(line -> 'components', '[]'::jsonb),
    coalesce(line ->> 'currency', 'BRL'),
    coalesce(line ->> 'reason', 'first_delivery'),
    p_status,
    p_created_by
  from jsonb_array_elements(p_lines) as line
  on conflict (order_id, product_id) do nothing;

  get diagnostics v_inserted = row_count;
  return v_inserted;
end;
$$;

-- Os grants são reafirmados porque `create or replace` preserva os existentes, mas esta
-- migration precisa valer também se alguém a rodar num banco onde a função foi recriada à mão.
revoke all on function finance.record_material_consumption(uuid, uuid, text, jsonb, text)
  from anon, authenticated, public;
grant execute on function finance.record_material_consumption(uuid, uuid, text, jsonb, text)
  to service_role;

comment on function finance.record_material_consumption(uuid, uuid, text, jsonb, text) is
  'Grava as linhas de custo de UM pedido num ato só. Não decide nada: status, receita e custo '
  'chegam prontos de lib/finance/consumption.ts. Devolve quantas linhas entraram — zero '
  'significa que o pedido já havia sido consumido, e é por isso que repetir a chamada é seguro. '
  'security invoker + search_path vazio: o único grantee (service_role) já tem insert próprio, '
  'então o definer só ampliaria o alcance de um defeito futuro.';
