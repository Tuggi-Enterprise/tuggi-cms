const { createClient } = require('@supabase/supabase-js');

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !supabaseKey) {
  console.error('❌ Variáveis de ambiente não encontradas');
  process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseKey);

async function checkAllStatus() {
  console.log('🔍 Verificando status de todos os itens originais em português...\n');

  try {
    // Buscar todos os itens originais em português
    const { data: allItems, error: fetchError } = await supabase
      .schema('core')
      .from('attraction_descriptions')
      .select(`
        id, 
        verification_status, 
        updated_at,
        description_scores(
          score_overall,
          created_at
        )
      `)
      .eq('is_original', true)
      .eq('language', 'pt-br')
      .order('updated_at', { ascending: false });

    if (fetchError) {
      console.error('❌ Erro ao buscar itens:', fetchError);
      return;
    }

    if (!allItems || allItems.length === 0) {
      console.log('✅ Nenhum item encontrado.');
      return;
    }

    console.log(`📊 Total de itens originais em português: ${allItems.length}\n`);

    // Processar dados para obter scores mais recentes
    const processedItems = allItems.map(item => {
      const latestScore = item.description_scores && item.description_scores.length > 0
        ? item.description_scores.sort((a, b) => new Date(b.created_at) - new Date(a.created_at))[0]
        : null;
      
      return {
        id: item.id,
        verification_status: item.verification_status,
        updated_at: item.updated_at,
        score: latestScore?.score_overall || null
      };
    });

    // Análise por status
    const statusCounts = {};
    const scoreRanges = {
      '0-20': 0,
      '21-40': 0,
      '41-60': 0,
      '61-80': 0,
      '81-100': 0,
      'null': 0
    };

    processedItems.forEach(item => {
      // Contar por status
      const status = item.verification_status || 'null';
      statusCounts[status] = (statusCounts[status] || 0) + 1;

      // Contar por faixa de score
      if (item.score === null) {
        scoreRanges['null']++;
      } else if (item.score <= 20) {
        scoreRanges['0-20']++;
      } else if (item.score <= 40) {
        scoreRanges['21-40']++;
      } else if (item.score <= 60) {
        scoreRanges['41-60']++;
      } else if (item.score <= 80) {
        scoreRanges['61-80']++;
      } else {
        scoreRanges['81-100']++;
      }
    });

    // Exibir resultados
    console.log('📊 DISTRIBUIÇÃO POR STATUS:');
    console.log('─'.repeat(50));
    Object.entries(statusCounts).forEach(([status, count]) => {
      const percentage = ((count / processedItems.length) * 100).toFixed(1);
      const emoji = {
        'approved': '✅',
        'needs_review': '🔄',
        'rejected': '❌',
        'pending': '⏳',
        'null': '❓'
      }[status] || '❓';
      console.log(`${emoji} ${status}: ${count} itens (${percentage}%)`);
    });

    console.log('\n📊 DISTRIBUIÇÃO POR SCORE:');
    console.log('─'.repeat(50));
    Object.entries(scoreRanges).forEach(([range, count]) => {
      if (count > 0) {
        const percentage = ((count / processedItems.length) * 100).toFixed(1);
        const emoji = range === 'null' ? '❓' : range === '81-100' ? '🏆' : range === '61-80' ? '📈' : range === '41-60' ? '📊' : range === '21-40' ? '📉' : '❌';
        console.log(`${emoji} ${range}%: ${count} itens (${percentage}%)`);
      }
    });

    // Análise temporal
    const now = new Date();
    const oneDayAgo = new Date(now.getTime() - 24 * 60 * 60 * 1000);
    const oneWeekAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);

    const recentItems = processedItems.filter(item => new Date(item.updated_at) > oneDayAgo);
    const weekItems = processedItems.filter(item => new Date(item.updated_at) > oneWeekAgo);

    console.log('\n📅 ANÁLISE TEMPORAL:');
    console.log('─'.repeat(50));
    console.log(`🕐 Últimas 24h: ${recentItems.length} itens`);
    console.log(`📅 Última semana: ${weekItems.length} itens`);
    console.log(`📊 Total: ${processedItems.length} itens`);

    // Estatísticas de score
    const itemsWithScore = processedItems.filter(item => item.score !== null);
    if (itemsWithScore.length > 0) {
      const scores = itemsWithScore.map(item => item.score);
      const avgScore = scores.reduce((sum, score) => sum + score, 0) / scores.length;
      const minScore = Math.min(...scores);
      const maxScore = Math.max(...scores);

      console.log('\n📈 ESTATÍSTICAS DE SCORE:');
      console.log('─'.repeat(50));
      console.log(`📊 Média: ${avgScore.toFixed(1)}%`);
      console.log(`📉 Mínimo: ${minScore}%`);
      console.log(`📈 Máximo: ${maxScore}%`);
      console.log(`📋 Itens com score: ${itemsWithScore.length}/${processedItems.length}`);
    }

  } catch (error) {
    console.error('❌ Erro geral:', error);
  }
}

// Executar o script
checkAllStatus();
