import { getSupabase } from '../lib/core/supabase-client';

const sb = getSupabase('service');

async function detectDuplicates() {
  console.log('🔍 Detectando duplicatas no Brasil (homolog.pois)...\n');

  // Buscar todos os POIs do Brasil com paginação
  const allPois: any[] = [];
  for (let offset = 0; ; offset += 1000) {
    const { data, error } = await sb.schema('homolog').from('pois')
      .select('uuid_id, name, lat, lon, osm_id, osm_type, city')
      .eq('country', 'Brazil')
      .range(offset, offset + 999);
    if (error) { console.error('Erro:', error.message); break; }
    if (!data || data.length === 0) break;
    allPois.push(...data);
    if (data.length < 1000) break;
  }

  console.log(`Total de POIs do Brasil carregados: ${allPois.length}\n`);

  // 1. Duplicatas por osm_id (excluindo nulls)
  const osmIdMap = new Map<string, any[]>();
  for (const poi of allPois) {
    if (poi.osm_id) {
      const key = `${poi.osm_id}_${poi.osm_type || ''}`;
      if (!osmIdMap.has(key)) osmIdMap.set(key, []);
      osmIdMap.get(key)!.push(poi);
    }
  }
  const osmDuplicates = [...osmIdMap.entries()].filter(([, items]) => items.length > 1);
  const osmDupCount = osmDuplicates.reduce((sum, [, items]) => sum + items.length - 1, 0);
  console.log(`=== DUPLICATAS POR OSM_ID ===`);
  console.log(`Grupos com osm_id duplicado: ${osmDuplicates.length}`);
  console.log(`Total de itens extras (removíveis): ${osmDupCount}`);
  if (osmDuplicates.length > 0) {
    console.log('Exemplos:');
    osmDuplicates.slice(0, 5).forEach(([key, items]) => {
      console.log(`  osm_id=${key}: ${items.length}x "${items[0].name}" (${items.map(i => i.city || '?').join(', ')})`);
    });
  }

  // 2. Duplicatas por coordenadas + nome
  const coordMap = new Map<string, any[]>();
  for (const poi of allPois) {
    if (poi.lat && poi.lon && poi.name) {
      const key = `${poi.name}|${Number(poi.lat).toFixed(5)}|${Number(poi.lon).toFixed(5)}`;
      if (!coordMap.has(key)) coordMap.set(key, []);
      coordMap.get(key)!.push(poi);
    }
  }
  const coordDuplicates = [...coordMap.entries()].filter(([, items]) => items.length > 1);
  const coordDupCount = coordDuplicates.reduce((sum, [, items]) => sum + items.length - 1, 0);
  console.log(`\n=== DUPLICATAS POR NOME + COORDENADAS ===`);
  console.log(`Grupos com mesmo nome+coords: ${coordDuplicates.length}`);
  console.log(`Total de itens extras (removíveis): ${coordDupCount}`);
  if (coordDuplicates.length > 0) {
    console.log('Exemplos:');
    coordDuplicates.slice(0, 5).forEach(([key, items]) => {
      console.log(`  "${items[0].name}" @ (${items[0].lat}, ${items[0].lon}): ${items.length}x`);
    });
  }

  console.log(`\n=== RESUMO ===`);
  console.log(`Total POIs Brasil: ${allPois.length}`);
  console.log(`Duplicatas por osm_id: ${osmDupCount} extras em ${osmDuplicates.length} grupos`);
  console.log(`Duplicatas por nome+coords: ${coordDupCount} extras em ${coordDuplicates.length} grupos`);
}

detectDuplicates().catch(console.error);
