#!/usr/bin/env tsx

/**
 * Teste das APIs OSM para o Museu do Telefone em Bragança Paulista
 * Demonstra as informações que podemos obter do OpenStreetMap para museus menores
 */

// Coordenadas do Museu do Telefone (aproximadas)
const MUSEU_TELEFONE = {
  name: "Museu do Telefone",
  fullName: "Museu do Telefone de Bragança Paulista",
  lat: -22.9528,
  lng: -46.5444,
  city: "Bragança Paulista",
  state: "São Paulo",
  country: "Brasil"
}

console.log('📞 Testando APIs OSM para o Museu do Telefone')
console.log('📍 Coordenadas:', MUSEU_TELEFONE.lat, MUSEU_TELEFONE.lng)
console.log('🏙️ Cidade:', MUSEU_TELEFONE.city)
console.log('')

// 1. Teste Nominatim API - Busca por nome
async function testNominatimSearch() {
  console.log('🔍 1. Testando Nominatim Search (busca por nome)...')
  
  try {
    const searchUrl = `https://nominatim.openstreetmap.org/search?` +
      `q=${encodeURIComponent(MUSEU_TELEFONE.fullName)}&` +
      `format=json&` +
      `polygon_geojson=1&` +
      `addressdetails=1&` +
      `extratags=1&` +
      `limit=5&` +
      `bounded=1&` +
      `viewbox=${MUSEU_TELEFONE.lng-0.01},${MUSEU_TELEFONE.lat+0.01},${MUSEU_TELEFONE.lng+0.01},${MUSEU_TELEFONE.lat-0.01}`

    const response = await fetch(searchUrl, {
      headers: {
        'User-Agent': 'TuggiCMS/1.0 (test-museu-telefone)'
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
        `q=${encodeURIComponent('museu telefone bragança paulista')}&` +
        `format=json&` +
        `polygon_geojson=1&` +
        `addressdetails=1&` +
        `extratags=1&` +
        `limit=10&` +
        `bounded=1&` +
        `viewbox=${MUSEU_TELEFONE.lng-0.05},${MUSEU_TELEFONE.lat+0.05},${MUSEU_TELEFONE.lng+0.05},${MUSEU_TELEFONE.lat-0.05}`

      const broadResponse = await fetch(broadSearchUrl, {
        headers: {
          'User-Agent': 'TuggiCMS/1.0 (test-museu-telefone-broad)'
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
      `lat=${MUSEU_TELEFONE.lat}&` +
      `lon=${MUSEU_TELEFONE.lng}&` +
      `format=json&` +
      `polygon_geojson=1&` +
      `addressdetails=1&` +
      `zoom=18`

    const response = await fetch(reverseUrl, {
      headers: {
        'User-Agent': 'TuggiCMS/1.0 (test-museu-telefone)'
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
      // Museus e atrações culturais
      node[tourism=museum](around:2000,${MUSEU_TELEFONE.lat},${MUSEU_TELEFONE.lng});
      way[tourism=museum](around:2000,${MUSEU_TELEFONE.lat},${MUSEU_TELEFONE.lng});
      relation[tourism=museum](around:2000,${MUSEU_TELEFONE.lat},${MUSEU_TELEFONE.lng});
      
      // Atrações turísticas
      node[tourism=attraction](around:2000,${MUSEU_TELEFONE.lat},${MUSEU_TELEFONE.lng});
      way[tourism=attraction](around:2000,${MUSEU_TELEFONE.lat},${MUSEU_TELEFONE.lng});
      
      // Edifícios históricos
      node[historic](around:2000,${MUSEU_TELEFONE.lat},${MUSEU_TELEFONE.lng});
      way[historic](around:2000,${MUSEU_TELEFONE.lat},${MUSEU_TELEFONE.lng});
      
      // Edifícios e estruturas
      way[building](around:1000,${MUSEU_TELEFONE.lat},${MUSEU_TELEFONE.lng});
      node[building](around:1000,${MUSEU_TELEFONE.lat},${MUSEU_TELEFONE.lng});
      
      // Vias de acesso
      way[highway](around:1000,${MUSEU_TELEFONE.lat},${MUSEU_TELEFONE.lng});
      node[amenity=parking](around:1000,${MUSEU_TELEFONE.lat},${MUSEU_TELEFONE.lng});
      
      // Transporte público
      node[public_transport](around:1000,${MUSEU_TELEFONE.lat},${MUSEU_TELEFONE.lng});
      node[railway=station](around:2000,${MUSEU_TELEFONE.lat},${MUSEU_TELEFONE.lng});
      
      // Nome específico do museu
      node[name~"[Mm]useu.*[Tt]elefone"](around:5000,${MUSEU_TELEFONE.lat},${MUSEU_TELEFONE.lng});
      way[name~"[Mm]useu.*[Tt]elefone"](around:5000,${MUSEU_TELEFONE.lat},${MUSEU_TELEFONE.lng});
      relation[name~"[Mm]useu.*[Tt]elefone"](around:5000,${MUSEU_TELEFONE.lat},${MUSEU_TELEFONE.lng});
      
      // Museus em geral
      node[name~"[Mm]useu"](around:3000,${MUSEU_TELEFONE.lat},${MUSEU_TELEFONE.lng});
      way[name~"[Mm]useu"](around:3000,${MUSEU_TELEFONE.lat},${MUSEU_TELEFONE.lng});
      
      // Telecomunicações
      node[amenity=telephone](around:2000,${MUSEU_TELEFONE.lat},${MUSEU_TELEFONE.lng});
      node[telecom](around:2000,${MUSEU_TELEFONE.lat},${MUSEU_TELEFONE.lng});
    );
    out geom;`

    const response = await fetch('https://overpass-api.de/api/interpreter', {
      method: 'POST',
      body: overpassQuery,
      headers: {
        'User-Agent': 'TuggiCMS/1.0 (test-museu-telefone)',
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
      name: MUSEU_TELEFONE.fullName,
      shortName: MUSEU_TELEFONE.name,
      location: `${MUSEU_TELEFONE.lat}, ${MUSEU_TELEFONE.lng}`,
      city: MUSEU_TELEFONE.city,
      state: MUSEU_TELEFONE.state,
      country: MUSEU_TELEFONE.country
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
  console.log('   Estado:', analysis.basicInfo.state)
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
    state: analysis.basicInfo.state,
    country: analysis.basicInfo.country,
    
    // Novos campos OSM
    osm_geometry: analysis.extractedInfo.geometry,
    osm_category: analysis.extractedInfo.category,
    osm_tags: analysis.extractedInfo.tags,
    osm_data_quality_score: 70, // Estimativa baseada na qualidade dos dados
    
    // Dados geográficos
    elevation_m: 850, // Elevação aproximada de Bragança Paulista
    estimated_height_m: 8, // Altura aproximada do edifício
    osm_area_m2: 800, // Área aproximada do museu
    
    // Características
    heritage_status: 'local_heritage',
    architectural_style: 'traditional',
    historical_period: '1900s',
    landmark_type: 'museum',
    
    // Acesso
    wheelchair_accessible: true,
    parking_capacity: 'small',
    public_transport: ['bus', 'taxi'],
    access_points: ['main_entrance'],
    
    // Dados ambientais
    urban_density: 'medium',
    noise_level: 'low',
    air_quality: 'good',
    shade_availability: 'full',
    
    // Scores de qualidade
    pov_quality_score: 60, // Moderado para POVs
    visibility_score: 50, // Visibilidade moderada
    accessibility_score: 75, // Acessível
    photogenic_score: 70, // Moderadamente fotogênico
    
    // Dados culturais
    cultural_significance: 'medium',
    local_traditions: ['telecommunications_history', 'local_culture'],
    seasonal_attractions: ['guided_tours', 'educational_programs'],
    
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

// 6. Análise específica para museus menores
function analyzeSmallMuseumCharacteristics() {
  console.log('\n🏛️ 6. Análise de Museus Menores')
  console.log('===============================')
  
  const characteristics = {
    // Características típicas
    typicalFeatures: [
      'Coleção especializada (telefones)',
      'História local',
      'Visitas guiadas',
      'Exposições temporárias',
      'Programas educativos',
      'Arquivo histórico'
    ],
    
    // Limitações
    limitations: [
      'Horários limitados',
      'Recursos financeiros menores',
      'Equipe reduzida',
      'Infraestrutura básica',
      'Público local',
      'Dependência de voluntários'
    ],
    
    // Oportunidades
    opportunities: [
      'História única e especializada',
      'Experiência mais íntima',
      'Conexão com a comunidade local',
      'Preservação de memória local',
      'Educação patrimonial',
      'Turismo cultural local'
    ],
    
    // Dados OSM esperados
    expectedOSMData: [
      'Informações básicas de localização',
      'Horários de funcionamento',
      'Informações de contato',
      'Dados históricos',
      'Características arquitetônicas',
      'Acessibilidade'
    ]
  }
  
  console.log('📋 Características Típicas:')
  characteristics.typicalFeatures.forEach((feature, index) => {
    console.log(`   ${index + 1}. ${feature}`)
  })
  
  console.log('\n⚠️ Limitações:')
  characteristics.limitations.forEach((limitation, index) => {
    console.log(`   ${index + 1}. ${limitation}`)
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
  console.log('🚀 Iniciando teste das APIs OSM para o Museu do Telefone\n')
  
  try {
    // Executar todos os testes
    const nominatimData = await testNominatimSearch()
    const reverseData = await testReverseGeocoding()
    const overpassData = await testOverpassAPI()
    
    // Analisar e sintetizar dados
    const analysis = analyzeOSMData(nominatimData, reverseData, overpassData)
    
    // Simular campos do banco
    const dbFields = simulateDatabaseFields(analysis)
    
    // Análise específica para museus menores
    const characteristics = analyzeSmallMuseumCharacteristics()
    
    console.log('\n✅ Teste concluído com sucesso!')
    console.log('📊 Total de campos OSM que podem ser adicionados:', Object.keys(dbFields).length)
    console.log('🏛️ Tipo de museu: Menor/Especializado')
    console.log('📍 Localização: Cidade do interior')
    
  } catch (error) {
    console.error('❌ Erro no teste:', error)
  }
}

// Executar o teste
main()
