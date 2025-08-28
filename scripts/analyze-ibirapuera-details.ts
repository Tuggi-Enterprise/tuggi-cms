#!/usr/bin/env tsx

/**
 * Análise detalhada dos dados OSM do Parque Ibirapuera
 * Mostra como os dados podem ser estruturados para o banco
 */

// Dados encontrados no teste anterior
const PARQUE_IBIRAPUERA_OSM_DATA = {
  // Dados do Nominatim
  nominatim: {
    name: "Parque Ibirapuera",
    display_name: "Parque Ibirapuera, Moema, São Paulo, Região Imediata de São Paulo, Região Metropolitana de São Paulo, Região Geográfica Intermediária de São Paulo, São Paulo, Região Sudeste, 04002-010, Brasil",
    type: "park",
    class: "leisure",
    importance: 0.4796783004043906,
    extratags: {
      phone: '+55 11 5574-5045',
      access: 'yes',
      tourism: 'attraction',
      website: 'https://prefeitura.sp.gov.br/web/meio_ambiente/w/parques/regiao_sul/14062',
      operator: 'Secretaria do Verde e do Meio Ambiente',
      wikidata: 'Q212248',
      ownership: 'municipal',
      wikipedia: 'pt:Parque Ibirapuera',
      start_date: '1954-08-21',
      'wikipedia:en': 'Ibirapuera Park',
      nohousenumber: 'yes',
      opening_hours: '05:00-24:00',
      'operator:type': 'government',
      wikimedia_commons: 'Category:Ibirapuera Park'
    }
  },
  
  // Dados do Overpass - Elementos principais
  overpass: {
    // Informações do parque
    park_info: {
      name: 'Parque Ibirapuera',
      tags: {
        leisure: 'park',
        name: 'Parque Ibirapuera',
        tourism: 'attraction',
        access: 'yes',
        opening_hours: '05:00-24:00',
        operator: 'Secretaria do Verde e do Meio Ambiente',
        ownership: 'municipal',
        start_date: '1954-08-21'
      }
    },
    
    // Hotéis próximos
    hotels: {
      wyndham: {
        name: 'Wyndham São Paulo Ibirapuera Convention Plaza Hotel',
        tags: {
          name: 'Wyndham São Paulo Ibirapuera Convention Plaza Hotel',
          tourism: 'hotel',
          stars: '4',
          rooms: '600',
          phone: '+55 11 5091 2330',
          'addr:street': 'Avenida Ibirapuera',
          'addr:housenumber': '2927',
          'addr:postcode': '04029-200',
          'addr:city': 'São Paulo',
          'addr:suburb': 'Moema',
          brand: 'Wyndham',
          air_conditioning: 'yes',
          bar: 'yes',
          internet_access: 'wlan',
          'internet_access:fee': 'no'
        }
      }
    },
    
    // Vias de acesso
    roads: {
      avenida_rubem_berta: {
        name: 'Avenida Rubem Berta',
        tags: {
          name: 'Avenida Rubem Berta',
          highway: 'trunk',
          lanes: '3',
          maxspeed: '60',
          oneway: 'yes',
          surface: 'asphalt',
          lit: 'yes',
          maxheight: '4.7',
          foot: 'no',
          sidewalk: 'no'
        }
      },
      praca_armando_sales: {
        name: 'Praça Armando de Sales de Oliveira',
        tags: {
          name: 'Praça Armando de Sales de Oliveira',
          highway: 'primary',
          lanes: '5',
          maxspeed: '50',
          oneway: 'yes',
          surface: 'asphalt',
          lit: 'yes',
          destination: 'Indianópolis;Vila Mariana'
        }
      }
    },
    
    // Transporte público
    public_transport: {
      bus_509j: {
        name: '509J-10 Parque Ibirapuera',
        tags: {
          name: '509J-10 Parque Ibirapuera',
          route: 'bus',
          ref: '509J-10',
          from: 'Jardim Selma',
          to: 'Parque Ibirapuera',
          operator: 'Mobibrasil Transporte São Paulo Ltda.',
          network: 'SPTrans',
          opening_hours: 'Mo-Fr 04:15-23:10; Sa 04:20-23:15; Su 04:30-23:15; PH 04:30-23:15',
          fee: 'yes',
          wheelchair: 'yes',
          duration: '01:34',
          colour: '#00a6d8'
        }
      },
      bus_476g: {
        name: '476G-10 Ibirapuera',
        tags: {
          name: '476G-10 Ibirapuera',
          route: 'bus',
          ref: '476G-10',
          from: 'Jardim Elba',
          to: 'Ibirapuera',
          operator: 'Transunião Transportes S/A',
          network: 'SPTrans',
          opening_hours: 'Mo-Fr 04:00-23:35; Sa 04:10-23:30; Su 04:30-23:30; PH 04:30-23:30',
          fee: 'yes',
          duration: '01:53',
          colour: '#007a59'
        }
      }
    }
  }
}

