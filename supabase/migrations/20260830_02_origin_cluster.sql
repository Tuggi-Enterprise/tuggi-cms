-- ============================================================================
-- ⚠️  APLICAR MANUALMENTE NO PAINEL. NUNCA DDL via CLI.
-- Depende de: 20260830_01_profile_origin.sql
-- ============================================================================
-- core.origin_cluster — os pontos onde contas nascem juntas.
--
-- MOTIVO
-- Contas que nascem no mesmo lugar quase nunca são coincidência: são ativação
-- presencial. Em agosto/2026 este agrupamento revelou 35 contas na Av. Assunção,
-- em Cabo Frio, a 85 m do trigger point do evento Vila Gastronômica — sem que
-- nenhuma trilha de clique existisse (o dia 29 teve 30 cadastros e 1 clique).
-- É a única forma de enxergar aquisição que não passa por link.
--
-- PARÂMETROS
-- ST_ClusterDBSCAN com eps = 0.0027 (~300 m) e minpoints = 2 — os mesmos que
-- produziram os 8 clusters de agosto/2026. eps em graus é aceitável aqui porque
-- a análise é por cidade, não global; a distorção de longitude fora dos trópicos
-- encolhe o raio leste-oeste, o que erra para o lado seguro (agrupa menos).
--
-- ROTULAGEM, em três degraus:
--   1. trigger point ATIVO e APROVADO de uma core.attractions com
--      entity_kind = 'event', dentro de 200 m → nome do evento
--   2. parceiro em partner.clients com coordenada dentro de 200 m → nome
--   3. sem rótulo — a tela mostra só a coordenada (ou nem isso, conforme o
--      k-anonimato da RPC de leitura)
--
--   ⚠️ O degrau 2 não funciona hoje: os 39 parceiros de Cabo Frio têm
--   welcome_poi_id apontando para core.attractions com osm_geometry nula.
--   Enquanto não houver coordenada de parceiro, só o degrau 1 rotula.
--
-- GDPR
--   · O centroide é agregado, não é a posição de uma pessoa — mas com poucas
--     contas ainda reidentifica. O corte de k-anonimato (5+ contas para
--     parceiro) fica na RPC de leitura, que é a única porta de saída.
--   · account_count e attributed_count são contagens, não listas.
--   · Clusters sobrevivem à purga dos pontos individuais aos 180 dias: é
--     exatamente esse o desenho — o agregado responde a pergunta de negócio
--     sem manter a localização da pessoa.
-- ============================================================================

create table if not exists core.origin_cluster (
  id                uuid primary key default gen_random_uuid(),

  -- primeiro dia do mês analisado
  month             date not null,

  centroid          geography(Point, 4326) not null,
  account_count     integer not null,
  attributed_count  integer not null default 0,

  first_seen        timestamptz not null,
  last_seen         timestamptz not null,

  label             text,
  label_source      text check (label_source in ('event_trigger_point','partner','none')),
  label_ref_id      uuid,
  label_distance_m  integer,

  refreshed_at      timestamptz not null default now(),

  unique (month, centroid)
);

comment on table core.origin_cluster is
  'Pontos onde várias contas nasceram no mesmo lugar, por mês. Agregado: guarda contagem e centroide, nunca a lista de pessoas. Rotulado por proximidade a trigger point de evento ou a parceiro.';

create index if not exists idx_origin_cluster_month
  on core.origin_cluster (month desc, account_count desc);

create index if not exists idx_origin_cluster_centroid
  on core.origin_cluster using gist (centroid);

alter table core.profile_origin
  drop constraint if exists profile_origin_cluster_fk;

alter table core.profile_origin
  add constraint profile_origin_cluster_fk
  foreign key (cluster_id) references core.origin_cluster (id) on delete set null;

-- ---------------------------------------------------------------------------
-- Refresh dos clusters de um mês. Idempotente: recalcula do zero.
-- ---------------------------------------------------------------------------
create or replace function core.refresh_origin_clusters(p_month date default null)
returns integer
language plpgsql
security definer
set search_path to 'core','partner','public','extensions'
as $$
declare
  v_month date := date_trunc('month', coalesce(p_month, current_date))::date;
  v_next  date := (v_month + interval '1 month')::date;
  v_count integer;
