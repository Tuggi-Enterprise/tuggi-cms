#!/usr/bin/env tsx

/**
 * Teste das APIs OSM para a Sagrada Família em Barcelona
 * Demonstra as informações que podemos obter do OpenStreetMap para monumentos internacionais
 */

// Coordenadas da Sagrada Família
const SAGRADA_FAMILIA = {
  name: "Sagrada Família",
  fullName: "Basílica de la Sagrada Família",
  lat: 41.4036,
  lng: 2.1744,
  city: "Barcelona",
  country: "España",
  region: "Cataluña"
}

console.log('⛪ Testando APIs OSM para a Sagrada Família')
console.log('📍 Coordenadas:', SAGRADA_FAMILIA.lat, SAGRADA_FAMILIA.lng)
console.log('🏙️ Cidade:', SAGRADA_FAMILIA.city)
console.log('🇪🇸 País:', SAGRADA_FAMILIA.country)
console.log('')

// 1. Teste Nominatim API - Busca por nome
async function testNominatimSearch() {
  console.log('🔍 1. Testando Nominatim Search (busca por nome)...')
  
  try {
    const searchUrl = `https://nominatim.openstreetmap.org/search?` +
      `q=${encodeURIComponent(SAGRADA_FAMILIA.fullName + ' Barcelona')}&` +
      `format=json&` +
      `polygon_geojson=1&` +
      `addressdetails=1&` +
      `extratags=1&` +
      `limit=5&` +
      `bounded=1&` +
      `viewbox=${SAGRADA_FAMILIA.lng-0.01},${SAGRADA_FAMILIA.lat+0.01},${SAGRADA_FAMILIA.lng+0.01},${SAGRADA_FAMILIA.lat-0.01}`

    const response = await fetch(searchUrl, {
      headers: {
        'User-Agent': 'TuggiCMS/1.0 (test-sagrada-familia)'
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
    } else {
      console.log('⚠️ Nenhum resultado encontrado para o nome exato')
      console.log('🔍 Tentando busca mais ampla...')
      
      // Busca mais ampla
      const broadSearchUrl = `https://nominatim.openstreetmap.org/search?` +
        `q=${encodeURIComponent('sagrada familia barcelona')}&` +
        `format=json&` +
        `polygon_geojson=1&` +
        `addressdetails=1&` +
        `extratags=1&` +
        `limit=10&` +
        `bounded=1&` +
        `viewbox=${SAGRADA_FAMILIA.lng-0.05},${SAGRADA_FAMILIA.lat+0.05},${SAGRADA_FAMILIA.lng+0.05},${SAGRADA_FAMILIA.lat-0.05}`

      const broadResponse = await fetch(broadSearchUrl, {
        headers: {
          'User-Agent': 'TuggiCMS/1.0 (test-sagrada-familia-broad)'
        }
      })

      if (broadResponse.ok) {
        const broadData = await broadResponse.json()
        console.log(`🔍 Busca ampla: ${broadData.length} resultados`)
        
        broadData.slice(0, 3).forEach((item: any, index: number) => {
          console.log(`   ${index + 1}. ${item.display_name}`)
          console.log(`      Tipo: ${item.type}, Classe: ${item.class}`)
        })
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
      `lat=${SAGRADA_FAMILIA.lat}&` +
      `lon=${SAGRADA_FAMILIA.lng}&` +
      `format=json&` +
      `polygon_geojson=1&` +
      `addressdetails=1&` +
      `zoom=18`

    const response = await fetch(reverseUrl, {
      headers: {
        'User-Agent': 'TuggiCMS/1.0 (test-sagrada-familia)'
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
      // Igrejas e basílicas
      node[amenity=place_of_worship](around:1000,${SAGRADA_FAMILIA.lat},${SAGRADA_FAMILIA.lng});
      way[amenity=place_of_worship](around:1000,${SAGRADA_FAMILIA.lat},${SAGRADA_FAMILIA.lng});
      relation[amenity=place_of_worship](around:1000,${SAGRADA_FAMILIA.lat},${SAGRADA_FAMILIA.lng});
      
      // Atrações turísticas
      node[tourism=attraction](around:1000,${SAGRADA_FAMILIA.lat},${SAGRADA_FAMILIA.lng});
      way[tourism=attraction](around:1000,${SAGRADA_FAMILIA.lat},${SAGRADA_FAMILIA.lng});
      
      // Edifícios históricos
      node[historic](around:1000,${SAGRADA_FAMILIA.lat},${SAGRADA_FAMILIA.lng});
      way[historic](around:1000,${SAGRADA_FAMILIA.lat},${SAGRADA_FAMILIA.lng});
      
      // Edifícios e estruturas
      way[building](around:500,${SAGRADA_FAMILIA.lat},${SAGRADA_FAMILIA.lng});
      node[building](around:500,${SAGRADA_FAMILIA.lat},${SAGRADA_FAMILIA.lng});
      
      // Vias de acesso
      way[highway](around:500,${SAGRADA_FAMILIA.lat},${SAGRADA_FAMILIA.lng});
      node[amenity=parking](around:500,${SAGRADA_FAMILIA.lat},${SAGRADA_FAMILIA.lng});
      
      // Transporte público
      node[public_transport](around:500,${SAGRADA_FAMILIA.lat},${SAGRADA_FAMILIA.lng});
      node[railway=station](around:1000,${SAGRADA_FAMILIA.lat},${SAGRADA_FAMILIA.lng});
      
      // Nome específico da Sagrada Família
      node[name~"[Ss]agrada.*[Ff]amilia"](around:2000,${SAGRADA_FAMILIA.lat},${SAGRADA_FAMILIA.lng});
      way[name~"[Ss]agrada.*[Ff]amilia"](around:2000,${SAGRADA_FAMILIA.lat},${SAGRADA_FAMILIA.lng});
      relation[name~"[Ss]agrada.*[Ff]amilia"](around:2000,${SAGRADA_FAMILIA.lat},${SAGRADA_FAMILIA.lng});
      
      // Igrejas e basílicas
      node[name~"[Ii]glesia"](around:2000,${SAGRADA_FAMILIA.lat},${SAGRADA_FAMILIA.lng});
      way[name~"[Ii]glesia"](around:2000,${SAGRADA_FAMILIA.lat},${SAGRADA_FAMILIA.lng});
      
      // Gaudí
      node[name~"[Gg]audí"](around:3000,${SAGRADA_FAMILIA.lat},${SAGRADA_FAMILIA.lng});
      way[name~"[Gg]audí"](around:3000,${SAGRADA_FAMILIA.lat},${SAGRADA_FAMILIA.lng});
    );
    out geom;`

    const response = await fetch('https://overpass-api.de/api/interpreter', {
      method: 'POST',
      body: overpassQuery,
      headers: {
        'User-Agent': 'TuggiCMS/1.0 (test-sagrada-familia)',
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
      name: SAGRADA_FAMILIA.fullName,
      shortName: SAGRADA_FAMILIA.name,
      location: `${SAGRADA_FAMILIA.lat}, ${SAGRADA_FAMILIA.lng}`,
      city: SAGRADA_FAMILIA.city,
      country: SAGRADA_FAMILIA.country,
      region: SAGRADA_FAMILIA.region
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
  console.log('   Nome completo:', analysis.basicInfo.name)
  console.log('   Nome abreviado:', analysis.basicInfo.shortName)
  console.log('   Localização:', analysis.basicInfo.location)
  console.log('   Cidade:', analysis.basicInfo.city)
  console.log('   País:', analysis.basicInfo.country)
  console.log('   Região:', analysis.basicInfo.region)
  
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
    region: analysis.basicInfo.region,
    
    // Novos campos OSM
    osm_geometry: analysis.extractedInfo.geometry,
    osm_category: analysis.extractedInfo.category,
    osm_tags: analysis.extractedInfo.tags,
    osm_data_quality_score: 95, // Estimativa baseada na qualidade dos dados
    
    // Dados geográficos
    elevation_m: 12, // Elevação aproximada de Barcelona
    estimated_height_m: 172, // Altura aproximada da Sagrada Família
    osm_area_m2: 15000, // Área aproximada da basílica
    
    // Características
    heritage_status: 'unesco_world_heritage',
    architectural_style: 'modernisme',
    historical_period: '1880s-present',
    landmark_type: 'basilica',
    
    // Acesso
    wheelchair_accessible: true,
    parking_capacity: 'large',
    public_transport: ['metro', 'bus', 'train'],
    access_points: ['main_entrance', 'nativity_facade', 'passion_facade', 'glory_facade'],
    
    // Dados ambientais
    urban_density: 'dense',
    noise_level: 'moderate',
    air_quality: 'good',
    shade_availability: 'partial',
    
    // Scores de qualidade
    pov_quality_score: 100, // Excelente para POVs
    visibility_score: 95, // Muito visível
    accessibility_score: 85, // Muito acessível
    photogenic_score: 100, // Extremamente fotogênico
    
    // Dados culturais
    cultural_significance: 'very_high',
    local_traditions: ['catholic_worship', 'architectural_tourism', 'cultural_heritage'],
    seasonal_attractions: ['christmas_services', 'easter_celebrations', 'architectural_tours'],
    
    // Informações específicas
    architect: 'Antoni Gaudí',
    construction_status: 'under_construction',
    completion_estimated: '2026',
    unesco_status: 'world_heritage_site',
    
    // Metadados
    verification_status: 'verified',
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

// 6. Análise específica para monumentos internacionais
function analyzeInternationalMonumentCharacteristics() {
  console.log('\n🏛️ 6. Análise de Monumentos Internacionais')
  console.log('============================================')
  
  const characteristics = {
    // Características típicas
    typicalFeatures: [
      'Patrimônio Mundial UNESCO',
      'Arquitetura icônica',
      'Turismo internacional',
      'Significado religioso e cultural',
      'Construção histórica',
      'Visitas guiadas multilíngue'
    ],
    
    // Vantagens
    advantages: [
      'Dados OSM muito detalhados',
      'Informações turísticas completas',
      'Múltiplos idiomas',
      'Infraestrutura turística desenvolvida',
      'Acessibilidade internacional',
      'Recursos tecnológicos avançados'
    ],
    
    // Oportunidades
    opportunities: [
      'Experiência cultural única',
      'Fotografia arquitetônica',
      'Educação histórica e artística',
      'Turismo religioso',
      'Pesquisa acadêmica',
      'Eventos culturais internacionais'
    ],
    
    // Dados OSM esperados
    expectedOSMData: [
      'Informações detalhadas de localização',
      'Horários de funcionamento',
      'Informações de contato oficiais',
      'Dados arquitetônicos precisos',
      'Informações de acessibilidade',
      'Dados turísticos completos'
    ]
  }
  
  console.log('📋 Características Típicas:')
  characteristics.typicalFeatures.forEach((feature, index) => {
    console.log(`   ${index + 1}. ${feature}`)
  })
  
  console.log('\n✅ Vantagens:')
  characteristics.advantages.forEach((advantage, index) => {
    console.log(`   ${index + 1}. ${advantage}`)
  })
  
  console.log('\n🎯 Oportunidades:')
  characteristics.opportunities.forEach((opportunity, index) => {
    console.log(`   ${index + 1}. ${opportunity}`)
  })
  
  console.log('\n📊 Dados OSM Esperados:')
  characteristics.expectedOSMData.forEach((data, index) => {
    console.log(`   ${index + 1}. ${data}`)
  })
  
  return characteristics
}

// Função principal
async function main() {
  console.log('🚀 Iniciando teste das APIs OSM para a Sagrada Família\n')
  
  try {
    // Executar todos os testes
    const nominatimData = await testNominatimSearch()
    const reverseData = await testReverseGeocoding()
    const overpassData = await testOverpassAPI()
    
    // Analisar e sintetizar dados
    const analysis = analyzeOSMData(nominatimData, reverseData, overpassData)
    
    // Simular campos do banco
    const dbFields = simulateDatabaseFields(analysis)
    
    // Análise específica para monumentos internacionais
    const characteristics = analyzeInternationalMonumentCharacteristics()
    
    console.log('\n✅ Teste concluído com sucesso!')
    console.log('📊 Total de campos OSM que podem ser adicionados:', Object.keys(dbFields).length)
    console.log('🏛️ Tipo de monumento: Internacional/Patrimônio Mundial')
    console.log('📍 Localização: Barcelona, Espanha')
    
  } catch (error) {
    console.error('❌ Erro no teste:', error)
  }
}

// Executar o teste
main()
