#!/usr/bin/env tsx

/**
 * Análise detalhada dos dados OSM do Cristo Redentor
 * Mostra como os dados podem ser estruturados para o banco
 */

// Dados encontrados no teste anterior
const CRISTO_REDENTOR_OSM_DATA = {
  // Dados do Nominatim
  nominatim: {
    name: "Cristo Redentor",
    display_name: "Cristo Redentor, Estrada do Corcovado, Santa Teresa, Rio de Janeiro, Região Geográfica Imediata do Rio de Janeiro, Região Metropolitana do Rio de Janeiro, Região Geográfica Intermediária do Rio de Janeiro, Rio de Janeiro, Região Sudeste, 22470-180, Brasil",
    type: "attraction",
    class: "tourism",
    importance: 0.5219832891981454,
    extratags: {
      landmark: '1',
      man_made: 'monument',
      wikidata: 'Q79961',
      wikipedia: 'pt:Cristo Redentor',
      'seamark:type': 'landmark',
      'subject:wikidata': 'Q302',
      'seamark:landmark:category': 'monument'
    }
  },
  
  // Dados do Overpass - Elementos principais
  overpass: {
    cristo_redentor: {
      name: 'Cristo Redentor',
      tags: {
        name: 'Cristo Redentor',
        'name:de': 'Christus der Erlöser',
        'name:en': 'Christ the Redeemer',
        'name:ja': 'コルコバードのキリスト像',
        'name:lt': 'Kristaus Atpirkėjo statula',
        'name:pl': 'Pomnik Chrystusa Odkupiciela w Rio de Janeiro',
        old_name: 'Christo Redemptor',
        public_transport: 'station',
        railway: 'station',
        train: 'yes',
        wheelchair: 'limited',
        wikidata: 'Q120648408'
      }
    },
    corcovado_peak: {
      name: 'Corcovado',
      tags: {
        ele: '710',
        name: 'Corcovado',
        'name:pt': 'Corcovado',
        'name:ru': 'Корковаду',
        natural: 'peak',
        wikidata: 'Q506938',
        wikimedia_commons: 'Category:Corcovado',
        wikipedia: 'pt:Corcovado'
      }
    },
    estrada_corcovado: {
      name: 'Estrada do Corcovado',
      tags: {
        bicycle: 'designated',
        foot: 'yes',
        highway: 'unclassified',
        lit: 'no',
        maxspeed: '30',
        name: 'Estrada do Corcovado',
        oneway: 'no',
        surface: 'asphalt'
      }
    }
  }
}

console.log('🗽 Análise Detalhada dos Dados OSM - Cristo Redentor')
console.log('===================================================\n')

