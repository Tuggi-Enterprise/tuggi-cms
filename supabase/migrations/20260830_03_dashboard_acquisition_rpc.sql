-- ============================================================================
-- ⚠️  APLICAR MANUALMENTE NO PAINEL. NUNCA DDL via CLI.
-- Depende de: 20260830_01_profile_origin.sql, 20260830_02_origin_cluster.sql
-- ============================================================================
-- core.dashboard_acquisition — a única porta de saída dos dados de origem.
--
-- MOTIVO
-- core.profile_origin e core.origin_cluster têm RLS ligado e nenhuma policy:
-- ninguém lê direto. Toda a leitura passa por aqui, que é onde ficam o recorte
-- multi-tenant e o k-anonimato.
--
-- IDENTIDADE — segue o SSOT de 20260717_02_identity_ssot_and_scope_hardening.sql:
--   core.caller_email(), core.is_caller_platform_admin(), core.resolve_dashboard_scope().
--   NUNCA current_setting('request.jwt.claims.email') — essa GUC não existe e
--   retorna NULL sempre, o que faz o filtro casar com nada (ou com tudo).
--
-- GDPR — três decisões desta função:
--   1. Nenhuma linha individual sai daqui. Só contagens e agregados.
--   2. k-anonimato no centroide de cluster: admin da plataforma vê todos os
--      centroides (é o controlador do dado); parceiro só recebe centroide de
--      cluster com 5+ contas. Abaixo disso, o parceiro vê contagem e cidade,
--      sem coordenada — um cluster de 2 contas com centroide preciso pode
--      revelar onde alguém mora.
--   3. Parceiro vê apenas o que é dele: profile_origin.partner_id dentro do
--      escopo devolvido por core.resolve_dashboard_scope(), que é fail-closed.
--
-- PERFORMANCE
-- Lê só as tabelas materializadas pelas migrations 01 e 02, com índice por
-- profile_created_at. Nada de PostGIS em tempo de request: o ST_Contains contra
-- city_boundaries já rodou no cron.
-- ============================================================================

create or replace function core.dashboard_acquisition(
  p_month    date,
  p_owner_id uuid default null
)
returns jsonb
language plpgsql
stable
security definer
set search_path to 'core','public','extensions'
as $$
declare
  v_month     date := date_trunc('month', p_month)::date;
  v_next      date := (v_month + interval '1 month')::date;
  v_is_admin  boolean := core.is_caller_platform_admin();
  v_scope     uuid[];
  v_k         integer;
  v_result    jsonb;
