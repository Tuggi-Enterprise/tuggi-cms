import { getSupabase } from '../lib/core/supabase-client';

const sb = getSupabase('service');

async function regionStats() {
  const dates = ['2026-03-16', '2026-03-17', '2026-03-20', '2026-03-21'];

  for (const date of dates) {
    console.log(`\n=== ${date} ===`);

    // Buscar descriptions desse dia com o attraction_id
    const allDescs: any[] = [];
    for (let offset = 0; ; offset += 1000) {
      const { data } = await sb.schema('core')
        .from('attraction_descriptions')
        .select('attraction_id')
        .gte('created_at', date + 'T00:00:00Z')
        .lte('created_at', date + 'T23:59:59Z')
        .range(offset, offset + 999);
      if (!data || data.length === 0) break;
      allDescs.push(...data);
      if (data.length < 1000) break;
    }

    if (allDescs.length === 0) {
      console.log('  Nenhuma descrição nesse dia.');
      continue;
    }

    // Buscar país/cidade/estado das attractions correspondentes
    const ids = [...new Set(allDescs.map(d => d.attraction_id))];
    const regionMap = new Map<string, number>();

    for (let i = 0; i < ids.length; i += 100) {
      const batch = ids.slice(i, i + 100);
      const { data: attrs } = await sb.schema('core')
        .from('attractions')
        .select('id, country, state, city')
        .in('id', batch);

      if (attrs) {
        for (const a of attrs) {
          const region = `${a.country || '?'} > ${a.state || '?'} > ${a.city || '?'}`;
          regionMap.set(region, (regionMap.get(region) || 0) + 1);
        }
      }
    }

    const sorted = [...regionMap.entries()].sort((a, b) => b[1] - a[1]);
    console.log(`  Total: ${allDescs.length} descrições, ${ids.length} POIs únicos`);
    sorted.slice(0, 10).forEach(([region, count]) => {
      console.log(`  ${count}x  ${region}`);
    });
    if (sorted.length > 10) console.log(`  ... e mais ${sorted.length - 10} regiões`);
  }
}

regionStats().catch(console.error);