// 1. Análise dos dados básicos
function analyzeBasicData() {
  console.log('📋 1. DADOS BÁSICOS')
  console.log('-------------------')
  
  const basicData = {
    name: CRISTO_REDENTOR_OSM_DATA.nominatim.name,
    category: CRISTO_REDENTOR_OSM_DATA.nominatim.class,
    type: CRISTO_REDENTOR_OSM_DATA.nominatim.type,
    importance: CRISTO_REDENTOR_OSM_DATA.nominatim.importance,
    address: CRISTO_REDENTOR_OSM_DATA.nominatim.display_name
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
  
  const tags = CRISTO_REDENTOR_OSM_DATA.nominatim.extratags
  const cristoTags = CRISTO_REDENTOR_OSM_DATA.overpass.cristo_redentor.tags
  
  console.log('📌 Tags Principais (Nominatim):')
  Object.entries(tags).forEach(([key, value]) => {
    console.log(`   ${key}: ${value}`)
  })
  
  console.log('\n📌 Tags Detalhadas (Overpass):')
  Object.entries(cristoTags).forEach(([key, value]) => {
    console.log(`   ${key}: ${value}`)
  })
  
  // Análise de idiomas disponíveis
  const languages = Object.keys(cristoTags).filter(key => key.startsWith('name:'))
  console.log('\n🌍 Idiomas disponíveis:', languages.map(lang => lang.replace('name:', '')))
  
  return { tags, cristoTags, languages }
}

// 3. Análise geográfica e ambiental
function analyzeGeographicData() {
  console.log('\n🗺️ 3. DADOS GEOGRÁFICOS E AMBIENTAIS')
  console.log('------------------------------------')
  
  const corcovadoPeak = CRISTO_REDENTOR_OSM_DATA.overpass.corcovado_peak
  const estrada = CRISTO_REDENTOR_OSM_DATA.overpass.estrada_corcovado
  
  console.log('🏔️ Dados do Pico do Corcovado:')
  console.log('   Nome:', corcovadoPeak.name)
  console.log('   Elevação:', corcovadoPeak.tags.ele, 'metros')
  console.log('   Tipo natural:', corcovadoPeak.tags.natural)
  console.log('   Wikidata:', corcovadoPeak.tags.wikidata)
  
  console.log('\n🛣️ Dados da Estrada do Corcovado:')
  console.log('   Nome:', estrada.name)
  console.log('   Tipo de via:', estrada.tags.highway)
  console.log('   Velocidade máxima:', estrada.tags.maxspeed, 'km/h')
  console.log('   Superfície:', estrada.tags.surface)
  console.log('   Acesso a pé:', estrada.tags.foot)
  console.log('   Acesso de bicicleta:', estrada.tags.bicycle)
  console.log('   Iluminação:', estrada.tags.lit)
  
  return { corcovadoPeak, estrada }
}

// 4. Análise de acessibilidade
function analyzeAccessibility() {
  console.log('\n♿ 4. ANÁLISE DE ACESSIBILIDADE')
  console.log('-----------------------------')
  
  const cristoTags = CRISTO_REDENTOR_OSM_DATA.overpass.cristo_redentor.tags
  
  const accessibility = {
    wheelchair: cristoTags.wheelchair === 'limited' ? 'Acesso limitado' : 'Não especificado',
    publicTransport: cristoTags.public_transport === 'station' ? 'Estação de transporte público' : 'Não disponível',
    train: cristoTags.train === 'yes' ? 'Acesso por trem' : 'Não disponível',
    foot: 'Sim (via Estrada do Corcovado)',
    bicycle: 'Sim (via Estrada do Corcovado)'
  }
  
  console.log('Cadeirantes:', accessibility.wheelchair)
  console.log('Transporte público:', accessibility.publicTransport)
  console.log('Trem:', accessibility.train)
  console.log('A pé:', accessibility.foot)
  console.log('Bicicleta:', accessibility.bicycle)
  
  return accessibility
}

// 5. Análise de dados culturais e históricos
function analyzeCulturalData() {
  console.log('\n🏛️ 5. DADOS CULTURAIS E HISTÓRICOS')
  console.log('----------------------------------')
  
  const tags = CRISTO_REDENTOR_OSM_DATA.nominatim.extratags
  const cristoTags = CRISTO_REDENTOR_OSM_DATA.overpass.cristo_redentor.tags
  
  const culturalData = {
    landmark: tags.landmark === '1' ? 'Sim' : 'Não',
    monument: tags.man_made === 'monument' ? 'Sim' : 'Não',
    wikidata: tags.wikidata,
    wikipedia: tags.wikipedia,
    oldName: cristoTags.old_name,
    heritageStatus: 'Patrimônio Mundial da UNESCO',
    constructionPeriod: '1922-1931',
    architect: 'Paul Landowski',
    height: '38 metros',
    material: 'Pedra-sabão'
  }
  
  console.log('Marco histórico:', culturalData.landmark)
  console.log('Monumento:', culturalData.monument)
  console.log('Wikidata ID:', culturalData.wikidata)
  console.log('Wikipedia:', culturalData.wikipedia)
  console.log('Nome antigo:', culturalData.oldName)
  console.log('Status patrimonial:', culturalData.heritageStatus)
  console.log('Período de construção:', culturalData.constructionPeriod)
  console.log('Arquiteto:', culturalData.architect)
  console.log('Altura:', culturalData.height)
  console.log('Material:', culturalData.material)
  
  return culturalData
}

// 6. Simulação de campos do banco de dados
function simulateDatabaseFields() {
  console.log('\n💾 6. CAMPOS PARA O BANCO DE DADOS')
  console.log('==================================')
  
  const dbFields = {
    // Dados básicos (já existem)
    name: CRISTO_REDENTOR_OSM_DATA.nominatim.name,
    city: 'Rio de Janeiro',
    country: 'Brasil',
    state: 'Rio de Janeiro',
    
    // Novos campos OSM
    osm_category: CRISTO_REDENTOR_OSM_DATA.nominatim.class,
    osm_tags: {
      ...CRISTO_REDENTOR_OSM_DATA.nominatim.extratags,
      ...CRISTO_REDENTOR_OSM_DATA.overpass.cristo_redentor.tags
    },
    osm_data_quality_score: 95, // Muito alta qualidade
    
    // Dados geográficos
    elevation_m: 710, // Altura do Corcovado
    estimated_height_m: 38, // Altura do monumento
    osm_geometry: {
      type: "Point",
      coordinates: [-43.2104585, -22.9519173]
    },
    
    // Características
    heritage_status: 'unesco_world_heritage',
    architectural_style: 'art_deco',
    historical_period: '1920s',
    landmark_type: 'monument',
    
    // Acesso
    wheelchair_accessible: 'limited',
    parking_capacity: 'large', // Estacionamento do Corcovado
    public_transport: ['train', 'bus'],
    access_points: ['main_entrance', 'train_station'],
    
    // Dados ambientais
    urban_density: 'mixed',
    noise_level: 'low', // Área natural
    air_quality: 'excellent', // Elevação alta
    shade_availability: 'partial',
    
    // Scores de qualidade
    pov_quality_score: 100, // Excelente para POVs
    visibility_score: 95, // Muito visível
    accessibility_score: 70, // Moderadamente acessível
    photogenic_score: 100, // Extremamente fotogênico
    
    // Dados culturais
    cultural_significance: 'very_high',
    local_traditions: ['religious_pilgrimage', 'tourist_attraction'],
    seasonal_attractions: ['sunrise', 'sunset', 'christmas_lighting'],
    
    // Metadados
    verification_status: 'verified',
    osm_last_updated: new Date().toISOString(),
    data_sources: ['osm_nominatim', 'osm_overpass', 'unesco', 'wikipedia']
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
      'Cristo Redentor (ponto principal)',
      'Pico do Corcovado (710m)',
      'Pedra do Sapo (351m)',
      'Morro do Inglês',
      'Alto das Paineiras'
    ],
    
    // POVs potenciais
    potentialViewpoints: [
      'Mirante da Estrada do Corcovado',
      'Pontos ao longo da trilha',
      'Terraços do restaurante',
      'Pontos de parada do trem'
    ],
    
    // Características ideais
    idealCharacteristics: {
      elevation: 'Alta (710m)',
      visibility: 'Excelente (360°)',
      accessibility: 'Trem + estrada',
      photogenic: 'Muito alta',
      crowdLevel: 'Alto (turístico)'
    },
    
    // Horários ideais
    bestTimes: [
      'Amanhecer (menos movimento)',
      'Pôr do sol (luz dourada)',
      'Noite (iluminação)',
      'Dias de semana (menos movimento)'
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
  
  return povOpportunities
}

// Função principal
function main() {
  console.log('🚀 Iniciando análise detalhada dos dados OSM\n')
  
  try {
    // Executar todas as análises
    const basicData = analyzeBasicData()
    const tags = analyzeTags()
    const geographicData = analyzeGeographicData()
    const accessibility = analyzeAccessibility()
    const culturalData = analyzeCulturalData()
    const dbFields = simulateDatabaseFields()
    const povOpportunities = analyzePOVOpportunities()
    
    console.log('\n✅ Análise concluída com sucesso!')
    console.log('📊 Resumo:')
    console.log(`   - ${Object.keys(dbFields).length} campos podem ser adicionados ao banco`)
    console.log(`   - ${tags.languages.length} idiomas disponíveis`)
    console.log(`   - ${povOpportunities.existingViewpoints.length} viewpoints existentes`)
    console.log(`   - Score de qualidade OSM: ${dbFields.osm_data_quality_score}/100`)
    
  } catch (error) {
    console.error('❌ Erro na análise:', error)
  }
}

// Executar a análise
main()
