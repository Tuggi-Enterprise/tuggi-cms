import { getSupabase } from '../lib/core/supabase-client';

const sb = getSupabase('service');

async function run() {
  // Bounding box de São Paulo capital
  const minLat = -23.85, maxLat = -23.35, minLon = -46.85, maxLon = -46.35;

  // 1. Contagem exata
  const { count: total } = await sb.schema('homolog').from('pois')
    .select('*', { count: 'exact', head: true })
    .gte('lat', minLat).lte('lat', maxLat)
    .gte('lon', minLon).lte('lon', maxLon);

  const { count: noCity } = await sb.schema('homolog').from('pois')
    .select('*', { count: 'exact', head: true })
    .gte('lat', minLat).lte('lat', maxLat)
    .gte('lon', minLon).lte('lon', maxLon)
    .is('city', null);

  const { count: alreadySP } = await sb.schema('homolog').from('pois')
    .select('*', { count: 'exact', head: true })
    .eq('city', 'São Paulo');

  console.log('=== SÃO PAULO CAPITAL ===');
  console.log('Total no bounding box:', total);
  console.log('Com city=null no box:', noCity);
  console.log('Já com city=São Paulo:', alreadySP);

  if (!noCity || noCity === 0) {
    console.log('Nada para atualizar!');
    return;
  }

  // 2. Atualizar com paginação real
  let totalUpdated = 0;
  const target = noCity as number;

  while (totalUpdated < target) {
    // Sempre busca do offset 0, pois os já atualizados saem do filtro city=null
    const { data, error } = await sb.schema('homolog').from('pois')
      .select('uuid_id')
      .gte('lat', minLat).lte('lat', maxLat)
      .gte('lon', minLon).lte('lon', maxLon)
      .is('city', null)
      .range(0, 999);

    if (error) { console.error('Erro fetch:', error.message); break; }
    if (!data || data.length === 0) break;

    const ids = data.map(p => p.uuid_id);

    // Update em lotes de 100
    for (let i = 0; i < ids.length; i += 100) {
      const batch = ids.slice(i, i + 100);
      const { error: upErr } = await sb.schema('homolog').from('pois')
        .update({ city: 'São Paulo' })
        .in('uuid_id', batch);
      if (upErr) {
        console.error('Erro update:', upErr.message);
      } else {
        totalUpdated += batch.length;
      }
    }
    console.log(`  Progresso: ${totalUpdated}/${target}`);
  }

  console.log(`\n✅ Total atualizado para São Paulo: ${totalUpdated}`);

  // 3. Verificação final
  const { count: finalNull } = await sb.schema('homolog').from('pois')
    .select('*', { count: 'exact', head: true })
    .gte('lat', minLat).lte('lat', maxLat)
    .gte('lon', minLon).lte('lon', maxLon)
    .is('city', null);
  console.log('Restantes com city=null no box:', finalNull);
}

run().catch(console.error);
