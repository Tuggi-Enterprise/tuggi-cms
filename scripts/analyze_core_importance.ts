
import { createClient } from '@supabase/supabase-js';
import * as dotenv from 'dotenv';

dotenv.config();

const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);

async function analyzeCoreImportance() {
  console.log('--- Analisando Relevância em core.attractions ---');

  // 1. Distribuição de is_premium e is_touristic
  const { count: premiumCount } = await supabase.schema('core').from('attractions').select('*', { count: 'exact', head: true }).eq('is_premium', true);
  const { count: touristicCount } = await supabase.schema('core').from('attractions').select('*', { count: 'exact', head: true }).eq('is_touristic', true);
  const { count: total } = await supabase.schema('core').from('attractions').select('*', { count: 'exact', head: true });

  console.log(`\n📊 Estatísticas Gerais:`);
  console.log(`- Total de Atrações: ${total}`);
  console.log(`- Atrações Premium: ${premiumCount} (${((premiumCount!/total!) * 100).toFixed(2)}%)`);
  console.log(`- Marcadas como Turísticas: ${touristicCount} (${((touristicCount!/total!) * 100).toFixed(2)}%)`);

  // 2. Análise de Categorias de "Ruído" que podem ter passado
  const noiseCategories = [
    'school', 'university', 'kindergarten', 'hospital', 'clinic', 'doctors', 
    'bank', 'atm', 'pharmacy', 'parking', 'supermarket', 'convenience', 
    'bench', 'waste_basket', 'telephone'
  ];

  console.log(`\n🔍 Verificando categorias de utilidade/ruído em Core:`);
  for (const cat of noiseCategories) {
    const { count } = await supabase
      .schema('core')
      .from('attractions')
      .select('*', { count: 'exact', head: true })
      .eq('category', cat);
    
    if (count && count > 0) {
      // Verificar se algum desses itens tem Wiki/Wikidata (fama)
      const { count: famousCount } = await supabase
        .schema('core')
        .from('attractions')
        .select('*', { count: 'exact', head: true })
        .eq('category', cat)
        .or('osm_wikipedia_url.not.is.null,osm_wikidata_id.not.is.null,wikipedia.not.is.null,wikidata.not.is.null');

      console.log(`- ${cat}: ${count} itens total (${famousCount} são famosos/referenciados).`);
    }
  }

  // 3. Importância (importance ou importance_level)
  // Alguns registros podem ter importance muito baixa (Nominatim importance < 0.1 por exemplo)
  const { count: lowImportance } = await supabase
    .schema('core')
    .from('attractions')
    .select('*', { count: 'exact', head: true })
    .lt('importance', 0.1);

  console.log(`\n📉 Itens com Importância muito baixa (< 0.1): ${lowImportance}`);

  // 4. Amostra de itens "Suspeitos" (Categoria de utilidade e sem Wiki)
  const { data: suspectDocs } = await supabase
    .schema('core')
    .from('attractions')
    .select('name, category, importance')
    .in('category', ['school', 'bank', 'parking', 'clinic'])
    .is('osm_wikipedia_url', null)
    .is('osm_wikidata_id', null)
    .limit(5);

  if (suspectDocs && suspectDocs.length > 0) {
    console.log('\n🚨 Exemplo de itens que podem ser "Ruído" (Utilidades sem fama):');
    suspectDocs.forEach(d => console.log(`- ${d.name} (${d.category}) | Importância: ${d.importance}`));
  }
}

analyzeCoreImportance();
