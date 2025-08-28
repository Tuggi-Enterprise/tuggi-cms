#!/usr/bin/env tsx

/**
 * Análise detalhada dos dados OSM da Sagrada Família em Barcelona
 * Mostra como os dados podem ser estruturados para o banco
 */

// Dados encontrados no teste anterior
const SAGRADA_FAMILIA_OSM_DATA = {
  // Dados do Nominatim
  nominatim: {
    name: "Basílica de la Sagrada Família",
    display_name: "Basílica de la Sagrada Família, 401, Carrer de Mallorca, la Sagrada Família, Eixample, Barcelona, Barcelonès, Barcelona, Catalunya, 08013, España",
    type: "place_of_worship",
    class: "amenity",
    importance: 0.5501492971959381,
    extratags: {
      url: 'http://www.sagradafamilia.cat',
      'ref:whc': '320-005',
      tourism: 'attraction',
      website: 'http://www.sagradafamilia.org',
      building: 'basilica',
      heritage: '1',
      historic: 'heritage',
      landmark: '8',
      religion: 'christian',
      wikidata: 'Q48435',
      architect: 'Antoni Gaudí i Cornet',
      wikipedia: 'ca:Temple Expiatori de la Sagrada Família',
      check_date: '2023-04-24',
      importance: 'international',
      wheelchair: 'yes',
      'roof:colour': 'tan',
      denomination: 'catholic',
      opening_hours: 'Mo-Su 09:00-20:00',
      'building:colour': 'tan',
      'heritage:operator': 'whc',
      'architect:wikidata': 'Q25328',
      'toilets:wheelchair': 'yes',
      'whc:inscription_date': '2005',
      'wheelchair:description:de': 'Nur die Türme können nicht besichtigt werden'
    }
  },
  
  // Dados do Reverse Geocoding
  reverse: {
    display_name: "Basílica de la Sagrada Família, 401, Carrer de Mallorca, la Sagrada Família, Eixample, Barcelona, Barcelonès, Barcelona, Catalunya, 08013, España",
    type: "place_of_worship",
    class: "amenity",
    address: {
      amenity: 'Basílica de la Sagrada Família',
      house_number: '401',
      road: 'Carrer de Mallorca',
      quarter: 'la Sagrada Família',
      suburb: 'Eixample',
      city: 'Barcelona',
      county: 'Barcelonès',
      province: 'Barcelona',
      'ISO3166-2-lvl6': 'ES-B',
      state: 'Catalunya',
      'ISO3166-2-lvl4': 'ES-CT',
      postcode: '08013',
      country: 'España',
      country_code: 'es'
    }
  }
}

console.log('⛪ Análise Detalhada dos Dados OSM - Sagrada Família')
console.log('====================================================\n')

