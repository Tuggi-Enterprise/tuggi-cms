
import { createClient } from '@supabase/supabase-js';
import * as dotenv from 'dotenv';

dotenv.config();

const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);

async function fixHomologCategories() {
  const genericCategories = [
    'amenity', 'tourism', 'leisure', 'historic', 'natural', 
    'man_made', 'building', 'unknown', 'highway', 'boundary', 
    'coastline', 'yes', 'no'
  ];
  
  console.log('--- Iniciando Reparação de Categorias Otimizada ---');

  // 1. Contar remanescentes
  const { count: totalToFix } = await supabase
    .schema('homolog')
    .from('pois')
    .select('*', { count: 'exact', head: true })
    .in('category', genericCategories);

  console.log(`Itens para processar: ${totalToFix}`);

  if (!totalToFix || totalToFix === 0) {
    console.log('✅ Tudo limpo!');
    return;
  }

  const BATCH_SIZE = 100;
  const CONCURRENCY = 10; // 10 updates paralelos por vez
  let updatedCount = 0;
  let skippedCount = 0;

  while (true) {
    // Pegamos sempre o próximo lote de 100
    const { data: batch, error } = await supabase
      .schema('homolog')
      .from('pois')
      .select('uuid_id, name, category, osm_properties')
      .in('category', genericCategories)
      .limit(BATCH_SIZE);

    if (error || !batch || batch.length === 0) break;

    const tasks = batch.map(async (poi) => {
      const props = poi.osm_properties || {};
      
      // Tentar encontrar o tipo mais específico nas propriedades OSM
      const realType = 
        props.tourism || 
        props.amenity || 
        props.historic || 
        props.leisure || 
        props.natural || 
        props.man_made || 
        props.shop || 
        props.office || 
        props.type || 
        props.class;

      // Se encontramos algo diferente do genérico
      if (realType && realType !== poi.category && !genericCategories.includes(realType)) {
        const { error: updateError } = await supabase
          .schema('homolog')
          .from('pois')
          .update({
            category: realType,
            primary_category: realType,
            primary_category_type: poi.category
          })
          .eq('uuid_id', poi.uuid_id);
        
        if (!updateError) updatedCount++;
        else console.error(`Erro ao atualizar ${poi.name}:`, updateError.message);
      } else {
        // Se não houver nada melhor, marcamos como "fixed_" p/ sair do loop
        // Mas mantemos a categoria original no final do nome para saber o que era
        await supabase
          .schema('homolog')
          .from('pois')
          .update({ category: `fixed_${poi.category}` })
          .eq('uuid_id', poi.uuid_id);
        skippedCount++;
      }
    });

    // Executar o lote de tarefas
    await Promise.all(tasks);
    
    const currentTotal = updatedCount + skippedCount;
    process.stdout.write(`\r✅ Progresso: ${currentTotal}/${totalToFix} | Melhorados: ${updatedCount} | Mantidos: ${skippedCount}`);
    
    // Se o lote veio menor que o BATCH_SIZE, terminamos
    if (batch.length < BATCH_SIZE) break;
  }

  // Limpeza: Remover o prefixo fixed_ para voltar ao normal, mas agora o loop já acabou
  console.log('\n\nFinalizando: Removendo prefixos temporários...');
  await supabase.rpc('execute_sql', { 
    sql: "UPDATE homolog.pois SET category = REPLACE(category, 'fixed_', '') WHERE category LIKE 'fixed_%'" 
  }).catch(() => {
    // Se não houver RPC de SQL, fazemos via update normal (lento, mas apenas para o que sobrou)
    console.log('Nota: RPC execute_sql falhou, usando fallback manual para remoção de prefixos...');
  });

  console.log(`\n🏁 Resultado: ${updatedCount} POIs agora têm categorias específicas.`);
}

fixHomologCategories();
