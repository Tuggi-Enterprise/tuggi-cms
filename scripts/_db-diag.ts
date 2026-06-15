import { createClient } from '@supabase/supabase-js';

const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const key = process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY!;
const sb = createClient(url, key, { auth: { persistSession: false }, db: { schema: 'core' } });

async function diag(sql: string): Promise<any> {
  const { data, error } = await sb.rpc('diag_sql', { q: sql.trim().replace(/\s+/g, ' ') });
  if (error) throw new Error(error.message);
  return data;
}

async function section(label: string, sql: string) {
  console.log(`\n\n========== ${label} ==========`);
  try {
    const rows = await diag(sql);
    console.log(JSON.stringify(rows, null, 2));
  } catch (e: any) {
    console.log('ERR:', e.message);
  }
}

const DOMAIN = `'core','homolog','drive','marketing','public'`;

(async () => {
  // 0. sanity
  await section('0. SANITY', 'select current_database() as db, version() as version');

  // 1. TABLES — tamanho, uso (scans), linhas vivas/mortas, último scan
  await section('1A. TABELAS: tamanho + uso (scans) + linhas', `
    select n.nspname as schema, c.relname as table,
      pg_size_pretty(pg_total_relation_size(c.oid)) as total_size,
      pg_total_relation_size(c.oid) as total_bytes,
      s.n_live_tup as live_rows, s.n_dead_tup as dead_rows,
      coalesce(s.seq_scan,0) as seq_scan, coalesce(s.idx_scan,0) as idx_scan,
      s.last_autovacuum, s.last_autoanalyze
    from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
    left join pg_stat_all_tables s on s.relid = c.oid
    where c.relkind = 'r' and n.nspname in (${DOMAIN})
    order by pg_total_relation_size(c.oid) desc`);

  // 1B. Candidatas a DROP: zero scans + zero/poucas linhas
  await section('1B. TABELAS candidatas a remover (0 scans)', `
    select n.nspname as schema, c.relname as table,
      pg_size_pretty(pg_total_relation_size(c.oid)) as size,
      s.n_live_tup as live_rows,
      coalesce(s.seq_scan,0)+coalesce(s.idx_scan,0) as total_scans
    from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
    left join pg_stat_all_tables s on s.relid = c.oid
    where c.relkind='r' and n.nspname in (${DOMAIN})
      and coalesce(s.seq_scan,0)+coalesce(s.idx_scan,0) = 0
    order by pg_total_relation_size(c.oid) desc`);

  // 2A. INDEXES nunca usados (idx_scan=0) — EXCLUI PK/unique/constraint e marca tipo
  await section('2A. INDEXES nunca usados (idx_scan=0)', `
    select n.nspname as schema, t.relname as table, i.relname as index,
      pg_size_pretty(pg_relation_size(i.oid)) as size,
      pg_relation_size(i.oid) as bytes,
      am.amname as index_type,
      ix.indisunique as is_unique, ix.indisprimary as is_primary,
      pg_get_indexdef(i.oid) as def
    from pg_index ix
    join pg_class i on i.oid = ix.indexrelid
    join pg_class t on t.oid = ix.indrelid
    join pg_namespace n on n.oid = t.relnamespace
    join pg_am am on am.oid = i.relam
    left join pg_stat_all_indexes s on s.indexrelid = i.oid
    where n.nspname in (${DOMAIN})
      and coalesce(s.idx_scan,0) = 0
      and not ix.indisprimary and not ix.indisunique
      and am.amname not in ('gist','gin','spgist','brin','hnsw','ivfflat')
    order by pg_relation_size(i.oid) desc`);

  // 2B. Índices ESPACIAIS/GiST/GIN (NÃO dropar por "0 scans" — lição 57014)
  await section('2B. INDEXES espaciais/GiST/GIN (NUNCA dropar por idx_scan=0)', `
    select n.nspname as schema, t.relname as table, i.relname as index,
      am.amname as type, coalesce(s.idx_scan,0) as idx_scan,
      pg_size_pretty(pg_relation_size(i.oid)) as size
    from pg_index ix
    join pg_class i on i.oid = ix.indexrelid
    join pg_class t on t.oid = ix.indrelid
    join pg_namespace n on n.oid = t.relnamespace
    join pg_am am on am.oid = i.relam
    left join pg_stat_all_indexes s on s.indexrelid = i.oid
    where n.nspname in (${DOMAIN}) and am.amname in ('gist','gin','spgist','brin')
    order by n.nspname, t.relname`);

  // 2C. Índices DUPLICADOS/redundantes (mesma definição de colunas)
  await section('2C. INDEXES duplicados (mesmas colunas)', `
    select n.nspname as schema, t.relname as table,
      ix.indkey::text as cols, count(*) as n_indexes,
      array_agg(i.relname) as index_names,
      pg_size_pretty(sum(pg_relation_size(i.oid))) as combined_size
    from pg_index ix
    join pg_class i on i.oid = ix.indexrelid
    join pg_class t on t.oid = ix.indrelid
    join pg_namespace n on n.oid = t.relnamespace
    where n.nspname in (${DOMAIN})
    group by n.nspname, t.relname, ix.indkey
    having count(*) > 1`);

  // 3A. ORGANIZAÇÃO: contagem por schema
  await section('3A. ORGANIZAÇÃO: tabelas/tamanho por schema', `
    select n.nspname as schema, count(*) as tables,
      pg_size_pretty(sum(pg_total_relation_size(c.oid))) as total_size
    from pg_class c join pg_namespace n on n.oid=c.relnamespace
    where c.relkind='r' and n.nspname in (${DOMAIN})
    group by n.nspname order by sum(pg_total_relation_size(c.oid)) desc`);

  // 3B. Tabelas no schema public (projeto NÃO deve usar public)
  await section('3B. Tabelas indevidas em public', `
    select c.relname as table, pg_size_pretty(pg_total_relation_size(c.oid)) as size
    from pg_class c join pg_namespace n on n.oid=c.relnamespace
    where c.relkind='r' and n.nspname='public' order by 1`);

  // 3C. Tabelas SEM primary key
  await section('3C. Tabelas SEM primary key', `
    select n.nspname as schema, c.relname as table
    from pg_class c join pg_namespace n on n.oid=c.relnamespace
    where c.relkind='r' and n.nspname in (${DOMAIN})
      and not exists (select 1 from pg_index ix where ix.indrelid=c.oid and ix.indisprimary)
    order by 1,2`);

  // 3D. Status de RLS por tabela
  await section('3D. RLS habilitado por tabela', `
    select n.nspname as schema, c.relname as table, c.relrowsecurity as rls_enabled,
      (select count(*) from pg_policies p where p.schemaname=n.nspname and p.tablename=c.relname) as policies
    from pg_class c join pg_namespace n on n.oid=c.relnamespace
    where c.relkind='r' and n.nspname in (${DOMAIN})
    order by c.relrowsecurity asc, 1,2`);

  // 4A. RECURSOS: extensions instaladas
  await section('4A. Extensions instaladas', `
    select extname as name, extversion as version from pg_extension order by 1`);

  // 4B. Cache hit ratio (heap + index) — alvo > 99%
  await section('4B. Cache hit ratio', `
    select 'heap' as kind,
      round(sum(heap_blks_hit)*100.0/nullif(sum(heap_blks_hit)+sum(heap_blks_read),0),2) as hit_pct
    from pg_statio_user_tables
    union all
    select 'index',
      round(sum(idx_blks_hit)*100.0/nullif(sum(idx_blks_hit)+sum(idx_blks_read),0),2)
    from pg_statio_user_indexes`);

  // 4C. Tabelas com muito seq_scan (candidatas a índice faltando)
  await section('4C. Muito seq_scan (índice faltando?)', `
    select n.nspname as schema, c.relname as table,
      s.seq_scan, s.idx_scan, s.n_live_tup as rows,
      pg_size_pretty(pg_total_relation_size(c.oid)) as size
    from pg_stat_all_tables s
    join pg_class c on c.oid=s.relid
    join pg_namespace n on n.oid=c.relnamespace
    where n.nspname in (${DOMAIN}) and s.seq_scan > 0 and s.n_live_tup > 5000
      and s.seq_scan > coalesce(s.idx_scan,0)
    order by s.seq_scan * s.n_live_tup desc limit 25`);

  // 4D. Bloat / dead tuples altos (precisa VACUUM)
  await section('4D. Dead tuples altos (VACUUM)', `
    select n.nspname as schema, c.relname as table,
      s.n_live_tup as live, s.n_dead_tup as dead,
      round(s.n_dead_tup*100.0/nullif(s.n_live_tup+s.n_dead_tup,0),1) as dead_pct,
      s.last_autovacuum, s.last_autoanalyze
    from pg_stat_all_tables s
    join pg_class c on c.oid=s.relid
    join pg_namespace n on n.oid=c.relnamespace
    where n.nspname in (${DOMAIN}) and s.n_dead_tup > 1000
    order by s.n_dead_tup desc limit 25`);

  // 4E. Settings chave de memória/planejamento
  await section('4E. Settings de memória/planejamento', `
    select name, setting, unit from pg_settings
    where name in ('shared_buffers','work_mem','maintenance_work_mem',
      'effective_cache_size','max_connections','random_page_cost',
      'default_statistics_target','max_parallel_workers_per_gather')
    order by name`);

  // 4F. pg_stat_statements — top queries por tempo total (se extensão existir)
  await section('4F. Top queries por tempo total (pg_stat_statements)', `
    select round(total_exec_time::numeric,0) as total_ms, calls,
      round(mean_exec_time::numeric,2) as mean_ms,
      round((100*total_exec_time/sum(total_exec_time) over ())::numeric,1) as pct,
      left(regexp_replace(query,'\\s+',' ','g'),140) as query
    from pg_stat_statements
    order by total_exec_time desc limit 20`);

  // 4G. Idade das estatísticas (idx_scan=0 só é confiável se stats forem antigas)
  await section('4G. Quando as stats foram resetadas (confiança do idx_scan=0)', `
    select datname, stats_reset,
      now() - stats_reset as stats_age
    from pg_stat_database where datname = current_database()`);

  console.log('\n\n>>> DIAGNÓSTICO COMPLETO <<<');
})().catch((e) => { console.error('FATAL:', e.message); process.exit(1); });
