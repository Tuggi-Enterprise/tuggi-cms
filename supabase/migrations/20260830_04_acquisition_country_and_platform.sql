-- ============================================================================
-- ⚠️  APLICAR MANUALMENTE NO PAINEL. NUNCA DDL via CLI.
-- Depende de: 20260830_03_dashboard_acquisition_rpc.sql (substitui a função)
-- ============================================================================
-- Adiciona país e sistema operacional a core.dashboard_acquisition().
--
-- PAÍS — ⚠️ cobertura conhecida e limitada
-- core.city_boundaries tem apenas SETE países em admin_level = 2: Argentina,
-- Brasil, México, Portugal, Espanha, Estados Unidos e Uruguai. Toda conta
-- nascida fora deles fica sem país mesmo tendo coordenada — em agosto/2026 são
-- 36 contas, a Itália inteira entre elas.
--
-- Conserto barato e desproporcionalmente útil: importar os ~200 polígonos de
-- admin_level = 2 do mundo. É ordens de grandeza menor que importar municípios
-- e resolveria o país de 100% das contas com coordenada. Enquanto não vier, a
-- tela mostra 'unidentified' em vez de fingir que o país não existe.
--
-- drive.profiles.country NÃO serve de reserva: está integralmente nulo (0 de
-- 197 em agosto/2026).
--
-- SISTEMA OPERACIONAL
-- Vem de core.profile_origin.platform, que é a plataforma do PRIMEIRO ping —
-- o aparelho com que a conta nasceu. Não confundir com profiles.last_platform,
-- que é o aparelho atual. Cobertura de 193 em 197 no mês de referência.
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
  summary_row as (
    select jsonb_build_object(
      'total',              count(*),
      'with_partner',       count(partner_id),
      'located',            count(city_name),
      'outside_boundaries', count(*) filter (where origin_point is not null and city_name is null),
      'without_origin',     count(*) filter (where origin_source = 'none'),
      'from_fallback',      count(*) filter (where origin_source = 'profile_fallback'),
      'distinct_cities',    count(distinct city_name),
      'distinct_countries', count(distinct country_name),
      'in_clusters',        count(cluster_id),
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
  day_series as (
    select d::date day_at from generate_series(v_month, v_next - 1, interval '1 day') d
  ),
  daily_rows as (
    select jsonb_agg(jsonb_build_object(
             'day',          x.day_at,
             'total',        x.total,
             'with_partner', x.with_partner,
             'cumulative',   x.cumulative
           ) order by x.day_at) j
    from (
      select d.day_at,
             count(b.profile_id)                                              as total,
             count(b.partner_id)                                              as with_partner,
             sum(count(b.profile_id)) over (order by d.day_at)                    as cumulative
      from day_series d
      left join base b
        on (b.profile_created_at at time zone 'America/Sao_Paulo')::date = d.day_at
      group by d.day_at
    ) x
  ),
  -- cidades
  city_rows as (
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
  -- países
  --
  -- 'unidentified' = tem coordenada, mas o país não está entre os sete em
  -- city_boundaries. É lacuna de catálogo, não ausência de origem.
  country_rows as (
    select jsonb_agg(jsonb_build_object(
             'country',      coalesce(country_name, ''),
             'status',       status,
             'total',        total,
             'with_partner', with_partner,
             'ios',          ios,
             'android',      android
           ) order by total desc, country_name nulls last) j
    from (
      select country_name,
             case
               when country_name is not null then 'identified'
               when origin_point is not null then 'unidentified'
               else 'without_origin'
             end as status,
             count(*) total,
             count(partner_id) with_partner,
             count(*) filter (where platform = 'ios')     ios,
             count(*) filter (where platform = 'android') android
      from base
      group by country_name,
               case
                 when country_name is not null then 'identified'
                 when origin_point is not null then 'unidentified'
                 else 'without_origin'
               end
    ) p
  ),
  -- sistema operacional do aparelho com que a conta nasceu
  platform_rows as (
    select jsonb_agg(jsonb_build_object(
             'platform',     coalesce(platform, ''),
             'total',        total,
             'with_partner', with_partner
           ) order by total desc) j
    from (
      select platform, count(*) total, count(partner_id) with_partner
      from base
      group by platform
    ) x
  ),
  -- parceiros
  partner_rows as (
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
    'summary',    (select j from summary_row),
    'daily',      coalesce((select j from daily_rows),      '[]'::jsonb),
    'cities',     coalesce((select j from city_rows),     '[]'::jsonb),
    'countries',  coalesce((select j from country_rows),      '[]'::jsonb),
    'platforms',  coalesce((select j from platform_rows), '[]'::jsonb),
    'partners',   coalesce((select j from partner_rows),   '[]'::jsonb),
    'clusters',   coalesce((select j from clusters),    '[]'::jsonb)
  ) into v_result;

  return v_result;
end;
$$;

comment on function core.dashboard_acquisition(date, uuid) is
  'Analytics de aquisição por mês: resumo, série diária, cidades, países, sistema operacional, parceiros e clusters de origem. '
  'Única porta de leitura de core.profile_origin e core.origin_cluster (ambas com RLS e sem policy). '
  'Admin da plataforma vê tudo; parceiro vê o próprio escopo e só recebe centroide de cluster com 5+ contas. '
  'País só resolve para os sete admin_level=2 presentes em core.city_boundaries.';

revoke all on function core.dashboard_acquisition(date, uuid) from public, anon;
grant execute on function core.dashboard_acquisition(date, uuid) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- Conferência (agosto/2026, extração de 2026-08-31):
--   Brazil 105 · não identificado 53 · United States 14 · Spain 12 ·
--   Portugal 10 · Argentina 3
--   android ~114 · ios ~79 · sem plataforma 4
-- ---------------------------------------------------------------------------
-- select jsonb_pretty(core.dashboard_acquisition('2026-08-01') -> 'countries');
-- select jsonb_pretty(core.dashboard_acquisition('2026-08-01') -> 'platforms');
