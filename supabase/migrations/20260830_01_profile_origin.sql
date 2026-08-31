-- ============================================================================
-- ⚠️  APLICAR MANUALMENTE NO PAINEL. NUNCA DDL via CLI.
-- ============================================================================
-- core.profile_origin — onde cada conta nasceu.
--
-- MOTIVO
-- O CMS não sabe responder "de onde vieram os cadastros deste mês". A pergunta
-- foi respondida à mão em agosto/2026 e revelou 35 contas nascidas no mesmo
-- ponto da Av. Assunção, em Cabo Frio, a 85 m do trigger point do evento
-- Vila Gastronômica — com apenas 4 atribuídas a parceiro. Esta tabela torna a
-- resposta barata e repetível.
--
-- REGRA DE ORIGEM (SSOT — nenhuma outra camada redeclara isto)
--   1. Primeiro registro de drive.user_location_history do perfil, que é a
--      posição gravada quando a permissão de localização é concedida.
--   2. Fallback: drive.profiles.latitude/longitude SOMENTE quando login_count = 1.
--      Sem relogin, a coordenada do perfil não pôde ter sido reescrita.
--   3. Sem nenhum dos dois: origem nula.
--
--   NÃO usar drive.session_heartbeats: é telemetria de sessão de guia, não tem
--   coordenada e só existe quando o guia roda.
--
--   Medições que sustentam a regra (agosto/2026, 189 contas):
--     · 163 de 169 primeiros pings ocorrem em até 1 h da criação da conta
--     · nenhum passa de 7 dias
--     · accuracy mediana do primeiro ping: 11,5 m
--     · profiles.latitude fica a 3 m (mediana) do primeiro ping, contra 13 m do
--       último — é gravada uma vez, no início, mas muda no relogin
--
-- GDPR — coordenada de origem é dado pessoal. Decisões desta migration:
--   · Minimização: nenhuma PII aqui. Só profile_id (pseudônimo), coordenada,
--     cidade e país. Sem nome, e-mail, telefone ou IP.
--   · Retenção: origin_point é apagado após 180 dias por
--     core.purge_profile_origin_points(). Os agregados (cidade, país, cluster)
--     sobrevivem; o ponto individual, não.
--   · Apagamento: FK ON DELETE CASCADE — apagar o perfil apaga a origem.
--   · Finalidade: analytics de aquisição. Registrada nos COMMENTs abaixo.
--   · k-anonimato e recorte por parceiro ficam na RPC de leitura (migration 03),
--     que é a única porta de saída destes dados.
--
-- SEGURANÇA — o schema core tem default ACL `authenticated=arwd` para tabelas.
-- Toda tabela nova nasce legível E GRAVÁVEL por qualquer usuário logado do app.
-- Por isso o REVOKE explícito no fim é obrigatório, não decorativo.
-- Ver também: TRUNCATE ignora RLS e a plataforma o concede por padrão.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1. Tabela
-- ---------------------------------------------------------------------------
create table if not exists core.profile_origin (
  profile_id          uuid primary key
                      references drive.profiles (id) on delete cascade,

  -- criação da conta, copiada para permitir filtro por mês sem join
  profile_created_at  timestamptz not null,

  -- a coordenada de origem; apagada após 180 dias pela política de retenção
  origin_point        geography(Point, 4326),
  origin_source       text not null default 'none'
                      check (origin_source in ('location_history','profile_fallback','none')),
  origin_recorded_at  timestamptz,

  -- distância em minutos entre a criação da conta e o ping: a régua de confiança
  lag_minutes         integer,
  accuracy_meters     real,

  -- resolvidos de core.city_boundaries; sobrevivem à purga do ponto
  city_name           text,
  country_name        text,

  partner_id          uuid,

  -- do primeiro ping: versão instalada na época, não a versão atual do perfil
  platform            text,
  app_version         text,

  cluster_id          uuid,

  refreshed_at        timestamptz not null default now(),
  point_purged_at     timestamptz
);

comment on table core.profile_origin is
  'Onde cada conta nasceu. Dado pessoal (localização): finalidade restrita a analytics de aquisição, '
  'retenção do ponto de 180 dias via core.purge_profile_origin_points(), apagamento em cascata com o perfil. '
  'Leitura apenas por core.dashboard_acquisition().';

comment on column core.profile_origin.origin_source is
  'location_history = primeiro ping (permissão concedida); profile_fallback = coordenada do perfil com login_count = 1; none = sem origem.';

comment on column core.profile_origin.lag_minutes is
  'Minutos entre a criação da conta e o primeiro ping. Acima de 60 a origem é menos confiável como local de nascimento.';

