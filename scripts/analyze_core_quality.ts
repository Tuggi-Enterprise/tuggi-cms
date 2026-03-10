
import { createClient } from '@supabase/supabase-js';
import * as dotenv from 'dotenv';

dotenv.config();

const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);

async function analyzeCoreQuality() {
  console.log('--- Analisando Qualidade em core.attractions ---');

  // 1. Contagem Total
  const { count: total } = await supabase.schema('core').from('attractions').select('*', { count: 'exact', head: true });
  console.log(`\n📊 Total de Atrações em Core: ${total}`);

  // 2. Categorias Genéricas ou Vazias
  const genericCats = ['amenity', 'tourism', 'leisure', 'historic', 'natural', 'man_made', 'building', 'unknown', 'yes', 'no'];
  const { count: genericCount } = await supabase
    .schema('core')
    .from('attractions')
    .select('*', { count: 'exact', head: true })
    .in('category', genericCats);

  const { count: nullCatCount } = await supabase
    .schema('core')
    .from('attractions')
    .select('*', { count: 'exact', head: true })
    .is('category', null);

  console.log(`\n📌 Categorias:`);
  console.log(`- Itens com categorias genéricas: ${genericCount}`);
  console.log(`- Itens sem categoria (null): ${nullCatCount}`);

  // 3. Duplicatas por osm_id (Estimativa via Batch)
  console.log('\n🔍 Analisando duplicatas por osm_id (amostra de 50k)...');
  const { data: sample, error } = await supabase
    .schema('core')
    .from('attractions')
    .select('osm_id')
    .not('osm_id', 'is', null)
    .limit(50000);

  if (sample) {
    const ids = sample.map(p => p.osm_id);
    const seen = new Set();
    const dupes = new Set();
    ids.forEach(id => {
      if (seen.has(id)) dupes.add(id);
      seen.add(id);
    });
    console.log(`- Duplicatas na amostra: ${dupes.size}`);
    console.log(`- Taxa de duplicidade: ${((dupes.size / sample.length) * 100).toFixed(4)}%`);
  }

  // 4. Amostra de itens sem categoria
  if ((nullCatCount || 0) > 0) {
    const { data: nullSample } = await supabase
      .schema('core')
      .from('attractions')
      .select('name, osm_category, osm_type, primary_category_type')
      .is('category', null)
      .limit(10);
    
    console.log('\n🔍 Itens sem categoria (Amostra):');
    nullSample?.forEach(p => console.log(`- ${p.name} | Type: ${p.osm_category || p.osm_type || 'N/A'} | Type2: ${p.primary_category_type || 'N/A'}`));
  }
}

analyzeCoreQuality();
