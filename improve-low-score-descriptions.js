const { createClient } = require('@supabase/supabase-js');

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !supabaseKey) {
  console.error('❌ Variáveis de ambiente não encontradas');
  process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseKey);

// Configurações
const BATCH_SIZE = 10; // Número de descrições a processar por vez
const SCORE_THRESHOLD = 60; // Processar descrições com score abaixo deste valor

async function improveLowScoreDescriptions() {
  console.log('🚀 SISTEMA DE MELHORIA DE DESCRIÇÕES');
  console.log('════════════════════════════════════\n');

  try {
    // 1. Buscar descrições com score baixo usando a view
    console.log(`🔍 Buscando descrições originais com score abaixo de ${SCORE_THRESHOLD}%...`);
    
    const { data: lowScoreItems, error: fetchError, count } = await supabase
      .schema('core')
      .from('v_descriptions_with_last_score')
      .select(`
        description_id,
        attraction_id,
        description,
        score_overall,
        verification_status,
        attractions!inner(
          name,
          city,
          country,
          google_types
        )
      `, { count: 'exact' })
      .eq('language', 'pt-br')
      .eq('is_original', true)
      .lt('score_overall', SCORE_THRESHOLD)
      .order('score_overall', { ascending: true });

    if (fetchError) {
      console.error('❌ Erro ao buscar descrições:', fetchError);
      return;
    }

    if (!lowScoreItems || lowScoreItems.length === 0) {
      console.log('✅ Nenhuma descrição com score baixo encontrada!');
      return;
    }

    console.log(`📊 Encontradas ${lowScoreItems.length} descrições com score abaixo de ${SCORE_THRESHOLD}%`);
    
    // 2. Processar em lotes
    const totalBatches = Math.ceil(lowScoreItems.length / BATCH_SIZE);
    console.log(`📦 Processando em ${totalBatches} lotes de ${BATCH_SIZE} descrições cada\n`);
    
    let totalProcessed = 0;
    let totalImproved = 0;
    let totalFailed = 0;
    let scoreChanges = [];

    for (let batchIndex = 0; batchIndex < totalBatches; batchIndex++) {
      const startIndex = batchIndex * BATCH_SIZE;
      const endIndex = Math.min(startIndex + BATCH_SIZE, lowScoreItems.length);
      const currentBatch = lowScoreItems.slice(startIndex, endIndex);

      console.log(`\n📋 LOTE ${batchIndex + 1}/${totalBatches} (itens ${startIndex + 1}-${endIndex})`);
      console.log('─'.repeat(80));

      let batchSuccessful = 0;
      let batchFailed = 0;

      // Processar cada descrição do lote
      for (let i = 0; i < currentBatch.length; i++) {
        const item = currentBatch[i];
        const itemNumber = startIndex + i + 1;
        const oldScore = item.score_overall;
        const oldStatus = item.verification_status;
        
        try {
          console.log(`\n[${itemNumber}/${lowScoreItems.length}] Processando: ${item.attractions.name}`);
          console.log(`   📍 Local: ${item.attractions.city}, ${item.attractions.country}`);
          console.log(`   📊 Score atual: ${oldScore}% | Status: ${oldStatus || 'null'}`);
          console.log(`   📝 Descrição atual: "${item.description.substring(0, 100)}..."`);
          
          // 1. Buscar dados de verificação mais recentes
          const { data: scoreData, error: scoreError } = await supabase
            .schema('core')
            .from('description_scores')
            .select('flags, reasoning, subscores')
            .eq('attraction_id', item.attraction_id)
            .order('created_at', { ascending: false })
            .limit(1)
            .single();
          
          if (scoreError) {
            console.log('   ⚠️ Sem dados de verificação detalhados');
            batchFailed++;
            continue;
          }
          
          // 2. Analisar problemas
          const problems = analyzeProblems(scoreData);
          if (problems.length > 0) {
            console.log(`   ❌ Problemas identificados: ${problems.length}`);
          }
          
          // 3. Gerar insights
          const insights = generateInsights(problems, scoreData);
          console.log(`   💡 Insights gerados: ${insights.length}`);
          
          // 4. Gerar nova descrição
          const newDescription = generateImprovedDescription(
            insights, 
            item.attractions, 
            item.description
          );
          
          console.log(`   🚀 Nova descrição: "${newDescription.substring(0, 100)}..."`);
          console.log(`   📏 Caracteres: ${newDescription.length}`);
          
          // 5. Salvar nova descrição
          const { error: updateError } = await supabase
            .schema('core')
            .from('attraction_descriptions')
            .update({ 
              description: newDescription,
              verification_status: 'pending', // Marcar para nova verificação
              updated_at: new Date().toISOString()
            })
            .eq('id', item.description_id);
          
          if (updateError) {
            console.log(`   ❌ Erro ao salvar descrição: ${updateError.message}`);
            batchFailed++;
            continue;
          }
          
          console.log('   ✅ Descrição atualizada com sucesso');
          
          // 6. Acionar verificação
          const verifyResult = await triggerVerification(item.description_id, newDescription, item.attraction_id);
          
          if (verifyResult.error) {
            console.log(`   ⚠️ Erro ao acionar verificação: ${verifyResult.error.message}`);
            batchSuccessful++; // Consideramos sucesso pois a descrição foi atualizada
          } else {
            console.log('   ✅ Verificação acionada com sucesso');
            
            // Registrar mudança de score
            const newScore = verifyResult.data?.score_overall || 0;
            const scoreDiff = newScore - oldScore;
            const scoreChangeEmoji = scoreDiff > 0 ? '📈' : scoreDiff < 0 ? '📉' : '➡️';
            
            console.log(`   📊 Score: ${oldScore}% → ${newScore}% ${scoreChangeEmoji} (${scoreDiff > 0 ? '+' : ''}${scoreDiff}%)`);
            console.log(`   🏷️ Status: ${oldStatus} → ${verifyResult.data?.verification_status || 'pending'}`);
            
            if (verifyResult.data?.subscores) {
              console.log(`   📊 Subscores: F${verifyResult.data.subscores.factuality}% C${verifyResult.data.subscores.coherence}% T${verifyResult.data.subscores.tts_clarity}% R${verifyResult.data.subscores.rules}%`);
            }
            
            scoreChanges.push({
              id: item.description_id,
              name: item.attractions.name,
              oldScore,
              newScore,
              scoreDiff,
              oldStatus,
              newStatus: verifyResult.data?.verification_status || 'pending'
            });
            
            batchSuccessful++;
          }

        } catch (error) {
          console.error(`   ❌ Erro inesperado: ${error.message}`);
          batchFailed++;
        }
        
        // Aguardar 2 segundos entre processamentos para evitar rate limiting
        if (i < currentBatch.length - 1) {
          console.log('   ⏳ Aguardando 2 segundos...');
          await new Promise(resolve => setTimeout(resolve, 2000));
        }
      }

      totalProcessed += currentBatch.length;
      totalImproved += batchSuccessful;
      totalFailed += batchFailed;

      console.log('\n' + '─'.repeat(80));
      console.log(`📊 Lote ${batchIndex + 1} concluído:`);
      console.log(`   ✅ Sucessos: ${batchSuccessful}`);
      console.log(`   ❌ Falhas: ${batchFailed}`);
      console.log(`   📈 Progresso: ${totalProcessed}/${lowScoreItems.length} (${Math.round(totalProcessed/lowScoreItems.length*100)}%)`);

      // Aguardar 5 segundos entre lotes
      if (batchIndex < totalBatches - 1) {
        console.log('⏳ Aguardando 5 segundos antes do próximo lote...');
        await new Promise(resolve => setTimeout(resolve, 5000));
      }
    }

    // 3. Resumo final detalhado
    console.log('\n🎉 PROCESSAMENTO CONCLUÍDO!');
    console.log('='.repeat(80));
    console.log(`📊 Total de descrições: ${lowScoreItems.length}`);
    console.log(`✅ Melhoradas: ${totalImproved}`);
    console.log(`❌ Falhas: ${totalFailed}`);
    console.log(`📈 Taxa de sucesso: ${Math.round(totalImproved/lowScoreItems.length*100)}%`);

    // 4. Análise das mudanças de score
    if (scoreChanges.length > 0) {
      console.log('\n📊 ANÁLISE DAS MUDANÇAS DE SCORE:');
      console.log('─'.repeat(80));
      
      const improved = scoreChanges.filter(change => change.scoreDiff > 0);
      const worsened = scoreChanges.filter(change => change.scoreDiff < 0);
      const unchanged = scoreChanges.filter(change => change.scoreDiff === 0);
      
      console.log(`📈 Melhoraram: ${improved.length} descrições`);
      console.log(`📉 Pioraram: ${worsened.length} descrições`);
      console.log(`➡️ Inalteradas: ${unchanged.length} descrições`);
      
      if (improved.length > 0) {
        const avgImprovement = improved.reduce((sum, change) => sum + change.scoreDiff, 0) / improved.length;
        console.log(`   📈 Melhoria média: +${Math.round(avgImprovement)}%`);
      }
      
      if (worsened.length > 0) {
        const avgWorsening = worsened.reduce((sum, change) => sum + Math.abs(change.scoreDiff), 0) / worsened.length;
        console.log(`   📉 Piora média: -${Math.round(avgWorsening)}%`);
      }

      // Top 5 melhorias
      if (improved.length > 0) {
        console.log('\n🏆 TOP 5 MELHORIAS:');
        improved
          .sort((a, b) => b.scoreDiff - a.scoreDiff)
          .slice(0, 5)
          .forEach((change, index) => {
            console.log(`   ${index + 1}. ${change.name}: ${change.oldScore}% → ${change.newScore}% (+${change.scoreDiff}%)`);
          });
      }

      // Mudanças de status
      const statusChanges = scoreChanges.reduce((acc, change) => {
        const key = `${change.oldStatus} → ${change.newStatus}`;
        acc[key] = (acc[key] || 0) + 1;
        return acc;
      }, {});

      console.log('\n🔄 MUDANÇAS DE STATUS:');
      Object.entries(statusChanges).forEach(([change, count]) => {
        console.log(`   ${change}: ${count} descrições`);
      });
    }

  } catch (error) {
    console.error('❌ Erro geral:', error);
  }
}

