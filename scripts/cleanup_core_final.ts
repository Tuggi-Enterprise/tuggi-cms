
import { createClient } from '@supabase/supabase-js';
import * as dotenv from 'dotenv';
import * as fs from 'fs';

dotenv.config();

const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);

async function cleanupCore() {
  console.log('--- Iniciando Limpeza Geral de core.attractions ---');

  // PARTE 1: Limpeza de Ruído (Utilitários sem fama)
  const noiseCategories = [
    'school', 'university', 'kindergarten', 'hospital', 'clinic', 'doctors', 
    'bank', 'atm', 'pharmacy', 'parking', 'supermarket', 'convenience', 
    'bench', 'waste_basket', 'telephone'
  ];

  console.log('\n🗑️  Removendo Ruído (Categorias indesejadas sem fama)...');
  
  // Buscamos itens dessas categorias que NÃO tenham Wikipedia ou Wikidata
  const { data: noiseItems, error: noiseError } = await supabase
    .schema('core')
    .from('attractions')
    .select('id, name, category')
    .in('category', noiseCategories)
    .is('osm_wikipedia_url', null)
    .is('osm_wikidata_id', null)
    .is('wikipedia', null)
    .is('wikidata', null);

  if (noiseError) {
    console.error('Erro ao buscar ruído:', noiseError.message);
  } else if (noiseItems && noiseItems.length > 0) {
    console.log(`Encontrados ${noiseItems.length} itens de ruído para remoção.`);
    
    // Deletar em lotes
    const BATCH_SIZE = 100;
    for (let i = 0; i < noiseItems.length; i += BATCH_SIZE) {
      const ids = noiseItems.slice(i, i + BATCH_SIZE).map(item => item.id);
      
      // Deletar coordenadas primeiro (dependência)
      await supabase.schema('core').from('attraction_coordinate').delete().in('attraction_id', ids);
      // Deletar atrações
      const { error: delError } = await supabase.schema('core').from('attractions').delete().in('id', ids);
      
      if (!delError) {
        process.stdout.write(`\r✅ Ruído removido: ${Math.min(i + BATCH_SIZE, noiseItems.length)}/${noiseItems.length}`);
      }
    }
  } else {
    console.log('✅ Nenhum ruído óbvio encontrado.');
  }

  // PARTE 2: Limpeza de Duplicatas Geográficas
  console.log('\n\n🗑️  Processando Duplicatas Geográficas (baseado no relatório)...');
  
  if (!fs.existsSync('core_duplicates_final_report.json')) {
    console.error('Relatório de duplicatas não encontrado. Rode o script de detecção primeiro.');
    return;
  }

  const duplicates = JSON.parse(fs.readFileSync('core_duplicates_final_report.json', 'utf8'));
  console.log(`Total de pares duplicados no relatório: ${duplicates.length}`);

  // Estratégia: Para cada par, decidimos qual deletar.
  // Vamos usar um Set para garantir que se um item for deletado em um par, não tentemos deletar seu parceiro em outro par
  const toDelete = new Set<string>();
  const kept = new Set<string>();

  for (const pair of duplicates) {
    // Se nenhum dos dois foi marcado para deletar ainda
    if (!toDelete.has(pair.id1) && !toDelete.has(pair.id2)) {
      // Regra simples: Mantemos o id1 (geralmente o que foi processado primeiro) e deletamos o id2
      toDelete.add(pair.id2);
      kept.add(pair.id1);
    }
  }

  const deleteList = Array.from(toDelete);
  console.log(`Total de itens únicos identificados para deleção: ${deleteList.length}`);

  if (deleteList.length > 0) {
    const BATCH_SIZE = 50;
    for (let i = 0; i < deleteList.length; i += BATCH_SIZE) {
      const ids = deleteList.slice(i, i + BATCH_SIZE);
      
      // Deletar coordenadas
      await supabase.schema('core').from('attraction_coordinate').delete().in('attraction_id', ids);
      // Deletar atrações
      const { error: delError } = await supabase.schema('core').from('attractions').delete().in('id', ids);
      
      if (!delError) {
        process.stdout.write(`\r✅ Duplicatas removidas: ${Math.min(i + BATCH_SIZE, deleteList.length)}/${deleteList.length}`);
      }
    }
  }

  console.log('\n\n🏁 Limpeza CORE concluída com sucesso!');
}

cleanupCore();
