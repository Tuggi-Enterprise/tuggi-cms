/**
 * Deleção de áudios órfãos do bucket travel-app-audios.
 *  - Dry-run por padrão. Passe --execute para apagar de verdade.
 *  - Recalcula o alvo AO VIVO e re-verifica cada lote contra as referências
 *    atuais antes de deletar (protege contra corrida com a migração).
 *  Alvo: contextual_audio/ (todos) + audio/ e master_audio/ NÃO referenciados.
 */
import { createClient } from '@supabase/supabase-js';
const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const key = process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY!;
const sb = createClient(url, key, { auth: { persistSession: false }, db: { schema: 'core' } });
const BUCKET = 'travel-app-audios';
const EXECUTE = process.argv.includes('--execute');
const BATCH = 1000;

async function diag(s: string): Promise<any[]> {
  const { data, error } = await sb.rpc('diag_sql', { q: s.trim().replace(/\s+/g, ' ') });
  if (error) throw new Error(error.message);
  return data || [];
}
const REFERENCED = `
  referenced as (
    select regexp_replace(audio_url,'^.*/travel-app-audios/','') as path
      from core.attraction_descriptions where position('travel-app-audios/' in coalesce(audio_url,''))>0
    union
    select regexp_replace(audio_url,'^.*/travel-app-audios/','') from core.cache_narrations where position('travel-app-audios/' in coalesce(audio_url,''))>0
    union
    select regexp_replace(audio_url,'^.*/travel-app-audios/','') from core.custom_route_descriptions where position('travel-app-audios/' in coalesce(audio_url,''))>0
  )`;
const TARGET = `
  (split_part(o.name,'/',1)='contextual_audio')
  or (split_part(o.name,'/',1) in ('audio','master_audio') and o.name not in (select path from referenced))`;
const q = (s: string) => "'" + s.replace(/'/g, "''") + "'";

(async () => {
  console.log(`MODO: ${EXECUTE ? '🔴 EXECUTE (vai apagar)' : '🟢 DRY-RUN'}\n`);

  // 1. Alvo ao vivo
  const rows = await diag(`with ${REFERENCED}
    select o.name from storage.objects o
    where o.bucket_id='travel-app-audios' and (${TARGET}) order by 1`);
  const names: string[] = rows.map(r => r.name);
  console.log(`Alvo ao vivo: ${names.length} arquivos`);

  // 2. Leak check global
  const leak = await diag(`with ${REFERENCED}
    select count(*)::int as n from storage.objects o
    where o.bucket_id='travel-app-audios' and o.name in (select path from referenced) and (${TARGET})`);
  if ((leak[0]?.n ?? 0) > 0) { console.error('ABORTADO: alvo contém referenciados:', leak[0].n); process.exit(1); }
  console.log('Leak check global: 0 ✅\n');

  let deleted = 0, skipped = 0, errors = 0;
  for (let i = 0; i < names.length; i += BATCH) {
    let batch = names.slice(i, i + BATCH);

    // 2b. re-verificação AO VIVO do lote (exclui o que virou referenciado agora)
    const refNow = await diag(`with ${REFERENCED}
      select b.p from (values ${batch.map(p => '(' + q(p) + ')').join(',')}) as b(p)
      where b.p in (select path from referenced)`);
    if (refNow.length) {
      const refSet = new Set(refNow.map(r => r.p));
      const before = batch.length;
      batch = batch.filter(p => !refSet.has(p));
      skipped += before - batch.length;
      console.log(`  lote ${i / BATCH + 1}: ${before - batch.length} pulado(s) por virarem referenciados`);
    }
    if (!batch.length) continue;

    if (EXECUTE) {
      const { data, error } = await sb.storage.from(BUCKET).remove(batch);
      if (error) { errors++; console.error(`  lote ${i / BATCH + 1} ERRO:`, error.message); }
      else { deleted += data?.length ?? batch.length; }
    } else {
      deleted += batch.length;
    }
    process.stdout.write(`\r${EXECUTE ? 'Apagados' : 'Seriam apagados'}: ${deleted} | pulados: ${skipped} | erros: ${errors}   `);
  }
  console.log(`\n\n${EXECUTE ? '✅ Deleção concluída' : '🟢 Dry-run'}: ${deleted} apagados, ${skipped} pulados (re-referenciados), ${errors} erros.`);
  if (!EXECUTE) console.log('Rode com --execute para apagar de verdade.');
})().catch(e => { console.error('FATAL', e.message); process.exit(1); });
