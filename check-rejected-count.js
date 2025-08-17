const { createClient } = require('@supabase/supabase-js');

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !supabaseKey) {
  console.error('❌ Variáveis de ambiente não encontradas');
  process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseKey);

async function checkRejectedCount() {
  console.log('🔍 Verificando quantidade de itens rejeitados...\n');

  try {
    // Buscar itens rejeitados com seus scores mais recentes
    const { data: rejectedItems, error: fetchError } = await supabase
      .schema('core')
      .from('attraction_descriptions')
      .select(`
        id, 
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
        verification_status: item.verification_status,
        updated_at: item.updated_at,
        score: latestScore?.score_overall || 0
      };
    });

    console.log(`📊 Total de itens rejeitados: ${processedItems.length}`);

    // Análise por score
    const scoreRanges = {
      '0-20%': 0,
      '21-40%': 0,
      '41-60%': 0,
      '61-80%': 0,
      '81-100%': 0
    };

    processedItems.forEach(item => {
      const score = item.score || 0;
      if (score <= 20) scoreRanges['0-20%']++;
      else if (score <= 40) scoreRanges['21-40%']++;
      else if (score <= 60) scoreRanges['41-60%']++;
      else if (score <= 80) scoreRanges['61-80%']++;
      else scoreRanges['81-100%']++;
    });

    console.log('\n📈 Distribuição por score:');
    Object.entries(scoreRanges).forEach(([range, count]) => {
      if (count > 0) {
        const percentage = Math.round(count / processedItems.length * 100);
        console.log(`   ${range}: ${count} itens (${percentage}%)`);
      }
    });

    // Análise por data
    const now = new Date();
    const oneDayAgo = new Date(now.getTime() - 24 * 60 * 60 * 1000);
    const oneWeekAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);

    const recentItems = processedItems.filter(item => 
      new Date(item.updated_at) > oneDayAgo
    );
    const weekOldItems = processedItems.filter(item => 
      new Date(item.updated_at) > oneWeekAgo && new Date(item.updated_at) <= oneDayAgo
    );
    const olderItems = processedItems.filter(item => 
      new Date(item.updated_at) <= oneWeekAgo
    );

    console.log('\n📅 Distribuição por data:');
    console.log(`   Últimas 24h: ${recentItems.length} itens`);
    console.log(`   Última semana: ${weekOldItems.length} itens`);
    console.log(`   Mais antigos: ${olderItems.length} itens`);

    // Estimativa de tempo
    const estimatedTimePerItem = 3; // segundos (incluindo delay)
    const totalEstimatedTime = processedItems.length * estimatedTimePerItem;
    const estimatedMinutes = Math.floor(totalEstimatedTime / 60);
    const estimatedSeconds = totalEstimatedTime % 60;

    console.log('\n⏱️ Estimativa de tempo:');
    console.log(`   Tempo por item: ~${estimatedTimePerItem}s`);
    console.log(`   Tempo total: ~${estimatedMinutes}m ${estimatedSeconds}s`);
    console.log(`   Lotes de 50: ${Math.ceil(processedItems.length / 50)} lotes`);

    console.log('\n🚀 Para executar o reprocessamento:');
    console.log('   node reprocess-rejected.js');

  } catch (error) {
    console.error('❌ Erro geral:', error);
  }
}

checkRejectedCount();
