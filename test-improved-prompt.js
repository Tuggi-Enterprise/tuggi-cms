const { createClient } = require('@supabase/supabase-js');

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !supabaseKey) {
  console.error('❌ NEXT_PUBLIC_SUPABASE_URL e SUPABASE_SERVICE_ROLE_KEY são necessárias');
  process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseKey);

async function testImprovedPrompt() {
  console.log('🔥 TESTANDO PROMPT MELHORADO DE EXTRAÇÃO DE CLAIMS');
  console.log('=' .repeat(80));
  
  // Testar com 3 descrições que sabemos que têm dados factuais óbvios
  const testCases = [
    {
      name: 'Bourbon Resort Atibaia',
      expectedClaims: ['inaugurado em 1962'],
      description: 'O Bourbon Resort Atibaia, inaugurado em 1962, oferece uma experiência completa de lazer e relaxamento.'
    },
    {
      name: 'Parque Dom Pedro II',
      expectedClaims: ['inaugurado em 1922'],
      description: 'Parque Dom Pedro II, inaugurado em 1922. Originalmente concebido como um espaço para exposições e eventos.'
    },
    {
      name: 'Parque do Povo Mário Pimenta Camargo',
      expectedClaims: ['inaugurado em 2008', '112 mil m²', 'Mário Pimenta Camargo'],
      description: 'O Parque do Povo Mário Pimenta Camargo, inaugurado em 2008, oferece aos visitantes 112 mil m² de área verde.'
    }
  ];
  
  console.log(`🎯 Testando ${testCases.length} casos específicos com dados factuais óbvios\n`);
  
  for (let i = 0; i < testCases.length; i++) {
    const testCase = testCases[i];
    console.log(`\n📋 TESTE ${i + 1}/3: ${testCase.name}`);
    console.log('-' .repeat(60));
    console.log(`📝 Descrição: "${testCase.description}"`);
    console.log(`🎯 Claims esperados: ${testCase.expectedClaims.join(', ')}`);
    
    // Buscar a atração real no banco
    const { data: attractions } = await supabase
      .schema('core')
      .from('attractions')
      .select('id, name, city, country')
      .ilike('name', `%${testCase.name.split(' ')[0]}%`)
      .limit(1);
      
    if (!attractions || attractions.length === 0) {
      console.log('❌ Atração não encontrada no banco');
      continue;
    }
    
    const attraction = attractions[0];
    
    // Buscar descrição original
    const { data: descriptions } = await supabase
      .schema('core')
      .from('attraction_descriptions')
      .select('id, description, attraction_id')
      .eq('attraction_id', attraction.id)
      .eq('is_original', true)
      .eq('language', 'pt-br')
      .limit(1);
      
    if (!descriptions || descriptions.length === 0) {
      console.log('❌ Descrição original não encontrada');
      continue;
    }
    
    const description = descriptions[0];
    console.log(`✅ Encontrada: ${attraction.name} (${attraction.city}, ${attraction.country})`);
    console.log(`📋 Descrição real (${description.description.length} chars): "${description.description.substring(0, 100)}..."`);
    
    // Processar com o prompt melhorado
    console.log(`\n🚀 Processando com prompt ULTRA-PRECISO...`);
    const startTime = Date.now();
    
    const { data, error } = await supabase.functions.invoke('verify-batch', {
      body: {
        description_id: description.id,
        description: description.description,
        attraction_id: description.attraction_id,
        force_reprocess: true
      }
    });

    const endTime = Date.now();
    const duration = (endTime - startTime) / 1000;

    if (error) {
      console.log(`❌ Erro na verificação:`, error);
      continue;
    }

    console.log(`\n✅ RESULTADOS (${duration}s):`);
    console.log(`📊 Score: ${data.score_overall}%`);
    console.log(`🔍 Claims Extraídos: ${data.reasoning?.total_claims || 0}`);
    console.log(`✅ Claims Suportados: ${data.reasoning?.supported_claims || 0}`);
    console.log(`❌ Claims Não Encontrados: ${data.reasoning?.not_found_claims || 0}`);
    
    // Verificar claims salvos no banco
    const { data: savedClaims } = await supabase
      .schema('core')
      .from('description_claims')
      .select('value, claim_type, weight, status')
      .eq('description_id', description.id)
      .order('created_at', { ascending: false });
      
    console.log(`\n💾 CLAIMS SALVOS NO BANCO (${savedClaims?.length || 0}):`);
    if (savedClaims && savedClaims.length > 0) {
      savedClaims.forEach((claim, index) => {
        console.log(`   ${index + 1}. "${claim.value}" (${claim.claim_type}, ${claim.status}, weight: ${claim.weight})`);
      });
      
      // Verificar se os claims esperados foram extraídos
      console.log(`\n🎯 ANÁLISE DE COBERTURA:`);
      testCase.expectedClaims.forEach(expectedClaim => {
        const found = savedClaims.some(claim => 
          claim.value.toLowerCase().includes(expectedClaim.toLowerCase()) ||
          expectedClaim.toLowerCase().includes(claim.value.toLowerCase())
        );
        console.log(`   ${found ? '✅' : '❌'} "${expectedClaim}" ${found ? 'ENCONTRADO' : 'NÃO ENCONTRADO'}`);
      });
    } else {
      console.log('   ❌ Nenhum claim salvo no banco');
      
      // Mostrar claims esperados que não foram encontrados
      console.log(`\n❌ CLAIMS ESPERADOS NÃO EXTRAÍDOS:`);
      testCase.expectedClaims.forEach(expectedClaim => {
        console.log(`   • "${expectedClaim}"`);
      });
    }
    
    // Calcular taxa de sucesso
    if (testCase.expectedClaims.length > 0) {
      const extractedCount = savedClaims?.length || 0;
      const expectedCount = testCase.expectedClaims.length;
      const successRate = extractedCount > 0 ? (Math.min(extractedCount, expectedCount) / expectedCount * 100) : 0;
      console.log(`\n📈 Taxa de Extração: ${extractedCount}/${expectedCount} (${successRate.toFixed(1)}%)`);
    }
    
    if (i < testCases.length - 1) {
      console.log('\n⏳ Aguardando 3s...');
      await new Promise(resolve => setTimeout(resolve, 3000));
    }
  }
  
  console.log('\n\n🎉 ANÁLISE FINAL DO PROMPT MELHORADO');
  console.log('=' .repeat(80));
  
  // Buscar estatísticas gerais dos últimos processamentos
  const { data: recentScores } = await supabase
    .schema('core')
    .from('description_scores')
    .select('score_overall, subscores, created_at')
    .order('created_at', { ascending: false })
    .limit(10);
    
  const { data: recentClaims } = await supabase
    .schema('core')
    .from('description_claims')
    .select('id, created_at')
    .order('created_at', { ascending: false })
    .limit(50);
    
  if (recentScores && recentClaims) {
    const recentClaimsCount = recentClaims.filter(claim => 
      new Date(claim.created_at) > new Date(Date.now() - 10 * 60 * 1000) // últimos 10 minutos
    ).length;
    
    console.log(`📊 ESTATÍSTICAS DOS ÚLTIMOS PROCESSAMENTOS:`);
    console.log(`   Claims extraídos nos últimos 10min: ${recentClaimsCount}`);
    console.log(`   Scores recentes: ${recentScores.slice(0, 3).map(s => s.score_overall + '%').join(', ')}`);
  }
  
  console.log(`\n✨ MELHORIAS NO PROMPT IMPLEMENTADAS:`);
  console.log(`   🎯 Instruções ULTRA-PRECISAS para extração`);
  console.log(`   📋 Regras OBRIGATÓRIAS para anos, nomes, números`);
  console.log(`   🔍 Exemplos específicos de extração`);
  console.log(`   📏 Metas de performance por tipo de texto`);
  console.log(`   ⚡ Estratégia palavra-por-palavra`);
  
  console.log('\n🎯 Teste do prompt melhorado concluído!');
}

testImprovedPrompt();