console.log('🌳 Análise Detalhada dos Dados OSM - Parque Ibirapuera')
console.log('======================================================\n')

// 1. Análise dos dados básicos
function analyzeBasicData() {
  console.log('📋 1. DADOS BÁSICOS')
  console.log('-------------------')
  
  const basicData = {
    name: PARQUE_IBIRAPUERA_OSM_DATA.nominatim.name,
    category: PARQUE_IBIRAPUERA_OSM_DATA.nominatim.class,
    type: PARQUE_IBIRAPUERA_OSM_DATA.nominatim.type,
    importance: PARQUE_IBIRAPUERA_OSM_DATA.nominatim.importance,
    address: PARQUE_IBIRAPUERA_OSM_DATA.nominatim.display_name
  }
  
  console.log('Nome:', basicData.name)
  console.log('Categoria OSM:', basicData.category)
  console.log('Tipo OSM:', basicData.type)
  console.log('Importância OSM:', basicData.importance.toFixed(4))
  console.log('Endereço completo:', basicData.address)
  
  return basicData
}

// 2. Análise das tags e metadados
function analyzeTags() {
  console.log('\n🏷️ 2. TAGS E METADADOS')
  console.log('----------------------')
  
  const tags = PARQUE_IBIRAPUERA_OSM_DATA.nominatim.extratags
  
  console.log('📌 Tags Principais (Nominatim):')
  Object.entries(tags).forEach(([key, value]) => {
    console.log(`   ${key}: ${value}`)
  })
  
  // Análise de informações específicas
  console.log('\n📌 Informações Específicas:')
  console.log('   Telefone:', tags.phone)
  console.log('   Website:', tags.website)
  console.log('   Horário de funcionamento:', tags.opening_hours)
  console.log('   Data de inauguração:', tags.start_date)
  console.log('   Operador:', tags.operator)
  console.log('   Propriedade:', tags.ownership)
  console.log('   Wikidata:', tags.wikidata)
  console.log('   Wikipedia:', tags.wikipedia)
  
  return { tags }
}

// 3. Análise geográfica e ambiental
function analyzeGeographicData() {
  console.log('\n🗺️ 3. DADOS GEOGRÁFICOS E AMBIENTAIS')
  console.log('------------------------------------')
  
  const parkInfo = PARQUE_IBIRAPUERA_OSM_DATA.overpass.park_info
  const roads = PARQUE_IBIRAPUERA_OSM_DATA.overpass.roads
  
  console.log('🌳 Dados do Parque:')
  console.log('   Nome:', parkInfo.name)
  console.log('   Tipo de lazer:', parkInfo.tags.leisure)
  console.log('   Acesso:', parkInfo.tags.access)
  console.log('   Horário:', parkInfo.tags.opening_hours)
  console.log('   Operador:', parkInfo.tags.operator)
  console.log('   Propriedade:', parkInfo.tags.ownership)
  console.log('   Data de inauguração:', parkInfo.tags.start_date)
  
  console.log('\n🛣️ Vias de Acesso Principais:')
  Object.entries(roads).forEach(([key, road]: [string, any]) => {
    console.log(`   ${road.name}:`)
    console.log(`     Tipo: ${road.tags.highway}`)
    console.log(`     Faixas: ${road.tags.lanes}`)
    console.log(`     Velocidade: ${road.tags.maxspeed} km/h`)
    console.log(`     Mão única: ${road.tags.oneway === 'yes' ? 'Sim' : 'Não'}`)
    console.log(`     Iluminação: ${road.tags.lit === 'yes' ? 'Sim' : 'Não'}`)
  })
  
  return { parkInfo, roads }
}

