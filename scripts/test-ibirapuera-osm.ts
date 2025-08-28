#!/usr/bin/env tsx

/**
 * Teste das APIs OSM para o Parque Ibirapuera em São Paulo
 * Demonstra as informações que podemos obter do OpenStreetMap
 */

// Coordenadas do Parque Ibirapuera
const PARQUE_IBIRAPUERA = {
  name: "Parque Ibirapuera",
  lat: -23.5874,
  lng: -46.6576,
  city: "São Paulo",
  country: "Brasil"
}

console.log('🌳 Testando APIs OSM para o Parque Ibirapuera')
console.log('📍 Coordenadas:', PARQUE_IBIRAPUERA.lat, PARQUE_IBIRAPUERA.lng)
console.log('')

// 1. Teste Nominatim API - Busca por nome
async function testNominatimSearch() {
  console.log('🔍 1. Testando Nominatim Search (busca por nome)...')
  
  try {
    const searchUrl = `https://nominatim.openstreetmap.org/search?` +
      `q=${encodeURIComponent(PARQUE_IBIRAPUERA.name + ' São Paulo')}&` +
      `format=json&` +
      `polygon_geojson=1&` +
      `addressdetails=1&` +
      `extratags=1&` +
      `limit=5&` +
      `bounded=1&` +
      `viewbox=${PARQUE_IBIRAPUERA.lng-0.01},${PARQUE_IBIRAPUERA.lat+0.01},${PARQUE_IBIRAPUERA.lng+0.01},${PARQUE_IBIRAPUERA.lat-0.01}`

    const response = await fetch(searchUrl, {
      headers: {
        'User-Agent': 'TuggiCMS/1.0 (test-ibirapuera)'
      }
    })

    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`)
    }

    const data = await response.json()
    
    console.log(`✅ Encontrados ${data.length} resultados`)
    
    if (data.length > 0) {
      const result = data[0]
      console.log('🏆 Melhor resultado:')
      console.log('   Nome:', result.display_name)
      console.log('   Tipo:', result.type)
      console.log('   Classe:', result.class)
      console.log('   Importância:', result.importance)
      console.log('   Tags:', result.tags)
      console.log('   Geometria:', result.geojson ? 'Disponível' : 'Não disponível')
      
      if (result.extratags) {
        console.log('   Tags Extras:', result.extratags)
      }
    }
    
    return data
  } catch (error) {
    console.error('❌ Erro na busca Nominatim:', error)
    return []
  }
}

// 2. Teste Reverse Geocoding - Busca por coordenadas
async function testReverseGeocoding() {
  console.log('\n🔍 2. Testando Reverse Geocoding (busca por coordenadas)...')
  
  try {
    const reverseUrl = `https://nominatim.openstreetmap.org/reverse?` +
      `lat=${PARQUE_IBIRAPUERA.lat}&` +
      `lon=${PARQUE_IBIRAPUERA.lng}&` +
      `format=json&` +
      `polygon_geojson=1&` +
      `addressdetails=1&` +
      `zoom=16`

    const response = await fetch(reverseUrl, {
      headers: {
        'User-Agent': 'TuggiCMS/1.0 (test-ibirapuera)'
      }
    })

    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`)
    }

    const data = await response.json()
    
    console.log('✅ Dados encontrados:')
    console.log('   Nome:', data.display_name)
    console.log('   Tipo:', data.type)
    console.log('   Classe:', data.class)
    console.log('   Endereço:', data.address)
    console.log('   Geometria:', data.geojson ? 'Disponível' : 'Não disponível')
    
    if (data.extratags) {
      console.log('   Tags Extras:', data.extratags)
    }
    
    return data
  } catch (error) {
    console.error('❌ Erro no reverse geocoding:', error)
    return null
  }
}

// 3. Teste Overpass API - Busca por features próximas
async function testOverpassAPI() {
  console.log('\n🔍 3. Testando Overpass API (features próximas)...')
  
  try {
    const overpassQuery = `[out:json][timeout:30];
    (
      // Parques e áreas verdes
      way[leisure=park](around:2000,${PARQUE_IBIRAPUERA.lat},${PARQUE_IBIRAPUERA.lng});
      relation[leisure=park](around:2000,${PARQUE_IBIRAPUERA.lat},${PARQUE_IBIRAPUERA.lng});
      
      // Áreas recreativas
      way[landuse=recreation_ground](around:2000,${PARQUE_IBIRAPUERA.lat},${PARQUE_IBIRAPUERA.lng});
      way[landuse=grass](around:2000,${PARQUE_IBIRAPUERA.lat},${PARQUE_IBIRAPUERA.lng});
      way[landuse=forest](around:2000,${PARQUE_IBIRAPUERA.lat},${PARQUE_IBIRAPUERA.lng});
      
      // Corpos d'água
      way[natural=water](around:2000,${PARQUE_IBIRAPUERA.lat},${PARQUE_IBIRAPUERA.lng});
      way[leisure=swimming_pool](around:2000,${PARQUE_IBIRAPUERA.lat},${PARQUE_IBIRAPUERA.lng});
      
      // Atrações turísticas
      way[tourism=attraction](around:2000,${PARQUE_IBIRAPUERA.lat},${PARQUE_IBIRAPUERA.lng});
      node[tourism=attraction](around:2000,${PARQUE_IBIRAPUERA.lat},${PARQUE_IBIRAPUERA.lng});
      
      // Viewpoints e mirantes
      node[tourism=viewpoint](around:2000,${PARQUE_IBIRAPUERA.lat},${PARQUE_IBIRAPUERA.lng});
      node[amenity=viewpoint](around:2000,${PARQUE_IBIRAPUERA.lat},${PARQUE_IBIRAPUERA.lng});
      
      // Edifícios e estruturas
      way[building](around:1000,${PARQUE_IBIRAPUERA.lat},${PARQUE_IBIRAPUERA.lng});
      node[historic](around:2000,${PARQUE_IBIRAPUERA.lat},${PARQUE_IBIRAPUERA.lng});
      
      // Vias de acesso
      way[highway](around:1000,${PARQUE_IBIRAPUERA.lat},${PARQUE_IBIRAPUERA.lng});
      node[amenity=parking](around:1000,${PARQUE_IBIRAPUERA.lat},${PARQUE_IBIRAPUERA.lng});
      
      // Nome específico do Ibirapuera
      way[name~"[Ii]birapuera"](around:3000,${PARQUE_IBIRAPUERA.lat},${PARQUE_IBIRAPUERA.lng});
      relation[name~"[Ii]birapuera"](around:3000,${PARQUE_IBIRAPUERA.lat},${PARQUE_IBIRAPUERA.lng});
      node[name~"[Ii]birapuera"](around:3000,${PARQUE_IBIRAPUERA.lat},${PARQUE_IBIRAPUERA.lng});
    );
    out geom;`

    const response = await fetch('https://overpass-api.de/api/interpreter', {
      method: 'POST',
      body: overpassQuery,
      headers: {
        'User-Agent': 'TuggiCMS/1.0 (test-ibirapuera)',
        'Content-Type': 'text/plain'
      }
    })

    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`)
    }

    const data = await response.json()
    
    console.log(`✅ Encontrados ${data.elements?.length || 0} elementos`)
    
    if (data.elements && data.elements.length > 0) {
      console.log('\n📊 Elementos encontrados:')
      
      // Agrupar por tipo
      const byType = data.elements.reduce((acc: any, element: any) => {
        const type = element.type
        if (!acc[type]) acc[type] = []
        acc[type].push(element)
        return acc
      }, {})
      
      Object.entries(byType).forEach(([type, elements]: [string, any]) => {
        console.log(`   ${type}: ${elements.length} elementos`)
        
        // Mostrar detalhes dos primeiros elementos de cada tipo
        elements.slice(0, 3).forEach((element: any, index: number) => {
          console.log(`     ${index + 1}. ${element.tags?.name || 'Sem nome'}`)
          console.log(`        Tags:`, element.tags)
          if (element.geometry) {
            console.log(`        Geometria: ${element.geometry.length} pontos`)
          }
        })
      })
    }
    
    return data
  } catch (error) {
    console.error('❌ Erro na busca Overpass:', error)
    return null
  }
}

