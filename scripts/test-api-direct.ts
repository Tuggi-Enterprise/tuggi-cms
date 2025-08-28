#!/usr/bin/env tsx

/**
 * Script para testar diretamente a API de enriquecimento OSM
 */

async function testAPI() {
  console.log('🧪 TESTE DIRETO DA API OSM');
  console.log('==========================\n');

  const testCases = [
    {
      name: 'Estádio Cícero Pompeu de Toledo - Morumbis',
      city: 'São Paulo',
      country: 'Brazil'
    },
    {
      name: 'MorumBIS',
      city: 'São Paulo',
      country: 'Brazil'
    },
    {
      name: 'Estádio do Morumbi',
      city: 'São Paulo',
      country: 'Brazil'
    }
  ];

  for (const testCase of testCases) {
    console.log(`🔍 Testando: "${testCase.name}"`);
    
    try {
      const response = await fetch('http://localhost:3000/api/pois/enrich-osm', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          poi_id: 'test-' + Date.now(),
          name: testCase.name,
          city: testCase.city,
          country: testCase.country
        })
      });

      const result = await response.json();
      
      if (result.success) {
        console.log(`✅ Sucesso!`);
        console.log(`📊 Dados encontrados:`, {
          osm_category: result.data?.osm_category,
          osm_tags: result.data?.osm_tags,
          osm_data_quality_score: result.data?.osm_data_quality_score
        });
      } else {
        console.log(`❌ Falhou: ${result.message}`);
        if (result.errors) {
          console.log(`🔍 Erros:`, result.errors);
        }
      }
      
    } catch (error) {
      console.error(`❌ Erro na requisição:`, error);
    }
    
    console.log('\n' + '-'.repeat(50) + '\n');
    
    // Delay entre testes
    await new Promise(resolve => setTimeout(resolve, 2000));
  }
}

// Executar o teste
testAPI().catch(console.error);
