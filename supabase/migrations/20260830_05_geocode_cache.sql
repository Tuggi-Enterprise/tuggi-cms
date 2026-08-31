-- ============================================================================
-- ⚠️  APLICAR MANUALMENTE NO PAINEL. NUNCA DDL via CLI.
-- Depende de: 20260830_01_profile_origin.sql
-- ============================================================================
-- core.geocode_cache — preenche cidade e país onde core.city_boundaries não
-- alcança, consultando o Nominatim aos poucos por cron.
--
-- MOTIVO
-- city_boundaries cobre sete países (Espanha, Brasil, Argentina, Portugal,
-- Uruguai, México e — só em nível de estado — Estados Unidos). Toda conta
-- nascida fora deles fica sem cidade e sem país mesmo tendo coordenada: em
-- 30/08/2026 são 71 coordenadas na base inteira, a Itália sendo o maior caso.
-- Importar os boundaries que faltam continua sendo o conserto de raiz; isto
-- resolve o presente enquanto aquilo não vem.
--
-- POLÍTICA DE USO DO NOMINATIM (operations.osmfoundation.org/policies/nominatim)
-- Verificada em 30/08/2026. O que ela exige e como esta migration cumpre:
--   · "Scripts run at regular intervals are restricted to 4 requests per minute"
--     → o cron roda a cada 5 min e pede no máximo 1 coordenada por execução:
--       12 requisições/hora, um vigésimo do teto.
--   · "Results must be cached on your side"
--     → é o propósito desta tabela; a mesma coordenada nunca é consultada duas
--       vezes, e coordenada arredondada faz vizinhos compartilharem a resposta.
--   · "Limit your requests to a single thread"
--     → uma requisição por execução, sem paralelismo.
--   · "Provide a valid HTTP Referer or User-Agent identifying the application"
--     → User-Agent próprio em core.geocode_user_agent().
--   · Proibido: "systematic queries ... reverse queries in a grid"
--     → não é grade: é uma coordenada por conta nova que o catálogo não cobriu.
--
-- GDPR — isto envia coordenada de usuário para um terceiro (OSM Foundation).
-- Três mitigações, e a primeira é a que importa:
--   1. A coordenada é arredondada para 3 casas decimais (~110 m) ANTES de sair.
--      Resolve cidade com folga e não resolve residência. O ponto preciso nunca
--      deixa o banco.
--   2. Nenhum identificador acompanha a requisição: vai a coordenada e nada mais.
--      O Nominatim não tem como ligar a consulta a uma pessoa.
--   3. Cache: cada coordenada sai uma única vez, para sempre.
-- Registrar esta transferência no inventário de tratamento de dados.
-- ============================================================================

create table if not exists core.geocode_cache (
  -- chave é a coordenada arredondada: o que efetivamente sai daqui
  lat3          numeric(9,3) not null,
  lng3          numeric(9,3) not null,

  city_name     text,
  country_name  text,
  display_name  text,

  status        text not null default 'pending'
                check (status in ('pending','resolved','not_found','failed')),
  attempts      integer not null default 0,

  request_id    bigint,
  requested_at  timestamptz,
  resolved_at   timestamptz,
  error_message text,

  created_at    timestamptz not null default now(),

  primary key (lat3, lng3)
);

comment on table core.geocode_cache is
  'Cache de geocodificação reversa (Nominatim) para coordenadas que core.city_boundaries não cobre. '
  'A chave é a coordenada arredondada a 3 casas (~110 m): é essa, e só essa, que é enviada ao serviço externo. '
  'Cache obrigatório pela política de uso do Nominatim.';

create index if not exists idx_geocode_cache_status
  on core.geocode_cache (status, created_at);

create index if not exists idx_geocode_cache_request
  on core.geocode_cache (request_id) where request_id is not null;

-- ---------------------------------------------------------------------------
-- User-Agent — a política exige um que identifique a aplicação.
-- "stock User-Agents as set by http libraries will not do"
-- ---------------------------------------------------------------------------
create or replace function core.geocode_user_agent()
returns text
language sql
immutable
as $$ select 'TuggiCMS/1.0 (analytics de aquisicao; suporte@tuggi.app)'::text $$;