begin
  -- Escopo — SSOT em core.resolve_dashboard_scope: devolve NULL para admin sem
  -- p_owner_id (visão global), o escopo do parceiro nos demais casos, e levanta
  -- 42501 quando o chamador pede fora do que é dele. Não redeclarar a regra aqui.
  v_scope := core.resolve_dashboard_scope(p_owner_id);

  -- k-anonimato: depende de QUEM chama, não de haver filtro. Admin da plataforma
  -- é o controlador do dado e vê todos os centroides, inclusive quando filtra por
  -- um parceiro; terceiro só recebe centroide de cluster com 5+ contas.
  v_k := case when v_is_admin then 1 else 5 end;

  with base as (
    select o.*
    from core.profile_origin o
    where o.profile_created_at >= v_month
      and o.profile_created_at <  v_next
      and (v_scope is null or o.partner_id = any (v_scope))
  ),
  -- resumo
  --
  -- Três estados de origem, que a tela NÃO deve misturar:
  --   located            → coordenada resolvida em um município importado
  --   outside_boundaries → tem coordenada, mas o município não está em
  --                        core.city_boundaries (Itália é o maior caso)
  --   without_origin     → não tem coordenada nenhuma
  resumo as (
    select jsonb_build_object(
      'total',              count(*),
      'with_partner',       count(partner_id),
      'located',            count(city_name),
      'outside_boundaries', count(*) filter (where origin_point is not null and city_name is null),
      'without_origin',     count(*) filter (where origin_source = 'none'),
      'from_fallback',      count(*) filter (where origin_source = 'profile_fallback'),
      'distinct_cities',    count(distinct city_name),
      'in_clusters',        count(cluster_id),
      -- confiança: quantas origens foram gravadas em até 1 h da criação da conta
      'origin_within_1h',   count(*) filter (where lag_minutes is not null and lag_minutes <= 60),
      'days_elapsed',       greatest(1, least(
                              extract(day from (v_next - interval '1 day'))::int,
                              case when v_next > (now() at time zone 'America/Sao_Paulo')::date
                                   then extract(day from (now() at time zone 'America/Sao_Paulo'))::int
                                   else extract(day from (v_next - interval '1 day'))::int end
                            ))
    ) j
    from base
  ),
  -- série diária, com acumulado
  dias as (
    select d::date dia from generate_series(v_month, v_next - 1, interval '1 day') d
  ),
  diario as (
    select jsonb_agg(jsonb_build_object(
             'day',          x.dia,
             'total',        x.total,
             'with_partner', x.with_partner,
             'cumulative',   x.cumulative
           ) order by x.dia) j
    from (
      select d.dia,
             count(b.profile_id)                                              as total,
             count(b.partner_id)                                              as with_partner,
             sum(count(b.profile_id)) over (order by d.dia)                    as cumulative
      from dias d
      left join base b
        on (b.profile_created_at at time zone 'America/Sao_Paulo')::date = d.dia
      group by d.dia
    ) x
  ),
  -- cidades
  --
  -- Cada linha carrega o próprio status, para a tela nunca somar cidade real
  -- com "não sei onde foi". As duas lacunas têm causas e consertos diferentes:
  -- outside_boundaries se resolve importando os municípios que faltam;
  -- without_origin é ausência de dado e não tem conserto retroativo.
  cidades as (
    select jsonb_agg(jsonb_build_object(
             'city',         coalesce(city_name, ''),
             'country',      coalesce(country_name, ''),
             'status',       status,
             'total',        total,
             'with_partner', with_partner
           ) order by total desc, city_name nulls last) j
    from (
      select city_name, country_name,
             case
               when city_name is not null      then 'located'
               when origin_point is not null   then 'outside_boundaries'
               else 'without_origin'
             end as status,
             count(*) total, count(partner_id) with_partner
      from base
      group by city_name, country_name,
               case
                 when city_name is not null    then 'located'
                 when origin_point is not null then 'outside_boundaries'
                 else 'without_origin'
               end
    ) c
  ),
  -- parceiros
  parceiros as (
    select jsonb_agg(jsonb_build_object(
             'partner_id', partner_id,
             'name',       coalesce(pc.name, ''),
             'total',      t.total
           ) order by t.total desc) j
    from (
      select partner_id, count(*) total
      from base where partner_id is not null
      group by partner_id
    ) t
    left join partner.clients pc on pc.id = t.partner_id
  ),
  -- clusters, com k-anonimato no centroide
  clusters as (
    select jsonb_agg(jsonb_build_object(
             'label',         coalesce(oc.label, ''),
             'label_source',  oc.label_source,
             'total',         k.total,
             'with_partner',  k.with_partner,
             'first_seen',    oc.first_seen,
             'last_seen',     oc.last_seen,
             -- centroide só quando o corte de k-anonimato permite
             'lat', case when k.total >= v_k then ST_Y(oc.centroid::geometry) end,
             'lng', case when k.total >= v_k then ST_X(oc.centroid::geometry) end,
             'coordinate_suppressed', (k.total < v_k)
           ) order by k.total desc) j
    from (
      select cluster_id, count(*) total, count(partner_id) with_partner
      from base where cluster_id is not null
      group by cluster_id
    ) k
    join core.origin_cluster oc on oc.id = k.cluster_id
  )
  select jsonb_build_object(
    'month',      v_month,
    'scoped',     (v_scope is not null),
    'summary',    (select j from resumo),
    'daily',      coalesce((select j from diario),    '[]'::jsonb),
    'cities',     coalesce((select j from cidades),   '[]'::jsonb),
    'partners',   coalesce((select j from parceiros), '[]'::jsonb),
    'clusters',   coalesce((select j from clusters),  '[]'::jsonb)
  ) into v_result;

  return v_result;
end;
$$;

comment on function core.dashboard_acquisition(date, uuid) is
  'Analytics de aquisição por mês: resumo, série diária, cidades, parceiros e clusters de origem. '
  'Única porta de leitura de core.profile_origin e core.origin_cluster (ambas com RLS e sem policy). '
  'Admin da plataforma vê tudo; parceiro vê o próprio escopo e só recebe centroide de cluster com 5+ contas.';

-- ---------------------------------------------------------------------------
-- Meses disponíveis, para popular o filtro sem varrer a tabela inteira no front
-- ---------------------------------------------------------------------------
create or replace function core.dashboard_acquisition_months()
returns jsonb
language sql
stable
security definer
set search_path to 'core','public'
as $$
  select coalesce(jsonb_agg(m order by m desc), '[]'::jsonb)
  from (
    select distinct date_trunc('month', profile_created_at)::date m
    from core.profile_origin
  ) x;
$$;

comment on function core.dashboard_acquisition_months() is
  'Meses com dados em core.profile_origin, do mais recente para o mais antigo. Popula o filtro da tela de aquisição.';

-- ---------------------------------------------------------------------------
-- Privilégios
-- ---------------------------------------------------------------------------
revoke all on function core.dashboard_acquisition(date, uuid) from public, anon;
revoke all on function core.dashboard_acquisition_months() from public, anon;
grant execute on function core.dashboard_acquisition(date, uuid) to authenticated, service_role;
grant execute on function core.dashboard_acquisition_months() to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- Conferência
-- ---------------------------------------------------------------------------
-- select core.dashboard_acquisition('2026-08-01');
--
-- O maior cluster do mês deve sair rotulado
-- 'Vila Gastronômica - Festival Sabores de Cabo Frio' (label_source =
-- 'event_trigger_point'), com o trigger point a ~104 m do centroide.
--
-- Teste de escopo, que precisa levantar 42501 e não devolver dado:
-- select core.dashboard_acquisition('2026-08-01', '<uuid de um parceiro alheio>');