// 4. Análise e síntese dos dados
function analyzeOSMData(nominatimData: any[], reverseData: any, overpassData: any) {
  console.log('\n📊 4. Análise e Síntese dos Dados OSM')
  console.log('=====================================')
  
  const analysis = {
    basicInfo: {
      name: 'Parque Ibirapuera',
      location: `${PARQUE_IBIRAPUERA.lat}, ${PARQUE_IBIRAPUERA.lng}`,
      city: PARQUE_IBIRAPUERA.city,
      country: PARQUE_IBIRAPUERA.country
    },
    osmData: {
      nominatimResults: nominatimData.length,
      reverseGeocoding: reverseData ? 'Sucesso' : 'Falha',
      overpassElements: overpassData?.elements?.length || 0
    },
    extractedInfo: {
      category: '',
      tags: {},
      geometry: null,
      elevation: null,
      access: [],
      nearbyFeatures: []
    }
  }
  
  // Extrair informações do Nominatim
  if (nominatimData.length > 0) {
    const bestMatch = nominatimData[0]
    analysis.extractedInfo.category = bestMatch.class
    analysis.extractedInfo.tags = bestMatch.tags || {}
    analysis.extractedInfo.geometry = bestMatch.geojson
  }
  
  // Extrair informações do Reverse Geocoding
  if (reverseData) {
    if (reverseData.extratags) {
      analysis.extractedInfo.tags = { ...analysis.extractedInfo.tags, ...reverseData.extratags }
    }
  }
  
  // Extrair informações do Overpass
  if (overpassData?.elements) {
    analysis.extractedInfo.nearbyFeatures = overpassData.elements
      .filter((el: any) => el.tags?.name)
      .map((el: any) => ({
        name: el.tags.name,
        type: el.type,
        tags: el.tags
      }))
  }
  
  console.log('📋 Informações Básicas:')
  console.log('   Nome:', analysis.basicInfo.name)
  console.log('   Localização:', analysis.basicInfo.location)
  console.log('   Cidade:', analysis.basicInfo.city)
  console.log('   País:', analysis.basicInfo.country)
  
  console.log('\n🗺️ Dados OSM Obtidos:')
  console.log('   Resultados Nominatim:', analysis.osmData.nominatimResults)
  console.log('   Reverse Geocoding:', analysis.osmData.reverseGeocoding)
  console.log('   Elementos Overpass:', analysis.osmData.overpassElements)
  
  console.log('\n🏷️ Tags e Categorização:')
  console.log('   Categoria:', analysis.extractedInfo.category)
  console.log('   Tags:', analysis.extractedInfo.tags)
  
  console.log('\n📍 Features Próximas:')
  analysis.extractedInfo.nearbyFeatures.slice(0, 10).forEach((feature: any, index: number) => {
    console.log(`   ${index + 1}. ${feature.name} (${feature.type})`)
  })
  
  return analysis
}

