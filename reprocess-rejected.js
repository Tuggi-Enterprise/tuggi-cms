const { createClient } = require('@supabase/supabase-js');

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !supabaseKey) {
  console.error('❌ Variáveis de ambiente não encontradas');
  process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseKey);

async function reprocessRejectedItems() {
  console.log('🔄 Iniciando reprocessamento de itens rejeitados...\n');

  try {
    // 1. Buscar todos os itens rejeitados com seus scores
    console.log('🔍 Buscando itens rejeitados...');
    
    const { data: rejectedItems, error: fetchError } = await supabase
      .schema('core')
      .from('attraction_descriptions')
      .select(`
        id, 
        description, 
        attraction_id, 
        verification_status, 
        updated_at,
        description_scores!inner(
          score_overall,
          created_at
        )
      `)
      .eq('is_original', true)
      .eq('language', 'pt-br')
      .eq('verification_status', 'rejected')
      .order('updated_at', { ascending: false });

    if (fetchError) {
      console.error('❌ Erro ao buscar itens rejeitados:', fetchError);
      return;
    }

    if (!rejectedItems || rejectedItems.length === 0) {
      console.log('✅ Nenhum item rejeitado encontrado!');
      return;
    }

    // Processar os dados para obter o score mais recente de cada item
    const processedItems = rejectedItems.map(item => {
      const latestScore = item.description_scores
        .sort((a, b) => new Date(b.created_at) - new Date(a.created_at))[0];
      
      return {
        id: item.id,
        description: item.description,
        attraction_id: item.attraction_id,
        verification_status: item.verification_status,
        updated_at: item.updated_at,
        score: latestScore?.score_overall || 0
      };
    });

    console.log(`📊 Encontrados ${processedItems.length} itens rejeitados`);

    // 2. Processar em lotes de 5 (teste)
    const BATCH_SIZE = 5;
    const totalBatches = Math.ceil(processedItems.length / BATCH_SIZE);
    
    console.log(`📦 Processando em ${totalBatches} lotes de ${BATCH_SIZE} itens cada\n`);

    let totalProcessed = 0;
    let totalSuccessful = 0;
    let totalFailed = 0;
    let scoreChanges = [];

    for (let batchIndex = 0; batchIndex < totalBatches; batchIndex++) {
      const startIndex = batchIndex * BATCH_SIZE;
      const endIndex = Math.min(startIndex + BATCH_SIZE, processedItems.length);
      const currentBatch = processedItems.slice(startIndex, endIndex);

      console.log(`\n🔄 Processando lote ${batchIndex + 1}/${totalBatches} (itens ${startIndex + 1}-${endIndex})`);
      console.log(`📋 ${currentBatch.length} itens neste lote`);
      console.log('─'.repeat(80));

      let batchSuccessful = 0;
      let batchFailed = 0;

      // Processar cada item do lote
      for (let i = 0; i < currentBatch.length; i++) {
        const item = currentBatch[i];
        const itemNumber = startIndex + i + 1;
        const oldScore = item.score || 0;
        const oldStatus = item.verification_status;
        
        try {
          console.log(`\n[${itemNumber}/${processedItems.length}] Processando: ${item.id.substring(0, 8)}...`);
          console.log(`   📄 Descrição: "${item.description.substring(0, 80)}..."`);
          console.log(`   📊 Score atual: ${oldScore}% | Status: ${oldStatus}`);
          
          // Retry logic para erro 429
          let data, error;
          let retryCount = 0;
          const maxRetries = 3;
          
          while (retryCount <= maxRetries) {
            const result = await supabase.functions.invoke('verify-batch', {
              body: {
                description_id: item.id,
                description: item.description,
                attraction_id: item.attraction_id,
                force_reprocess: true
              }
            });
            
            data = result.data;
            error = result.error;
            
            // Se não há erro ou não é 429, sair do loop
            if (!error || !error.message?.includes('429')) {
              break;
            }
            
            retryCount++;
            if (retryCount <= maxRetries) {
              const waitTime = Math.pow(2, retryCount) * 60000; // Exponential backoff: 2min, 4min, 8min
              console.log(`   ⏳ Erro 429 detectado. Retry ${retryCount}/${maxRetries} em ${waitTime/60000} minutos...`);
              console.log(`   ⏸️  Processamento pausado. Aguardando quota da API...`);
              
              // Mostrar countdown
              let remainingTime = waitTime;
              const countdownInterval = setInterval(() => {
                remainingTime -= 10000; // 10 segundos
                const minutes = Math.floor(remainingTime / 60000);
                const seconds = Math.floor((remainingTime % 60000) / 1000);
                process.stdout.write(`\r   ⏳ Aguardando: ${minutes}m ${seconds}s restantes...`);
                
                if (remainingTime <= 0) {
                  clearInterval(countdownInterval);
                  console.log('\n   🔄 Retomando processamento...');
                }
              }, 10000);
              
              await new Promise(resolve => setTimeout(resolve, waitTime));
              clearInterval(countdownInterval);
            }
          }

          if (error) {
            console.error(`   ❌ Erro após ${retryCount} tentativas: ${error.message}`);
            batchFailed++;
          } else {
            const newScore = data.score_overall || 0;
            const scoreDiff = newScore - oldScore;
            const scoreChangeEmoji = scoreDiff > 0 ? '📈' : scoreDiff < 0 ? '📉' : '➡️';
            
            console.log(`   ✅ Sucesso!`);
            console.log(`   📊 Score: ${oldScore}% → ${newScore}% ${scoreChangeEmoji} (${scoreDiff > 0 ? '+' : ''}${scoreDiff}%)`);
            console.log(`   🏷️ Status: ${oldStatus} → ${data.verification_status || 'unknown'}`);
            console.log(`   📝 Claims: ${data.claims_processed || 0} processados`);
            
            if (data.subscores) {
              console.log(`   📊 Subscores: F${data.subscores.factuality}% C${data.subscores.coherence}% T${data.subscores.tts_clarity}% R${data.subscores.rules}%`);
            }
            
            batchSuccessful++;
            
            // Registrar mudança de score
            scoreChanges.push({
              id: item.id,
              oldScore,
              newScore,
              scoreDiff,
              oldStatus,
              newStatus: data.verification_status || 'unknown'
            });
          }

          // Aguardar 2 segundos entre processamentos para evitar rate limiting
          if (i < currentBatch.length - 1) {
            await new Promise(resolve => setTimeout(resolve, 2000));
          }

        } catch (error) {
          console.error(`   ❌ Erro inesperado: ${error.message}`);
          batchFailed++;
        }
      }

      totalProcessed += currentBatch.length;
      totalSuccessful += batchSuccessful;
      totalFailed += batchFailed;

      console.log('\n' + '─'.repeat(80));
      console.log(`📊 Lote ${batchIndex + 1} concluído:`);
      console.log(`   ✅ Sucessos: ${batchSuccessful}`);
      console.log(`   ❌ Falhas: ${batchFailed}`);
      console.log(`   📈 Progresso: ${totalProcessed}/${processedItems.length} (${Math.round(totalProcessed/processedItems.length*100)}%)`);

      // Aguardar 5 segundos entre lotes
      if (batchIndex < totalBatches - 1) {
        console.log('⏳ Aguardando 5 segundos antes do próximo lote...');
        await new Promise(resolve => setTimeout(resolve, 5000));
      }
    }

    // 3. Resumo final detalhado
    console.log('\n🎉 REPROCESSAMENTO CONCLUÍDO!');
    console.log('='.repeat(80));
    console.log(`📊 Total de itens: ${processedItems.length}`);
    console.log(`✅ Sucessos: ${totalSuccessful}`);
    console.log(`❌ Falhas: ${totalFailed}`);
    console.log(`📈 Taxa de sucesso: ${Math.round(totalSuccessful/processedItems.length*100)}%`);

    // 4. Análise das mudanças de score
    if (scoreChanges.length > 0) {
      console.log('\n📊 ANÁLISE DAS MUDANÇAS DE SCORE:');
      console.log('─'.repeat(80));
      
      const improved = scoreChanges.filter(change => change.scoreDiff > 0);
      const worsened = scoreChanges.filter(change => change.scoreDiff < 0);
      const unchanged = scoreChanges.filter(change => change.scoreDiff === 0);
      
      console.log(`📈 Melhoraram: ${improved.length} itens`);
      console.log(`📉 Pioraram: ${worsened.length} itens`);
      console.log(`➡️ Inalterados: ${unchanged.length} itens`);
      
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
            console.log(`   ${index + 1}. ${change.oldScore}% → ${change.newScore}% (+${change.scoreDiff}%)`);
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
        console.log(`   ${change}: ${count} itens`);
      });
    }

    // 5. Verificar resultados finais
    console.log('\n🔍 VERIFICAÇÃO FINAL:');
    console.log('─'.repeat(80));
    
    const { data: updatedItems, error: checkError } = await supabase
      .schema('core')
      .from('attraction_descriptions')
      .select('verification_status, score')
      .in('id', processedItems.map(item => item.id));

    if (!checkError && updatedItems) {
      const statusCounts = updatedItems.reduce((acc, item) => {
        acc[item.verification_status] = (acc[item.verification_status] || 0) + 1;
        return acc;
      }, {});

      console.log('📊 Status após reprocessamento:');
      Object.entries(statusCounts).forEach(([status, count]) => {
        const emoji = {
          'approved': '✅',
          'needs_review': '🔄',
          'rejected': '❌',
          'pending': '⏳'
        }[status] || '❓';
        console.log(`   ${emoji} ${status}: ${count}`);
      });
    }

  } catch (error) {
    console.error('❌ Erro geral:', error);
  }
}

// Executar o script
reprocessRejectedItems();
