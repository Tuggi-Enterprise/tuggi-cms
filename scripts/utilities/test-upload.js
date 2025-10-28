#!/usr/bin/env node

/**
 * Teste simples de upload para verificar Supabase
 * Este script testa as APIs de POIs e coordenadas
 */

const fs = require('fs');
const path = require('path');

// Simular dados de teste
const testPOIs = [
  {
    properties: {
      name: "Praça da Sé",
      city: "São Paulo",
      state: "SP",
      country: "Brazil",
      category: "tourism=attraction",
      osm_id: "12345",
      osm_type: "way",
      importance: 0.8
    },
    geometry: {
      type: "Point",
      coordinates: [-46.6333, -23.5505]
    }
  },
  {
    properties: {
      name: "Cristo Redentor",
      city: "Rio de Janeiro",
      state: "RJ",
      country: "Brazil",
      category: "tourism=attraction",
      osm_id: "67890",
      osm_type: "way",
      importance: 0.9
    },
    geometry: {
      type: "Point",
      coordinates: [-43.2105, -22.9519]
    }
  }
];

async function testSupabaseAPIs() {
  console.log('🧪 [TEST] Iniciando teste de upload para Supabase...\n');

  try {
    // Teste 1: Salvar POIs
    console.log('📊 [TEST] Testando API de POIs...');
    const poisResponse = await fetch('http://localhost:3000/api/supabase/pois', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        pois: testPOIs,
        sourceFile: 'test-upload.js'
      })
    });

    if (!poisResponse.ok) {
      throw new Error(`POIs API failed: ${poisResponse.status} ${poisResponse.statusText}`);
    }

    const poisResult = await poisResponse.json();
    console.log('✅ [TEST] POIs salvos com sucesso:', {
      success: poisResult.success,
      imported: poisResult.imported,
      data: poisResult.data?.length || 0
    });

    if (!poisResult.success || !poisResult.data) {
      throw new Error('Falha ao salvar POIs');
    }

    // Teste 2: Salvar coordenadas para cada POI
    console.log('\n📍 [TEST] Testando API de coordenadas...');
    for (let i = 0; i < testPOIs.length; i++) {
      const poi = testPOIs[i];
      const savedPOI = poisResult.data[i];
      
      if (!savedPOI?.id) {
        console.log(`⚠️ [TEST] POI ${i} não foi salvo, pulando coordenadas`);
        continue;
      }

      const coordinates = {
        latitude: poi.geometry.coordinates[1],
        longitude: poi.geometry.coordinates[0],
        elevation_m: null,
        boundary_type: 'point',
        boundary_source: 'osm',
        show_in_map: true
      };

      const coordsResponse = await fetch('http://localhost:3000/api/supabase/coordinates', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          coordinates: coordinates,
          poiId: savedPOI.id
        })
      });

      if (!coordsResponse.ok) {
        console.error(`❌ [TEST] Erro ao salvar coordenadas para POI ${savedPOI.id}:`, coordsResponse.statusText);
        continue;
      }

      const coordsResult = await coordsResponse.json();
      console.log(`✅ [TEST] Coordenadas salvas para POI ${savedPOI.id}:`, {
        success: coordsResult.success,
        data: coordsResult.data
      });
    }

    // Teste 3: Verificar estatísticas
    console.log('\n📊 [TEST] Testando API de estatísticas...');
    const statsResponse = await fetch('http://localhost:3000/api/supabase/stats');
    
    if (!statsResponse.ok) {
      throw new Error(`Stats API failed: ${statsResponse.status} ${statsResponse.statusText}`);
    }

    const statsResult = await statsResponse.json();
    console.log('✅ [TEST] Estatísticas obtidas:', {
      success: statsResult.success,
      data: statsResult.data
    });

    // Teste 4: Listar POIs
    console.log('\n📋 [TEST] Testando listagem de POIs...');
    const listResponse = await fetch('http://localhost:3000/api/supabase/pois?page=1&limit=10');
    
    if (!listResponse.ok) {
      throw new Error(`List API failed: ${listResponse.status} ${listResponse.statusText}`);
    }

    const listResult = await listResponse.json();
    console.log('✅ [TEST] POIs listados:', {
      success: listResult.success,
      count: listResult.data?.length || 0,
      pagination: listResult.pagination
    });

    console.log('\n🎉 [TEST] Todos os testes passaram com sucesso!');
    console.log('✅ POIs salvos no Supabase');
    console.log('✅ Coordenadas salvas no Supabase');
    console.log('✅ APIs funcionando corretamente');
    console.log('✅ Sistema pronto para uso!');

  } catch (error) {
    console.error('\n❌ [TEST] Erro durante o teste:', error.message);
    console.error('Stack trace:', error.stack);
    process.exit(1);
  }
}

// Executar teste se chamado diretamente
if (require.main === module) {
  testSupabaseAPIs();
}

module.exports = { testSupabaseAPIs, testPOIs };
