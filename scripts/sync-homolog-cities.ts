import { getSupabase } from '../lib/core/supabase-client';

const sb = getSupabase('service');

async function syncCities() {
  console.log('🔄 Passo 1: Contando itens com addr:city disponível mas city vazio...');

  // Primeiro, vamos ver a estrutura do osm_properties para entender como acessar addr:city
  const { data: sample, error: sampleErr } = await sb.schema('homolog')
    .from('pois')
    .select('uuid_id, name, city, osm_properties')
    .not('osm_properties', 'is', null)
    .limit(3);

  if (sampleErr) {
    console.error('Erro ao buscar amostra:', sampleErr.message);
    return;
  }

  console.log('Amostra de osm_properties:');
  sample?.forEach(s => {
    const tags = s.osm_properties || {};
    console.log(`  - ${s.name} | city col: "${s.city}" | addr:city tag: "${tags['addr:city'] || 'N/A'}"`);
  });

  // Contar quantos têm addr:city nas tags mas city está null/vazio
  const BATCH_SIZE = 1000;
  let offset = 0;
  let totalCandidates = 0;
  let totalUpdated = 0;
  let allCities = new Map<string, number>();

  console.log('\n🔄 Passo 2: Buscando e atualizando em lotes...');

  while (true) {
    const { data: batch, error: batchErr } = await sb.schema('homolog')
      .from('pois')
      .select('uuid_id, name, city, osm_properties')
      .not('osm_properties', 'is', null)
      .range(offset, offset + BATCH_SIZE - 1);

    if (batchErr) {
      console.error(`Erro no lote offset=${offset}:`, batchErr.message);
      break;
    }

    if (!batch || batch.length === 0) break;

    // Filtrar os que têm addr:city nas tags mas city está vazio
    const candidates = batch.filter(item => {
      const tags = item.osm_properties || {};
      const addrCity = tags['addr:city'];
      return addrCity && (!item.city || item.city.trim() === '');
    });

    totalCandidates += candidates.length;

    if (candidates.length > 0) {
      // Atualizar cada candidato
      for (const item of candidates) {
        const cityName = item.osm_properties['addr:city'].trim();
        
        const { error: updateErr } = await sb.schema('homolog')
          .from('pois')
          .update({ city: cityName })
          .eq('uuid_id', item.uuid_id);

        if (updateErr) {
          console.error(`  ❌ Erro ao atualizar ${item.name}: ${updateErr.message}`);
        } else {
          totalUpdated++;
          allCities.set(cityName, (allCities.get(cityName) || 0) + 1);
        }
      }
      
      console.log(`  Lote ${offset}-${offset + batch.length}: ${candidates.length} atualizados (total: ${totalUpdated})`);
    }

    if (batch.length < BATCH_SIZE) break;
    offset += BATCH_SIZE;
  }

  console.log('\n✅ Sincronização concluída!');
  console.log(`  Total de candidatos encontrados: ${totalCandidates}`);
  console.log(`  Total de registros atualizados: ${totalUpdated}`);
  
  // Mostrar as top 20 cidades encontradas
  const sortedCities = [...allCities.entries()].sort((a, b) => b[1] - a[1]);
  console.log(`\n📊 Top 20 cidades encontradas:`);
  sortedCities.slice(0, 20).forEach(([city, count]) => {
    console.log(`  ${city}: ${count} POIs`);
  });

  // Verificar Campinas e Guarulhos especificamente
  const campinas = allCities.get('Campinas') || 0;
  const guarulhos = allCities.get('Guarulhos') || 0;
  console.log(`\n🎯 Cidades alvo:`);
  console.log(`  Campinas: ${campinas} POIs`);
  console.log(`  Guarulhos: ${guarulhos} POIs`);
}

syncCities().catch(console.error);
