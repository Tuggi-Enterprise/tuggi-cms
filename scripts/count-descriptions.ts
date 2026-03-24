import { getSupabase } from '../lib/core/supabase-client';

const sb = getSupabase('service');

async function stats() {
  const dates = ['2026-03-16', '2026-03-17', '2026-03-20', '2026-03-21'];
  console.log('📊 Descrições geradas por dia (core.attraction_descriptions):');
  
  for (const date of dates) {
    const { count, error } = await sb.schema('core')
      .from('attraction_descriptions')
      .select('*', { count: 'exact', head: true })
      .gte('created_at', date + 'T00:00:00Z')
      .lte('created_at', date + 'T23:59:59Z');
      
    if (error) console.error('Erro na data ' + date + ':', error.message);
    else console.log('  ' + date + ': ' + (count || 0) + ' descrições');
  }

  // Total geral
  const { count: total } = await sb.schema('core')
    .from('attraction_descriptions')
    .select('*', { count: 'exact', head: true });
  console.log('\nTotal geral de descrições:', total);
}

stats().catch(console.error);
