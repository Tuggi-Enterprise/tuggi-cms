#!/usr/bin/env tsx

/**
 * Teste das APIs OSM para o Cristo Redentor no Rio de Janeiro
 * Demonstra as informações que podemos obter do OpenStreetMap
 */

// Coordenadas do Cristo Redentor
const CRISTO_REDENTOR = {
  name: "Cristo Redentor",
  lat: -22.9519,
  lng: -43.2105,
  city: "Rio de Janeiro",
  country: "Brasil"
}

console.log('🗽 Testando APIs OSM para o Cristo Redentor')
console.log('📍 Coordenadas:', CRISTO_REDENTOR.lat, CRISTO_REDENTOR.lng)
console.log('')

// 1. Teste Nominatim API - Busca por nome
async function testNominatimSearch() {
  console.log('🔍 1. Testando Nominatim Search (busca por nome)...')
  
  try {
    const searchUrl = `https://nominatim.openstreetmap.org/search?` +
      `q=${encodeURIComponent(CRISTO_REDENTOR.name + ' Rio de Janeiro')}&` +
      `format=json&` +
      `polygon_geojson=1&` +
      `addressdetails=1&` +
      `extratags=1&` +
      `limit=5&` +
      `bounded=1&` +
      `viewbox=${CRISTO_REDENTOR.lng-0.01},${CRISTO_REDENTOR.lat+0.01},${CRISTO_REDENTOR.lng+0.01},${CRISTO_REDENTOR.lat-0.01}`

    const response = await fetch(searchUrl, {
      headers: {
        'User-Agent': 'TuggiCMS/1.0 (test-cristo-redentor)'
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
      `lat=${CRISTO_REDENTOR.lat}&` +
      `lon=${CRISTO_REDENTOR.lng}&` +
      `format=json&` +
      `polygon_geojson=1&` +
      `addressdetails=1&` +
      `zoom=18`

    const response = await fetch(reverseUrl, {
      headers: {
        'User-Agent': 'TuggiCMS/1.0 (test-cristo-redentor)'
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
      // Atrações turísticas
      node["tourism"="attraction"](around:1000,${CRISTO_REDENTOR.lat},${CRISTO_REDENTOR.lng});
      way["tourism"="attraction"](around:1000,${CRISTO_REDENTOR.lat},${CRISTO_REDENTOR.lng});
      relation["tourism"="attraction"](around:1000,${CRISTO_REDENTOR.lat},${CRISTO_REDENTOR.lng});
      
      // Viewpoints e mirantes
      node["tourism"="viewpoint"](around:1000,${CRISTO_REDENTOR.lat},${CRISTO_REDENTOR.lng});
      node["amenity"="viewpoint"](around:1000,${CRISTO_REDENTOR.lat},${CRISTO_REDENTOR.lng});
      node["man_made"="observation_deck"](around:1000,${CRISTO_REDENTOR.lat},${CRISTO_REDENTOR.lng});
      
      // Características naturais
      node["natural"="peak"](around:1000,${CRISTO_REDENTOR.lat},${CRISTO_REDENTOR.lng});
      way["natural"="peak"](around:1000,${CRISTO_REDENTOR.lat},${CRISTO_REDENTOR.lng});
      
      // Edifícios e estruturas
      way["building"](around:500,${CRISTO_REDENTOR.lat},${CRISTO_REDENTOR.lng});
      node["historic"="monument"](around:1000,${CRISTO_REDENTOR.lat},${CRISTO_REDENTOR.lng});
      
      // Vias de acesso
      way["highway"](around:500,${CRISTO_REDENTOR.lat},${CRISTO_REDENTOR.lng});
      node["amenity"="parking"](around:500,${CRISTO_REDENTOR.lat},${CRISTO_REDENTOR.lng});
      
      // Nome específico do Cristo Redentor
      node["name"~"[Cc]risto [Rr]edentor"](around:2000,${CRISTO_REDENTOR.lat},${CRISTO_REDENTOR.lng});
      way["name"~"[Cc]risto [Rr]edentor"](around:2000,${CRISTO_REDENTOR.lat},${CRISTO_REDENTOR.lng});
      relation["name"~"[Cc]risto [Rr]edentor"](around:2000,${CRISTO_REDENTOR.lat},${CRISTO_REDENTOR.lng});
    );
    out geom;`

    const response = await fetch('https://overpass-api.de/api/interpreter', {
      method: 'POST',
      body: overpassQuery,
      headers: {
        'User-Agent': 'TuggiCMS/1.0 (test-cristo-redentor)',
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
      name: 'Cristo Redentor',
      location: `${CRISTO_REDENTOR.lat}, ${CRISTO_REDENTOR.lng}`,
      city: CRISTO_REDENTOR.city,
      country: CRISTO_REDENTOR.country
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
  analysis.extractedInfo.nearbyFeatures.slice(0, 5).forEach((feature: any, index: number) => {
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
    osm_data_quality_score: 85, // Estimativa baseada na qualidade dos dados
    
    // Dados geográficos
    elevation_m: analysis.extractedInfo.tags.ele || null,
    estimated_height_m: analysis.extractedInfo.tags.height || null,
    
    // Características
    heritage_status: analysis.extractedInfo.tags.heritage || null,
    architectural_style: analysis.extractedInfo.tags.architectural_style || null,
    historical_period: analysis.extractedInfo.tags.start_date || null,
    
    // Acesso
    wheelchair_accessible: analysis.extractedInfo.tags.wheelchair === 'yes',
    parking_capacity: analysis.extractedInfo.tags.capacity || null,
    
    // Dados ambientais
    urban_density: 'mixed', // Inferido da localização
    noise_level: 'moderate', // Estimativa
    
    // Scores de qualidade
    pov_quality_score: 95, // Excelente para POVs
    visibility_score: 90, // Muito visível
    accessibility_score: 75, // Moderadamente acessível
    photogenic_score: 100, // Extremamente fotogênico
    
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
  console.log('🚀 Iniciando teste das APIs OSM para o Cristo Redentor\n')
  
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
