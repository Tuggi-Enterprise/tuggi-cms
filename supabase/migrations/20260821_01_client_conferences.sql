-- A conferência presencial de BR-B2B-022, item 3, passa a ser fato DO CLIENTE.
--
-- O PROBLEMA QUE ISTO RESOLVE. A evidência do alvará e do contrato social só existia dentro de
-- `partner.partner_form_submissions.review_note`, da proposta promovida — e o portão de geração
-- do contrato (`app/api/admin/clients/[clientId]/contract/route.ts`, `loadRegularity`) lia
-- exatamente ali. Cliente cadastrado direto, sem proposta, não tinha submission, então a
-- evidência era falsa por construção e não havia tela nenhuma no CMS para registrá-la. Medido em
-- 2026-08-21: 10 dos 12 clientes estavam nesse estado, sem caminho de saída.
--
-- A conferência é fato do ESTABELECIMENTO, e o estabelecimento é o cliente. A anotação da
-- proposta continua sendo o que ela sempre foi — o que um revisor escreveu sobre uma proposta,
-- com `reviewed_by` e data próprios — e a promoção é a transferência explícita, feita por
-- `promoteProposal`. Ninguém lê mais a evidência de dois lugares.
--
-- SEM POLÍTICA DE RLS, E SÓ `service_role`, igual a `partner.partner_contracts` e
-- `partner.partner_contract_acceptances`: nada nesta tabela é alcançável por `anon` nem por
-- `authenticated`, e o CMS chega por rota autenticada com o cliente de serviço. Não há `DELETE`
-- nem `TRUNCATE` no grant, de propósito — a Supabase concede os dois por padrão a toda tabela
-- nova, e uma política de RLS não filtra TRUNCATE.
--
-- ROLLBACK (destrutivo, executado por humano, nunca por agente):
--   DROP TABLE partner.client_conferences;

create table if not exists partner.client_conferences (
  client_id uuid primary key references partner.clients (id) on delete cascade,

  -- Os documentos de BR-B2B-022 item 3 que a equipe confirmou ter visto em mãos.
  -- Lista fechada: `business_license`, `incorporation_document`.
  --
  -- É SÓ ISTO, e a ausência é decisão. Número do alvará, município emissor e data de validade
  -- estiveram nesta tabela até 2026-08-21, quando o operador cortou os três: *"nao iremos pedir
  -- o numero do alvará, só dar um check no cms"*. Eram três transcrições de papel por
  -- conferência, e nada as lia de volta. O que foi junto com a data é a capacidade de detectar
  -- alvará vencido — ver a nota em `lib/partner-form/regularity.ts`, `ConferenceRecord`.
  documents_seen text[] not null default '{}',

  -- Quem afirmou, e quando. A conferência não é um arquivo que guardamos: é a asserção de
  -- uma pessoa nomeada, e sem esta coluna a marca vira a memória de alguém.
  reviewed_by uuid,
  reviewed_at timestamptz not null default now(),
  created_at timestamptz not null default now(),

  constraint client_conferences_documents_seen_known check (
    documents_seen <@ array['business_license', 'incorporation_document']::text[]
  )
);

comment on table partner.client_conferences is
  'What one operator recorded having seen of the BR-B2B-022 documents for this client, in person. Single source for the contract regularity gate.';
comment on column partner.client_conferences.documents_seen is
  'Closed list: business_license, incorporation_document. The whole of the record since 2026-08-21.';
comment on column partner.client_conferences.reviewed_by is
  'The auth user who asserted it. Nullable only for rows backfilled from a proposal annotation that had none.';

alter table partner.client_conferences enable row level security;

revoke all on partner.client_conferences from anon, authenticated;
grant select, insert, update on partner.client_conferences to service_role;

-- Backfill: as conferências que já existiam viajam da anotação da proposta para o cliente que
-- ela virou. Sem isto os dois clientes que HOJE conseguem gerar contrato parariam de conseguir.
-- As transcrições que existirem no JSON de origem NÃO viajam: não há coluna que as receba, e
-- elas continuam onde sempre estiveram, dentro de `review_note`, para quem precisar olhar.
insert into partner.client_conferences (client_id, documents_seen, reviewed_by, reviewed_at)
select distinct on (s.promoted_client_id)
  s.promoted_client_id,
  coalesce(
    (
      select array_agg(value #>> '{}')
      from jsonb_array_elements(s.review_note -> 'conference' -> 'documentsSeen')
      where value #>> '{}' in ('business_license', 'incorporation_document')
    ),
    '{}'::text[]
  ),
  s.reviewed_by,
  coalesce(s.reviewed_at, s.promoted_at, now())
from partner.partner_form_submissions s
where s.promoted_client_id is not null
  and jsonb_typeof(s.review_note -> 'conference') = 'object'
order by s.promoted_client_id, s.promoted_at desc nulls last
on conflict (client_id) do nothing;
