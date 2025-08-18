const { createClient } = require('@supabase/supabase-js');

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !supabaseKey) {
  console.error('❌ Variáveis de ambiente não encontradas');
  process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseKey);

async function analyzeRejectedPatterns() {
  console.log('🔍 Analisando padrões dos itens rejeitados...\n');

  try {
    // Buscar todos os itens rejeitados com detalhes completos
    const { data: rejectedItems, error: fetchError } = await supabase
      .schema('core')
      .from('attraction_descriptions')
      .select(`
        id, 
        description,
        attraction_id,
        verification_status, 
        updated_at,
        description_scores(
          score_overall,
          subscores,
          flags,
          created_at
        ),
        description_claims(
          claim_type,
          slot,
          value,
          status,
          weight
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
      console.log('✅ Nenhum item rejeitado encontrado.');
      return;
    }

    console.log(`📊 Total de itens rejeitados: ${rejectedItems.length}\n`);

    // Processar dados para análise
    const processedItems = rejectedItems.map(item => {
      const latestScore = item.description_scores && item.description_scores.length > 0
        ? item.description_scores.sort((a, b) => new Date(b.created_at) - new Date(a.created_at))[0]
        : null;
      
      return {
        id: item.id,
        description: item.description,
        attraction_id: item.attraction_id,
        score: latestScore?.score_overall || null,
        subscores: latestScore?.subscores || null,
        flags: latestScore?.flags || [],
        claims: item.description_claims || [],
        updated_at: item.updated_at
      };
    });

    // 1. ANÁLISE DE SCORES
    console.log('📊 ANÁLISE DE SCORES:');
    console.log('─'.repeat(60));
    
    const scoreRanges = {
      '0-20': 0,
      '21-40': 0,
      '41-60': 0,
      '61-80': 0,
      '81-100': 0
    };

    processedItems.forEach(item => {
      if (item.score !== null) {
        if (item.score <= 20) scoreRanges['0-20']++;
        else if (item.score <= 40) scoreRanges['21-40']++;
        else if (item.score <= 60) scoreRanges['41-60']++;
        else if (item.score <= 80) scoreRanges['61-80']++;
        else scoreRanges['81-100']++;
      }
    });

    Object.entries(scoreRanges).forEach(([range, count]) => {
      if (count > 0) {
        const percentage = ((count / processedItems.length) * 100).toFixed(1);
        console.log(`📊 ${range}%: ${count} itens (${percentage}%)`);
      }
    });

    // 2. ANÁLISE DE SUBSORES
    console.log('\n📊 ANÁLISE DE SUBSORES:');
    console.log('─'.repeat(60));
    
    const subscoresAnalysis = {
      factuality: { total: 0, count: 0, low: 0, medium: 0, high: 0 },
      coherence: { total: 0, count: 0, low: 0, medium: 0, high: 0 },
      tts_clarity: { total: 0, count: 0, low: 0, medium: 0, high: 0 },
      rules: { total: 0, count: 0, low: 0, medium: 0, high: 0 }
    };

    processedItems.forEach(item => {
      if (item.subscores) {
        Object.entries(item.subscores).forEach(([key, value]) => {
          if (subscoresAnalysis[key]) {
            subscoresAnalysis[key].total += value;
            subscoresAnalysis[key].count++;
            
            if (value <= 30) subscoresAnalysis[key].low++;
            else if (value <= 70) subscoresAnalysis[key].medium++;
            else subscoresAnalysis[key].high++;
          }
        });
      }
    });

    Object.entries(subscoresAnalysis).forEach(([key, data]) => {
      if (data.count > 0) {
        const avg = (data.total / data.count).toFixed(1);
        console.log(`📊 ${key.toUpperCase()}:`);
        console.log(`   Média: ${avg}%`);
        console.log(`   Baixo (0-30%): ${data.low} itens`);
        console.log(`   Médio (31-70%): ${data.medium} itens`);
        console.log(`   Alto (71-100%): ${data.high} itens`);
        console.log('');
      }
    });

    // 3. ANÁLISE DE FLAGS
    console.log('🏷️ ANÁLISE DE FLAGS:');
    console.log('─'.repeat(60));
    
    const flagCounts = {};
    processedItems.forEach(item => {
      item.flags.forEach(flag => {
        flagCounts[flag] = (flagCounts[flag] || 0) + 1;
      });
    });

    Object.entries(flagCounts)
      .sort((a, b) => b[1] - a[1])
      .forEach(([flag, count]) => {
        const percentage = ((count / processedItems.length) * 100).toFixed(1);
        console.log(`🏷️ ${flag}: ${count} itens (${percentage}%)`);
      });

    // 4. ANÁLISE DE CLAIMS
    console.log('\n📝 ANÁLISE DE CLAIMS:');
    console.log('─'.repeat(60));
    
    const claimAnalysis = {
      total_claims: 0,
      supported_claims: 0,
      contradicted_claims: 0,
      not_found_claims: 0,
      claim_types: {},
      claim_statuses: {}
    };

    processedItems.forEach(item => {
      item.claims.forEach(claim => {
        claimAnalysis.total_claims++;
        
        // Contar por tipo
        claimAnalysis.claim_types[claim.claim_type] = (claimAnalysis.claim_types[claim.claim_type] || 0) + 1;
        
        // Contar por status
        claimAnalysis.claim_statuses[claim.status] = (claimAnalysis.claim_statuses[claim.status] || 0) + 1;
        
        // Contar por resultado
        if (claim.status === 'supported') claimAnalysis.supported_claims++;
        else if (claim.status === 'contradicted') claimAnalysis.contradicted_claims++;
        else if (claim.status === 'not_found') claimAnalysis.not_found_claims++;
      });
    });

    console.log(`📊 Total de claims: ${claimAnalysis.total_claims}`);
    console.log(`✅ Claims suportados: ${claimAnalysis.supported_claims} (${((claimAnalysis.supported_claims / claimAnalysis.total_claims) * 100).toFixed(1)}%)`);
    console.log(`❌ Claims contraditos: ${claimAnalysis.contradicted_claims} (${((claimAnalysis.contradicted_claims / claimAnalysis.total_claims) * 100).toFixed(1)}%)`);
    console.log(`❓ Claims não encontrados: ${claimAnalysis.not_found_claims} (${((claimAnalysis.not_found_claims / claimAnalysis.total_claims) * 100).toFixed(1)}%)`);

    console.log('\n📊 Claims por tipo:');
    Object.entries(claimAnalysis.claim_types)
      .sort((a, b) => b[1] - a[1])
      .forEach(([type, count]) => {
        const percentage = ((count / claimAnalysis.total_claims) * 100).toFixed(1);
        console.log(`   ${type}: ${count} (${percentage}%)`);
      });

    // 5. ANÁLISE DE LENGTH E COMPLEXIDADE
    console.log('\n📏 ANÁLISE DE LENGTH E COMPLEXIDADE:');
    console.log('─'.repeat(60));
    
    const lengthAnalysis = {
      short: 0, // 0-100 chars
      medium: 0, // 101-300 chars
      long: 0 // 300+ chars
    };

    const wordCountAnalysis = {
      short: 0, // 0-20 words
      medium: 0, // 21-50 words
      long: 0 // 50+ words
    };

    processedItems.forEach(item => {
      const charCount = item.description.length;
      const wordCount = item.description.split(/\s+/).length;
      
      if (charCount <= 100) lengthAnalysis.short++;
      else if (charCount <= 300) lengthAnalysis.medium++;
      else lengthAnalysis.long++;
      
      if (wordCount <= 20) wordCountAnalysis.short++;
      else if (wordCount <= 50) wordCountAnalysis.medium++;
      else wordCountAnalysis.long++;
    });

    console.log('📏 Por caracteres:');
    Object.entries(lengthAnalysis).forEach(([range, count]) => {
      const percentage = ((count / processedItems.length) * 100).toFixed(1);
      console.log(`   ${range}: ${count} itens (${percentage}%)`);
    });

    console.log('\n📏 Por palavras:');
    Object.entries(wordCountAnalysis).forEach(([range, count]) => {
      const percentage = ((count / processedItems.length) * 100).toFixed(1);
      console.log(`   ${range}: ${count} itens (${percentage}%)`);
    });

    // 6. EXEMPLOS DE PROBLEMAS COMUNS
    console.log('\n🔍 EXEMPLOS DE PROBLEMAS COMUNS:');
    console.log('─'.repeat(60));
    
    // Exemplos de itens com baixa factualidade
    const lowFactualityItems = processedItems
      .filter(item => item.subscores && item.subscores.factuality <= 30)
      .slice(0, 3);
    
    console.log('📉 Exemplos de baixa factualidade:');
    lowFactualityItems.forEach((item, index) => {
      console.log(`\n${index + 1}. Score: ${item.score}% (Factualidade: ${item.subscores.factuality}%)`);
      console.log(`   Descrição: "${item.description.substring(0, 100)}..."`);
      console.log(`   Flags: ${item.flags.join(', ')}`);
    });

    // Exemplos de itens com muitos claims não encontrados
    const notFoundClaimsItems = processedItems
      .filter(item => item.claims.filter(c => c.status === 'not_found').length > 2)
      .slice(0, 3);
    
    console.log('\n❓ Exemplos com muitos claims não encontrados:');
    notFoundClaimsItems.forEach((item, index) => {
      const notFoundCount = item.claims.filter(c => c.status === 'not_found').length;
      console.log(`\n${index + 1}. Claims não encontrados: ${notFoundCount}/${item.claims.length}`);
      console.log(`   Descrição: "${item.description.substring(0, 100)}..."`);
      console.log(`   Score: ${item.score}%`);
    });

    // 7. RECOMENDAÇÕES
    console.log('\n💡 RECOMENDAÇÕES PARA OTIMIZAÇÃO:');
    console.log('─'.repeat(60));
    
    const recommendations = [];
    
    // Análise de factualidade
    const avgFactuality = subscoresAnalysis.factuality.count > 0 
      ? (subscoresAnalysis.factuality.total / subscoresAnalysis.factuality.count).toFixed(1)
      : 0;
    
    if (avgFactuality < 50) {
      recommendations.push('🔍 Melhorar verificação de fatos: Implementar mais fontes de verificação');
      recommendations.push('📚 Expandir base de conhecimento: Adicionar mais fontes oficiais por país');
      recommendations.push('🎯 Focar em claims verificáveis: Priorizar informações com evidências disponíveis');
    }
    
    // Análise de claims não encontrados
    const notFoundPercentage = ((claimAnalysis.not_found_claims / claimAnalysis.total_claims) * 100).toFixed(1);
    if (notFoundPercentage > 50) {
      recommendations.push('🔎 Melhorar busca de evidências: Otimizar algoritmos de RAG');
      recommendations.push('🌐 Expandir fontes de dados: Incluir mais bases de conhecimento');
      recommendations.push('📝 Refinar extração de claims: Focar em informações mais comuns');
    }
    
    // Análise de flags
    const commonFlags = Object.entries(flagCounts)
      .filter(([flag, count]) => count > processedItems.length * 0.3)
      .map(([flag]) => flag);
    
    if (commonFlags.includes('no_supported_claims')) {
      recommendations.push('✅ Priorizar claims verificáveis: Focar em informações com evidências disponíveis');
    }
    
    if (commonFlags.includes('low_factuality')) {
      recommendations.push('📊 Melhorar qualidade das fontes: Usar fontes mais confiáveis');
    }
    
    if (commonFlags.includes('high_coherence')) {
      recommendations.push('🎯 Manter coerência: Continuar gerando textos bem estruturados');
    }

    recommendations.forEach((rec, index) => {
      console.log(`${index + 1}. ${rec}`);
    });

  } catch (error) {
    console.error('❌ Erro geral:', error);
  }
}

// Executar o script
analyzeRejectedPatterns();
