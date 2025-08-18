const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

async function forceReprocessOptimized() {
  console.log('🔄 Forçando reprocessamento da descrição otimizada...\n');

  try {
    // 1. Buscar a descrição otimizada
    const { data: poi, error: poiError } = await supabase
      .schema('core')
      .from('attractions')
      .select('id, name, city')
      .eq('name', 'Lago do Taboão')
      .eq('city', 'Bragança Paulista')
      .single();

    if (poiError || !poi) {
      console.error('❌ Erro ao buscar POI:', poiError);
      return;
    }

    const { data: optimizedDesc, error: descError } = await supabase
      .schema('core')
      .from('attraction_descriptions')
      .select('*')
      .eq('attraction_id', poi.id)
      .eq('language', 'pt-br')
      .eq('is_original', true)
      .ilike('description', '%dezembro de 2023%')
      .single();

    if (descError || !optimizedDesc) {
      console.error('❌ Erro ao buscar descrição otimizada:', descError);
      return;
    }

    console.log('✅ Descrição otimizada encontrada:');
    console.log(`   ID: ${optimizedDesc.id}`);
    console.log(`   Status atual: ${optimizedDesc.verification_status}`);
    console.log(`   Texto: "${optimizedDesc.description}"`);

    // 2. Limpar claims antigas
    console.log('\n🧹 Limpando claims antigas...');
    
    const { error: deleteClaimsError } = await supabase
      .schema('core')
      .from('description_claims')
      .delete()
      .eq('description_id', optimizedDesc.id);

    if (deleteClaimsError) {
      console.error('❌ Erro ao limpar claims:', deleteClaimsError);
    } else {
      console.log('✅ Claims antigas removidas');
    }

    // 3. Limpar scores antigos
    console.log('🧹 Limpando scores antigos...');
    
    const { error: deleteScoresError } = await supabase
      .schema('core')
      .from('description_scores')
      .delete()
      .eq('description_id', optimizedDesc.id);

    if (deleteScoresError) {
      console.error('❌ Erro ao limpar scores:', deleteScoresError);
    } else {
      console.log('✅ Scores antigos removidos');
    }

    // 4. Resetar status da descrição
    console.log('🔄 Resetando status da descrição...');
    
    const { error: resetError } = await supabase
      .schema('core')
      .from('attraction_descriptions')
      .update({
        verification_status: 'pending',
        updated_at: new Date().toISOString()
      })
      .eq('id', optimizedDesc.id);

    if (resetError) {
      console.error('❌ Erro ao resetar status:', resetError);
      return;
    }

    console.log('✅ Status resetado para "pending"');

    // 5. Aguardar um momento
    console.log('\n⏳ Aguardando 3 segundos...');
    await new Promise(resolve => setTimeout(resolve, 3000));

    // 6. Chamar verificação via Edge Function
    console.log('\n🚀 Iniciando verificação da descrição limpa...');
    
    const { data: verificationResult, error: verifyError } = await supabase.functions.invoke('verify-batch', {
      body: {
        limit: 1,
        cursor: null
      }
    });

    if (verifyError) {
      console.error('❌ Erro na verificação:', verifyError);
      console.log('⚠️ Continuando para verificar resultados...');
    } else {
      console.log('✅ Verificação iniciada!');
      console.log('📊 Resultado:', JSON.stringify(verificationResult, null, 2));
    }

    // 7. Aguardar processamento
    console.log('\n⏳ Aguardando processamento (15 segundos)...');
    await new Promise(resolve => setTimeout(resolve, 15000));

    // 8. Verificar novos resultados
    console.log('\n🔍 Verificando novos resultados...');
    
    const { data: newScore, error: scoreError } = await supabase
      .schema('core')
      .from('description_scores')
      .select('*')
      .eq('description_id', optimizedDesc.id)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();

    if (!scoreError && newScore) {
      console.log('\n🎉 NOVO SCORE GERADO!');
      console.log('─'.repeat(60));
      console.log(`   Score geral: ${newScore.score_overall}%`);
      console.log(`   Factualidade: ${newScore.score_factuality}%`);
      console.log(`   Coerência: ${newScore.score_coherence}%`);
      console.log(`   TTS: ${newScore.score_tts_clarity}%`);
      console.log(`   Regras: ${newScore.score_rules}%`);
      console.log(`   Status: ${newScore.verification_status}`);
      console.log(`   Flags: ${newScore.flags ? newScore.flags.join(', ') : 'nenhuma'}`);
      console.log('─'.repeat(60));
    } else {
      console.log('⚠️ Nenhum novo score encontrado');
    }

    // 9. Verificar novas claims
    const { data: newClaims, error: claimsError } = await supabase
      .schema('core')
      .from('description_claims')
      .select('*')
      .eq('description_id', optimizedDesc.id)
      .order('created_at', { ascending: false });

    if (!claimsError && newClaims && newClaims.length > 0) {
      console.log(`\n🎯 ${newClaims.length} NOVAS CLAIMS EXTRAÍDAS:`);
      newClaims.forEach((claim, index) => {
        console.log(`   ${index + 1}. [${claim.claim_type}] "${claim.value}"`);
        console.log(`      Status: ${claim.verification_status || 'não verificada'}`);
      });

      // Verificar se as claims são da descrição correta
      const expectedClaims = [
        'dezembro de 2023',
        '23 metros',
        'ponte japonesa',
        'portal Tori',
        'Festival da Linguiça',
        'cartão-postal'
      ];

      console.log('\n🔍 Verificação de claims esperadas:');
      expectedClaims.forEach(expected => {
        const found = newClaims.some(claim => 
          claim.value.toLowerCase().includes(expected.toLowerCase())
        );
        console.log(`   ${expected}: ${found ? '✅ ENCONTRADA' : '❌ NÃO ENCONTRADA'}`);
      });

    } else {
      console.log('⚠️ Nenhuma nova claim encontrada');
    }

    // 10. Comparar com score anterior
    if (newScore && newScore.score_overall) {
      const previousScore = 54; // Score anterior
      const improvement = newScore.score_overall - previousScore;
      
      console.log('\n📈 ANÁLISE DE MELHORIA:');
      console.log('─'.repeat(60));
      console.log(`   Score anterior: ${previousScore}%`);
      console.log(`   Score atual: ${newScore.score_overall}%`);
      console.log(`   Melhoria: ${improvement > 0 ? '+' : ''}${improvement}%`);
      
      if (improvement > 0) {
        console.log('🎉 SUCESSO! Score melhorou significativamente!');
      } else if (improvement === 0) {
        console.log('⚠️ Score manteve-se igual');
      } else {
        console.log('❌ Score piorou - investigar');
      }
      console.log('─'.repeat(60));
    }

    console.log('\n🎯 RESUMO DO REPROCESSAMENTO:');
    console.log('─'.repeat(60));
    console.log('✅ Claims antigas removidas');
    console.log('✅ Scores antigos removidos');
    console.log('✅ Status resetado para reprocessamento');
    console.log('✅ Nova verificação iniciada');
    console.log('📊 Aguardando resultados finais...');

  } catch (error) {
    console.error('❌ Erro geral:', error);
  }
}

forceReprocessOptimized();