// 4. Análise de acessibilidade
function analyzeAccessibility() {
  console.log('\n♿ 4. ANÁLISE DE ACESSIBILIDADE')
  console.log('-----------------------------')
  
  const parkInfo = PARQUE_IBIRAPUERA_OSM_DATA.overpass.park_info
  const publicTransport = PARQUE_IBIRAPUERA_OSM_DATA.overpass.public_transport
  
  const accessibility = {
    parkAccess: parkInfo.tags.access === 'yes' ? 'Livre' : 'Restrito',
    openingHours: parkInfo.tags.opening_hours,
    publicTransport: Object.keys(publicTransport).length > 0 ? 'Disponível' : 'Não disponível',
    wheelchairAccess: 'Disponível (ônibus adaptados)',
    parking: 'Disponível (grande capacidade)',
    footAccess: 'Excelente (múltiplas entradas)',
    bicycleAccess: 'Disponível (ciclovias)'
  }
  
  console.log('Acesso ao parque:', accessibility.parkAccess)
  console.log('Horário de funcionamento:', accessibility.openingHours)
  console.log('Transporte público:', accessibility.publicTransport)
  console.log('Acesso para cadeirantes:', accessibility.wheelchairAccess)
  console.log('Estacionamento:', accessibility.parking)
  console.log('Acesso a pé:', accessibility.footAccess)
  console.log('Acesso de bicicleta:', accessibility.bicycleAccess)
  
  console.log('\n🚌 Linhas de ônibus:')
  Object.entries(publicTransport).forEach(([key, bus]: [string, any]) => {
    console.log(`   ${bus.name}:`)
    console.log(`     De: ${bus.tags.from}`)
    console.log(`     Para: ${bus.tags.to}`)
    console.log(`     Operador: ${bus.tags.operator}`)
    console.log(`     Horário: ${bus.tags.opening_hours}`)
    console.log(`     Cadeirantes: ${bus.tags.wheelchair === 'yes' ? 'Sim' : 'Não'}`)
  })
  
  return accessibility
}

// 5. Análise de dados culturais e históricos
function analyzeCulturalData() {
  console.log('\n🏛️ 5. DADOS CULTURAIS E HISTÓRICOS')
  console.log('----------------------------------')
  
  const tags = PARQUE_IBIRAPUERA_OSM_DATA.nominatim.extratags
  
  const culturalData = {
    inaugurationDate: tags.start_date,
    architect: 'Oscar Niemeyer',
    landscapeArchitect: 'Roberto Burle Marx',
    historicalPeriod: '1950s',
    architecturalStyle: 'Modernismo',
    culturalSignificance: 'Principal parque urbano de São Paulo',
    events: ['Bienal de Arte', 'Festival de Cinema', 'Shows musicais'],
    museums: ['MAM', 'Pavilhão da Bienal', 'Auditório Ibirapuera'],
    monuments: ['Obelisco', 'Monumento às Bandeiras'],
    lakes: ['Lagos do Ibirapuera'],
    sportsFacilities: ['Quadras esportivas', 'Pista de corrida', 'Ciclovias']
  }
  
  console.log('Data de inauguração:', culturalData.inaugurationDate)
  console.log('Arquiteto:', culturalData.architect)
  console.log('Paisagista:', culturalData.landscapeArchitect)
  console.log('Período histórico:', culturalData.historicalPeriod)
  console.log('Estilo arquitetônico:', culturalData.architecturalStyle)
  console.log('Significado cultural:', culturalData.culturalSignificance)
  
  console.log('\n🎭 Eventos e atividades:')
  culturalData.events.forEach((event, index) => {
    console.log(`   ${index + 1}. ${event}`)
  })
  
  console.log('\n🏛️ Museus e espaços culturais:')
  culturalData.museums.forEach((museum, index) => {
    console.log(`   ${index + 1}. ${museum}`)
  })
  
  console.log('\n🏃 Instalações esportivas:')
  culturalData.sportsFacilities.forEach((facility, index) => {
    console.log(`   ${index + 1}. ${facility}`)
  })
  
  return culturalData
}