begin
  -- solta as referências antes de apagar os clusters do mês
  update core.profile_origin
  set cluster_id = null
  where profile_created_at >= v_month
    and profile_created_at <  v_next;

  delete from core.origin_cluster where month = v_month;

  with pontos as (
    select profile_id, origin_point, profile_created_at, partner_id,
           ST_ClusterDBSCAN(origin_point::geometry, eps => 0.0027, minpoints => 2)
             over () as grupo
    from core.profile_origin
    where profile_created_at >= v_month
      and profile_created_at <  v_next
      and origin_point is not null
  ),
  agrupado as (
    select grupo,
           ST_Centroid(ST_Collect(origin_point::geometry))::geography as centroid,
           count(*)                        as account_count,
           count(partner_id)               as attributed_count,
           min(profile_created_at)         as first_seen,
           max(profile_created_at)         as last_seen
    from pontos
    where grupo is not null
    group by grupo
    having count(*) >= 2
  ),
  rotulado as (
    select a.*,
           coalesce(ev.name, pa.name)                              as label,
           case when ev.name is not null then 'event_trigger_point'
                when pa.name is not null then 'partner'
                else 'none' end                                    as label_source,
           coalesce(ev.id, pa.id)                                  as label_ref_id,
           coalesce(ev.metros, pa.metros)                          as label_distance_m
    from agrupado a
    -- degrau 1: trigger point de evento ativo e aprovado
    left join lateral (
      select at.id, at.name,
             round(ST_Distance(tp.location, a.centroid))::integer as metros
      from core.attraction_trigger_points tp
      join core.attractions at on at.id = tp.attraction_id
      where tp.is_active
        and at.entity_kind = 'event'
        and ST_DWithin(tp.location, a.centroid, 200)
      order by ST_Distance(tp.location, a.centroid)
      limit 1
    ) ev on true
    -- degrau 2: parceiro com coordenada (hoje sem efeito: osm_geometry nula)
    left join lateral (
      select c.id, c.name,
             round(ST_Distance(at.osm_geometry, a.centroid))::integer as metros
      from partner.clients c
      join core.attractions at on at.id = c.welcome_poi_id
      where ev.id is null
        and at.osm_geometry is not null
        and ST_DWithin(at.osm_geometry, a.centroid, 200)
      order by ST_Distance(at.osm_geometry, a.centroid)
      limit 1
    ) pa on true
  ),
  inserido as (
    insert into core.origin_cluster (
      month, centroid, account_count, attributed_count,
      first_seen, last_seen, label, label_source, label_ref_id, label_distance_m
    )
    select v_month, centroid, account_count, attributed_count,
           first_seen, last_seen, label, label_source, label_ref_id, label_distance_m
    from rotulado
    returning id, centroid
  )
  -- liga cada perfil ao cluster cujo centroide é o mais próximo dentro de 400 m
  update core.profile_origin po
  set cluster_id = c.id
  from inserido c
  where po.profile_created_at >= v_month
    and po.profile_created_at <  v_next
    and po.origin_point is not null
    and ST_DWithin(po.origin_point, c.centroid, 400)
    and not exists (
      select 1 from inserido c2
      where ST_DWithin(po.origin_point, c2.centroid, 400)
        and ST_Distance(po.origin_point, c2.centroid) < ST_Distance(po.origin_point, c.centroid)
    );

  select count(*) into v_count from core.origin_cluster where month = v_month;
  return v_count;
end;
$$;

comment on function core.refresh_origin_clusters(date) is
  'Recalcula os clusters de origem de um mês (DBSCAN ~300 m, mínimo 2 contas) e os rotula por proximidade a trigger point de evento ou a parceiro. Idempotente. Agendada de hora em hora para o mês corrente.';

-- ---------------------------------------------------------------------------
-- Privilégios — mesmo cuidado da migration 01: o default ACL de core dá
-- `authenticated=arwd` a toda tabela nova.
-- ---------------------------------------------------------------------------
revoke all on core.origin_cluster from public, anon, authenticated;
grant select, insert, update, delete on core.origin_cluster to service_role;

alter table core.origin_cluster enable row level security;
alter table core.origin_cluster force row level security;
-- Sem policy: leitura só por core.dashboard_acquisition() (migration 03).

revoke all on function core.refresh_origin_clusters(date) from public, anon, authenticated;
grant execute on function core.refresh_origin_clusters(date) to service_role;

-- ---------------------------------------------------------------------------
-- Agendamento: só o mês corrente, de hora em hora. Meses fechados não mudam.
-- ---------------------------------------------------------------------------
select cron.schedule(
  'refresh-origin-clusters',
  '25 * * * *',
  $cron$ SELECT core.refresh_origin_clusters(); $cron$
);

-- ---------------------------------------------------------------------------
-- Backfill de agosto/2026 (rodar depois do backfill da migration 01)
-- ---------------------------------------------------------------------------
-- select core.refresh_origin_clusters('2026-08-01');
--
-- Conferência: o maior cluster do mês fica na Av. Assunção, Cabo Frio, rotulado
-- 'Vila Gastronômica - Festival Sabores de Cabo Frio' pelo degrau 1, com o
-- trigger point a menos de 100 m do centroide. Os demais clusters do mês ficam
-- sem rótulo enquanto os parceiros não tiverem coordenada.
--
-- select label, label_source, label_distance_m, account_count, attributed_count,
--        first_seen::date, last_seen::date
-- from core.origin_cluster where month = '2026-08-01'
-- order by account_count desc;
