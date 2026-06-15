import { createClient } from '@supabase/supabase-js';
import * as fs from 'fs';
const url=process.env.NEXT_PUBLIC_SUPABASE_URL!;const key=process.env.SUPABASE_SECRET_KEY||process.env.SUPABASE_SERVICE_ROLE_KEY!;
const sb=createClient(url,key,{auth:{persistSession:false},db:{schema:'core'}});
async function diag(s:string){const{data,error}=await sb.rpc('diag_sql',{q:s.trim().replace(/\s+/g,' ')});if(error)throw new Error(error.message);return data;}

const REFERENCED = `
  referenced as (
    select regexp_replace(audio_url,'^.*/travel-app-audios/','') as path
      from core.attraction_descriptions where position('travel-app-audios/' in coalesce(audio_url,''))>0
    union
    select regexp_replace(audio_url,'^.*/travel-app-audios/','') from core.cache_narrations where position('travel-app-audios/' in coalesce(audio_url,''))>0
    union
    select regexp_replace(audio_url,'^.*/travel-app-audios/','') from core.custom_route_descriptions where position('travel-app-audios/' in coalesce(audio_url,''))>0
  )`;
// alvo de deleção: contextual inteiro + audio/master_audio não-referenciados
const TARGET = `
  (split_part(o.name,'/',1)='contextual_audio')
  or (split_part(o.name,'/',1) in ('audio','master_audio') and o.name not in (select path from referenced))`;

(async()=>{
  // 1. SUMMARY — confere totais antes de listar
  const summary = await diag(`with ${REFERENCED}
    select split_part(o.name,'/',1) as categoria, count(*) as arquivos,
      pg_size_pretty(sum((o.metadata->>'size')::bigint)) as tamanho,
      sum((o.metadata->>'size')::bigint) as bytes
    from storage.objects o
    where o.bucket_id='travel-app-audios' and (${TARGET})
    group by 1 order by sum((o.metadata->>'size')::bigint) desc`);
  console.log('\n===== DRY-RUN: resumo do que SERIA deletado =====');
  console.table(summary);
  const totBytes = (summary as any[]).reduce((s,r)=>s+Number(r.bytes),0);
  const totFiles = (summary as any[]).reduce((s,r)=>s+Number(r.arquivos),0);
  console.log(`TOTAL: ${totFiles} arquivos, ${(totBytes/1073741824).toFixed(2)} GB`);

  // SEGURANÇA: confirma que NENHUM referenciado entrou no alvo
  const leak = await diag(`with ${REFERENCED}
    select count(*) as referenced_no_alvo
    from storage.objects o
    where o.bucket_id='travel-app-audios' and o.name in (select path from referenced) and (${TARGET})`);
  console.log('CHECK vazamento (deve ser 0):', JSON.stringify(leak));

  // 2. LISTA COMPLETA → arquivo (para revisão e para a deleção futura)
  const rows = await diag(`with ${REFERENCED}
    select o.name, (o.metadata->>'size')::bigint as bytes, split_part(o.name,'/',1) as categoria
    from storage.objects o
    where o.bucket_id='travel-app-audios' and (${TARGET})
    order by 3, 1`);
  const out='/tmp/orphan-audios-dryrun.json';
  fs.writeFileSync(out, JSON.stringify(rows,null,1));
  fs.writeFileSync('/tmp/orphan-audios-paths.txt', (rows as any[]).map(r=>r.name).join('\n'));
  console.log(`\nLista completa (${(rows as any[]).length} paths) escrita em:\n  ${out}\n  /tmp/orphan-audios-paths.txt`);
  console.log('\nAmostra (5 por categoria):');
  for(const cat of ['audio','master_audio','contextual_audio']){
    const s=(rows as any[]).filter(r=>r.categoria===cat).slice(0,5).map(r=>'  '+r.name);
    console.log(`[${cat}]\n${s.join('\n')}`);
  }
  console.log('\n*** NADA FOI DELETADO — apenas listagem. ***');
}) ().catch(e=>{console.error('FATAL',e.message);process.exit(1);});
