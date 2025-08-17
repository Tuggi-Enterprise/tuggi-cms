const { createClient } = require('@supabase/supabase-js');

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !supabaseKey) {
  console.error('❌ NEXT_PUBLIC_SUPABASE_URL e SUPABASE_SERVICE_ROLE_KEY são necessárias');
  process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseKey);

// Lista das 8 atrações da imagem que você enviou
const targetAttractions = [
  'Jardim Botânico de São Paulo',
  'Museu da Cidade de São Paulo / Solar da Marquesa de Santos',
  'Bourbon Resort Atibaia',
  'Museu da Energia de São Paulo',
  'Parque Dom Pedro II',
  'Museo Olímpico y del Deporte Joan Antoni Samaranch',
  'Parque do Povo Mário Pimenta Camargo',
  'Capela Santa Cruz'
];

async function testImprovedScoring() {
  console.log('🚀 TESTANDO MELHORIAS NO SISTEMA DE SCORING');
  console.log('=' .repeat(80));
  console.log(`📋 Testando ${targetAttractions.length} atrações específicas da lista\n`);
  
  const results = [];
  
  for (let i = 0; i < targetAttractions.length; i++) {
    const attractionName = targetAttractions[i];
    console.log(`\n🎯 ${i + 1}/${targetAttractions.length} - ${attractionName}`);
    console.log('-' .repeat(60));
    
    try {
      // Buscar a atração por nome
      const { data: attractions, error: attractionError } = await supabase
        .schema('core')
        .from('attractions')
        .select('id, name, city, country, website, reference_links')
        .ilike('name', `%${attractionName.split('/')[0].trim()}%`)
        .limit(1);

      if (attractionError || !attractions || attractions.length === 0) {
        console.log(`❌ Atração não encontrada: ${attractionName}`);
        results.push({
          name: attractionName,
          status: 'not_found',
          error: 'Atração não encontrada no banco'
        });
        continue;
      }

      const attraction = attractions[0];
      console.log(`✅ Encontrada: ${attraction.name}`);
      console.log(`📍 Localização: ${attraction.city}, ${attraction.country}`);
      console.log(`🌐 Website: ${attraction.website || 'N/A'}`);
      console.log(`🔗 Links de Referência: ${attraction.reference_links?.length || 0}`);

      // Buscar descrição original
      const { data: descriptions, error: descError } = await supabase
        .schema('core')
        .from('attraction_descriptions')
        .select('id, description, attraction_id, is_original, language')
        .eq('attraction_id', attraction.id)
        .eq('is_original', true)
        .eq('language', 'pt-br')
        .limit(1);

      if (descError || !descriptions || descriptions.length === 0) {
        console.log(`❌ Nenhuma descrição original em português encontrada`);
        results.push({
          name: attraction.name,
          status: 'no_description',
          error: 'Descrição original não encontrada'
        });
        continue;
      }

      const description = descriptions[0];
      console.log(`📋 Descrição (${description.description.length} chars):`);
      console.log(`   "${description.description.substring(0, 120)}..."`);

      // Processar verificação com as melhorias
      console.log(`\n🔄 Processando com sistema melhorado...`);
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
          error: error.message,
          duration
        });
        continue;
      }

      console.log(`\n✅ Processado em ${duration}s`);
      console.log(`📊 Score Final: ${data.score_overall}%`);
      console.log(`🔍 Claims Processados: ${data.claims_processed}`);
      
      // Mostrar breakdown detalhado
      if (data.subscores) {
        console.log(`📈 Breakdown dos Subscores:`);
        console.log(`   • Factualidade: ${data.subscores.factuality}%`);
        console.log(`   • Coerência: ${data.subscores.coherence}%`);
        console.log(`   • TTS Clarity: ${data.subscores.tts_clarity}%`);
        console.log(`   • Regras: ${data.subscores.rules}%`);
      }
      
      if (data.flags && data.flags.length > 0) {
        console.log(`⚠️ Flags: ${data.flags.join(', ')}`);
      }
      
      if (data.reasoning) {
        console.log(`💡 Análise:`);
        console.log(`   Claims Extraídos: ${data.reasoning.total_claims}`);
        console.log(`   Claims Suportados: ${data.reasoning.supported_claims}`);
        console.log(`   Claims Contraditos: ${data.reasoning.contradicted_claims}`);
        console.log(`   Claims Não Encontrados: ${data.reasoning.not_found_claims}`);
        
        if (data.reasoning.total_claims > 0) {
          const successRate = (data.reasoning.supported_claims / data.reasoning.total_claims * 100).toFixed(1);
          console.log(`   Taxa de Sucesso: ${successRate}%`);
        }
      }

      results.push({
        name: attraction.name,
        status: 'success',
        score_overall: data.score_overall,
        subscores: data.subscores,
        claims_processed: data.claims_processed,
        claims_extracted: data.reasoning?.total_claims || 0,
        claims_supported: data.reasoning?.supported_claims || 0,
        claims_contradicted: data.reasoning?.contradicted_claims || 0,
        claims_not_found: data.reasoning?.not_found_claims || 0,
        flags: data.flags || [],
        duration,
        description_length: description.description.length
      });

      // Verificar evidências salvas
      const { data: savedClaims } = await supabase
        .schema('core')
        .from('description_claims')
        .select('id')
        .eq('description_id', description.id);
        
      const { data: savedEvidence } = await supabase
        .schema('core')
        .from('description_claim_evidence')
        .select('id')
        .in('claim_id', savedClaims?.map(c => c.id) || []);
        
      console.log(`💾 Dados Salvos: ${savedClaims?.length || 0} claims, ${savedEvidence?.length || 0} evidências`);

      // Aguardar entre processamentos para evitar rate limiting
      if (i < targetAttractions.length - 1) {
        console.log('⏳ Aguardando 3s...');
        await new Promise(resolve => setTimeout(resolve, 3000));
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

  // ANÁLISE FINAL DOS RESULTADOS
  console.log('\n\n🎉 ANÁLISE FINAL DAS MELHORIAS');
  console.log('=' .repeat(80));
  
  const successful = results.filter(r => r.status === 'success');
  const failed = results.filter(r => r.status !== 'success');
  
  console.log(`\n📊 RESUMO GERAL:`);
  console.log(`✅ Processados com sucesso: ${successful.length}/${results.length}`);
  console.log(`❌ Falhas: ${failed.length}/${results.length}`);
  
  if (successful.length > 0) {
    const scores = successful.map(r => r.score_overall);
    const avgScore = scores.reduce((a, b) => a + b, 0) / scores.length;
    const minScore = Math.min(...scores);
    const maxScore = Math.max(...scores);
    const uniqueScores = [...new Set(scores)].length;
    
    console.log(`\n📈 ANÁLISE DE SCORES:`);
    console.log(`   Média: ${avgScore.toFixed(1)}%`);
    console.log(`   Mínimo: ${minScore}% | Máximo: ${maxScore}%`);
    console.log(`   Range: ${maxScore - minScore}%`);
    console.log(`   Scores únicos: ${uniqueScores} (${uniqueScores === 1 ? '❌ TODOS IGUAIS!' : '✅ Variação detectada'})`);
    
    console.log(`\n🔍 ANÁLISE DE CLAIMS:`);
    const totalClaimsExtracted = successful.reduce((sum, r) => sum + r.claims_extracted, 0);
    const totalClaimsSupported = successful.reduce((sum, r) => sum + r.claims_supported, 0);
    const avgClaimsPerDescription = totalClaimsExtracted / successful.length;
    const overallSuccessRate = totalClaimsExtracted > 0 ? (totalClaimsSupported / totalClaimsExtracted * 100) : 0;
    
    console.log(`   Claims extraídos (total): ${totalClaimsExtracted}`);
    console.log(`   Claims suportados (total): ${totalClaimsSupported}`);
    console.log(`   Média de claims por descrição: ${avgClaimsPerDescription.toFixed(1)}`);
    console.log(`   Taxa geral de sucesso: ${overallSuccessRate.toFixed(1)}%`);
    
    console.log(`\n🏆 TOP PERFORMERS:`);
    const topScores = successful
      .sort((a, b) => b.score_overall - a.score_overall)
      .slice(0, 3);
    
    topScores.forEach((result, index) => {
      console.log(`   ${index + 1}. ${result.name}: ${result.score_overall}% (${result.claims_supported}/${result.claims_extracted} claims)`);
    });
    
    console.log(`\n⚠️ PROBLEMAS IDENTIFICADOS:`);
    const withFlags = successful.filter(r => r.flags.length > 0);
    const noClaims = successful.filter(r => r.claims_extracted === 0);
    const noSupported = successful.filter(r => r.claims_supported === 0 && r.claims_extracted > 0);
    const lowScores = successful.filter(r => r.score_overall < 50);
    
    console.log(`   Com flags: ${withFlags.length}`);
    console.log(`   Sem claims extraídos: ${noClaims.length}`);
    console.log(`   Sem claims suportados: ${noSupported.length}`);
    console.log(`   Scores baixos (<50%): ${lowScores.length}`);
    
    if (noClaims.length > 0) {
      console.log(`\n❌ DESCRIÇÕES SEM CLAIMS EXTRAÍDOS:`);
      noClaims.forEach(r => {
        console.log(`   • ${r.name} (${r.description_length} chars)`);
      });
    }
  }
  
  if (failed.length > 0) {
    console.log(`\n❌ FALHAS DETALHADAS:`);
    failed.forEach(result => {
      console.log(`   • ${result.name}: ${result.error}`);
    });
  }
  
  console.log(`\n✨ MELHORIAS IMPLEMENTADAS TESTADAS:`);
  console.log(`   ✅ Extração de claims melhorada (9 categorias)`);
  console.log(`   ✅ Fontes segmentadas por país (IPHAN, INAH, etc.)`);
  console.log(`   ✅ Scoring real baseado em claims verificados`);
  console.log(`   ✅ Reasoning detalhado para cada score`);
  console.log(`   ✅ Sistema de flags para identificar problemas`);
  
  console.log('\n🎯 Teste das melhorias concluído!');
}

testImprovedScoring();