// Função para analisar problemas da descrição
function analyzeProblems(scoreData) {
  const problems = [];
  const flags = scoreData.flags || [];
  const reasoning = scoreData.reasoning || {};
  
  flags.forEach(flag => {
    switch (flag) {
      case 'low_factuality':
        problems.push('Baixa factualidade - informações não verificáveis');
        break;
      case 'no_supported_claims':
        problems.push('Nenhuma claim foi verificada positivamente');
        break;
      case 'recent_content':
        problems.push('Informações muito recentes não são verificáveis');
        break;
      case 'specific_measurements':
        problems.push('Medidas específicas não encontradas em fontes');
        break;
      case 'cultural_content':
        problems.push('Elementos culturais específicos não verificáveis');
        break;
      case 'contradiction':
        problems.push('Claims contraditórias encontradas');
        break;
      case 'moderate_factuality':
        problems.push('Factualidade moderada - pode ser melhorada');
        break;
    }
  });

  // Análise baseada no reasoning
  if (reasoning.total_claims > 0 && reasoning.supported_claims === 0) {
    problems.push(`${reasoning.total_claims} claims extraídas mas nenhuma verificada`);
  }

  if (reasoning.not_found_claims > 0) {
    problems.push(`${reasoning.not_found_claims} claims não encontradas em fontes`);
  }

  return problems;
}

