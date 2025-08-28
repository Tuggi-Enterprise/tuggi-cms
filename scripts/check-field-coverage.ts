#!/usr/bin/env tsx

/**
 * Script para verificar quais campos OSM estão sendo preenchidos vs schema definido
 */

async function checkFieldCoverage() {
  console.log('🔍 VERIFICAÇÃO DE COBERTURA DOS CAMPOS OSM');
  console.log('==========================================\n');

  // Campos definidos no schema
  const schemaFields = [
    // Básicos OSM
    'osm_category', 'osm_tags', 'osm_data_quality_score', 'osm_geometry', 'osm_last_updated',
    
    // Geográficos
    'elevation_m', 'estimated_height_m', 'osm_area_m2',
    
    // Arquitetônicos/Históricos
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
    
    // Físicos
    'building_colour', 'roof_colour', 'building_material',
    
    // Metadados
    'verification_status', 'data_sources', 'osm_import_date'
  ];

  console.log(`📋 Total de campos no schema: ${schemaFields.length}\n`);

  // Testar com um POI rico em dados
  const testPOI = {
    name: 'Cristo Redentor',
    city: 'Rio de Janeiro',
    country: 'Brazil'
  };

  console.log(`🧪 Testando com: ${testPOI.name}\n`);

  try {
    const response = await fetch('http://localhost:3000/api/pois/enrich-osm', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        poi_id: `550e8400-e29b-41d4-a716-${Date.now().toString().slice(-12)}`,
        name: testPOI.name,
        city: testPOI.city,
        country: testPOI.country
      })
    });

    const result = await response.json();
    
    if (result.success) {
      const filledFields = result.fields_updated || [];
      const missingFields = schemaFields.filter(field => !filledFields.includes(field));
      
      console.log(`✅ Campos preenchidos: ${filledFields.length}/${schemaFields.length}`);
      console.log(`📊 Cobertura: ${((filledFields.length / schemaFields.length) * 100).toFixed(1)}%\n`);
      
      console.log('📈 CAMPOS PREENCHIDOS:');
      console.log('======================');
      filledFields.sort().forEach(field => {
        console.log(`✅ ${field}`);
      });
      
      console.log('\n❌ CAMPOS FALTANDO:');
      console.log('===================');
      missingFields.sort().forEach(field => {
        console.log(`❌ ${field}`);
      });
      
      // Categorizar campos faltando
      const missingByCategory = {
        'Arquitetônicos/Históricos': missingFields.filter(f => 
          ['architectural_style', 'historical_period', 'construction_status', 'completion_estimated_year'].includes(f)
        ),
        'UNESCO específicos': missingFields.filter(f => 
          ['unesco_inscription_date', 'unesco_reference'].includes(f)
        ),
        'Específicos por tipo': missingFields.filter(f => 
          ['collection_focus', 'target_audience', 'educational_programs', 'vegetation_type', 'water_features', 
           'sports_facilities', 'playground', 'commemorated_event', 'commemorated_person'].includes(f)
        ),
        'Outros': missingFields.filter(f => 
          !['architectural_style', 'historical_period', 'construction_status', 'completion_estimated_year',
            'unesco_inscription_date', 'unesco_reference', 'collection_focus', 'target_audience', 
            'educational_programs', 'vegetation_type', 'water_features', 'sports_facilities', 
            'playground', 'commemorated_event', 'commemorated_person'].includes(f)
        )
      };
      
      console.log('\n📊 CAMPOS FALTANDO POR CATEGORIA:');
      console.log('=================================');
      Object.entries(missingByCategory).forEach(([category, fields]) => {
        if (fields.length > 0) {
          console.log(`\n${category}: ${fields.length} campos`);
          fields.forEach(field => console.log(`  - ${field}`));
        }
      });
      
    } else {
      console.log(`❌ Erro no teste: ${result.message}`);
    }
    
  } catch (error) {
    console.error(`❌ Erro na requisição:`, error);
  }
}

// Executar a verificação
checkFieldCoverage().catch(console.error);
