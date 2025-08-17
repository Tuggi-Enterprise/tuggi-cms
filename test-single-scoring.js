const { createClient } = require('@supabase/supabase-js');

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !supabaseKey) {
  console.error('❌ NEXT_PUBLIC_SUPABASE_URL e SUPABASE_SERVICE_ROLE_KEY são necessárias');
  process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseKey);

async function testSingleScoring() {
  console.log('🧪 Testando scoring real em uma descrição...\n');
  
  try {
    // Buscar uma descrição original para teste
    const { data: descriptions, error: descError } = await supabase
      .schema('core')
      .from('attraction_descriptions')
      .select(`
        id, 
        description, 
        attraction_id, 
        is_original,
        attractions:attraction_id (
          name,
          website,
          reference_links
        )
      `)
      .eq('is_original', true)
      .not('description', 'is', null)
      .limit(1);

    if (descError || !descriptions || descriptions.length === 0) {
      console.log('❌ Nenhuma descrição original encontrada');
      return;
    }

    const description = descriptions[0];
    const attraction = description.attractions;
    
    console.log(`🏛️ Atração: ${attraction.name}`);
    console.log(`📋 Descrição ID: ${description.id}`);
    console.log(`📝 Descrição (${description.description.length} chars):`);
    console.log(`   "${description.description.substring(0, 150)}..."`);
    console.log(`🌐 Website: ${attraction.website || 'N/A'}`);
    console.log(`🔗 Reference Links: ${attraction.reference_links?.length || 0}\n`);

    // Processar verificação
    console.log('🚀 Processando verificação...');
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
      console.log('❌ Erro na verificação:', error);
      return;
    }

    console.log(`\n✅ Verificação concluída em ${duration}s`);
    console.log('\n📊 RESULTADOS:');
    console.log('=' .repeat(50));
    console.log(`Score Geral: ${data.score_overall}%`);
    console.log('\n📈 Subscores:');
    console.log(`   Factualidade: ${data.subscores.factuality}%`);
    console.log(`   Coerência: ${data.subscores.coherence}%`);
    console.log(`   TTS Clarity: ${data.subscores.tts_clarity}%`);
    console.log(`   Regras: ${data.subscores.rules}%`);
    
    console.log(`\n🔍 Claims Processados: ${data.claims_processed}`);
    console.log(`🏷️ Flags: ${data.flags?.length > 0 ? data.flags.join(', ') : 'Nenhuma'}`);
    
    if (data.reasoning) {
      console.log('\n💡 ANÁLISE DETALHADA:');
      console.log('=' .repeat(50));
      console.log(`Total de Claims: ${data.reasoning.total_claims}`);
      console.log(`Claims Suportados: ${data.reasoning.supported_claims}`);
      console.log(`Claims Contraditos: ${data.reasoning.contradicted_claims}`);
      console.log(`Claims Não Encontrados: ${data.reasoning.not_found_claims}`);
      console.log(`Tamanho da Descrição: ${data.reasoning.description_length} chars`);
      
      console.log('\n⚖️ Pesos Utilizados:');
      console.log(`   Factualidade: ${(data.reasoning.weights_used.factuality * 100).toFixed(1)}%`);
      console.log(`   Coerência: ${(data.reasoning.weights_used.coherence * 100).toFixed(1)}%`);
      console.log(`   TTS Clarity: ${(data.reasoning.weights_used.tts_clarity * 100).toFixed(1)}%`);
      console.log(`   Regras: ${(data.reasoning.weights_used.rules * 100).toFixed(1)}%`);
      
      // Calcular breakdown do score
      const factualityContrib = data.subscores.factuality * data.reasoning.weights_used.factuality;
      const coherenceContrib = data.subscores.coherence * data.reasoning.weights_used.coherence;
      const ttsContrib = data.subscores.tts_clarity * data.reasoning.weights_used.tts_clarity;
      const rulesContrib = data.subscores.rules * data.reasoning.weights_used.rules;
      
      console.log('\n🧮 Contribuição para Score Final:');
      console.log(`   Factualidade: ${factualityContrib.toFixed(1)} pontos`);
      console.log(`   Coerência: ${coherenceContrib.toFixed(1)} pontos`);
      console.log(`   TTS Clarity: ${ttsContrib.toFixed(1)} pontos`);
      console.log(`   Regras: ${rulesContrib.toFixed(1)} pontos`);
      console.log(`   TOTAL: ${(factualityContrib + coherenceContrib + ttsContrib + rulesContrib).toFixed(1)} pontos`);
      
      // Análise de performance
      if (data.reasoning.supported_claims === 0 && data.reasoning.total_claims > 0) {
        console.log('\n⚠️ PROBLEMA IDENTIFICADO: Nenhum claim foi suportado');
      }
      
      if (data.reasoning.contradicted_claims > 0) {
        console.log(`\n⚠️ ATENÇÃO: ${data.reasoning.contradicted_claims} claims contraditos encontrados`);
      }
      
      if (data.reasoning.total_claims === 0) {
        console.log('\n⚠️ PROBLEMA: Nenhum claim foi extraído da descrição');
      }
    }

    // Verificar se os dados foram salvos no banco
    console.log('\n🔍 Verificando dados salvos...');
    
    const { data: savedScore } = await supabase
      .schema('core')
      .from('description_scores')
      .select('*')
      .eq('description_id', description.id)
      .order('created_at', { ascending: false })
      .limit(1);
      
    if (savedScore && savedScore.length > 0) {
      console.log(`✅ Score salvo no banco: ${savedScore[0].score_overall}%`);
    } else {
      console.log('❌ Score não foi salvo no banco');
    }
    
    const { data: savedClaims } = await supabase
      .schema('core')
      .from('description_claims')
      .select('*')
      .eq('description_id', description.id);
      
    console.log(`📋 Claims salvos: ${savedClaims?.length || 0}`);
    
    const { data: savedEvidence } = await supabase
      .schema('core')
      .from('description_claim_evidence')
      .select('*')
      .in('claim_id', savedClaims?.map(c => c.id) || []);
      
    console.log(`🔍 Evidências salvas: ${savedEvidence?.length || 0}`);

  } catch (error) {
    console.error('❌ Erro inesperado:', error);
  }
}

testSingleScoring();
