#!/usr/bin/env tsx

/**
 * Script para analisar campos OSM que não temos na tabela mas que seriam valiosos
 */

async function analyzeMissingOSMFields() {
  console.log('🔍 ANÁLISE DE CAMPOS OSM VALIOSOS NÃO CAPTURADOS');
  console.log('==============================================\n');

  // Campos que já temos na tabela (OSM relacionados)
  const existingFields = [
    'osm_category', 'osm_tags', 'osm_data_quality_score', 'osm_geometry', 'osm_last_updated',
    'elevation_m', 'estimated_height_m', 'osm_area_m2',
    'heritage_status', 'architectural_style', 'historical_period', 'landmark_type', 'architect',
    'construction_status', 'completion_estimated_year',
    'unesco_status', 'unesco_inscription_date', 'unesco_reference', 'landmark_level', 'importance_level',
    'wheelchair_accessible', 'wheelchair_toilets', 'parking_capacity', 'public_transport', 'access_points',
    'urban_density', 'noise_level', 'air_quality', 'shade_availability',
    'pov_quality_score', 'visibility_score', 'accessibility_score', 'photogenic_score',
    'cultural_significance', 'local_traditions', 'seasonal_attractions',
    'museum_type', 'collection_focus', 'target_audience', 'educational_programs',
    'park_type', 'vegetation_type', 'water_features', 'sports_facilities', 'playground',
    'monument_type', 'commemorated_event', 'commemorated_person',
    'building_colour', 'roof_colour', 'building_material',
    'verification_status', 'data_sources', 'osm_import_date'
  ];

  // Testar POIs ricos em dados para ver que campos OSM temos disponíveis
  const testPOIs = [
    { name: 'Cristo Redentor', city: 'Rio de Janeiro', country: 'Brazil' },
    { name: 'MASP', city: 'São Paulo', country: 'Brazil' },
    { name: 'Parque Ibirapuera', city: 'São Paulo', country: 'Brazil' },
    { name: 'La Sagrada Familia', city: 'Barcelona', country: 'Spain' },
    { name: 'Estádio do Morumbi', city: 'São Paulo', country: 'Brazil' }
  ];

  const allOSMFields = new Set<string>();
  const fieldFrequency: { [key: string]: number } = {};
  const fieldExamples: { [key: string]: string[] } = {};

  for (const poi of testPOIs) {
    console.log(`🔍 Analisando: ${poi.name}`);
    
    try {
      // Buscar dados do Nominatim
      const nominatimUrl = `https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(poi.name)}&format=json&limit=1&addressdetails=1&extratags=1`;
      const nominatimResponse = await fetch(nominatimUrl);
      
      if (nominatimResponse.ok) {
        const nominatimData = await nominatimResponse.json();
        if (nominatimData[0]?.extratags) {
          const tags = nominatimData[0].extratags;
          
          Object.keys(tags).forEach(field => {
            allOSMFields.add(field);
            fieldFrequency[field] = (fieldFrequency[field] || 0) + 1;
            
            if (!fieldExamples[field]) fieldExamples[field] = [];
            if (fieldExamples[field].length < 3) {
              fieldExamples[field].push(`${poi.name}: ${tags[field]}`);
            }
          });
          
          // Também adicionar campos básicos
          ['class', 'type', 'importance', 'lat', 'lon', 'display_name'].forEach(field => {
            if (nominatimData[0][field]) {
              allOSMFields.add(field);
              fieldFrequency[field] = (fieldFrequency[field] || 0) + 1;
              
              if (!fieldExamples[field]) fieldExamples[field] = [];
              if (fieldExamples[field].length < 3) {
                fieldExamples[field].push(`${poi.name}: ${nominatimData[0][field]}`);
              }
            }
          });
        }
      }
      
    } catch (error) {
      console.warn(`⚠️ Erro ao buscar ${poi.name}:`, error);
    }
    
    await new Promise(resolve => setTimeout(resolve, 1000)); // Rate limiting
  }

  console.log(`\n📊 Total de campos OSM encontrados: ${allOSMFields.size}`);
  console.log(`📊 Campos existentes na tabela: ${existingFields.length}\n`);

  // Campos OSM que NÃO temos na tabela
  const missingFields = Array.from(allOSMFields).filter(field => {
    // Verificar se o campo não está mapeado de alguma forma
    return !existingFields.some(existing => 
      existing.includes(field) || 
      field.includes(existing.replace('_', ':')) ||
      field.includes(existing.replace('_', ''))
    );
  });

  console.log('🆕 CAMPOS OSM VALIOSOS QUE NÃO TEMOS NA TABELA:');
  console.log('==============================================');

  // Ordenar por frequência (mais comum primeiro)
  const sortedMissingFields = missingFields.sort((a, b) => 
    (fieldFrequency[b] || 0) - (fieldFrequency[a] || 0)
  );

  // Categorizar campos por importância
  const highValueFields = sortedMissingFields.filter(field => {
    const freq = fieldFrequency[field] || 0;
    const isImportant = ['wikidata', 'wikipedia', 'phone', 'email', 'website', 'opening_hours', 
                        'capacity', 'operator', 'owner', 'surface', 'access', 'fee', 'layer',
                        'tourism', 'amenity', 'leisure', 'historic', 'religion', 'denomination'].some(important => 
                          field.includes(important) || important.includes(field)
                        );
    return freq >= 2 || isImportant;
  });

  const mediumValueFields = sortedMissingFields.filter(field => {
    const freq = fieldFrequency[field] || 0;
    return freq === 1 && !highValueFields.includes(field);
  });

  console.log('\n🔴 ALTA PRIORIDADE (frequentes ou importantes):');
  highValueFields.forEach(field => {
    const freq = fieldFrequency[field] || 0;
    const examples = fieldExamples[field]?.slice(0, 2).join(', ') || '';
    console.log(`  📌 ${field} (${freq}x) - ${examples}`);
  });

  console.log('\n🟡 MÉDIA PRIORIDADE:');
  mediumValueFields.slice(0, 10).forEach(field => {
    const examples = fieldExamples[field]?.slice(0, 1).join('') || '';
    console.log(`  📌 ${field} (1x) - ${examples}`);
  });

  // Sugestões de novos campos para a tabela
  console.log('\n💡 SUGESTÕES DE NOVOS CAMPOS PARA A TABELA:');
  console.log('==========================================');

  const suggestedFields = [
    { field: 'osm_wikidata_id', type: 'text', reason: 'Link para Wikidata para dados estruturados' },
    { field: 'osm_wikipedia_url', type: 'text', reason: 'Link para Wikipedia para mais informações' },
    { field: 'contact_phone', type: 'text', reason: 'Telefone de contato (complementar ao Google)' },
    { field: 'contact_email', type: 'text', reason: 'Email de contato' },
    { field: 'operator_name', type: 'text', reason: 'Quem opera/administra o local' },
    { field: 'access_fee', type: 'text', reason: 'Se tem taxa de entrada (yes/no/valor)' },
    { field: 'surface_type', type: 'text', reason: 'Tipo de superfície (paved, grass, sand, etc.)' },
    { field: 'capacity_visitors', type: 'integer', reason: 'Capacidade máxima de visitantes' },
    { field: 'religion_type', type: 'text', reason: 'Para locais religiosos' },
    { field: 'historic_period', type: 'text', reason: 'Período histórico específico' }
  ];

  suggestedFields.forEach(suggestion => {
    console.log(`  🏗️  ${suggestion.field} (${suggestion.type}) - ${suggestion.reason}`);
  });

  console.log('\n📈 RESUMO:');
  console.log(`  • Campos OSM disponíveis: ${allOSMFields.size}`);
  console.log(`  • Campos já na tabela: ${existingFields.length}`);
  console.log(`  • Campos não capturados: ${missingFields.length}`);
  console.log(`  • Alta prioridade: ${highValueFields.length}`);
  console.log(`  • Campos sugeridos: ${suggestedFields.length}`);
}

analyzeMissingOSMFields().catch(console.error);
