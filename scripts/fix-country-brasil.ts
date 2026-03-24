import { getSupabase } from '../lib/core/supabase-client';

const sb = getSupabase('service');

async function fix() {
  const { count } = await sb.schema('homolog').from('pois')
    .select('*', { count: 'exact', head: true })
    .eq('country', 'Brasil');
  console.log('Itens com country=Brasil:', count);

  if (!count || count === 0) {
    console.log('Nada para corrigir.');
    return;
  }

  let updated = 0;
  while (true) {
    const { data } = await sb.schema('homolog').from('pois')
      .select('uuid_id')
      .eq('country', 'Brasil')
      .range(0, 999);

    if (!data || data.length === 0) break;

    const ids = data.map(p => p.uuid_id);
    for (let i = 0; i < ids.length; i += 100) {
      const batch = ids.slice(i, i + 100);
      const { error } = await sb.schema('homolog').from('pois')
        .update({ country: 'Brazil' })
        .in('uuid_id', batch);
      if (error) console.error('Erro:', error.message);
      else updated += batch.length;
    }
    console.log('  Progresso:', updated);
  }

  const { count: remaining } = await sb.schema('homolog').from('pois')
    .select('*', { count: 'exact', head: true })
    .eq('country', 'Brasil');
  console.log('✅ Atualizados:', updated);
  console.log('Restantes com Brasil:', remaining);
}

fix().catch(console.error);