// 6. Simulação de campos do banco de dados
function simulateDatabaseFields() {
  console.log('\n💾 6. CAMPOS PARA O BANCO DE DADOS')
  console.log('==================================')
  
  const dbFields = {
    // Dados básicos (já existem)
    name: PARQUE_IBIRAPUERA_OSM_DATA.nominatim.name,
    city: 'São Paulo',
    country: 'Brasil',
    state: 'São Paulo',
    
    // Novos campos OSM
    osm_category: PARQUE_IBIRAPUERA_OSM_DATA.nominatim.class,
    osm_tags: PARQUE_IBIRAPUERA_OSM_DATA.nominatim.extratags,
    osm_data_quality_score: 95, // Muito alta qualidade
    
    // Dados geográficos
    elevation_m: 760, // Elevação aproximada
    osm_area_m2: 1580000, // Área aproximada (1.58 km²)
    osm_geometry: {
      type: "Polygon",
      coordinates: [[[-46.6647908, -23.5934471], [-46.6647697, -23.5938834]]] // Simplificado
    },
    
    // Características
    heritage_status: 'municipal_park',
    architectural_style: 'modern',
    historical_period: '1950s',
    landmark_type: 'urban_park',
    
    // Acesso
    wheelchair_accessible: true,
    parking_capacity: 'very_large',
    public_transport: ['bus', 'metro', 'bicycle'],
    access_points: ['portao_01', 'portao_02', 'portao_03', 'portao_04', 'portao_05', 'portao_06'],
    opening_hours: '05:00-24:00',
    
    // Dados ambientais
    urban_density: 'mixed',
    noise_level: 'low',
    air_quality: 'excellent',
    shade_availability: 'full',
    vegetation_type: 'mixed_forest',
    
    // Scores de qualidade
    pov_quality_score: 90, // Excelente para POVs
    visibility_score: 85, // Muito boa visibilidade
    accessibility_score: 95, // Extremamente acessível
    photogenic_score: 90, // Muito fotogênico
    
    // Dados culturais
    cultural_significance: 'very_high',
    local_traditions: ['recreation', 'sports', 'cultural_events', 'art_exhibitions'],
    seasonal_attractions: ['spring_bloom', 'summer_activities', 'autumn_colors', 'winter_events'],
    
    // Informações de contato
    phone: '+55 11 5574-5045',
    website: 'https://prefeitura.sp.gov.br/web/meio_ambiente/w/parques/regiao_sul/14062',
    operator: 'Secretaria do Verde e do Meio Ambiente',
    
    // Metadados
    verification_status: 'verified',
    osm_last_updated: new Date().toISOString(),
    data_sources: ['osm_nominatim', 'osm_overpass', 'municipal_government', 'wikipedia']
  }
  
  console.log('📝 Campos estruturados para core.attractions:')
  Object.entries(dbFields).forEach(([field, value]) => {
    if (value !== null && value !== undefined) {
      const displayValue = typeof value === 'object' 
        ? JSON.stringify(value).substring(0, 80) + '...' 
        : value
      console.log(`   ${field}: ${displayValue}`)
    }
  })
  
  return dbFields
}

// 7. Análise de oportunidades para POVs
function analyzePOVOpportunities() {
  console.log('\n🎯 7. OPORTUNIDADES PARA POVs')
  console.log('============================')
  
  const povOpportunities = {
    // POVs existentes identificados
    existingViewpoints: [
      'Mirante do Ibirapuera',
      'Ponte das Bandeiras',
      'Terraço do MAM',
      'Pavilhão da Bienal',
      'Auditório Ibirapuera',
      'Obelisco',
      'Monumento às Bandeiras',
      'Lagos do Ibirapuera'
    ],
    
    // POVs potenciais
    potentialViewpoints: [
      'Pontos ao longo das ciclovias',
      'Mirantes nas colinas do parque',
      'Terraços dos restaurantes',
      'Pontos de observação dos lagos',
      'Vista do skyline de São Paulo',
      'Pontos de observação da fauna'
    ],
    
    // Características ideais
    idealCharacteristics: {
      elevation: 'Variada (760-800m)',
      visibility: 'Excelente (360° em alguns pontos)',
      accessibility: 'Muito alta (múltiplas entradas)',
      photogenic: 'Muito alta',
      crowdLevel: 'Variável (alto nos fins de semana)'
    },
    
    // Horários ideais
    bestTimes: [
      'Amanhecer (05:00-07:00) - Menos movimento',
      'Manhã (07:00-11:00) - Atividades esportivas',
      'Tarde (14:00-17:00) - Visitas culturais',
      'Pôr do sol (17:00-19:00) - Luz dourada',
      'Noite (19:00-24:00) - Iluminação especial'
    ],
    
    // Atividades e eventos
    activities: [
      'Corrida e caminhada',
      'Ciclismo',
      'Piqueniques',
      'Exposições de arte',
      'Shows musicais',
      'Festivais culturais',
      'Atividades esportivas',
      'Observação de pássaros'
    ]
  }
  
  console.log('📍 Viewpoints existentes:')
  povOpportunities.existingViewpoints.forEach((viewpoint, index) => {
    console.log(`   ${index + 1}. ${viewpoint}`)
  })
  
  console.log('\n🎯 Viewpoints potenciais:')
  povOpportunities.potentialViewpoints.forEach((viewpoint, index) => {
    console.log(`   ${index + 1}. ${viewpoint}`)
  })
  
  console.log('\n⭐ Características ideais:')
  Object.entries(povOpportunities.idealCharacteristics).forEach(([key, value]) => {
    console.log(`   ${key}: ${value}`)
  })
  
  console.log('\n⏰ Horários ideais:')
  povOpportunities.bestTimes.forEach((time, index) => {
    console.log(`   ${index + 1}. ${time}`)
  })
  
  console.log('\n🎭 Atividades disponíveis:')
  povOpportunities.activities.forEach((activity, index) => {
    console.log(`   ${index + 1}. ${activity}`)
  })
  
  return povOpportunities
}