comment on column core.profile_origin.origin_point is
  'Coordenada de origem. Apagada após 180 dias (LGPD/GDPR, minimização). point_purged_at registra quando.';

create index if not exists idx_profile_origin_created
  on core.profile_origin (profile_created_at desc);

create index if not exists idx_profile_origin_city
  on core.profile_origin (city_name) where city_name is not null;

create index if not exists idx_profile_origin_partner
  on core.profile_origin (partner_id) where partner_id is not null;

create index if not exists idx_profile_origin_cluster
  on core.profile_origin (cluster_id) where cluster_id is not null;

create index if not exists idx_profile_origin_point
  on core.profile_origin using gist (origin_point) where origin_point is not null;

-- ---------------------------------------------------------------------------
-- 2. Refresh incremental
--
-- Custo medido em 2026-08-30 na janela de 45 dias: 151 ms, ~900 buffers,
-- Index Scan Backward em idx_ulh_user_time. A cada 10 min é folgado.
-- ---------------------------------------------------------------------------
create or replace function core.refresh_profile_origin(p_since timestamptz default null)
returns integer
language plpgsql
security definer
set search_path to 'core','drive','public','extensions'
as $$
declare
  v_since timestamptz := coalesce(p_since, now() - interval '45 days');
  v_count integer;
begin
  with alvo as (
    -- perfis recentes, mais os que ainda não têm origem: um ping pode chegar depois
    select p.id, p.created_at, p.latitude, p.longitude, p.login_count,
           p.partner_id, p.last_platform, p.last_app_version
    from drive.profiles p
    left join core.profile_origin o on o.profile_id = p.id
    where p.created_at >= v_since
       or o.profile_id is null
       or o.origin_source = 'none'
  ),
  primeiro_ping as (
    select a.*, l.latitude ping_lat, l.longitude ping_lng, l.created_at ping_at,
           l.accuracy ping_acc, l.platform ping_platform, l.app_version ping_version
    from alvo a
    left join lateral (
      select latitude, longitude, created_at, accuracy, platform, app_version
      from drive.user_location_history h
      where h.user_id = a.id
      order by h.created_at asc
      limit 1
    ) l on true
  ),
  resolvido as (
    select
      p.id,
      p.created_at,
      p.partner_id,
      case
        when p.ping_lat is not null then 'location_history'
        when p.login_count = 1 and p.latitude is not null then 'profile_fallback'
        else 'none'
      end as origin_source,
      case
        when p.ping_lat is not null
          then ST_SetSRID(ST_MakePoint(p.ping_lng, p.ping_lat), 4326)::geography
        when p.login_count = 1 and p.latitude is not null
          then ST_SetSRID(ST_MakePoint(p.longitude, p.latitude), 4326)::geography
      end as origin_point,
      p.ping_at as origin_recorded_at,
      case when p.ping_at is not null
           then round(extract(epoch from (p.ping_at - p.created_at)) / 60)::integer
      end as lag_minutes,
      p.ping_acc as accuracy_meters,
      coalesce(p.ping_platform, p.last_platform) as platform,
      coalesce(p.ping_version, p.last_app_version) as app_version
    from primeiro_ping p
  ),
  com_lugar as (
    select r.*,
           coalesce(cb.name_en, cb.name) as city_name,
           coalesce(pb.name_en, pb.name) as country_name
    from resolvido r
    left join lateral (
      select name, name_en from core.city_boundaries b
      where r.origin_point is not null
        and b.admin_level between 6 and 10
        and b.geom && r.origin_point::geometry
        and ST_Contains(b.geom, r.origin_point::geometry)
      order by b.admin_level desc
      limit 1
    ) cb on true
    left join lateral (
      select name, name_en from core.city_boundaries b
      where r.origin_point is not null
        and b.admin_level = 2
        and b.geom && r.origin_point::geometry
        and ST_Contains(b.geom, r.origin_point::geometry)
      limit 1
    ) pb on true
  )
  insert into core.profile_origin as po (
    profile_id, profile_created_at, origin_point, origin_source, origin_recorded_at,
    lag_minutes, accuracy_meters, city_name, country_name, partner_id,
    platform, app_version, refreshed_at
  )
  select id, created_at, origin_point, origin_source, origin_recorded_at,
         lag_minutes, accuracy_meters, city_name, country_name, partner_id,
         platform, app_version, now()
  from com_lugar
  on conflict (profile_id) do update set
    profile_created_at = excluded.profile_created_at,
    -- não ressuscita ponto já purgado pela retenção
    origin_point       = case when po.point_purged_at is null
                              then excluded.origin_point else null end,
    origin_source      = excluded.origin_source,
    origin_recorded_at = excluded.origin_recorded_at,
    lag_minutes        = excluded.lag_minutes,
    accuracy_meters    = excluded.accuracy_meters,
    city_name          = excluded.city_name,
    country_name       = excluded.country_name,
    partner_id         = excluded.partner_id,
    platform           = excluded.platform,
    app_version        = excluded.app_version,
    refreshed_at       = now();

  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