-- ---------------------------------------------------------------------------
-- Fase 1 — enfileira. Uma coordenada por execução.
-- ---------------------------------------------------------------------------
create or replace function core.enqueue_geocode_lookups(p_limit integer default 1)
returns integer
language plpgsql
security definer
set search_path to 'core','net','public','extensions'
as $$
declare
  r          record;
  v_count    integer := 0;
  v_req      bigint;
begin
  -- candidatas: têm coordenada, não têm cidade, e ainda não estão no cache
  for r in
    select distinct
           round(ST_Y(o.origin_point::geometry)::numeric, 3) lat3,
           round(ST_X(o.origin_point::geometry)::numeric, 3) lng3
    from core.profile_origin o
    where o.origin_point is not null
      and o.city_name is null
      and not exists (
        select 1 from core.geocode_cache g
        where g.lat3 = round(ST_Y(o.origin_point::geometry)::numeric, 3)
          and g.lng3 = round(ST_X(o.origin_point::geometry)::numeric, 3)
      )
    limit p_limit
  loop
    -- zoom=10 devolve o município; accept-language=en mantém o nome alinhado
    -- com o que city_boundaries guarda em name_en.
    select net.http_get(
      url := 'https://nominatim.openstreetmap.org/reverse?format=jsonv2&zoom=10&accept-language=en'
             || '&lat=' || r.lat3::text || '&lon=' || r.lng3::text,
      headers := jsonb_build_object('User-Agent', core.geocode_user_agent()),
      timeout_milliseconds := 15000
    ) into v_req;

    insert into core.geocode_cache (lat3, lng3, status, request_id, requested_at, attempts)
    values (r.lat3, r.lng3, 'pending', v_req, now(), 1)
    on conflict (lat3, lng3) do update
      set request_id = excluded.request_id,
          requested_at = now(),
          attempts = core.geocode_cache.attempts + 1;

    v_count := v_count + 1;
  end loop;

  return v_count;
end;
$$;

comment on function core.enqueue_geocode_lookups(integer) is
  'Dispara a geocodificação reversa de coordenadas sem cidade, uma por execução. Envia apenas a coordenada arredondada a ~110 m.';

-- ---------------------------------------------------------------------------
-- Fase 2 — colhe as respostas que o pg_net já recebeu.
-- ---------------------------------------------------------------------------
create or replace function core.collect_geocode_responses()
returns integer
language plpgsql
security definer
set search_path to 'core','net','public','extensions'
as $$
declare
  r        record;
  v_count  integer := 0;
  v_addr   jsonb;
  v_city   text;
  v_country text;
begin
  for r in
    select g.lat3, g.lng3, resp.status_code, resp.content, resp.error_msg
    from core.geocode_cache g
    join net._http_response resp on resp.id = g.request_id
    where g.status = 'pending'
  loop
    if r.status_code = 200 and r.content is not null then
      -- o Nominatim pode devolver 200 com corpo que não é JSON (página de erro,
      -- rate limit em HTML). Sem o guard, uma resposta dessas aborta a rodada
      -- inteira e o cron para de drenar a fila em silêncio.
      begin
        v_addr := (r.content::jsonb) -> 'address';
      exception when others then
        update core.geocode_cache
        set status = case when attempts >= 3 then 'failed' else 'pending' end,
            error_message = 'resposta nao e JSON',
            request_id = null
        where lat3 = r.lat3 and lng3 = r.lng3;
        v_count := v_count + 1;
        continue;
      end;

      -- mesma ordem de precedência usada na resolução por boundary
      v_city := coalesce(
        v_addr ->> 'city', v_addr ->> 'town', v_addr ->> 'village',
        v_addr ->> 'municipality', v_addr ->> 'county',
        v_addr ->> 'state_district', v_addr ->> 'state'
      );
      v_country := v_addr ->> 'country';

      update core.geocode_cache
      set city_name    = v_city,
          country_name = v_country,
          display_name = (r.content::jsonb) ->> 'display_name',
          status       = case when v_city is null and v_country is null
                              then 'not_found' else 'resolved' end,
          resolved_at  = now(),
          error_message = null
      where lat3 = r.lat3 and lng3 = r.lng3;
    else
      update core.geocode_cache
      set status = case when attempts >= 3 then 'failed' else 'pending' end,
          error_message = coalesce(r.error_msg, 'HTTP ' || coalesce(r.status_code::text, '?')),
          request_id = null
      where lat3 = r.lat3 and lng3 = r.lng3;
    end if;

    v_count := v_count + 1;
  end loop;

  return v_count;
