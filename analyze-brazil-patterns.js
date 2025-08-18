const { createClient } = require('@supabase/supabase-js');

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !supabaseKey) {
  console.error('❌ Variáveis de ambiente não encontradas');
  process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseKey);

async function analyzeBrazilPatterns() {
  console.log('🇧🇷 Analisando padrões dos itens rejeitados do Brasil...\n');

  try {
    // Buscar itens rejeitados do Brasil
    const { data: brazilRejectedItems, error: fetchError } = await supabase
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
        ),
        attractions!inner(
          country,
          city,
          google_types
        )
      `)
      .eq('is_original', true)
      .eq('language', 'pt-br')
      .eq('verification_status', 'rejected')
      .eq('attractions.country', 'Brazil')
      .order('updated_at', { ascending: false });

    if (fetchError) {
      console.error('❌ Erro ao buscar itens rejeitados do Brasil:', fetchError);
      return;
    }

    if (!brazilRejectedItems || brazilRejectedItems.length === 0) {
      console.log('✅ Nenhum item rejeitado do Brasil encontrado.');
      return;
    }

    console.log(`📊 Total de itens rejeitados do Brasil: ${brazilRejectedItems.length}\n`);

    // Processar dados para análise
    const processedItems = brazilRejectedItems.map(item => {
      const latestScore = item.description_scores && item.description_scores.length > 0
        ? item.description_scores.sort((a, b) => new Date(b.created_at) - new Date(a.created_at))[0]
        : null;
      
      return {
        id: item.id,
        description: item.description,
        attraction_id: item.attraction_id,
        country: item.attractions?.country,
        city: item.attractions?.city,
        google_types: item.attractions?.google_types,
        score: latestScore?.score_overall || null,
        subscores: latestScore?.subscores || null,
        flags: latestScore?.flags || [],
        claims: item.description_claims || [],
        updated_at: item.updated_at
      };
    });

    // 1. ANÁLISE POR CIDADE
    console.log('🏙️ ANÁLISE POR CIDADE:');
    console.log('─'.repeat(60));
    
    const cityAnalysis = {};
    processedItems.forEach(item => {
      const city = item.city || 'Desconhecida';
      if (!cityAnalysis[city]) {
        cityAnalysis[city] = {
          count: 0,
          avgScore: 0,
          totalScore: 0,
          lowFactuality: 0,
          noClaims: 0
        };
      }
      
      cityAnalysis[city].count++;
      cityAnalysis[city].totalScore += item.score || 0;
      
      if (item.subscores && item.subscores.factuality <= 30) {
        cityAnalysis[city].lowFactuality++;
      }
      
      if (item.flags.includes('no_claims_extracted')) {
        cityAnalysis[city].noClaims++;
      }
    });

    // Calcular médias
    Object.keys(cityAnalysis).forEach(city => {
      const data = cityAnalysis[city];
      data.avgScore = data.count > 0 ? (data.totalScore / data.count).toFixed(1) : 0;
    });

    Object.entries(cityAnalysis)
      .sort((a, b) => b[1].count - a[1].count)
      .slice(0, 10)
      .forEach(([city, data]) => {
        console.log(`🏙️ ${city}: ${data.count} itens (média: ${data.avgScore}%)`);
        console.log(`   📉 Baixa factualidade: ${data.lowFactuality} (${((data.lowFactuality/data.count)*100).toFixed(1)}%)`);
        console.log(`   ❓ Sem claims: ${data.noClaims} (${((data.noClaims/data.count)*100).toFixed(1)}%)`);
        console.log('');
      });

    // 2. ANÁLISE POR TIPO DE ATRAÇÃO
    console.log('🏛️ ANÁLISE POR TIPO DE ATRAÇÃO:');
    console.log('─'.repeat(60));
    
    const typeAnalysis = {};
    processedItems.forEach(item => {
      const types = item.google_types || [];
      types.forEach(type => {
        if (!typeAnalysis[type]) {
          typeAnalysis[type] = {
            count: 0,
            avgScore: 0,
            totalScore: 0,
            lowFactuality: 0,
            noClaims: 0
          };
        }
        
        typeAnalysis[type].count++;
        typeAnalysis[type].totalScore += item.score || 0;
        
        if (item.subscores && item.subscores.factuality <= 30) {
          typeAnalysis[type].lowFactuality++;
        }
        
        if (item.flags.includes('no_claims_extracted')) {
          typeAnalysis[type].noClaims++;
        }
      });
    });

    // Calcular médias
    Object.keys(typeAnalysis).forEach(type => {
      const data = typeAnalysis[type];
      data.avgScore = data.count > 0 ? (data.totalScore / data.count).toFixed(1) : 0;
    });

    Object.entries(typeAnalysis)
      .sort((a, b) => b[1].count - a[1].count)
      .slice(0, 10)
      .forEach(([type, data]) => {
        console.log(`🏛️ ${type}: ${data.count} itens (média: ${data.avgScore}%)`);
        console.log(`   📉 Baixa factualidade: ${data.lowFactuality} (${((data.lowFactuality/data.count)*100).toFixed(1)}%)`);
        console.log(`   ❓ Sem claims: ${data.noClaims} (${((data.noClaims/data.count)*100).toFixed(1)}%)`);
        console.log('');
      });

    // 3. ANÁLISE DE PATRÕES DE TEXTO
    console.log('📝 ANÁLISE DE PATRÕES DE TEXTO:');
    console.log('─'.repeat(60));
    
    const textPatterns = {
      startsWithO: 0,
      hasInaugurado: 0,
      hasLocalizado: 0,
      hasProjetado: 0,
      hasConstruido: 0,
      hasFundado: 0,
      hasCriado: 0,
      hasInaugurada: 0,
      hasLocalizada: 0,
      hasProjetada: 0,
      hasConstruida: 0,
      hasFundada: 0,
      hasCriada: 0
    };

    processedItems.forEach(item => {
      const desc = item.description.toLowerCase();
      
      if (desc.startsWith('o ')) textPatterns.startsWithO++;
      if (desc.includes('inaugurado')) textPatterns.hasInaugurado++;
      if (desc.includes('localizado')) textPatterns.hasLocalizado++;
      if (desc.includes('projetado')) textPatterns.hasProjetado++;
      if (desc.includes('construído')) textPatterns.hasConstruido++;
      if (desc.includes('fundado')) textPatterns.hasFundado++;
      if (desc.includes('criado')) textPatterns.hasCriado++;
      if (desc.includes('inaugurada')) textPatterns.hasInaugurada++;
      if (desc.includes('localizada')) textPatterns.hasLocalizada++;
      if (desc.includes('projetada')) textPatterns.hasProjetada++;
      if (desc.includes('construída')) textPatterns.hasConstruida++;
      if (desc.includes('fundada')) textPatterns.hasFundada++;
      if (desc.includes('criada')) textPatterns.hasCriada++;
    });

    Object.entries(textPatterns).forEach(([pattern, count]) => {
      if (count > 0) {
        const percentage = ((count / processedItems.length) * 100).toFixed(1);
        console.log(`📝 ${pattern}: ${count} itens (${percentage}%)`);
      }
    });

    // 4. EXEMPLOS DE PROBLEMAS ESPECÍFICOS
    console.log('\n🔍 EXEMPLOS DE PROBLEMAS ESPECÍFICOS:');
    console.log('─'.repeat(60));
    
    // Exemplos de itens com claims não encontrados
    const notFoundExamples = processedItems
      .filter(item => item.claims.filter(c => c.status === 'not_found').length > 2)
      .slice(0, 5);
    
    console.log('❓ Exemplos com claims não encontrados:');
    notFoundExamples.forEach((item, index) => {
      const notFoundCount = item.claims.filter(c => c.status === 'not_found').length;
      const totalClaims = item.claims.length;
      console.log(`\n${index + 1}. ${item.city} - Claims não encontrados: ${notFoundCount}/${totalClaims}`);
      console.log(`   Score: ${item.score}% | Factualidade: ${item.subscores?.factuality || 'N/A'}%`);
      console.log(`   Descrição: "${item.description.substring(0, 120)}..."`);
      
      // Mostrar claims não encontrados
      const notFoundClaims = item.claims.filter(c => c.status === 'not_found');
      console.log(`   Claims não encontrados:`);
      notFoundClaims.slice(0, 3).forEach(claim => {
        console.log(`     - ${claim.claim_type}: ${claim.value}`);
      });
    });

    // 5. RECOMENDAÇÕES ESPECÍFICAS PARA BRASIL
    console.log('\n💡 RECOMENDAÇÕES PARA OTIMIZAÇÃO NO BRASIL:');
    console.log('─'.repeat(60));
    
    const recommendations = [];
    
    // Análise de factualidade
    const avgFactuality = processedItems.reduce((sum, item) => 
      sum + (item.subscores?.factuality || 0), 0) / processedItems.length;
    
    if (avgFactuality < 50) {
      recommendations.push('🔍 Expandir fontes brasileiras: IPHAN, IBGE, sites oficiais de cidades');
      recommendations.push('📚 Adicionar base de dados de patrimônio histórico brasileiro');
      recommendations.push('🎯 Focar em informações oficiais: anos de inauguração, arquitetos conhecidos');
    }
    
    // Análise de claims não encontrados
    const totalClaims = processedItems.reduce((sum, item) => sum + item.claims.length, 0);
    const notFoundClaims = processedItems.reduce((sum, item) => 
      sum + item.claims.filter(c => c.status === 'not_found').length, 0);
    const notFoundPercentage = ((notFoundClaims / totalClaims) * 100).toFixed(1);
    
    if (notFoundPercentage > 50) {
      recommendations.push('🔎 Implementar busca fuzzy para nomes brasileiros');
      recommendations.push('🌐 Adicionar variações de nomes (ex: "São Paulo" vs "Sao Paulo")');
      recommendations.push('📝 Usar padrões mais comuns: "inaugurado em", "localizado em", "projetado por"');
    }
    
    // Análise de padrões de texto
    if (textPatterns.startsWithO > processedItems.length * 0.5) {
      recommendations.push('📝 Manter padrão "O [nome]..." - está funcionando bem');
    }
    
    if (textPatterns.hasInaugurado > processedItems.length * 0.3) {
      recommendations.push('📅 Focar em anos de inauguração - são mais verificáveis');
    }

    recommendations.forEach((rec, index) => {
      console.log(`${index + 1}. ${rec}`);
    });

    // 6. TEMPLATE DE DESCRIÇÃO OTIMIZADO
    console.log('\n📋 TEMPLATE DE DESCRIÇÃO OTIMIZADO PARA BRASIL:');
    console.log('─'.repeat(60));
    
    console.log(`📝 Estrutura recomendada:`);
    console.log(`"O [NOME], [inaugurado/fundado/criado] em [ANO], [localizado em] [CIDADE/BAIRRO].`);
    console.log(`[Projetado por] [ARQUITETO] em [ESTILO ARQUITETÔNICO]. [FUNÇÃO PRINCIPAL]`);
    console.log(`[DETALHE HISTÓRICO IMPORTANTE]."`);
    
    console.log(`\n📝 Exemplo:`);
    console.log(`"O Museu de Arte de São Paulo, inaugurado em 1947, localizado na Avenida Paulista.`);
    console.log(`Projetado por Lina Bo Bardi em estilo modernista. Abriga uma das mais importantes`);
    console.log(`coleções de arte europeia da América Latina."`);

  } catch (error) {
    console.error('❌ Erro geral:', error);
  }
}

// Executar o script
analyzeBrazilPatterns();
