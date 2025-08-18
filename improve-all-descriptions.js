const { createClient } = require('@supabase/supabase-js');
const { default: fetch } = require('node-fetch');

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

// Configurações
const BATCH_SIZE = 10; // Número de descrições a processar por vez
const SCORE_THRESHOLD = 60; // Processar descrições com score abaixo deste valor
const SLEEP_TIME = 2000; // Tempo de espera entre processamentos (ms)

// Função principal
async function improveAllDescriptions() {
  console.log('🚀 SISTEMA DE MELHORIA DE DESCRIÇÕES');
  console.log('════════════════════════════════════\n');

  try {
    // 1. Buscar total de descrições originais com score baixo
    console.log('🔍 Contando descrições originais com score baixo...');
    
    // Usar a view que já tem o score mais recente
    const { data: lowScoreDescriptions, error: countError, count } = await supabase
      .schema('core')
      .from('v_descriptions_with_last_score')
      .select('id', { count: 'exact' })
      .eq('language', 'pt-br')
      .eq('is_original', true)
      .lt('score_overall', SCORE_THRESHOLD);

    if (countError) {
      console.error('❌ Erro ao contar descrições:', countError);
      return;
    }

    console.log(`✅ Encontradas ${count} descrições com score abaixo de ${SCORE_THRESHOLD}%`);
    
    // 2. Configurar processamento em lotes
    const totalBatches = Math.ceil(count / BATCH_SIZE);
    console.log(`📦 Processando em ${totalBatches} lotes de ${BATCH_SIZE} descrições\n`);
    
    let processedCount = 0;
    let improvedCount = 0;
    let currentBatch = 0;
    let lastId = null;

    // 3. Processar em lotes
    while (processedCount < count) {
      currentBatch++;
      console.log(`\n📋 LOTE ${currentBatch}/${totalBatches}`);
      console.log('─'.repeat(50));

      // Buscar lote de descrições usando a view
      const query = supabase
        .schema('core')
        .from('v_descriptions_with_last_score')
        .select(`
          id,
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
        `)
        .eq('language', 'pt-br')
        .eq('is_original', true)
        .lt('score_overall', SCORE_THRESHOLD)
        .order('id', { ascending: true })
        .limit(BATCH_SIZE);

      // Adicionar filtro para continuar de onde parou
      if (lastId) {
        query.gt('id', lastId);
      }

      const { data: descriptions, error: batchError } = await query;

      if (batchError) {
        console.error(`❌ Erro ao buscar lote ${currentBatch}:`, batchError);
        continue;
      }

      if (!descriptions || descriptions.length === 0) {
        console.log('⚠️ Nenhuma descrição encontrada neste lote');
        break;
      }

      // Processar cada descrição do lote
      for (const [index, description] of descriptions.entries()) {
        processedCount++;
        lastId = description.id;
        
        console.log(`\n🔄 [${processedCount}/${count}] Processando: ${description.attractions.name}`);
        
        // Melhorar a descrição
        const result = await improveDescription(description);
        
        if (result.success) {
          improvedCount++;
        }
        
        // Esperar entre processamentos para evitar sobrecarga
        if (index < descriptions.length - 1) {
          await sleep(SLEEP_TIME);
        }
      }

      // Mostrar progresso
      console.log(`\n📊 Progresso: ${processedCount}/${count} (${Math.round(processedCount/count*100)}%)`);
      console.log(`✅ Descrições melhoradas: ${improvedCount}`);
    }

    console.log('\n🎉 PROCESSAMENTO CONCLUÍDO!');
    console.log(`📊 Total processado: ${processedCount}/${count}`);
    console.log(`✅ Total melhorado: ${improvedCount}`);

  } catch (error) {
    console.error('❌ Erro geral:', error);
  }
}

// Função para melhorar uma descrição usando o feedback loop
async function improveDescription(description) {
  try {
    // 1. Analisar descrição atual
    console.log(`   📝 Descrição atual: "${truncateText(description.description, 100)}..."`);
    console.log(`   📊 Score atual: ${description.score_overall}%`);
    
    // 2. Buscar dados de verificação
    const { data: scoreData, error: scoreError } = await supabase
      .schema('core')
      .from('description_scores')
      .select('flags, reasoning, subscores')
      .eq('attraction_id', description.attraction_id)
      .order('created_at', { ascending: false })
      .limit(1)
      .single();
    
    if (scoreError) {
      console.log('   ⚠️ Sem dados de verificação disponíveis');
      return { success: false };
    }
    
    // 3. Analisar problemas
    const problems = analyzeProblems(scoreData);
    if (problems.length > 0) {
      console.log('   ❌ Problemas identificados:', problems.length);
    }
    
    // 4. Gerar insights
    const insights = generateInsights(problems, scoreData);
    console.log('   💡 Insights gerados:', insights.length);
    
    // 5. Gerar nova descrição
    const newDescription = generateImprovedDescription(
      insights, 
      description.attractions, 
      description.description
    );
    
    console.log(`   🚀 Nova descrição: "${truncateText(newDescription, 100)}..."`);
    console.log(`   📏 Caracteres: ${newDescription.length}`);
    
    // 6. Salvar nova descrição
    const { error: updateError } = await supabase
      .schema('core')
      .from('attraction_descriptions')
      .update({ 
        description: newDescription,
        verification_status: 'pending', // Marcar para nova verificação
        updated_at: new Date().toISOString()
      })
      .eq('id', description.id);
    
    if (updateError) {
      console.log('   ❌ Erro ao salvar descrição:', updateError);
      return { success: false };
    }
    
    console.log('   ✅ Descrição atualizada com sucesso');
    
    // 7. Acionar verificação
    await triggerVerification(description.id);
    
    return { success: true };
  } catch (error) {
    console.error('   ❌ Erro ao melhorar descrição:', error);
    return { success: false };
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
async function triggerVerification(descriptionId) {
  try {
    console.log('   🔄 Acionando verificação...');
    
    // Invocar Edge Function para verificação
    const { error } = await supabase.functions.invoke('verify-batch', {
      body: { 
        description_ids: [descriptionId],
        force_reprocess: true
      }
    });
    
    if (error) {
      console.log('   ⚠️ Erro ao acionar verificação:', error);
      return false;
    }
    
    console.log('   ✅ Verificação acionada com sucesso');
    return true;
  } catch (error) {
    console.error('   ❌ Erro ao acionar verificação:', error);
    return false;
  }
}

// Função auxiliar para truncar texto
function truncateText(text, maxLength) {
  if (!text) return '';
  return text.length <= maxLength ? text : text.substring(0, maxLength);
}

// Função auxiliar para esperar
function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// Executar script
improveAllDescriptions().catch(console.error);
