#!/usr/bin/env tsx

/**
 * Script para testar a API de enriquecimento OSM
 * Testa a funcionalidade completa da API /api/pois/enrich-osm
 */

import { createClient } from '@supabase/supabase-js';

// Configuração do Supabase
const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const supabase = createClient(supabaseUrl, supabaseServiceKey);

// POIs de teste baseados nos nossos testes anteriores
const TEST_POIS = [
  {
    name: 'Museu de Arte de São Paulo',
    city: 'São Paulo',
    country: 'Brazil',
    expected_quality: 85
  },
  {
    name: 'Parque Ibirapuera',
    city: 'São Paulo',
    country: 'Brazil',
    expected_quality: 90
  },
  {
    name: 'Cristo Redentor',
    city: 'Rio de Janeiro',
    country: 'Brazil',
    expected_quality: 80
  },
  {
    name: 'Museu do Telefone',
    city: 'Bragança Paulista',
    country: 'Brazil',
    expected_quality: 70
  },
  {
    name: 'La Sagrada Familia',
    city: 'Barcelona',
    country: 'Spain',
    expected_quality: 95
  }
];

async function testOSMEnrichmentAPI() {
  console.log('🧪 TESTE DA API DE ENRIQUECIMENTO OSM');
  console.log('=====================================\n');

  // 1. Primeiro, vamos buscar um POI real do banco para testar
  console.log('📋 1. Buscando POI de teste no banco de dados...');
  
  const { data: pois, error } = await supabase
    .schema('core')
    .from('attractions')
    .select('id, name, city, country, google_place_id')
    .eq('approved', true)
    .limit(1);

  if (error || !pois || pois.length === 0) {
    console.error('❌ Erro ao buscar POIs:', error);
    return;
  }

  const testPOI = pois[0];
  console.log(`✅ POI encontrado: ${testPOI.name} (${testPOI.city}, ${testPOI.country})`);

  // 2. Testar a API de enriquecimento
  console.log('\n🔄 2. Testando API de enriquecimento OSM...');
  
  try {
    const response = await fetch('http://localhost:3000/api/pois/enrich-osm', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        poi_id: testPOI.id,
        name: testPOI.name,
        city: testPOI.city,
        country: testPOI.country,
        google_place_id: testPOI.google_place_id
      }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error(`❌ Erro na API: ${response.status} - ${errorText}`);
      return;
    }

    const result = await response.json();
    
    console.log('✅ Resposta da API:');
    console.log(`   - Success: ${result.success}`);
    console.log(`   - Message: ${result.message}`);
    console.log(`   - Quality Score: ${result.data_quality_score}%`);
    console.log(`   - Fields Updated: ${result.fields_updated?.length || 0}`);
    console.log(`   - OSM Data:`, result.osm_data);

    // 3. Verificar se os dados foram salvos no banco
    console.log('\n📊 3. Verificando dados salvos no banco...');
    
    const { data: updatedPOI, error: fetchError } = await supabase
      .schema('core')
      .from('attractions')
      .select(`
        id,
        name,
        osm_category,
        osm_data_quality_score,
        heritage_status,
        unesco_status,
        landmark_level,
        pov_quality_score,
        visibility_score,
        accessibility_score,
        photogenic_score,
        wheelchair_accessible,
        cultural_significance,
        osm_tags,
        osm_last_updated
      `)
      .eq('id', testPOI.id)
      .single();

    if (fetchError) {
      console.error('❌ Erro ao buscar POI atualizado:', fetchError);
      return;
    }

    console.log('✅ Dados atualizados no banco:');
    console.log(`   - OSM Category: ${updatedPOI.osm_category || 'N/A'}`);
    console.log(`   - OSM Quality Score: ${updatedPOI.osm_data_quality_score || 'N/A'}%`);
    console.log(`   - Heritage Status: ${updatedPOI.heritage_status || 'N/A'}`);
    console.log(`   - UNESCO Status: ${updatedPOI.unesco_status || 'N/A'}`);
    console.log(`   - Landmark Level: ${updatedPOI.landmark_level || 'N/A'}`);
    console.log(`   - POV Quality Score: ${updatedPOI.pov_quality_score || 'N/A'}%`);
    console.log(`   - Visibility Score: ${updatedPOI.visibility_score || 'N/A'}%`);
    console.log(`   - Accessibility Score: ${updatedPOI.accessibility_score || 'N/A'}%`);
    console.log(`   - Photogenic Score: ${updatedPOI.photogenic_score || 'N/A'}%`);
    console.log(`   - Wheelchair Accessible: ${updatedPOI.wheelchair_accessible || 'N/A'}`);
    console.log(`   - Cultural Significance: ${updatedPOI.cultural_significance || 'N/A'}`);
    console.log(`   - OSM Tags Count: ${updatedPOI.osm_tags ? Object.keys(updatedPOI.osm_tags).length : 0}`);
    console.log(`   - Last Updated: ${updatedPOI.osm_last_updated || 'N/A'}`);

    // 4. Análise dos dados OSM
    if (updatedPOI.osm_tags) {
      console.log('\n🏷️ 4. Análise das tags OSM:');
      const tags = updatedPOI.osm_tags;
      const importantTags = [
        'tourism', 'leisure', 'historic', 'amenity', 'heritage', 'architect',
        'wheelchair', 'opening_hours', 'website', 'phone', 'email'
      ];

      importantTags.forEach(tag => {
        if (tags[tag]) {
          console.log(`   - ${tag}: ${tags[tag]}`);
        }
      });

      // Mostrar algumas tags extras interessantes
      const extraTags = Object.keys(tags).filter(tag => !importantTags.includes(tag)).slice(0, 5);
      if (extraTags.length > 0) {
        console.log('   - Tags extras:', extraTags.map(tag => `${tag}: ${tags[tag]}`).join(', '));
      }
    }

    // 5. Resumo do teste
    console.log('\n📈 5. RESUMO DO TESTE');
    console.log('=====================');
    
    const qualityScore = updatedPOI.osm_data_quality_score || 0;
    const povScore = updatedPOI.pov_quality_score || 0;
    
    console.log(`✅ POI testado: ${updatedPOI.name}`);
    console.log(`✅ Dados OSM encontrados: ${updatedPOI.osm_category ? 'Sim' : 'Não'}`);
    console.log(`✅ Score de qualidade: ${qualityScore}%`);
    console.log(`✅ Score POV: ${povScore}%`);
    console.log(`✅ Campos atualizados: ${result.fields_updated?.length || 0}`);
    
    if (qualityScore >= 70) {
      console.log('🎉 Teste SUCESSO: Dados OSM de alta qualidade obtidos!');
    } else if (qualityScore >= 50) {
      console.log('⚠️ Teste PARCIAL: Dados OSM obtidos mas com qualidade moderada');
    } else {
      console.log('❌ Teste FALHOU: Dados OSM insuficientes ou não encontrados');
    }

  } catch (error) {
    console.error('❌ Erro durante o teste:', error);
  }
}

