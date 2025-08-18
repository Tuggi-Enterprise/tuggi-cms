const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

async function forceVerifyHistorical() {
  console.log('🔍 Forçando verificação da descrição histórica...\n');

  try {
    // 1. Buscar a descrição histórica específica
    const { data: descriptions, error } = await supabase
      .schema('core')
      .from('attraction_descriptions')
      .select(`
        id, description, updated_at,
        attractions(name, city, country)
      `)
      .ilike('description', '%dezembro de 2023%')
      .eq('language', 'pt-br')
      .eq('is_original', true);

    if (error || !descriptions || descriptions.length === 0) {
      console.error('❌ Erro ao buscar descrição histórica:', error);
      return;
    }

    const historicalDesc = descriptions[0];
    console.log('✅ Descrição histórica encontrada:');
    console.log(`   POI: ${historicalDesc.attractions.name}`);
    console.log(`   ID: ${historicalDesc.id}`);
    console.log(`   Atualizada: ${new Date(historicalDesc.updated_at).toLocaleString('pt-BR')}`);
    console.log(`   Texto: "${historicalDesc.description.substring(0, 100)}..."`);

    // 2. Resetar status para forçar reprocessamento
    console.log('\n🔄 Resetando status para forçar reprocessamento...');
    
    const { error: resetError } = await supabase
      .schema('core')
      .from('attraction_descriptions')
      .update({ 
        verification_status: 'pending',
        updated_at: new Date().toISOString()
      })
      .eq('id', historicalDesc.id);

    if (resetError) {
      console.error('❌ Erro ao resetar status:', resetError);
      return;
    }

    console.log('✅ Status resetado com sucesso');

    // 3. Aguardar um momento
    console.log('\n⏳ Aguardando 2 segundos...');
    await new Promise(resolve => setTimeout(resolve, 2000));

    // 4. Chamar verificação usando o método de processamento
    console.log('\n🚀 Iniciando processamento em lote...');
    
    const { data: batchResult, error: batchError } = await supabase.functions.invoke('verify-batch', {
      body: {
        limit: 5,
        cursor: null
      }
    });

    if (batchError) {
      console.error('❌ Erro no processamento:', batchError);
    } else {
      console.log('✅ Processamento iniciado!');
      console.log('📊 Resultado:', JSON.stringify(batchResult, null, 2));
    }

    // 5. Aguardar processamento
    console.log('\n⏳ Aguardando processamento (10 segundos)...');
    await new Promise(resolve => setTimeout(resolve, 10000));

    // 6. Verificar resultados
    console.log('\n🔍 Verificando resultados da verificação...');
    
    const { data: updatedDesc, error: checkError } = await supabase
      .schema('core')
      .from('attraction_descriptions')
      .select('verification_status, score_overall')
      .eq('id', historicalDesc.id)
      .single();

    if (checkError) {
      console.error('❌ Erro ao verificar resultado:', checkError);
    } else {
      console.log('✅ Status atualizado:');
      console.log(`   Status: ${updatedDesc.verification_status || 'ainda processando'}`);
      console.log(`   Score: ${updatedDesc.score_overall || 'ainda calculando'}%`);
    }

    // 7. Buscar score detalhado
    const { data: score, error: scoreError } = await supabase
      .schema('core')
      .from('description_scores')
      .select('*')
      .eq('description_id', historicalDesc.id)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();

    if (!scoreError && score) {
      console.log('\n📊 Score detalhado encontrado:');
      console.log(`   Score geral: ${score.score_overall}%`);
      console.log(`   Factualidade: ${score.score_factuality}%`);
      console.log(`   Coerência: ${score.score_coherence}%`);
      console.log(`   TTS: ${score.score_tts_clarity}%`);
      console.log(`   Regras: ${score.score_rules}%`);
      console.log(`   Status: ${score.verification_status}`);
      console.log(`   Flags: ${score.flags ? score.flags.join(', ') : 'nenhuma'}`);
    }

    // 8. Buscar claims da nova verificação
    const { data: newClaims, error: claimsError } = await supabase
      .schema('core')
      .from('description_claims')
      .select('*')
      .eq('description_id', historicalDesc.id)
      .order('created_at', { ascending: false })
      .limit(10);

    if (!claimsError && newClaims && newClaims.length > 0) {
      console.log(`\n🔍 ${newClaims.length} claims mais recentes:`);
      newClaims.forEach((claim, index) => {
        console.log(`   ${index + 1}. [${claim.claim_type}] "${claim.value}"`);
        console.log(`      Status: ${claim.verification_status || 'não verificada'}`);
      });
    }

    console.log('\n🎯 ANÁLISE DA VERIFICAÇÃO HISTÓRICA:');
    console.log('─'.repeat(60));
    console.log('✅ Dados factuais na descrição:');
    console.log('   • "dezembro de 2023" (data específica)');
    console.log('   • "23 metros de comprimento" (medida exata)');
    console.log('   • "ponte de estilo japonês" (tipo específico)');
    console.log('   • "Tori, portal japonês" (elemento cultural)');
    console.log('   • "Festa da Linguiça" (evento tradicional)');
    console.log('   • "cartão-postal de Bragança Paulista" (status)');
    
    if (score && score.score_overall) {
      console.log(`\n📈 Score esperado: > 70% (dados verificáveis)`);
      console.log(`📊 Score obtido: ${score.score_overall}%`);
      
      if (score.score_overall > 70) {
        console.log('🎉 SUCESSO! Score significativamente melhor!');
      } else if (score.score_overall > 54) {
        console.log('✅ MELHORIA! Score superior ao anterior!');
      } else {
        console.log('⚠️ Score ainda baixo, investigar claims');
      }
    }

  } catch (error) {
    console.error('❌ Erro geral:', error);
  }
}

forceVerifyHistorical();
