const { createClient } = require('@supabase/supabase-js');

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !supabaseKey) {
  console.error('❌ NEXT_PUBLIC_SUPABASE_URL e SUPABASE_SERVICE_ROLE_KEY são necessárias');
  process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseKey);

async function testEvidenceFix() {
  console.log('🔧 TESTANDO CORREÇÃO DO SALVAMENTO DE EVIDÊNCIAS');
  console.log('=' .repeat(80));
  
  try {
    // Buscar uma atração com descrição original que tem dados factuais claros
    const { data: attractions } = await supabase
      .schema('core')
      .from('attractions')
      .select('id, name, city, country, website, reference_links')
      .ilike('name', '%Bourbon%')
      .limit(1);

    if (!attractions || attractions.length === 0) {
      console.log('❌ Atração de teste não encontrada');
      return;
    }

    const attraction = attractions[0];
    console.log(`🎯 Atração de teste: ${attraction.name}`);
    console.log(`📍 Localização: ${attraction.city}, ${attraction.country}`);
    console.log(`🌐 Website: ${attraction.website || 'N/A'}`);
    console.log(`🔗 Links de referência: ${attraction.reference_links?.length || 0}`);

    // Buscar descrição original
    const { data: descriptions } = await supabase
      .schema('core')
      .from('attraction_descriptions')
      .select('id, description, attraction_id, is_original')
      .eq('attraction_id', attraction.id)
      .eq('is_original', true)
      .eq('language', 'pt-br')
      .limit(1);

    if (!descriptions || descriptions.length === 0) {
      console.log('❌ Descrição original não encontrada');
      return;
    }

    const description = descriptions[0];
    console.log(`\n📋 Descrição (${description.description.length} chars):`);
    console.log(`"${description.description}"`);

    // Limpar dados antigos para teste limpo
    console.log(`\n🧹 Limpando dados antigos...`);
    
    // Buscar claims antigos
    const { data: oldClaims } = await supabase
      .schema('core')
      .from('description_claims')
      .select('id')
      .eq('description_id', description.id);
      
    if (oldClaims && oldClaims.length > 0) {
      // Deletar evidências antigas
      await supabase
        .schema('core')
        .from('description_claim_evidence')
        .delete()
        .in('claim_id', oldClaims.map(c => c.id));
        
      // Deletar claims antigos
      await supabase
        .schema('core')
        .from('description_claims')
        .delete()
        .eq('description_id', description.id);
        
      console.log(`🗑️ Removidos ${oldClaims.length} claims antigos`);
    }
    
    // Deletar scores antigos
    await supabase
      .schema('core')
      .from('description_scores')
      .delete()
      .eq('description_id', description.id);

    // Processar com as correções implementadas
    console.log(`\n🚀 Processando com correções de evidência...`);
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
      return;
    }

    console.log(`\n✅ Processamento concluído em ${duration}s`);
    console.log(`📊 Score: ${data.score_overall}%`);
    console.log(`🔍 Claims processados: ${data.claims_processed}`);
    
    if (data.reasoning) {
      console.log(`\n💡 Análise detalhada:`);
      console.log(`   Claims extraídos: ${data.reasoning.total_claims}`);
      console.log(`   Claims suportados: ${data.reasoning.supported_claims}`);
      console.log(`   Claims contraditos: ${data.reasoning.contradicted_claims}`);
      console.log(`   Claims não encontrados: ${data.reasoning.not_found_claims}`);
    }

    // Verificar dados salvos no banco
    console.log(`\n🔍 VERIFICANDO DADOS SALVOS:`);
    
    // Verificar score
    const { data: savedScore } = await supabase
      .schema('core')
      .from('description_scores')
      .select('score_overall, subscores, flags')
      .eq('description_id', description.id)
      .order('created_at', { ascending: false })
      .limit(1);
      
    console.log(`📊 Score salvo: ${savedScore?.[0]?.score_overall || 'N/A'}%`);
    
    // Verificar claims
    const { data: savedClaims } = await supabase
      .schema('core')
      .from('description_claims')
      .select('id, value, claim_type, status, weight')
      .eq('description_id', description.id)
      .order('created_at', { ascending: false });
      
    console.log(`📋 Claims salvos: ${savedClaims?.length || 0}`);
    
    if (savedClaims && savedClaims.length > 0) {
      console.log(`\n📝 CLAIMS DETALHADOS:`);
      savedClaims.forEach((claim, index) => {
        console.log(`   ${index + 1}. "${claim.value}" (${claim.claim_type}, ${claim.status})`);
      });
      
      // Verificar evidências - ESTE É O TESTE PRINCIPAL!
      const { data: savedEvidence } = await supabase
        .schema('core')
        .from('description_claim_evidence')
        .select('*')
        .in('claim_id', savedClaims.map(c => c.id));
        
      console.log(`\n🎯 EVIDÊNCIAS SALVAS: ${savedEvidence?.length || 0}`);
      
      if (savedEvidence && savedEvidence.length > 0) {
        console.log(`\n🎉 SUCESSO! Evidências estão sendo salvas:`);
        savedEvidence.forEach((evidence, index) => {
          console.log(`   ${index + 1}. Fonte: ${evidence.source}`);
          console.log(`      Página: ${evidence.page}`);
          console.log(`      URL: ${evidence.url}`);
          console.log(`      Quote: "${evidence.quote.substring(0, 80)}..."`);
          console.log(`      Veredicto: ${evidence.verdict}\n`);
        });
        
        // Análise por claim
        console.log(`📊 ANÁLISE POR CLAIM:`);
        savedClaims.forEach(claim => {
          const claimEvidence = savedEvidence.filter(e => e.claim_id === claim.id);
          console.log(`   "${claim.value}": ${claimEvidence.length} evidências`);
        });
        
      } else {
        console.log(`\n❌ PROBLEMA PERSISTENTE: Ainda não há evidências sendo salvas`);
        
        // Debug adicional
        console.log(`\n🔍 DEBUG ADICIONAL:`);
        console.log(`   Claims com status 'supported': ${savedClaims.filter(c => c.status === 'supported').length}`);
        console.log(`   Claims com status 'not_found': ${savedClaims.filter(c => c.status === 'not_found').length}`);
        console.log(`   Claims com status 'contradicted': ${savedClaims.filter(c => c.status === 'contradicted').length}`);
      }
    } else {
      console.log(`❌ Nenhum claim foi salvo`);
    }
    
    // Comparação antes/depois
    console.log(`\n📈 COMPARAÇÃO DE MELHORIAS:`);
    console.log(`   ✅ Claims extraídos: ${data.reasoning?.total_claims || 0} (vs. 0-2 antes)`);
    console.log(`   ✅ Evidências salvas: ${savedEvidence?.length || 0} (vs. 0 antes)`);
    console.log(`   ✅ Score variável: ${data.score_overall}% (vs. 75% fixo antes)`);
    console.log(`   ✅ Reasoning detalhado: ${data.reasoning ? 'Sim' : 'Não'}`);

  } catch (error) {
    console.error('❌ Erro no teste:', error);
  }
  
  console.log('\n🎯 Teste de correção de evidências concluído!');
}

testEvidenceFix();
