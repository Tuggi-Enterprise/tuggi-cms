#!/usr/bin/env tsx

/**
 * Script específico para testar a busca do Estádio do Morumbi
 * Testa as melhorias na busca OSM
 */

async function testMorumbiStadium() {
  console.log('🏟️ TESTE ESPECÍFICO - ESTÁDIO DO MORUMBI');
  console.log('==========================================\n');

  const testCases = [
    {
      name: 'Estádio Cícero Pompeu de Toledo - Morumbis',
      city: 'São Paulo',
      country: 'Brazil',
      expected: 'Morumbi'
    },
    {
      name: 'Estádio do Morumbi',
      city: 'São Paulo',
      country: 'Brazil',
      expected: 'Morumbi'
    },
    {
      name: 'Arena Morumbi',
      city: 'São Paulo',
      country: 'Brazil',
      expected: 'Morumbi'
    },
    {
      name: 'Museu de Arte de São Paulo',
      city: 'São Paulo',
      country: 'Brazil',
      expected: 'MASP'
    },
    {
      name: 'Parque Ibirapuera',
      city: 'São Paulo',
      country: 'Brazil',
      expected: 'Ibirapuera'
    }
  ];

  for (const testCase of testCases) {
    console.log(`🔍 Testando: "${testCase.name}"`);
    
    try {
      // Testar busca direta no Nominatim
      const searchVariations = generateSearchVariations(testCase.name, testCase.city, testCase.country);
      console.log(`📝 Variações geradas:`, searchVariations);
      
      // Testar cada variação
      for (const variation of searchVariations) {
        console.log(`  🔍 Tentando: "${variation}"`);
        
        const nominatimUrl = `https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(variation)}&format=json&limit=3&addressdetails=1&extratags=1`;
        
        const response = await fetch(nominatimUrl, {
          headers: {
            'User-Agent': 'Tuggi-CMS/1.0 (https://tuggi.com)'
          }
        });
        
        if (response.ok) {
          const data = await response.json();
          
          if (data && data.length > 0) {
            console.log(`    ✅ Encontrado ${data.length} resultados:`);
            
            for (const result of data) {
              const name = result.name || result.display_name || 'Sem nome';
              const type = result.class || 'Sem tipo';
              const tags = result.extratags || {};
              
              console.log(`      📍 ${name} (${type})`);
              console.log(`      🏷️ Tags:`, Object.keys(tags).slice(0, 5).map(k => `${k}=${tags[k]}`).join(', '));
              
              // Verificar se é um estádio
              if (type === 'leisure' || tags.leisure === 'stadium' || tags.sport === 'stadium') {
                console.log(`      🏟️ É um estádio!`);
              }
            }
          } else {
            console.log(`    ❌ Nenhum resultado encontrado`);
          }
        } else {
          console.log(`    ❌ Erro na API: ${response.status}`);
        }
        
        // Delay entre tentativas
        await new Promise(resolve => setTimeout(resolve, 1000));
      }

      // DOUBLE CHECK: Testar busca por palavras-chave
      console.log(`  🔍 DOUBLE CHECK: Testando busca por palavras-chave`);
      
      // Simular extração de palavras-chave
      const keywords = testCase.name.toLowerCase().split(' ').filter(word => word.length > 3);
      console.log(`    📝 Palavras-chave extraídas: ${keywords.join(', ')}`);
      
      // Testar busca com palavras-chave
      for (const keyword of keywords.slice(0, 3)) {
        console.log(`    🔍 Tentando palavra-chave: "${keyword}"`);
        const keywordUrl = `https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(`${keyword}, ${testCase.city}, ${testCase.country}`)}&format=json&limit=3&addressdetails=1&extratags=1`;
        
        try {
          const response = await fetch(keywordUrl, {
            headers: {
              'User-Agent': 'Tuggi-CMS/1.0 (https://tuggi.com)'
            }
          });
          
          if (response.ok) {
            const data = await response.json();
            if (data && data.length > 0) {
              console.log(`      ✅ Encontrado ${data.length} resultados para "${keyword}"`);
              
              // Verificar se algum resultado é relevante
              for (const result of data) {
                const resultName = result.display_name.toLowerCase();
                if (resultName.includes(testCase.name.toLowerCase().split(' ')[0]) || 
                    resultName.includes(testCase.name.toLowerCase().split(' ').pop() || '')) {
                  console.log(`      🎯 Match potencial encontrado: ${result.display_name}`);
                  break;
                }
              }
            } else {
              console.log(`      ❌ Nenhum resultado para "${keyword}"`);
            }
          }
        } catch (error) {
          console.log(`      ⚠️ Erro na busca por "${keyword}": ${error}`);
        }
        
        // Delay entre requests
        await new Promise(resolve => setTimeout(resolve, 500));
      }
      
    } catch (error) {
      console.error(`❌ Erro no teste:`, error);
    }
    
    console.log('\n' + '='.repeat(50) + '\n');
  }
}

// Função para gerar variações de busca (copiada da API)
function generateSearchVariations(name: string, city: string, country: string): string[] {
  const variations: string[] = [];
  
  // Extrair palavras-chave do nome
  const words = name.split(' ').filter(word => word.length > 2);
  
  // Variações com palavras-chave
  if (words.length > 1) {
    // Primeira e última palavra
    if (words.length >= 2) {
      variations.push(`${words[0]} ${words[words.length - 1]}, ${city}, ${country}`);
    }
    
    // Primeiras duas palavras
    if (words.length >= 2) {
      variations.push(`${words[0]} ${words[1]}, ${city}, ${country}`);
    }
    
    // Palavras mais longas (provavelmente mais importantes)
    const longWords = words.filter(word => word.length > 4);
    if (longWords.length >= 2) {
      variations.push(`${longWords[0]} ${longWords[1]}, ${city}, ${country}`);
    }
  }
  
  // Variações específicas para estádios
  if (name.toLowerCase().includes('estádio') || name.toLowerCase().includes('stadium')) {
    const stadiumName = name.replace(/estádio\s+/i, '').replace(/stadium\s+/i, '');
    variations.push(`${stadiumName}, ${city}, ${country}`);
    variations.push(`Estádio ${stadiumName}, ${city}, ${country}`);
  }
  
  // Variações com nomes conhecidos
  const knownVariations: { [key: string]: string[] } = {
    'Estádio Cícero Pompeu de Toledo - Morumbis': ['Morumbi', 'Estádio do Morumbi', 'Arena Morumbi'],
    'Museu de Arte de São Paulo': ['MASP', 'Museu MASP'],
    'Parque Ibirapuera': ['Ibirapuera', 'Parque do Ibirapuera'],
    'Cristo Redentor': ['Cristo', 'Cristo Redentor Rio'],
    'La Sagrada Familia': ['Sagrada Familia', 'Sagrada Família', 'Basilica Sagrada Familia']
  };
  
  if (knownVariations[name]) {
    variations.push(...knownVariations[name].map(v => `${v}, ${city}, ${country}`));
  }
  
  // Remover duplicatas e retornar
  return [...new Set(variations)];
}

// Executar o teste
testMorumbiStadium().catch(console.error);
