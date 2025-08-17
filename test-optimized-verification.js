const { createClient } = require('@supabase/supabase-js');

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !supabaseKey) {
  console.error('❌ NEXT_PUBLIC_SUPABASE_URL e SUPABASE_SERVICE_ROLE_KEY são necessárias');
  process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseKey);

async function testOptimizedVerification() {
  console.log('🚀 Testando sistema otimizado de verificação...');
  
  try {
    // 1. Testar processamento de uma descrição individual
    console.log('\n📋 Testando verificação individual...');
    
    const descriptionId = '64f278e6-f536-45d0-a3ca-777b6549ba92';
    
    const { data: description, error: fetchError } = await supabase
      .schema('core')
      .from('attraction_descriptions')
      .select('id, description, attraction_id, is_original')
      .eq('id', descriptionId)
      .single();

    if (fetchError) {
      console.error('❌ Erro ao buscar descrição:', fetchError);
      return;
    }

    console.log('📋 Descrição encontrada:', {
      id: description.id,
      description_length: description.description?.length || 0
    });

    // 2. Testar a Edge Function otimizada
    console.log('\n🔄 Chamando Edge Function otimizada...');
    const startTime = Date.now();
    
    const { data, error } = await supabase.functions.invoke('verify-batch', {
      body: {
        description_id: description.id,
        description: description.description,
        attraction_id: description.attraction_id,
        force_reprocess: true
      }
    });

    const endTime = Date.now();
    const duration = (endTime - startTime) / 1000;

    if (error) {
      console.error('❌ Erro na Edge Function:', error);
      return;
    }

    console.log(`✅ Verificação concluída em ${duration}s:`, {
      success: data.success,
      score_overall: data.score_overall,
      claims_processed: data.claims_processed
    });

    // 3. Verificar resultados
    console.log('\n🔍 Verificando resultados...');
    
    const { data: scores } = await supabase
      .schema('core')
      .from('description_scores')
      .select('*')
      .eq('description_id', description.id)
      .order('created_at', { ascending: false })
      .limit(1);

    if (scores && scores.length > 0) {
      console.log('✅ Score salvo:', {
        score_overall: scores[0].score_overall,
        subscores: scores[0].subscores,
        flags: scores[0].flags
      });
    }

    const { data: claims } = await supabase
      .schema('core')
      .from('description_claims')
      .select('*')
      .eq('description_id', description.id);

    console.log(`📊 Claims encontrados: ${claims?.length || 0}`);
    if (claims && claims.length > 0) {
      claims.forEach((claim, index) => {
        console.log(`  ${index + 1}. ${claim.value} (${claim.status})`);
      });
    }

    // 4. Testar processamento em lote pequeno
    console.log('\n📦 Testando processamento em lote (3 descrições)...');
    
    const { data: batchDescriptions } = await supabase
      .schema('core')
      .from('attraction_descriptions')
      .select('id, description, attraction_id, is_original')
      .eq('is_original', true)
      .limit(3);

    if (batchDescriptions && batchDescriptions.length > 0) {
      console.log(`📋 Processando ${batchDescriptions.length} descrições em lote...`);
      
      for (const desc of batchDescriptions) {
        try {
          console.log(`🔄 Processando ${desc.id}...`);
          
          const { data: batchResult, error: batchError } = await supabase.functions.invoke('verify-batch', {
            body: {
              description_id: desc.id,
              description: desc.description,
              attraction_id: desc.attraction_id,
              force_reprocess: false
            }
          });

          if (batchError) {
            console.error(`❌ Erro ao processar ${desc.id}:`, batchError.message);
          } else {
            console.log(`✅ ${desc.id} processado: Score ${batchResult.score_overall}`);
          }

          // Aguardar 1 segundo entre processamentos
          await new Promise(resolve => setTimeout(resolve, 1000));
          
        } catch (error) {
          console.error(`❌ Erro inesperado ao processar ${desc.id}:`, error.message);
        }
      }
    }

    console.log('\n🎉 Teste do sistema otimizado concluído!');

  } catch (error) {
    console.error('❌ Erro inesperado:', error);
  }
}

testOptimizedVerification();
