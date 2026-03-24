
import { getSupabase } from '../lib/core/supabase-client';

const sb = getSupabase('service');

async function updateChurches() {
  const schedule = [
    { "days": [6], "start": "08:00", "end": "18:00" },
    { "days": [3], "start": "19:00", "end": "20:30" },
    { "days": [0], "start": "17:00", "end": "20:30" }
  ];

  console.log('🔄 Buscando Igrejas Adventistas em Portugal no Core...');

  // Primeiro fazemos um select para saber quantas existem
  const { data: list, error: errList } = await sb.schema('core')
    .from('attractions')
    .select('id, name')
    .ilike('name', '%Adventista%')
    .eq('country', 'Portugal');

  if (errList) throw errList;
  console.log(`Encontradas ${list?.length || 0} igrejas para atualizar.`);

  if (!list || list.length === 0) {
    console.log('Nenhuma igreja encontrada com esse filtro.');
    return;
  }

  // Atualizando todas
  const { data, error } = await sb.schema('core')
    .from('attractions')
    .update({ 
      schedule, 
      is_active: true,
      updated_at: new Date().toISOString()
    })
    .ilike('name', '%Adventista%')
    .eq('country', 'Portugal')
    .select('id, name');

  if (error) {
    console.error('Erro no update:', error.message);
    return;
  }

  console.log(`✅ Sucesso! Atualizadas ${data?.length} igrejas adventistas com o novo schedule.`);
  
  // Amostra do resultado
  console.table(data?.slice(0, 5));
}

updateChurches().catch(console.error);
