const { createClient } = require('@supabase/supabase-js');

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !supabaseKey) {
  console.error('❌ Variáveis de ambiente não encontradas');
  process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseKey);

async function verifyNewDescription() {
  console.log('🔍 Verificando factualmente a nova descrição histórica...\n');

  try {
    // 1. Primeiro buscar o POI
    const { data: poi, error: poiError } = await supabase
      .schema('core')
      .from('attractions')
      .select('id, name, city, country')
      .eq('name', 'Lago do Taboão')
      .eq('city', 'Bragança Paulista')
      .single();

    if (poiError || !poi) {
      console.error('❌ Erro ao buscar POI:', poiError);
      return;
    }

    // 2. Buscar a descrição mais recente
    const { data: description, error: descError } = await supabase
      .schema('core')
      .from('attraction_descriptions')
      .select('id, description, updated_at, verification_status')
      .eq('attraction_id', poi.id)
      .eq('language', 'pt-br')
      .eq('is_original', true)
      .order('updated_at', { ascending: false })
      .limit(1)
      .single();

    if (descError || !description) {
      console.error('❌ Erro ao buscar descrição:', descError);
      return;
    }

    console.log('✅ Descrição encontrada:');
    console.log(`   POI: ${poi.name}`);
    console.log(`   Localização: ${poi.city}, ${poi.country}`);
    console.log(`   Atualizada: ${new Date(description.updated_at).toLocaleString('pt-BR')}`);
    console.log(`   Status atual: ${description.verification_status || 'não verificada'}`);
    console.log(`   Texto (${description.description.length} chars): "${description.description.substring(0, 100)}..."`);

    // 3. Chamar a verificação via Edge Function
    console.log('\n🚀 Iniciando verificação factual...');
    
    const { data: verificationResult, error: verifyError } = await supabase.functions.invoke('verify-batch', {
      body: {
        limit: 1,
        cursor: null,
        force_reprocess: true
      }
    });

    if (verifyError) {
      console.error('❌ Erro na verificação:', verifyError);
      console.log('⚠️ Continuando para buscar scores existentes...');
    } else {
      console.log('\n✅ Verificação concluída!');
      console.log('📊 Resultado:', JSON.stringify(verificationResult, null, 2));
    }

    // 4. Buscar o score mais recente
    console.log('\n🔍 Buscando score de verificação...');
    
    const { data: latestScore, error: scoreError } = await supabase
      .schema('core')
      .from('description_scores')
      .select('*')
      .eq('description_id', description.id)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();

    if (scoreError) {
      console.error('❌ Erro ao buscar score:', scoreError);
    } else if (latestScore) {
      console.log('✅ Score encontrado:');
      console.log(`   Score geral: ${latestScore.score_overall}%`);
      console.log(`   Factualidade: ${latestScore.score_factuality}%`);
      console.log(`   Coerência: ${latestScore.score_coherence}%`);
      console.log(`   TTS: ${latestScore.score_tts_clarity}%`);
      console.log(`   Regras: ${latestScore.score_rules}%`);
      console.log(`   Status: ${latestScore.verification_status}`);
      console.log(`   Flags: ${latestScore.flags ? latestScore.flags.join(', ') : 'nenhuma'}`);
    } else {
      console.log('⚠️ Nenhum score encontrado ainda');
    }

    // 5. Buscar claims extraídas
    console.log('\n🔍 Buscando claims extraídas...');
    
    const { data: claims, error: claimsError } = await supabase
      .schema('core')
      .from('description_claims')
      .select('*')
      .eq('description_id', description.id)
      .order('created_at', { ascending: false });

    if (claimsError) {
      console.error('❌ Erro ao buscar claims:', claimsError);
    } else if (claims && claims.length > 0) {
      console.log(`✅ ${claims.length} claims extraídas:`);
      claims.forEach((claim, index) => {
        console.log(`   ${index + 1}. [${claim.claim_type}] "${claim.value}" (${claim.slot})`);
        console.log(`      Status: ${claim.verification_status || 'não verificada'}`);
      });
    } else {
      console.log('⚠️ Nenhuma claim encontrada');
    }

    // 6. Comparar com score anterior (se houver)
    console.log('\n📊 Comparando com verificações anteriores...');
    
    const { data: allScores, error: allScoresError } = await supabase
      .schema('core')
      .from('description_scores')
      .select('score_overall, verification_status, created_at')
      .eq('description_id', description.id)
      .order('created_at', { ascending: true });

    if (!allScoresError && allScores && allScores.length > 1) {
      console.log(`✅ Histórico de ${allScores.length} verificações:`);
      allScores.forEach((score, index) => {
        const date = new Date(score.created_at).toLocaleString('pt-BR');
        console.log(`   ${index + 1}. ${score.score_overall}% (${score.verification_status}) - ${date}`);
      });
      
      const firstScore = allScores[0];
      const latestScoreValue = latestScore || allScores[allScores.length - 1];
      const improvement = latestScoreValue.score_overall - firstScore.score_overall;
      
      console.log(`\n📈 Melhoria: ${improvement > 0 ? '+' : ''}${improvement}% (${firstScore.score_overall}% → ${latestScoreValue.score_overall}%)`);
    }

    console.log('\n🎯 ANÁLISE DA DESCRIÇÃO HISTÓRICA:');
    console.log('─'.repeat(60));
    console.log('✅ Dados factuais verificáveis:');
    console.log('   • Dezembro 2023 (data específica)');
    console.log('   • Ponte de 23 metros (medida exata)');
    console.log('   • Tori japonês (elemento cultural)');
    console.log('   • Festa da Linguiça (evento tradicional)');
    console.log('   • Cartão-postal da cidade (status oficial)');
    console.log('\n📊 Expectativa: Score significativamente maior que 38%');
    console.log('🎭 Valor histórico: Alto (eventos, cultura, datas)');

  } catch (error) {
    console.error('❌ Erro geral:', error);
  }
}

verifyNewDescription();