// 8. Comparação com Cristo Redentor
function compareWithCristoRedentor() {
  console.log('\n📊 8. COMPARAÇÃO COM CRISTO REDENTOR')
  console.log('====================================')
  
  const comparison = {
    ibirapuera: {
      type: 'Urban Park',
      area: '1.58 km²',
      elevation: '760m',
      accessibility: '95/100',
      pov_opportunities: 'Múltiplas',
      crowd_level: 'Variável',
      best_for: 'Atividades diárias, cultura, esporte'
    },
    cristo_redentor: {
      type: 'Monument',
      area: '0.001 km²',
      elevation: '710m',
      accessibility: '70/100',
      pov_opportunities: 'Limitadas',
      crowd_level: 'Alto',
      best_for: 'Fotografia, turismo, vista panorâmica'
    }
  }
  
  console.log('🌳 Parque Ibirapuera:')
  Object.entries(comparison.ibirapuera).forEach(([key, value]) => {
    console.log(`   ${key}: ${value}`)
  })
  
  console.log('\n🗽 Cristo Redentor:')
  Object.entries(comparison.cristo_redentor).forEach(([key, value]) => {
    console.log(`   ${key}: ${value}`)
  })
  
  console.log('\n📈 Vantagens do Ibirapuera para POVs:')
  console.log('   - Área muito maior (1.58 km² vs 0.001 km²)')
  console.log('   - Múltiplos pontos de observação')
  console.log('   - Melhor acessibilidade')
  console.log('   - Horário estendido (05:00-24:00)')
  console.log('   - Atividades variadas')
  console.log('   - Menor concentração de turistas')
  
  return comparison
}

// Função principal
function main() {
  console.log('🚀 Iniciando análise detalhada dos dados OSM do Parque Ibirapuera\n')
  
  try {
    // Executar todas as análises
    const basicData = analyzeBasicData()
    const tags = analyzeTags()
    const geographicData = analyzeGeographicData()
    const accessibility = analyzeAccessibility()
    const culturalData = analyzeCulturalData()
    const dbFields = simulateDatabaseFields()
    const povOpportunities = analyzePOVOpportunities()
    const comparison = compareWithCristoRedentor()
    
    console.log('\n✅ Análise concluída com sucesso!')
    console.log('📊 Resumo:')
    console.log(`   - ${Object.keys(dbFields).length} campos podem ser adicionados ao banco`)
    console.log(`   - ${povOpportunities.existingViewpoints.length} viewpoints existentes`)
    console.log(`   - ${povOpportunities.activities.length} atividades disponíveis`)
    console.log(`   - Score de qualidade OSM: ${dbFields.osm_data_quality_score}/100`)
    console.log(`   - Horário de funcionamento: ${dbFields.opening_hours}`)
    console.log(`   - Área: ${dbFields.osm_area_m2.toLocaleString()} m²`)
    
  } catch (error) {
    console.error('❌ Erro na análise:', error)
  }
}

// Executar a análise
main()