comment on function core.refresh_profile_origin(timestamptz) is
  'Upsert incremental de core.profile_origin. Sem argumento, refaz os últimos 45 dias mais os perfis sem origem resolvida. Agendada no pg_cron a cada 10 min.';

-- ---------------------------------------------------------------------------
-- 3. Retenção do ponto — GDPR, minimização
--
-- Após 180 dias o ponto individual é apagado. Cidade, país e cluster ficam:
-- o agregado responde a pergunta de negócio sem manter a localização da pessoa.
-- ---------------------------------------------------------------------------
create or replace function core.purge_profile_origin_points(p_older_than interval default interval '180 days')
returns integer
language plpgsql
security definer
set search_path to 'core','public'
as $$
declare
  v_count integer;
begin
  update core.profile_origin
  set origin_point = null,
      accuracy_meters = null,
      point_purged_at = now()
  where origin_point is not null
    and profile_created_at < now() - p_older_than;

  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

comment on function core.purge_profile_origin_points(interval) is
  'GDPR/LGPD: apaga a coordenada individual após 180 dias, preservando os agregados (cidade, país, cluster). Agendada no pg_cron, diária.';

-- ---------------------------------------------------------------------------
-- 4. Privilégios
--
-- OBRIGATÓRIO: o default ACL de core dá `authenticated=arwd` a toda tabela nova.
-- Sem estes REVOKE, qualquer usuário logado do app leria e escreveria a
-- coordenada de origem de todos os usuários.
-- ---------------------------------------------------------------------------
revoke all on core.profile_origin from public, anon, authenticated;
grant select, insert, update, delete on core.profile_origin to service_role;

alter table core.profile_origin enable row level security;
alter table core.profile_origin force row level security;
-- Sem policy: nenhum acesso direto. A leitura passa só por
-- core.dashboard_acquisition() (SECURITY DEFINER), na migration 03.

revoke all on function core.refresh_profile_origin(timestamptz) from public, anon, authenticated;
revoke all on function core.purge_profile_origin_points(interval) from public, anon, authenticated;
grant execute on function core.refresh_profile_origin(timestamptz) to service_role;
grant execute on function core.purge_profile_origin_points(interval) to service_role;

-- ---------------------------------------------------------------------------
-- 5. Agendamento
-- ---------------------------------------------------------------------------
select cron.schedule(
  'refresh-profile-origin',
  '*/10 * * * *',
  $cron$ SELECT core.refresh_profile_origin(); $cron$
);

select cron.schedule(
  'purge-profile-origin-points',
  '20 3 * * *',
  $cron$ SELECT core.purge_profile_origin_points(); $cron$
);

-- ---------------------------------------------------------------------------
-- 6. Backfill inicial
--
-- Roda uma vez, cobrindo desde o primeiro perfil. Fora do cron porque a janela
-- é maior que a do refresh incremental.
-- ---------------------------------------------------------------------------
-- select core.refresh_profile_origin('2020-01-01'::timestamptz);

-- ---------------------------------------------------------------------------
-- 7. Conferência
--
-- Agosto/2026 estava em curso durante o desenvolvimento e os totais subiam a
-- cada hora (189 às 13h, 197 às 15h do dia 30). Por isso confira INVARIANTES,
-- não absolutos:
--
--   · sem_origem + hist + fallback = total
--   · a esmagadora maioria dos pings cai em até 1 h da criação da conta
--     (170 de 180 na extração de 2026-08-30 15h)
--   · fallback é sempre uma minoria de um dígito — é o caso raro de permissão
--     concedida sem nenhum ping
--   · Cabo Frio é a cidade líder do mês, à frente de Saquarema, por conta da
--     ativação na Vila Gastronômica
-- ---------------------------------------------------------------------------
-- select count(*) total,
--        count(*) filter (where origin_source = 'location_history') hist,
--        count(*) filter (where origin_source = 'profile_fallback') fallback,
--        count(*) filter (where origin_source = 'none') sem_origem,
--        count(*) filter (where lag_minutes <= 60) lag_ate_1h,
--        count(partner_id) com_parceiro
-- from core.profile_origin
-- where profile_created_at >= '2026-08-01' and profile_created_at < '2026-09-01';
