const { createClient } = require('@supabase/supabase-js');

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !supabaseKey) {
  console.error('❌ NEXT_PUBLIC_SUPABASE_URL e SUPABASE_SERVICE_ROLE_KEY são necessárias');
  process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseKey);

// 8 itens de amostragem baseados na imagem
const sampleAttractions = [
  'Jardim Botânico de São Paulo',
  'Museu da Cidade de São Paulo / Solar da Marquesa de Santos',
  'Parque Dom Pedro II',
  'Museo Olímpico y del Deporte Joan Antoni Samaranch',
  'Parque do Povo Mário Pimenta Camargo',
  'Monumento aos Heróis da Travessia do Atlântico',
  'Bourbon Resort Atibaia',
  'Capela Santa Cruz'
];

async function testRealScoring() {
  console.log('🧪 Testando scoring real nos 8 itens de amostragem...\n');
  
  const results = [];
  
  for (let i = 0; i < sampleAttractions.length; i++) {
    const attractionName = sampleAttractions[i];
    console.log(`\n📋 ${i + 1}/8 - Testando: ${attractionName}`);
    
    try {
      // Buscar a atração
      const { data: attractions, error: attractionError } = await supabase
        .schema('core')
        .from('attractions')
        .select('id, name, website, reference_links')
        .ilike('name', `%${attractionName}%`)
        .limit(1);

      if (attractionError || !attractions || attractions.length === 0) {
        console.log(`❌ Atração não encontrada: ${attractionName}`);
        continue;
      }

      const attraction = attractions[0];
      console.log(`✅ Encontrada: ${attraction.name}`);
      console.log(`   Website: ${attraction.website || 'N/A'}`);
      console.log(`   Reference Links: ${attraction.reference_links?.length || 0}`);

      // Buscar descrição original
      const { data: descriptions, error: descError } = await supabase
        .schema('core')
        .from('attraction_descriptions')
        .select('id, description, attraction_id, is_original')
        .eq('attraction_id', attraction.id)
        .eq('is_original', true)
        .limit(1);

      if (descError || !descriptions || descriptions.length === 0) {
        console.log(`❌ Nenhuma descrição original encontrada`);
        continue;
      }

      const description = descriptions[0];
      console.log(`📋 Descrição (${description.description.length} chars): ${description.description.substring(0, 80)}...`);

      // Testar verificação
      console.log(`🚀 Processando verificação...`);
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
        console.log(`❌ Erro na verificação:`, error);
        results.push({
          name: attraction.name,
          status: 'error',
          error: error.message
        });
        continue;
      }

      console.log(`✅ Verificação concluída em ${duration}s`);
      console.log(`📊 Score: ${data.score_overall}% (Factuality: ${data.subscores.factuality}%, Coherence: ${data.subscores.coherence}%, TTS: ${data.subscores.tts_clarity}%, Rules: ${data.subscores.rules}%)`);
      console.log(`🔍 Claims: ${data.claims_processed}`);
      console.log(`🏷️ Flags: ${data.flags?.join(', ') || 'None'}`);
      
      if (data.reasoning) {
        console.log(`💡 Reasoning:`);
        console.log(`   Total Claims: ${data.reasoning.total_claims}`);
        console.log(`   Supported: ${data.reasoning.supported_claims}`);
        console.log(`   Contradicted: ${data.reasoning.contradicted_claims}`);
        console.log(`   Not Found: ${data.reasoning.not_found_claims}`);
        console.log(`   Description Length: ${data.reasoning.description_length}`);
      }

      results.push({
        name: attraction.name,
        status: 'success',
        score_overall: data.score_overall,
        subscores: data.subscores,
        claims_processed: data.claims_processed,
        flags: data.flags || [],
        reasoning: data.reasoning,
        duration
      });

      // Aguardar 2 segundos entre processamentos
      if (i < sampleAttractions.length - 1) {
        console.log('⏳ Aguardando 2s...');
        await new Promise(resolve => setTimeout(resolve, 2000));
      }

    } catch (error) {
      console.log(`❌ Erro inesperado:`, error.message);
      results.push({
        name: attractionName,
        status: 'error',
        error: error.message
      });
    }
  }

  // Resumo dos resultados
  console.log('\n\n📊 RESUMO DOS RESULTADOS:');
  console.log('=' .repeat(80));
  
  const successful = results.filter(r => r.status === 'success');
  const failed = results.filter(r => r.status === 'error');
  
  console.log(`\n✅ Sucessos: ${successful.length}/${results.length}`);
  console.log(`❌ Falhas: ${failed.length}/${results.length}`);
  
  if (successful.length > 0) {
    console.log('\n📈 ANÁLISE DE SCORES:');
    
    const scores = successful.map(r => r.score_overall);
    const avgScore = scores.reduce((a, b) => a + b, 0) / scores.length;
    const minScore = Math.min(...scores);
    const maxScore = Math.max(...scores);
    
    console.log(`   Média: ${avgScore.toFixed(1)}%`);
    console.log(`   Mínimo: ${minScore}%`);
    console.log(`   Máximo: ${maxScore}%`);
    console.log(`   Range: ${maxScore - minScore}%`);
    
    console.log('\n📋 DETALHES POR ATRAÇÃO:');
    successful.forEach(result => {
      console.log(`\n🏛️ ${result.name}`);
      console.log(`   Score: ${result.score_overall}%`);
      console.log(`   Factuality: ${result.subscores.factuality}%`);
      console.log(`   Claims: ${result.reasoning?.supported_claims}/${result.reasoning?.total_claims} supported`);
      console.log(`   Flags: ${result.flags.length > 0 ? result.flags.join(', ') : 'None'}`);
      console.log(`   Duration: ${result.duration}s`);
    });
    
    console.log('\n🔍 PROBLEMAS IDENTIFICADOS:');
    const withFlags = successful.filter(r => r.flags.length > 0);
    const noSupportedClaims = successful.filter(r => r.reasoning?.supported_claims === 0);
    const lowScores = successful.filter(r => r.score_overall < 60);
    
    console.log(`   Com flags: ${withFlags.length}`);
    console.log(`   Sem claims suportados: ${noSupportedClaims.length}`);
    console.log(`   Scores baixos (<60%): ${lowScores.length}`);
  }
  
  if (failed.length > 0) {
    console.log('\n❌ FALHAS:');
    failed.forEach(result => {
      console.log(`   ${result.name}: ${result.error}`);
    });
  }
  
  console.log('\n🎉 Teste completo!');
}

testRealScoring();