async function testMultiplePOIs() {
  console.log('\n🧪 TESTE COM MÚLTIPLOS POIs');
  console.log('============================\n');

  // Buscar POIs de diferentes tipos
  const { data: pois, error } = await supabase
    .schema('core')
    .from('attractions')
    .select('id, name, city, country, google_place_id, category')
    .eq('approved', true)
    .limit(5);

  if (error || !pois) {
    console.error('❌ Erro ao buscar POIs:', error);
    return;
  }

  console.log(`📋 Testando ${pois.length} POIs diferentes...\n`);

  for (const poi of pois) {
    console.log(`🔄 Testando: ${poi.name} (${poi.city}, ${poi.country})`);
    
    try {
      const response = await fetch('http://localhost:3000/api/pois/enrich-osm', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          poi_id: poi.id,
          name: poi.name,
          city: poi.city,
          country: poi.country,
          google_place_id: poi.google_place_id
        }),
      });

      if (response.ok) {
        const result = await response.json();
        const qualityScore = result.data_quality_score || 0;
        
        console.log(`   ✅ Quality: ${qualityScore}% | Fields: ${result.fields_updated?.length || 0}`);
        
        if (qualityScore >= 80) {
          console.log(`   🎉 Excelente qualidade de dados!`);
        } else if (qualityScore >= 60) {
          console.log(`   👍 Boa qualidade de dados`);
        } else {
          console.log(`   ⚠️ Qualidade moderada`);
        }
      } else {
        console.log(`   ❌ Erro: ${response.status}`);
      }

      // Delay entre chamadas para evitar rate limiting
      await new Promise(resolve => setTimeout(resolve, 2000));
      
    } catch (error) {
      console.log(`   ❌ Erro: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  console.log('\n✅ Teste com múltiplos POIs concluído!');
}

// Função principal
async function main() {
  try {
    await testOSMEnrichmentAPI();
    await testMultiplePOIs();
  } catch (error) {
    console.error('❌ Erro no teste principal:', error);
  }
}

// Executar o teste
if (require.main === module) {
  main();
}
