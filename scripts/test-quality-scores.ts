#!/usr/bin/env tsx

/**
 * Script para testar a qualidade dos scores em diferentes tipos de POIs
 */

async function testQualityScores() {
  console.log('🧪 TESTE DE QUALIDADE DOS SCORES');
  console.log('=================================\n');

  const testCases = [
    {
      name: 'Estádio Cícero Pompeu de Toledo - Morumbis',
      city: 'São Paulo',
      country: 'Brazil',
      type: 'Stadium'
    },
    {
      name: 'Cristo Redentor',
      city: 'Rio de Janeiro',
      country: 'Brazil',
      type: 'Monument/Religious'
    },
    {
      name: 'Museu de Arte de São Paulo',
      city: 'São Paulo',
      country: 'Brazil',
      type: 'Museum'
    },
    {
      name: 'Parque Ibirapuera',
      city: 'São Paulo',
      country: 'Brazil',
      type: 'Park'
    },
    {
      name: 'La Sagrada Família',
      city: 'Barcelona',
      country: 'Spain',
      type: 'Religious/UNESCO'
    },
    {
      name: 'Museu Nacional d\'Art de Catalunya',
      city: 'Barcelona',
      country: 'Spain',
      type: 'Museum'
    }
  ];

  const results = [];

  for (const testCase of testCases) {
    console.log(`🔍 Testando: "${testCase.name}" (${testCase.type})`);
    
    try {
      const response = await fetch('http://localhost:3000/api/pois/enrich-osm', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          poi_id: `550e8400-e29b-41d4-a716-${Date.now().toString().slice(-12)}`,
          name: testCase.name,
          city: testCase.city,
          country: testCase.country
        })
      });

      const result = await response.json();
      
      if (result.success) {
        const score = result.data_quality_score;
        console.log(`✅ Score: ${score}/100`);
        
        results.push({
          name: testCase.name,
          type: testCase.type,
          score: score,
          fields_count: result.fields_updated?.length || 0
        });
      } else {
        console.log(`❌ Falhou: ${result.message}`);
        results.push({
          name: testCase.name,
          type: testCase.type,
          score: 0,
          error: result.message
        });
      }
      
    } catch (error) {
      console.error(`❌ Erro na requisição:`, error);
      results.push({
        name: testCase.name,
        type: testCase.type,
        score: 0,
        error: 'Network error'
      });
    }
    
    console.log('');
    
    // Delay entre testes
    await new Promise(resolve => setTimeout(resolve, 3000));
  }

  // Resumo dos resultados
  console.log('\n📊 RESUMO DOS SCORES:');
  console.log('=====================\n');
  
  results.forEach(result => {
    if (result.error) {
      console.log(`❌ ${result.name}: ERRO - ${result.error}`);
    } else {
      console.log(`📈 ${result.name}: ${result.score}/100 (${result.type}) - ${result.fields_count} campos`);
    }
  });

  // Estatísticas
  const validResults = results.filter(r => !r.error);
  if (validResults.length > 0) {
    const scores = validResults.map(r => r.score);
    const avgScore = scores.reduce((a, b) => a + b, 0) / scores.length;
    const minScore = Math.min(...scores);
    const maxScore = Math.max(...scores);
    
    console.log('\n📈 ESTATÍSTICAS:');
    console.log(`   Média: ${avgScore.toFixed(1)}/100`);
    console.log(`   Mínimo: ${minScore}/100`);
    console.log(`   Máximo: ${maxScore}/100`);
    console.log(`   Amplitude: ${maxScore - minScore} pontos`);
  }
}

// Executar o teste
testQualityScores().catch(console.error);
