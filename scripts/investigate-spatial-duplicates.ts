
import { createClient } from '@supabase/supabase-js';
import * as dotenv from 'dotenv';
import * as fs from 'fs';

dotenv.config();

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

const supabase = createClient(supabaseUrl!, supabaseKey!);

const DISTANCE_THRESHOLD_METERS = 150; // Duplicados se mesmo nome e estiverem a < 150m
const OUTPUT_FILE = 'spatial_duplicates.json';

// Função Haversine para calcular distância entre coordenadas
function calculateDistance(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const R = 6371e3; // Raio da Terra em metros
  const φ1 = lat1 * Math.PI / 180;
  const φ2 = lat2 * Math.PI / 180;
  const Δφ = (lat2 - lat1) * Math.PI / 180;
  const Δλ = (lon2 - lon1) * Math.PI / 180;

  const a = Math.sin(Δφ / 2) * Math.sin(Δφ / 2) +
            Math.cos(φ1) * Math.cos(φ2) *
            Math.sin(Δλ / 2) * Math.sin(Δλ / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));

  return R * c;
}

async function investigateSpatialDuplicates() {
  console.log('🔍 Buscando POIs sem cidade em homolog.pois...');
  
  let allPois: any[] = [];
  let offset = 0;
  const batchSize = 1000;
  let hasMore = true;

  while (hasMore) {
    const { data, error } = await supabase
      .schema('homolog')
      .from('pois')
      .select('uuid_id, name, lat, lon, created_at')
      .is('city', null)
      .not('name', 'is', null)
      .order('uuid_id')
      .range(offset, offset + batchSize - 1);

    if (error) {
      console.error('Erro ao buscar lote:', error.message);
      break;
    }

    if (!data || data.length === 0) break;

    allPois.push(...data);
    offset += batchSize;
    
    if (allPois.length % 5000 === 0) {
      process.stdout.write(`\r📥 Carregados: ${allPois.length.toLocaleString()}`);
    }

    if (data.length < batchSize) hasMore = false;
  }

  console.log(`\n✅ Total carregado: ${allPois.length.toLocaleString()} itens.`);
  console.log('🧪 Agrupando por nome e calculando proximidade...');

  // Agrupar por nome (normalizado)
  const nameMap = new Map<string, any[]>();
  allPois.forEach(p => {
    const normName = p.name.toLowerCase().trim();
    if (!nameMap.has(normName)) nameMap.set(normName, []);
    nameMap.get(normName)!.push(p);
  });

  const idsToDelete: string[] = [];
  let nameGroupsWithDupes = 0;

  for (const [name, list] of nameMap.entries()) {
    if (list.length < 2) continue;

    // Ordenar por data de criação (manter o mais antigo)
    list.sort((a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime());

    const keepers: any[] = [];
    
    for (const current of list) {
        let isDuplicate = false;
        
        for (const keeper of keepers) {
            const dist = calculateDistance(current.lat, current.lon, keeper.lat, keeper.lon);
            if (dist <= DISTANCE_THRESHOLD_METERS) {
                isDuplicate = true;
                break;
            }
        }

        if (isDuplicate) {
            idsToDelete.push(current.uuid_id);
        } else {
            keepers.push(current);
        }
    }
    
    if (keepers.length < list.length) {
        nameGroupsWithDupes++;
    }
  }

  console.log('\n📊 RESULTADOS DA INVESTIGAÇÃO ESPACIAL');
  console.log('─'.repeat(40));
  console.log(`Grupos de nomes com duplicatas: ${nameGroupsWithDupes}`);
  console.log(`Total de POIs para remover: ${idsToDelete.length}`);
  console.log(`Estimativa de redução: ${((idsToDelete.length / allPois.length) * 100).toFixed(2)}% da base sem cidades.`);

  if (idsToDelete.length > 0) {
    fs.writeFileSync(OUTPUT_FILE, JSON.stringify(idsToDelete, null, 2));
    console.log(`\n📄 Lista de IDs salva em: ${OUTPUT_FILE}`);
  }
}

investigateSpatialDuplicates();