end;
$$;

comment on function core.collect_geocode_responses() is
  'Lê as respostas do pg_net e preenche core.geocode_cache. Reagenda até 3 tentativas antes de marcar failed.';

-- ---------------------------------------------------------------------------
-- Fase 3 — aplica o cache no relatório.
--
-- Só preenche o que está vazio: boundary próprio sempre vence geocodificação
-- externa, porque é o dado que nós controlamos.
-- ---------------------------------------------------------------------------
create or replace function core.apply_geocode_cache()
returns integer
language plpgsql
security definer
set search_path to 'core','public','extensions'
as $$
declare
  v_count integer;
begin
  update core.profile_origin o
  set city_name    = coalesce(o.city_name, g.city_name),
      country_name = coalesce(o.country_name, g.country_name)
  from core.geocode_cache g
  where o.origin_point is not null
    and (o.city_name is null or o.country_name is null)
    and g.status = 'resolved'
    and g.lat3 = round(ST_Y(o.origin_point::geometry)::numeric, 3)
    and g.lng3 = round(ST_X(o.origin_point::geometry)::numeric, 3)
    and (o.city_name is distinct from coalesce(o.city_name, g.city_name)
      or o.country_name is distinct from coalesce(o.country_name, g.country_name));

  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

comment on function core.apply_geocode_cache() is
  'Preenche cidade e país em core.profile_origin a partir do cache. Nunca sobrescreve o que veio de core.city_boundaries.';

-- ---------------------------------------------------------------------------
-- Orquestrador: as três fases em ordem, uma chamada só para o cron.
-- ---------------------------------------------------------------------------
create or replace function core.run_geocode_backfill(p_limit integer default 1)
returns jsonb
language plpgsql
security definer
set search_path to 'core','public'
as $$
declare
  v_collected integer;
  v_applied   integer;
  v_queued    integer;
begin
  -- colher antes de enfileirar: a resposta de agora é da rodada anterior
  v_collected := core.collect_geocode_responses();
  v_applied   := core.apply_geocode_cache();
  v_queued    := core.enqueue_geocode_lookups(p_limit);

  return jsonb_build_object('collected', v_collected, 'applied', v_applied, 'queued', v_queued);
end;
$$;

comment on function core.run_geocode_backfill(integer) is
  'Uma rodada do backfill de geocodificação: colhe respostas pendentes, aplica no relatório e enfileira a próxima coordenada.';

-- ---------------------------------------------------------------------------
-- Privilégios — o schema core dá `authenticated=arwd` a toda tabela nova.
-- ---------------------------------------------------------------------------
revoke all on core.geocode_cache from public, anon, authenticated;
grant select, insert, update, delete on core.geocode_cache to service_role;

alter table core.geocode_cache enable row level security;
alter table core.geocode_cache force row level security;

revoke all on function core.enqueue_geocode_lookups(integer)  from public, anon, authenticated;
revoke all on function core.collect_geocode_responses()       from public, anon, authenticated;
revoke all on function core.apply_geocode_cache()             from public, anon, authenticated;
revoke all on function core.run_geocode_backfill(integer)     from public, anon, authenticated;
grant execute on function core.run_geocode_backfill(integer) to service_role;

-- ---------------------------------------------------------------------------
-- Agendamento — 1 requisição a cada 5 min = 12/hora, contra o teto de 4/minuto.
-- A fila inicial (71 coordenadas em 30/08/2026) drena em ~6 h; depois só o
-- fluxo novo, que é dezena por mês.
-- ---------------------------------------------------------------------------
select cron.schedule(
  'geocode-backfill',
  '*/5 * * * *',
  $cron$ SELECT core.run_geocode_backfill(1); $cron$
);

-- ---------------------------------------------------------------------------
-- Acompanhamento
-- ---------------------------------------------------------------------------
-- select status, count(*) from core.geocode_cache group by 1;
--
-- select count(*) filter (where city_name is null) ainda_sem_cidade,
--        count(*) filter (where country_name is null) ainda_sem_pais
-- from core.profile_origin where origin_point is not null;
--
-- Para acelerar a drenagem inicial sem violar a política (teto de 4/min),
-- rodar manualmente algumas vezes: select core.run_geocode_backfill(1);
