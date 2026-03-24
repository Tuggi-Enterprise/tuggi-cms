import { getSupabase } from '../lib/core/supabase-client';

const sb = getSupabase('service');

async function audioStats() {
  const dates = ['2026-03-16', '2026-03-17', '2026-03-20', '2026-03-21'];

  console.log('📊 Áudios gerados por dia (core.attraction_descriptions com audio_url):');

  for (const date of dates) {
    // Total de descrições no dia
    const { count: totalDescs } = await sb.schema('core')
      .from('attraction_descriptions')
      .select('*', { count: 'exact', head: true })
      .gte('created_at', date + 'T00:00:00Z')
      .lte('created_at', date + 'T23:59:59Z');

    // Descrições COM audio_url preenchido
    const { count: withAudio } = await sb.schema('core')
      .from('attraction_descriptions')
      .select('*', { count: 'exact', head: true })
      .gte('created_at', date + 'T00:00:00Z')
      .lte('created_at', date + 'T23:59:59Z')
      .not('audio_url', 'is', null);

    // Por idioma (amostra)
    const { data: langs } = await sb.schema('core')
      .from('attraction_descriptions')
      .select('language')
      .gte('created_at', date + 'T00:00:00Z')
      .lte('created_at', date + 'T23:59:59Z')
      .not('audio_url', 'is', null);

    const langMap = new Map<string, number>();
    langs?.forEach(l => langMap.set(l.language, (langMap.get(l.language) || 0) + 1));
    const langStr = [...langMap.entries()].map(([k, v]) => `${k}: ${v}`).join(', ');

    console.log(`  ${date}: ${withAudio || 0} áudios / ${totalDescs || 0} descrições  [${langStr}]`);
  }

  // Total geral
  const { count: totalAudios } = await sb.schema('core')
    .from('attraction_descriptions')
    .select('*', { count: 'exact', head: true })
    .not('audio_url', 'is', null);
  console.log(`\nTotal geral de áudios: ${totalAudios}`);
}

audioStats().catch(console.error);
