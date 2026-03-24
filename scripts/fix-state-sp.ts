import { getSupabase } from '../lib/core/supabase-client';

const sb = getSupabase('service');

async function fixState() {
  const cities = ['Campinas', 'Guarulhos', 'São Paulo'];
  
  for (const city of cities) {
    let updated = 0;
    while (true) {
      const { data } = await sb.schema('homolog').from('pois')
        .select('uuid_id')
        .eq('city', city)
        .is('state', null)
        .range(0, 999);
      if (!data || data.length === 0) break;
      
      const ids = data.map(p => p.uuid_id);
      for (let i = 0; i < ids.length; i += 100) {
        const batch = ids.slice(i, i + 100);
        await sb.schema('homolog').from('pois').update({ state: 'São Paulo' }).in('uuid_id', batch);
        updated += batch.length;
      }
      console.log(city + ': ' + updated + ' atualizados');
    }
    console.log('✅ ' + city + ': total ' + updated + ' com state = São Paulo');
  }
}

fixState().catch(console.error);