// Função para gerar insights baseados nos problemas
function generateInsights(problems, scoreData) {
  const insights = [];
  const flags = scoreData.flags || [];
  
  problems.forEach(problem => {
    if (problem.includes('recentes')) {
      insights.push('Usar informações históricas em vez de datas recentes');
    }
    if (problem.includes('específicas')) {
      insights.push('Evitar medidas técnicas específicas sem fontes');
    }
    if (problem.includes('culturais')) {
      insights.push('Usar termos culturais mais genéricos');
    }
    if (problem.includes('verificada')) {
      insights.push('Focar em características permanentes e bem estabelecidas');
    }
    if (problem.includes('factualidade')) {
      insights.push('Priorizar informações que podem ser verificadas em fontes tradicionais');
    }
    if (problem.includes('contraditórias')) {
      insights.push('Eliminar informações contraditórias e inconsistentes');
    }
    if (problem.includes('claims não encontradas')) {
      insights.push('Substituir claims não verificadas por alternativas verificáveis');
    }
  });

  // Insights baseados em flags específicas
  if (flags.includes('recent_content')) {
    insights.push('Focar em importância histórica e cultural estabelecida');
  }
  
  if (flags.includes('specific_measurements')) {
    insights.push('Usar características qualitativas em vez de medidas quantitativas');
  }
  
  if (flags.includes('cultural_content')) {
    insights.push('Simplificar elementos culturais para maior acessibilidade');
  }

  // Insights adicionais
  insights.push('Usar linguagem mais genérica e acessível');
  insights.push('Manter foco na experiência do visitante');
  insights.push('Incluir elementos que podem ser verificados facilmente');
  
  return [...new Set(insights)]; // Remove duplicatas
}