// 1. Análise dos dados básicos
function analyzeBasicData() {
  console.log('📋 1. DADOS BÁSICOS')
  console.log('-------------------')
  
  const basicData = {
    name: SAGRADA_FAMILIA_OSM_DATA.nominatim.name,
    category: SAGRADA_FAMILIA_OSM_DATA.nominatim.class,
    type: SAGRADA_FAMILIA_OSM_DATA.nominatim.type,
    importance: SAGRADA_FAMILIA_OSM_DATA.nominatim.importance,
    address: SAGRADA_FAMILIA_OSM_DATA.nominatim.display_name
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
  
  const tags = SAGRADA_FAMILIA_OSM_DATA.nominatim.extratags
  
  console.log('📌 Tags Principais (Nominatim):')
  Object.entries(tags).forEach(([key, value]) => {
    console.log(`   ${key}: ${value}`)
  })
  
  // Análise de informações específicas
  console.log('\n📌 Informações Específicas:')
  console.log('   Website oficial:', tags.website)
  console.log('   Website alternativo:', tags.url)
  console.log('   Horário de funcionamento:', tags.opening_hours)
  console.log('   Arquiteto:', tags.architect)
  console.log('   Wikidata:', tags.wikidata)
  console.log('   Wikipedia:', tags.wikipedia)
  console.log('   Religião:', tags.religion)
  console.log('   Denominação:', tags.denomination)
  console.log('   Tipo de edifício:', tags.building)
  console.log('   Status histórico:', tags.historic)
  console.log('   Patrimônio:', tags.heritage)
  console.log('   Operador do patrimônio:', tags['heritage:operator'])
  console.log('   Data de inscrição UNESCO:', tags['whc:inscription_date'])
  console.log('   Referência UNESCO:', tags['ref:whc'])
  console.log('   Importância:', tags.importance)
  console.log('   Acesso para cadeirantes:', tags.wheelchair)
  console.log('   Banheiros para cadeirantes:', tags['toilets:wheelchair'])
  console.log('   Cor do edifício:', tags['building:colour'])
  console.log('   Cor do telhado:', tags['roof:colour'])
  console.log('   Data de verificação:', tags.check_date)
  
  return { tags }
}

// 3. Análise geográfica e de localização
function analyzeGeographicData() {
  console.log('\n🗺️ 3. DADOS GEOGRÁFICOS E LOCALIZAÇÃO')
  console.log('--------------------------------------')
  
  const address = SAGRADA_FAMILIA_OSM_DATA.reverse.address
  
  console.log('📍 Endereço Detalhado:')
  console.log('   Número:', address.house_number)
  console.log('   Rua:', address.road)
  console.log('   Bairro:', address.quarter)
  console.log('   Subúrbio:', address.suburb)
  console.log('   Cidade:', address.city)
  console.log('   Condado:', address.county)
  console.log('   Província:', address.province)
  console.log('   Estado:', address.state)
  console.log('   CEP:', address.postcode)
  console.log('   País:', address.country)
  console.log('   Código do país:', address.country_code)
  
  console.log('\n🏢 Características da Localização:')
  console.log('   Tipo: Basílica católica')
  console.log('   Localização: Eixample (distrito planejado)')
  console.log('   Contexto urbano: Área central de Barcelona')
  console.log('   Acessibilidade: Excelente (transporte público)')
  console.log('   Visibilidade: Muito alta (landmark nível 8)')
  
  return { address }
}

// 4. Análise de acessibilidade e funcionamento
function analyzeAccessibility() {
  console.log('\n♿ 4. ANÁLISE DE ACESSIBILIDADE E FUNCIONAMENTO')
  console.log('===============================================')
  
  const tags = SAGRADA_FAMILIA_OSM_DATA.nominatim.extratags
  
  const accessibility = {
    openingHours: tags.opening_hours,
    website: tags.website,
    alternativeWebsite: tags.url,
    wheelchairAccess: tags.wheelchair === 'yes',
    wheelchairToilets: tags['toilets:wheelchair'] === 'yes',
    wheelchairDescription: tags['wheelchair:description:de'],
    publicTransport: 'Excelente (metro, ônibus, trem)',
    parking: 'Disponível (estacionamentos próximos)',
    footAccess: 'Excelente (área central)',
    metroAccess: 'Metrô Sagrada Família (L2, L5)'
  }
  
  console.log('⏰ Horário de funcionamento:', accessibility.openingHours)
  console.log('🌐 Website oficial:', accessibility.website)
  console.log('🌐 Website alternativo:', accessibility.alternativeWebsite)
  console.log('♿ Acesso para cadeirantes:', accessibility.wheelchairAccess ? 'Sim' : 'Não')
  console.log('🚽 Banheiros para cadeirantes:', accessibility.wheelchairToilets ? 'Sim' : 'Não')
  console.log('📝 Descrição acessibilidade:', accessibility.wheelchairDescription)
  console.log('🚌 Transporte público:', accessibility.publicTransport)
  console.log('🅿️ Estacionamento:', accessibility.parking)
  console.log('🚶 Acesso a pé:', accessibility.footAccess)
  console.log('🚇 Metrô:', accessibility.metroAccess)
  
  // Análise dos horários
  console.log('\n📅 Análise dos Horários:')
  console.log('   Segunda a Domingo: 09:00-20:00 (11 horas)')
  console.log('   Total de horas diárias: 11 horas')
  console.log('   Total de horas semanais: 77 horas')
  console.log('   Disponibilidade: Muito alta')
  
  return accessibility
}

// 5. Análise de dados culturais e históricos
function analyzeCulturalData() {
  console.log('\n🏛️ 5. DADOS CULTURAIS E HISTÓRICOS')
  console.log('==================================')
  
  const tags = SAGRADA_FAMILIA_OSM_DATA.nominatim.extratags
  
  const culturalData = {
    architect: tags.architect,
    architecturalStyle: 'Modernisme (Art Nouveau catalão)',
    historicalPeriod: '1882-presente',
    culturalSignificance: 'Patrimônio Mundial UNESCO',
    religiousSignificance: 'Basílica católica',
    constructionStatus: 'Em construção (140+ anos)',
    completionEstimated: '2026',
    unescoInscription: tags['whc:inscription_date'],
    unescoReference: tags['ref:whc'],
    importance: tags.importance,
    landmarkLevel: tags.landmark,
    heritageStatus: tags.heritage,
    historicStatus: tags.historic,
    denomination: tags.denomination,
    religion: tags.religion,
    buildingType: tags.building,
    architectWikidata: tags['architect:wikidata'],
    mainWikidata: tags.wikidata,
    wikipedia: tags.wikipedia
  }
  
  console.log('👷 Arquiteto:', culturalData.architect)
  console.log('🏗️ Estilo arquitetônico:', culturalData.architecturalStyle)
  console.log('📚 Período histórico:', culturalData.historicalPeriod)
  console.log('🎨 Significado cultural:', culturalData.culturalSignificance)
  console.log('⛪ Significado religioso:', culturalData.religiousSignificance)
  console.log('🏗️ Status da construção:', culturalData.constructionStatus)
  console.log('📅 Previsão de conclusão:', culturalData.completionEstimated)
  console.log('🏆 Inscrição UNESCO:', culturalData.unescoInscription)
  console.log('🔗 Referência UNESCO:', culturalData.unescoReference)
  console.log('⭐ Importância:', culturalData.importance)
  console.log('🏛️ Nível de landmark:', culturalData.landmarkLevel)
  console.log('🏛️ Status do patrimônio:', culturalData.heritageStatus)
  console.log('📚 Status histórico:', culturalData.historicStatus)
  console.log('⛪ Denominação:', culturalData.denomination)
  console.log('🙏 Religião:', culturalData.religion)
  console.log('🏢 Tipo de edifício:', culturalData.buildingType)
  console.log('🔗 Wikidata do arquiteto:', culturalData.architectWikidata)
  console.log('🔗 Wikidata principal:', culturalData.mainWikidata)
  console.log('📖 Wikipedia:', culturalData.wikipedia)
  
  return culturalData
}

// 6. Simulação de campos do banco de dados
function simulateDatabaseFields() {
  console.log('\n💾 6. CAMPOS PARA O BANCO DE DADOS')
  console.log('==================================')
  
  const tags = SAGRADA_FAMILIA_OSM_DATA.nominatim.extratags
  
  const dbFields = {
    // Dados básicos (já existem)
    name: SAGRADA_FAMILIA_OSM_DATA.nominatim.name,
    city: 'Barcelona',
    country: 'España',
    region: 'Catalunya',
    
    // Novos campos OSM
    osm_category: SAGRADA_FAMILIA_OSM_DATA.nominatim.class,
    osm_tags: tags,
    osm_data_quality_score: 98, // Muito alta qualidade
    
    // Dados geográficos
    elevation_m: 12, // Elevação aproximada de Barcelona
    estimated_height_m: 172, // Altura aproximada da Sagrada Família
    osm_area_m2: 15000, // Área aproximada da basílica
    osm_geometry: {
      type: "MultiPolygon",
      coordinates: [[[[2.1735675, 41.4036645], [2.1735679, 41.4036592]]]] // Simplificado
    },
    
    // Características
    heritage_status: 'unesco_world_heritage',
    architectural_style: 'modernisme',
    historical_period: '1880s-present',
    landmark_type: 'basilica',
    
    // Acesso
    wheelchair_accessible: tags.wheelchair === 'yes',
    wheelchair_toilets: tags['toilets:wheelchair'] === 'yes',
    parking_capacity: 'large',
    public_transport: ['metro', 'bus', 'train'],
    access_points: ['main_entrance', 'nativity_facade', 'passion_facade', 'glory_facade'],
    opening_hours: tags.opening_hours,
    
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
    architect: tags.architect,
    construction_status: 'under_construction',
    completion_estimated: '2026',
    unesco_status: 'world_heritage_site',
    unesco_inscription_date: tags['whc:inscription_date'],
    unesco_reference: tags['ref:whc'],
    landmark_level: parseInt(tags.landmark),
    importance_level: tags.importance,
    building_colour: tags['building:colour'],
    roof_colour: tags['roof:colour'],
    
    // Informações de contato
    website: tags.website,
    alternative_website: tags.url,
    
    // Metadados
    verification_status: 'verified',
    osm_last_updated: new Date().toISOString(),
    data_sources: ['osm_nominatim', 'osm_reverse', 'unesco', 'wikipedia']
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
      'Vista da fachada da Natividade',
      'Vista da fachada da Paixão',
      'Vista da fachada da Glória (em construção)',
      'Vista das torres',
      'Vista do interior da basílica',
      'Vista do parque Güell (vista distante)',
      'Vista do Tibidabo (vista panorâmica)',
      'Vista do mar (vista distante)'
    ],
    
    // POVs potenciais
    potentialViewpoints: [
      'Pontos ao redor da basílica',
      'Mirantes nos hotéis próximos',
      'Pontos de observação do Eixample',
      'Vista do metrô Sagrada Família',
      'Perspectivas arquitetônicas',
      'Pontos de observação da vida urbana',
      'Vista do parque da Sagrada Família',
      'Pontos de observação do tráfego'
    ],
    
    // Características ideais
    idealCharacteristics: {
      elevation: 'Moderada (12m)',
      visibility: 'Excelente (landmark nível 8)',
      accessibility: 'Muito alta (transporte público)',
      photogenic: 'Muito alta',
      crowdLevel: 'Alto (turismo internacional)'
    },
    
    // Horários ideais
    bestTimes: [
      'Manhã (09:00-12:00) - Menos movimento',
      'Tarde (14:00-17:00) - Visitas turísticas',
      'Fins de semana (09:00-20:00) - Mais movimento',
      'Noite (após 20:00) - Iluminação especial',
      'Amanhecer - Luz dourada nas fachadas',
      'Pôr do sol - Silhueta dramática'
    ],
    
    // Atividades e eventos
    activities: [
      'Visitas à basílica',
      'Visitas guiadas multilíngue',
      'Subida às torres',
      'Museu da Sagrada Família',
      'Missa dominical',
      'Concertos de órgão',
      'Exposições temporárias',
      'Eventos culturais',
      'Fotografia arquitetônica',
      'Pesquisa acadêmica'
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

// 8. Comparação com outros monumentos testados
function compareWithOtherMonuments() {
  console.log('\n📊 8. COMPARAÇÃO COM OUTROS MONUMENTOS TESTADOS')
  console.log('===============================================')
  
  const comparison = {
    sagrada_familia: {
      type: 'International Monument',
      area: '0.015 km²',
      elevation: '12m',
      accessibility: '85/100',
      pov_opportunities: 'Múltiplas',
      crowd_level: 'Muito alto',
      best_for: 'Arquitetura, turismo internacional, fotografia'
    },
    cristo_redentor: {
      type: 'National Monument',
      area: '0.001 km²',
      elevation: '710m',
      accessibility: '70/100',
      pov_opportunities: 'Limitadas',
      crowd_level: 'Alto',
      best_for: 'Fotografia, turismo, vista panorâmica'
    },
    masp: {
      type: 'Art Museum',
      area: '0.005 km²',
      elevation: '760m',
      accessibility: '90/100',
      pov_opportunities: 'Múltiplas',
      crowd_level: 'Variável',
      best_for: 'Arte, cultura, arquitetura'
    },
    museu_telefone: {
      type: 'Local Museum',
      area: '0.0008 km²',
      elevation: '850m',
      accessibility: '75/100',
      pov_opportunities: 'Limitadas',
      crowd_level: 'Baixo',
      best_for: 'História local, educação'
    }
  }
  
  console.log('⛪ Sagrada Família:')
  Object.entries(comparison.sagrada_familia).forEach(([key, value]) => {
    console.log(`   ${key}: ${value}`)
  })
  
  console.log('\n🗽 Cristo Redentor:')
  Object.entries(comparison.cristo_redentor).forEach(([key, value]) => {
    console.log(`   ${key}: ${value}`)
  })
  
  console.log('\n🏛️ MASP:')
  Object.entries(comparison.masp).forEach(([key, value]) => {
    console.log(`   ${key}: ${value}`)
  })
  
  console.log('\n📞 Museu do Telefone:')
  Object.entries(comparison.museu_telefone).forEach(([key, value]) => {
    console.log(`   ${key}: ${value}`)
  })
  
  console.log('\n📈 Vantagens da Sagrada Família para POVs:')
  console.log('   - Patrimônio Mundial UNESCO')
  console.log('   - Arquitetura icônica de Gaudí')
  console.log('   - Turismo internacional')
  console.log('   - Múltiplas fachadas e perspectivas')
  console.log('   - Horários amplos (11h/dia)')
  console.log('   - Dados OSM extremamente detalhados')
  console.log('   - Acessibilidade completa')
  console.log('   - Infraestrutura turística desenvolvida')
  
  return comparison
}

// Função principal
function main() {
  console.log('🚀 Iniciando análise detalhada dos dados OSM da Sagrada Família\n')
  
  try {
    // Executar todas as análises
    const basicData = analyzeBasicData()
    const tags = analyzeTags()
    const geographicData = analyzeGeographicData()
    const accessibility = analyzeAccessibility()
    const culturalData = analyzeCulturalData()
    const dbFields = simulateDatabaseFields()
    const povOpportunities = analyzePOVOpportunities()
    const comparison = compareWithOtherMonuments()
    
    console.log('\n✅ Análise concluída com sucesso!')
    console.log('📊 Resumo:')
    console.log(`   - ${Object.keys(dbFields).length} campos podem ser adicionados ao banco`)
    console.log(`   - ${povOpportunities.existingViewpoints.length} viewpoints existentes`)
    console.log(`   - ${povOpportunities.activities.length} atividades disponíveis`)
    console.log(`   - Score de qualidade OSM: ${dbFields.osm_data_quality_score}/100`)
    console.log(`   - Horário de funcionamento: ${dbFields.opening_hours}`)
    console.log(`   - Área: ${dbFields.osm_area_m2.toLocaleString()} m²`)
    console.log(`   - Arquiteto: ${dbFields.architect}`)
    console.log(`   - Status UNESCO: ${dbFields.unesco_status}`)
    console.log(`   - Website: ${dbFields.website}`)
    
  } catch (error) {
    console.error('❌ Erro na análise:', error)
  }
}

// Executar a análise
main()
