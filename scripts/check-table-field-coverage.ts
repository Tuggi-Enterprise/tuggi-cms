#!/usr/bin/env tsx

/**
 * Script para verificar cobertura dos campos OSM baseado no schema real da tabela
 */

async function checkTableFieldCoverage() {
  console.log('🔍 VERIFICAÇÃO DE COBERTURA - SCHEMA REAL DA TABELA');
  console.log('==================================================\n');

  // Campos OSM da tabela real (extraídos do schema fornecido)
  const osmFieldsInTable = [
    // Campos OSM básicos
    'osm_category', 'osm_tags', 'osm_data_quality_score', 'osm_geometry', 'osm_last_updated',
    
    // Dados geográficos
    'elevation_m', 'estimated_height_m', 'osm_area_m2',
    
    // Heritage e cultural
    'heritage_status', 'architectural_style', 'historical_period', 'landmark_type', 'architect',
    'construction_status', 'completion_estimated_year',
    
    // UNESCO
    'unesco_status', 'unesco_inscription_date', 'unesco_reference', 'landmark_level', 'importance_level',
    
    // Acessibilidade
    'wheelchair_accessible', 'wheelchair_toilets', 'parking_capacity', 'public_transport', 'access_points',
    
    // Ambientais
    'urban_density', 'noise_level', 'air_quality', 'shade_availability',
    
    // Scores POV
    'pov_quality_score', 'visibility_score', 'accessibility_score', 'photogenic_score',
    
    // Culturais
    'cultural_significance', 'local_traditions', 'seasonal_attractions',
    
    // Específicos por tipo
    'museum_type', 'collection_focus', 'target_audience', 'educational_programs',
    'park_type', 'vegetation_type', 'water_features', 'sports_facilities', 'playground',
    'monument_type', 'commemorated_event', 'commemorated_person',
    
    // Características físicas
    'building_colour', 'roof_colour', 'building_material',
    
    // Metadados
    'verification_status', 'data_sources', 'osm_import_date'
  ];

  console.log(`📋 Total de campos OSM na tabela: ${osmFieldsInTable.length}\n`);

  // Testar com diferentes tipos de POI para ver variação
  const testPOIs = [
    { name: 'Cristo Redentor', city: 'Rio de Janeiro', country: 'Brazil', type: 'Monument' },
    { name: 'Museu de Arte de São Paulo', city: 'São Paulo', country: 'Brazil', type: 'Museum' },
    { name: 'Parque Ibirapuera', city: 'São Paulo', country: 'Brazil', type: 'Park' }
  ];

  const allResults: any[] = [];

  for (const poi of testPOIs) {
    console.log(`🧪 Testando: ${poi.name} (${poi.type})`);
    
    try {
      const response = await fetch('http://localhost:3000/api/pois/enrich-osm', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          poi_id: `550e8400-e29b-41d4-a716-${Date.now().toString().slice(-12)}`,
          name: poi.name,
          city: poi.city,
          country: poi.country
        })
      });

      const result = await response.json();
      
      if (result.success) {
        const filledFields = result.fields_updated || [];
        const coverage = ((filledFields.length / osmFieldsInTable.length) * 100).toFixed(1);
        
        console.log(`✅ Campos preenchidos: ${filledFields.length}/${osmFieldsInTable.length} (${coverage}%)`);
        
        allResults.push({
          name: poi.name,
          type: poi.type,
          filledFields,
          coverage: parseFloat(coverage)
        });
        
      } else {
        console.log(`❌ Falhou: ${result.message}`);
        allResults.push({
          name: poi.name,
          type: poi.type,
          filledFields: [],
          coverage: 0,
          error: result.message
        });
      }
      
    } catch (error) {
      console.error(`❌ Erro na requisição para "${poi.name}":`, error);
    }
    
    console.log(''); // Empty line
    await new Promise(resolve => setTimeout(resolve, 2000)); // Delay
  }

  // Análise consolidada
  console.log('\n📊 ANÁLISE CONSOLIDADA:');
  console.log('=======================\n');

  const allFilledFields = new Set();
  allResults.forEach(result => {
    if (result.filledFields) {
      result.filledFields.forEach((field: string) => allFilledFields.add(field));
    }
  });

  const totalFilledFields = Array.from(allFilledFields);
  const missingFields = osmFieldsInTable.filter(field => !allFilledFields.has(field));

  console.log(`✅ Campos preenchidos (pelo menos uma vez): ${totalFilledFields.length}/${osmFieldsInTable.length}`);
  console.log(`📊 Cobertura geral: ${((totalFilledFields.length / osmFieldsInTable.length) * 100).toFixed(1)}%\n`);

  console.log('❌ CAMPOS NUNCA PREENCHIDOS:');
  console.log('============================');
  missingFields.sort().forEach(field => {
    console.log(`❌ ${field}`);
  });

  // Categorizar campos faltando por importância
  const criticalMissing = missingFields.filter(f => 
    ['architect', 'building_material', 'wheelchair_accessible', 'parking_capacity', 
     'museum_type', 'park_type', 'monument_type', 'elevation_m', 'estimated_height_m'].includes(f)
  );

  const moderateMissing = missingFields.filter(f => 
    ['architectural_style', 'historical_period', 'construction_status', 'completion_estimated_year',
     'unesco_inscription_date', 'unesco_reference', 'access_points', 'public_transport'].includes(f)
  );

  const lowPriorityMissing = missingFields.filter(f => 
    !criticalMissing.includes(f) && !moderateMissing.includes(f)
  );

  console.log('\n🚨 PRIORIDADE DE IMPLEMENTAÇÃO:');
  console.log('===============================');
  
  if (criticalMissing.length > 0) {
    console.log(`\n🔴 CRÍTICOS (${criticalMissing.length} campos):`);
    criticalMissing.forEach(field => console.log(`  - ${field}`));
  }
  
  if (moderateMissing.length > 0) {
    console.log(`\n🟡 MODERADOS (${moderateMissing.length} campos):`);
    moderateMissing.forEach(field => console.log(`  - ${field}`));
  }
  
  if (lowPriorityMissing.length > 0) {
    console.log(`\n🟢 BAIXA PRIORIDADE (${lowPriorityMissing.length} campos):`);
    lowPriorityMissing.forEach(field => console.log(`  - ${field}`));
  }

  // Resumo por POI
  console.log('\n📈 COBERTURA POR POI:');
  console.log('====================');
  allResults.forEach(result => {
    if (!result.error) {
      console.log(`${result.name} (${result.type}): ${result.coverage}%`);
    }
  });
}

checkTableFieldCoverage().catch(console.error);