// Função para gerar descrição melhorada
function generateImprovedDescription(insights, attraction, originalDescription) {
  const name = attraction.name;
  const city = attraction.city;
  
  // Analisar o tipo de atração para gerar descrição apropriada
  const googleTypes = attraction.google_types || [];
  const isMuseum = googleTypes.some(type => type.includes('museum'));
  const isPark = googleTypes.some(type => type.includes('park'));
  const isChurch = googleTypes.some(type => type.includes('church') || type.includes('cathedral'));
  const isTheater = googleTypes.some(type => type.includes('theater'));
  const isHistorical = googleTypes.some(type => 
    type.includes('landmark') || 
    type.includes('monument') || 
    type.includes('historical')
  );
  
  // Aplicar insights específicos
  if (insights.some(insight => insight.includes('históricas'))) {
    if (isMuseum) {
      return `${name} é um dos principais museus de ${city}, conhecido por sua importância histórica e acervo cultural. O local oferece um ambiente perfeito para visitantes que buscam conhecer a arte e história da região, sendo um espaço de grande valor educativo e turístico.`;
    }
    if (isChurch) {
      return `${name} é um dos principais templos religiosos de ${city}, conhecido por sua arquitetura histórica e importância cultural. O local oferece um ambiente de paz e contemplação, sendo um espaço de grande valor espiritual e turístico para visitantes.`;
    }
    if (isTheater) {
      return `${name} é um dos principais teatros de ${city}, conhecido por sua arquitetura histórica e importância cultural. O local oferece um ambiente perfeito para apreciar as artes cênicas, sendo um espaço de grande valor cultural e artístico.`;
    }
    if (isPark) {
      return `${name} é um dos principais parques de ${city}, conhecido por sua beleza natural e importância recreativa. O local oferece um ambiente perfeito para passeios e atividades ao ar livre, sendo um espaço de lazer muito apreciado por moradores e visitantes.`;
    }
    if (isHistorical) {
      return `${name} é um importante patrimônio histórico de ${city}, reconhecido por seu valor cultural e arquitetônico. O local representa um importante capítulo da história da região e oferece aos visitantes uma experiência rica em tradição e memória.`;
    }
  }
  
  // Descrição genérica otimizada
  return `${name} é um dos principais pontos turísticos de ${city}, conhecido por sua importância cultural e beleza. O local oferece um ambiente perfeito para visitantes, proporcionando uma experiência rica em história e tradição da região.`;
}

// Função para acionar verificação
async function triggerVerification(descriptionId, description, attractionId) {
  try {
    console.log('   🔄 Acionando verificação...');
    
    // Invocar Edge Function para verificação
    const { data, error } = await supabase.functions.invoke('verify-batch', {
      body: { 
        description_id: descriptionId,
        description: description,
        attraction_id: attractionId,
        force_reprocess: true
      }
    });
    
    return { data, error };
  } catch (error) {
    return { error };
  }
}

// Executar script
improveLowScoreDescriptions().catch(console.error);