// 5. Simular dados que seriam salvos no banco
function simulateDatabaseFields(analysis: any) {
  console.log('\n💾 5. Campos que seriam salvos no banco de dados')
  console.log('================================================')
  
  const dbFields = {
    // Dados básicos (já existem)
    name: analysis.basicInfo.name,
    city: analysis.basicInfo.city,
    country: analysis.basicInfo.country,
    
    // Novos campos OSM
    osm_geometry: analysis.extractedInfo.geometry,
    osm_category: analysis.extractedInfo.category,
    osm_tags: analysis.extractedInfo.tags,
    osm_data_quality_score: 90, // Estimativa baseada na qualidade dos dados
    
    // Dados geográficos
    elevation_m: 760, // Elevação aproximada do Ibirapuera
    estimated_height_m: null, // Parque não tem altura específica
    osm_area_m2: 1580000, // Área aproximada do parque (1.58 km²)
    
    // Características
    heritage_status: 'municipal_park',
    architectural_style: 'modern',
    historical_period: '1950s',
    landmark_type: 'urban_park',
    
    // Acesso
    wheelchair_accessible: true,
    parking_capacity: 'large',
    public_transport: ['bus', 'metro'],
    access_points: ['main_entrance', 'secondary_entrances'],
    
    // Dados ambientais
    urban_density: 'mixed',
    noise_level: 'low',
    air_quality: 'good',
    shade_availability: 'full',
    
    // Scores de qualidade
    pov_quality_score: 85, // Bom para POVs
    visibility_score: 80, // Boa visibilidade
    accessibility_score: 90, // Muito acessível
    photogenic_score: 85, // Muito fotogênico
    
    // Dados culturais
    cultural_significance: 'high',
    local_traditions: ['recreation', 'sports', 'cultural_events'],
    seasonal_attractions: ['spring_bloom', 'summer_activities', 'autumn_colors'],
    
    // Metadados
    verification_status: 'pending',
    osm_last_updated: new Date().toISOString()
  }
  
  console.log('📝 Campos que seriam adicionados à tabela core.attractions:')
  Object.entries(dbFields).forEach(([field, value]) => {
    if (value !== null && value !== undefined) {
      console.log(`   ${field}:`, typeof value === 'object' ? JSON.stringify(value).substring(0, 100) + '...' : value)
    }
  })
  
  return dbFields
}

// Função principal
async function main() {
  console.log('🚀 Iniciando teste das APIs OSM para o Parque Ibirapuera\n')
  
  try {
    // Executar todos os testes
    const nominatimData = await testNominatimSearch()
    const reverseData = await testReverseGeocoding()
    const overpassData = await testOverpassAPI()
    
    // Analisar e sintetizar dados
    const analysis = analyzeOSMData(nominatimData, reverseData, overpassData)
    
    // Simular campos do banco
    const dbFields = simulateDatabaseFields(analysis)
    
    console.log('\n✅ Teste concluído com sucesso!')
    console.log('📊 Total de campos OSM que podem ser adicionados:', Object.keys(dbFields).length)
    
  } catch (error) {
    console.error('❌ Erro no teste:', error)
  }
}

// Executar o teste
main()
