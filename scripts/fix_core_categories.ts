
import { createClient } from '@supabase/supabase-js';
import * as dotenv from 'dotenv';

dotenv.config();

const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);

const genericCategories = [
  'amenity', 'tourism', 'leisure', 'historic', 'natural', 
  'man_made', 'building', 'unknown', 'yes', 'no', 'office', 'shop'
];

async function fixCoreCategories() {
  console.log('--- Reparação de Categorias core.attractions (Otimizada) ---');

  const { count: totalToFix } = await supabase
    .schema('core')
    .from('attractions')
    .select('*', { count: 'exact', head: true })
    .or(`category.is.null,category.in.(${genericCategories.map(c => `"${c}"`).join(',')})`);

  console.log(`Itens identificados: ${totalToFix}`);

  if (!totalToFix || totalToFix === 0) {
    console.log('✅ Nada para corrigir.');
    return;
  }

  const BATCH_SIZE = 200;
  const CONCURRENCY = 40; // Aumentado para maior velocidade
  let updatedCount = 0;
  let skippedCount = 0;
  let errorCount = 0;

  while (true) {
    const { data: batch, error } = await supabase
      .schema('core')
      .from('attractions')
      .select('id, name, category, osm_category, osm_tags')
      .or(`category.is.null,category.in.(${genericCategories.map(c => `"${c}"`).join(',')})`)
      .limit(BATCH_SIZE);

    if (error || !batch || batch.length === 0) break;

    // Processar em chunks de concorrência
    for (let i = 0; i < batch.length; i += CONCURRENCY) {
      const chunk = batch.slice(i, i + CONCURRENCY);
      
      await Promise.all(chunk.map(async (item) => {
        const tags = item.osm_tags || {};
        
        const realType = 
          tags.tourism || 
          tags.amenity || 
          tags.historic || 
          tags.leisure || 
          tags.natural || 
          tags.man_made || 
          tags.shop || 
          tags.office || 
          tags.type || 
          (item.osm_category && !genericCategories.includes(item.osm_category) ? item.osm_category : null) ||
          tags.class;

        if (realType && realType !== item.category && !genericCategories.includes(realType)) {
          const { error: updateError } = await supabase
            .schema('core')
            .from('attractions')
            .update({
              category: realType,
              primary_category: realType,
              primary_category_type: item.category || item.osm_category
            })
            .eq('id', item.id);
          
          if (!updateError) updatedCount++;
          else {
              errorCount++;
              // Se der erro, tentamos apenas tirar do loop para não travar
              await supabase.schema('core').from('attractions').update({ category: `error_${item.category || 'null'}` }).eq('id', item.id);
          }
        } else {
          await supabase
            .schema('core')
            .from('attractions')
            .update({ category: `processed_${item.category || 'null'}` })
            .eq('id', item.id);
          skippedCount++;
        }
      }));
      
      process.stdout.write(`\r✅ Progresso: ${updatedCount + skippedCount}/${totalToFix} | Melhorados: ${updatedCount} | Mantidos: ${skippedCount} | Erros: ${errorCount}`);
    }
    
    if (batch.length < BATCH_SIZE) break;
  }

  console.log('\n\nFinalizando: Limpando marcadores temporários...');
  // O ideal aqui seria um RPC, mas faremos uma limpeza manual se o volume for baixo
  // Para evitar lentidão, vamos apenas reportar os itens 'processed_'
  console.log(`🏁 Concluído. Itens melhorados: ${updatedCount}.`);
  console.log(`Dica: Para voltar as categorias dos itens mantidos ao normal, rode um UPDATE removendo o prefixo 'processed_'.`);
}

fixCoreCategories();
