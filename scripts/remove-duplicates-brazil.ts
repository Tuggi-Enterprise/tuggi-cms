import { getSupabase } from '../lib/core/supabase-client';

const sb = getSupabase('service');

async function removeDuplicates() {
  console.log('🔍 Carregando todos os POIs do Brasil...\n');

  // Buscar todos os POIs do Brasil com paginação
  const allPois: any[] = [];
  for (let offset = 0; ; offset += 1000) {
    const { data, error } = await sb.schema('homolog').from('pois')
      .select('uuid_id, name, lat, lon, osm_id, osm_type, city, created_at, updated_at')
      .eq('country', 'Brazil')
      .range(offset, offset + 999);
    if (error) { console.error('Erro:', error.message); break; }
    if (!data || data.length === 0) break;
    allPois.push(...data);
    if (data.length < 1000) break;
  }

  console.log(`Total de POIs do Brasil carregados: ${allPois.length}\n`);

  // Agrupar por osm_id (critério principal)
  const osmIdMap = new Map<string, any[]>();
  const noOsmId: any[] = [];

  for (const poi of allPois) {
    if (poi.osm_id) {
      const key = `${poi.osm_id}_${poi.osm_type || ''}`;
      if (!osmIdMap.has(key)) osmIdMap.set(key, []);
      osmIdMap.get(key)!.push(poi);
    } else {
      noOsmId.push(poi);
    }
  }

  // Para itens sem osm_id, agrupar por nome+coords
  const coordMap = new Map<string, any[]>();
  for (const poi of noOsmId) {
    if (poi.lat && poi.lon && poi.name) {
      const key = `${poi.name}|${Number(poi.lat).toFixed(5)}|${Number(poi.lon).toFixed(5)}`;
      if (!coordMap.has(key)) coordMap.set(key, []);
      coordMap.get(key)!.push(poi);
    }
  }

  // Coletar IDs para deletar (manter o mais novo de cada grupo)
  const toDelete: string[] = [];

  // Processar duplicatas por osm_id
  for (const [, items] of osmIdMap) {
    if (items.length <= 1) continue;
    // Ordenar por updated_at DESC (mais novo primeiro), fallback created_at
    items.sort((a, b) => {
      const dateA = new Date(a.updated_at || a.created_at || 0).getTime();
      const dateB = new Date(b.updated_at || b.created_at || 0).getTime();
      return dateB - dateA;
    });
    // Manter o primeiro (mais novo), deletar o resto
    for (let i = 1; i < items.length; i++) {
      toDelete.push(items[i].uuid_id);
    }
  }

  const osmDeletes = toDelete.length;
  console.log(`Duplicatas por osm_id para remover: ${osmDeletes}`);

  // Processar duplicatas por nome+coords (sem osm_id)
  for (const [, items] of coordMap) {
    if (items.length <= 1) continue;
    items.sort((a, b) => {
      const dateA = new Date(a.updated_at || a.created_at || 0).getTime();
      const dateB = new Date(b.updated_at || b.created_at || 0).getTime();
      return dateB - dateA;
    });
    for (let i = 1; i < items.length; i++) {
      toDelete.push(items[i].uuid_id);
    }
  }

  const coordDeletes = toDelete.length - osmDeletes;
  console.log(`Duplicatas por nome+coords para remover: ${coordDeletes}`);
  console.log(`Total para deletar: ${toDelete.length}\n`);

  // Deletar em lotes de 100
  let deleted = 0;
  for (let i = 0; i < toDelete.length; i += 100) {
    const batch = toDelete.slice(i, i + 100);
    const { error } = await sb.schema('homolog').from('pois')
      .delete()
      .in('uuid_id', batch);
    if (error) {
      console.error(`Erro ao deletar lote ${i}:`, error.message);
    } else {
      deleted += batch.length;
    }
    if (deleted % 5000 === 0 || deleted === toDelete.length) {
      console.log(`  Progresso: ${deleted}/${toDelete.length}`);
    }
  }

  // Verificação final
  const { count: finalCount } = await sb.schema('homolog').from('pois')
    .select('*', { count: 'exact', head: true })
    .eq('country', 'Brazil');

  console.log(`\n✅ Remoção concluída!`);
  console.log(`Deletados: ${deleted}`);
  console.log(`POIs Brasil restantes: ${finalCount}`);
}

removeDuplicates().catch(console.error);
