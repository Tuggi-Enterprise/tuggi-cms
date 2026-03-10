
import { createClient } from '@supabase/supabase-js';
import * as dotenv from 'dotenv';

dotenv.config();

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

const supabase = createClient(supabaseUrl!, supabaseKey!);

async function fullAnalysis() {
  console.log('--- Analisando TODOS os 103k POIs em homolog.pois ---');

  // 1. Categorias de Acomodação (Proibidas se não forem famosas)
  const accommodation = ['hotel', 'hostel', 'motel', 'guest_house', 'apartment', 'chalet', 'alpine_hut'];
  
  // 2. Ruído absoluto (Nunca deveriam passar)
  const absoluteNoise = [
    'bench', 'waste_basket', 'trash_can', 'telephone', 'bicycle_parking', 
    'vending_machine', 'atm', 'surveillance', 'post_box', 'recycling', 
    'toilets', 'parking', 'street_cabinet', 'payment_centre', 'compressed_air'
  ];

  // 3. Utilidades Restritas (Proibidas se não forem famosas)
  const restrictedUtility = [
    'school', 'university', 'college', 'kindergarten', 'hospital', 'clinic', 
    'doctors', 'police', 'fire_station', 'post_office', 'government', 'office', 
    'bank', 'pharmacy', 'supermarket', 'convenience', 'bakery'
  ];

  console.log('\n1. Verificando Acomodações sem relevância (Wikipedia/Wikidata/Historic)...');
  const { count: accTotalCount, error: accError } = await supabase
    .schema('homolog')
    .from('pois')
    .select('*', { count: 'exact', head: true })
    .in('category', accommodation)
    .is('wikipedia', null)
    .is('wikidata', null)
    .eq('is_historic', false);

  if (accError) console.error('Erro ao buscar acomodações:', accError.message);
  else {
    console.log(`Total encontrado: ${accTotalCount} acomodações não-relevantes.`);
  }

  console.log('\n2. Verificando Ruído Absoluto (Bancos, Lixeiras, ATMs, Estacionamentos)...');
  const { count: noiseTotalCount, error: noiseError } = await supabase
    .schema('homolog')
    .from('pois')
    .select('*', { count: 'exact', head: true })
    .in('category', absoluteNoise);

  if (noiseError) console.error('Erro ao buscar ruído:', noiseError.message);
  else {
    console.log(`Total encontrado: ${noiseTotalCount} itens de ruído absoluto.`);
  }

  console.log('\n3. Verificando Utilidades sem relevância (Escolas, Hospitais, Bancos)...');
  const { count: utilTotalCount, error: utilError } = await supabase
    .schema('homolog')
    .from('pois')
    .select('*', { count: 'exact', head: true })
    .in('category', restrictedUtility)
    .is('wikipedia', null)
    .is('wikidata', null)
    .eq('is_historic', false);

  if (utilError) console.error('Erro ao buscar utilidades:', utilError.message);
  else {
    console.log(`Total encontrado: ${utilTotalCount} utilitários não-relevantes.`);
  }

  console.log('\n4. Verificando Termos Proibidos no Nome (Secretaria, Clínica, etc. - Sem Fama)...');
  const forbiddenTerms = ["secretaria", "departamento", "clínica", "clinica", "odontologia", "escola", "colégio", "banco", "farmácia", "drogaria"];
  
  let totalForbiddenNames = 0;
  for (const term of forbiddenTerms) {
      const { count } = await supabase
        .schema('homolog')
        .from('pois')
        .select('*', { count: 'exact', head: true })
        .ilike('name', `%${term}%`)
        .is('wikipedia', null)
        .is('wikidata', null)
        .eq('is_historic', false);
      
      if (count && count > 0) {
          console.log(`- Termo "${term}": ${count} itens.`);
          totalForbiddenNames += count;
      }
  }

  console.log('\n5. Verificando Categorias Genéricas (unknown, shop, yes)...');
  const { count: genericCount } = await supabase
    .schema('homolog')
    .from('pois')
    .select('*', { count: 'exact', head: true })
    .in('category', ['unknown', 'yes', 'no', 'building', 'office', 'shop']);
  console.log(`Total genérico: ${genericCount}`);

  console.log('\n--- Resumo Final ---');
  const grandTotal = (accTotalCount || 0) + (noiseTotalCount || 0) + (utilTotalCount || 0) + totalForbiddenNames;
  console.log(`Total estimado de itens que NÃO deveriam estar aqui: ~${grandTotal}`);
  
  if (accTotalCount && accTotalCount > 0) {
      const { data: examples } = await supabase.schema('homolog').from('pois').select('name, category').in('category', accommodation).is('wikipedia', null).is('wikidata', null).eq('is_historic', false).limit(5);
      console.log('\nExemplos de Acomodações:', examples?.map(e => `${e.name} (${e.category})`));
  }
}

fullAnalysis();
