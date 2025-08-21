import { POIInput, POVItem, POVGenerationMetrics } from '@/types/pov-types'
import { enrichPOIData, POIEnrichmentData } from '@/lib/googlePlaces'

interface POIProfile {
  type: 'landmark' | 'large_area' | 'building' | 'natural_feature' | 'infrastructure'
  height: 'ground' | 'low' | 'medium' | 'high' | 'very_high'
  size: 'small' | 'medium' | 'large' | 'massive'
  visibility: 'close_only' | 'medium_range' | 'long_range' | 'very_long_range'
  urban_density: 'open' | 'mixed' | 'dense' | 'very_dense'
}

interface GeometricConfig {
  rings: number[]           // Anéis de distância em metros
  sectorsPerRing: number   // Número de setores por anel
  minSeparation: number    // Separação mínima entre POVs
  environment: 'dense_urban' | 'mixed' | 'open_natural' | 'large_area'
  profile?: POIProfile
}

interface POVCandidate extends POVItem {
  ring: number
  sector: number
  score: number
}

export class GeometricPOVGenerator {
  
  async generatePOVs(attraction: any): Promise<POVItem[]> {
    const startTime = Date.now()
    
    try {
      console.log('🔢 Generating POVs geometrically for:', attraction.name)
      
      const coords = Array.isArray(attraction.coordinates) 
        ? attraction.coordinates[0] 
        : attraction.coordinates
      
      const poiInput: POIInput = {
        name: attraction.name,
        lat: coords?.latitude || 0,
        lng: coords?.longitude || 0,
        city: attraction.city,
        country: attraction.country,
        google_types: attraction.google_types || []
      }
      
      console.log(`📍 POI Input coordinates: ${poiInput.lat}, ${poiInput.lng}`)
      
      // 1. Enriquecer dados do POI usando Google Places API (se disponível)
      let enrichedData: POIEnrichmentData | null = null
      if (attraction.google_place_id) {
        console.log(`🔍 Attempting to enrich POI data using google_place_id: ${attraction.google_place_id}`)
        enrichedData = await enrichPOIData(attraction.google_place_id)
      }

      // 2. Criar perfil do POI
      const profile = this.createPOIProfile(poiInput)
      
      // 2. Detectar ambiente (fallback)
      const environment = this.detectEnvironment(poiInput)
      console.log(`🌍 Environment detected: ${environment}`)
      
      // 3. Configurar parâmetros baseados no perfil
      const config = this.getConfigForProfile(profile, environment)
      
      // 4. Gerar candidatos geométricos
      const candidates = this.generateCandidates(poiInput, config)
      console.log(`📐 Generated ${candidates.length} geometric candidates`)
      
      // 5. Filtrar e pontuar candidatos
      const scored = this.scoreAndFilterCandidates(candidates, config)
      
      // 6. Selecionar os melhores POVs
      const selected = this.selectBestPOVs(scored, config)
      
      const generationTime = Date.now() - startTime
      console.log(`✅ Generated ${selected.length} geometric POVs in ${generationTime}ms`)
      
      return selected
      
    } catch (error) {
      console.error('❌ Error in geometric generation:', error)
      throw error
    }
  }
  
  private createPOIProfile(poi: POIInput): POIProfile {
    const types = (poi.google_types || []).map(t => String(t).toLowerCase())
    
    // Classificação baseada em google_types
    const profile = this.classifyByGoogleTypes(types, poi)
    
    console.log(`🎯 POI Profile for ${poi.name}:`, {
      type: profile.type,
      height: profile.height,
      size: profile.size,
      visibility: profile.visibility,
      urban_density: profile.urban_density
    })
    
    return profile
  }

  private classifyByGoogleTypes(types: string[], poi: POIInput): POIProfile {
    // Landmarks elevados (visíveis de muito longe)
    if (types.some(t => ['mountain', 'natural_feature', 'peak'].includes(t)) ||
        poi.name.toLowerCase().includes('pico') ||
        poi.name.toLowerCase().includes('morro')) {
      return {
        type: 'landmark',
        height: 'very_high',
        size: 'large',
        visibility: 'very_long_range',
        urban_density: 'open'
      }
    }

    // Corpos d'água e áreas grandes
    if (types.some(t => ['park', 'lake', 'beach', 'stadium', 'airport', 'shopping_mall', 'university', 'establishment', 'point_of_interest'].includes(t)) ||
        poi.name.includes('lago') || poi.name.includes('parque') || poi.name.includes('praia') || poi.name.includes('estádio')) {
      const size = types.includes('airport') || types.includes('university') ? 'massive' :
                   types.includes('stadium') || types.includes('shopping_mall') ? 'large' :
                   poi.name.includes('lago') || poi.name.includes('lake') ? 'medium' :
                   'medium'
      
      // Determinar densidade urbana baseada no tipo
      const urban_density = types.includes('park') || poi.name.includes('lago') || poi.name.includes('praia') ? 'open' :
                            types.includes('airport') || types.includes('university') ? 'mixed' :
                            'mixed'
      
      return {
        type: 'large_area',
        height: 'ground',
        size,
        visibility: size === 'massive' ? 'long_range' : 'medium_range',
        urban_density
      }
    }

    // Edifícios altos
    if (types.some(t => ['skyscraper', 'building', 'establishment'].includes(t)) ||
        poi.name.toLowerCase().includes('edifício') ||
        poi.name.toLowerCase().includes('torre')) {
      return {
        type: 'building',
        height: 'high',
        size: 'medium',
        visibility: 'medium_range',
        urban_density: 'very_dense'
      }
    }

    // Pontes e infraestrutura
    if (types.some(t => ['bridge', 'infrastructure', 'transit_station'].includes(t))) {
      return {
        type: 'infrastructure',
        height: 'medium',
        size: 'medium',
        visibility: 'medium_range',
        urban_density: 'dense'
      }
    }

    // Atrações naturais
    if (types.some(t => ['tourist_attraction', 'point_of_interest'].includes(t))) {
      // Determinar altura baseada no nome
      const isElevated = poi.name.toLowerCase().includes('mirante') ||
                        poi.name.toLowerCase().includes('vista') ||
                        poi.name.toLowerCase().includes('overlook')
      
      return {
        type: 'natural_feature',
        height: isElevated ? 'high' : 'low',
        size: 'medium',
        visibility: isElevated ? 'long_range' : 'medium_range',
        urban_density: 'mixed'
      }
    }

    // Default para POIs não classificados
    return {
      type: 'landmark',
      height: 'medium',
      size: 'medium',
      visibility: 'medium_range',
      urban_density: 'mixed'
    }
  }

  private detectEnvironment(poi: POIInput): 'dense_urban' | 'mixed' | 'open_natural' | 'large_area' {
    const types = (poi.google_types || []).map(t => String(t).toLowerCase())
    const name = (poi.name || '').toLowerCase()
    const address = (poi.formatted_address || poi.vicinity || '').toLowerCase()

    // Detectar áreas grandes que precisam de POVs perimetrais
    const largeAreaHints = [
      // Corpos d'água
      'lake', 'lago', 'lagoa', 'represa', 'reservoir', 'pond', 'river', 'rio', 'creek', 'stream',
      // Parques e áreas verdes
      'park', 'parque', 'jardim', 'garden', 'square', 'praça', 'bosque', 'forest', 'floresta',
      // Praias e áreas costeiras
      'beach', 'praia', 'costa', 'waterfront', 'orla', 'marina',
      // Estádios e complexos
      'stadium', 'estádio', 'arena', 'complex', 'complexo', 'centro', 'shopping',
      // Aeroportos e grandes instalações
      'airport', 'aeroporto', 'terminal', 'campus', 'university', 'universidade',
      // Cemitérios e áreas extensas
      'cemetery', 'cemitério', 'memorial', 'convention', 'feira', 'expo'
    ]
    
    const largeAreaNameHints = [
      'lago', 'lagoa', 'represa', 'taboão', 'billings', 'guarapiranga',
      'parque', 'jardim', 'bosque', 'floresta', 'praia', 'orla',
      'estádio', 'arena', 'complexo', 'centro', 'shopping', 'aeroporto',
      'campus', 'universidade', 'cemitério', 'memorial'
    ]
    
    const hasLargeAreaType = types.some(t => largeAreaHints.some(h => t.includes(h)))
    const hasLargeAreaName = largeAreaNameHints.some(h => name.includes(h))
    const addressLargeArea = largeAreaHints.some(h => address.includes(h))

    if (hasLargeAreaType || hasLargeAreaName || addressLargeArea) {
      return 'large_area'
    }

    const naturalHints = ['park', 'natural', 'mountain', 'hill', 'peak', 'trail', 'national_park', 'forest', 'reserve', 'beach', 'island', 'waterfall', 'mirante']
    const nameNaturalHints = ['pico', 'morro', 'serra', 'parque', 'jaraguá', 'jaragua', 'mirante']

    const hasNaturalType = types.some(t => naturalHints.some(h => t.includes(h)))
    const hasNaturalName = nameNaturalHints.some(h => name.includes(h))
    const addressNatural = naturalHints.some(h => address.includes(h))

    if (hasNaturalType || hasNaturalName || addressNatural) {
      return 'open_natural'
    }

    // Grandes cidades = urbano denso
    const majorCities = ['são paulo', 'rio de janeiro', 'new york', 'london', 'tokyo', 'paris', 'madrid', 'barcelona']
    if (majorCities.some(city => poi.city.toLowerCase().includes(city))) {
      return 'dense_urban'
    }

    return 'mixed'
  }
  
  private getConfigForProfile(profile: POIProfile, env: 'dense_urban' | 'mixed' | 'open_natural' | 'large_area'): GeometricConfig {
    // Configurações específicas baseadas no perfil do POI
    const config = this.generateProfileBasedConfig(profile)
    config.environment = env
    config.profile = profile
    
    console.log(`⚙️ Config for ${profile.type} (${profile.visibility}):`, {
      rings: config.rings,
      sectors: config.sectorsPerRing,
      separation: config.minSeparation
    })
    
    return config
  }

  private generateProfileBasedConfig(profile: POIProfile): GeometricConfig {
    // Configurações baseadas na visibilidade e tipo do POI
    switch (profile.visibility) {
      case 'very_long_range': // Picos, montanhas
        return {
          rings: [1000, 3000, 8000, 15000, 25000],
          sectorsPerRing: 12, // 30° por setor
          minSeparation: 500,
          environment: 'open_natural'
        }
      
      case 'long_range': // Edifícios altos, mirantes, estádios grandes
        return {
          rings: [300, 800, 2000, 5000, 10000],
          sectorsPerRing: 12,
          minSeparation: 200,
          environment: 'mixed'
        }
      
      case 'medium_range': // Áreas grandes, edifícios médios
        return {
          rings: profile.type === 'large_area' 
            ? [50, 100, 200, 400, 800]    // Perímetro denso para áreas
            : [150, 400, 1000, 2500],     // Distâncias médias para edifícios
          sectorsPerRing: profile.type === 'large_area' ? 16 : 10,
          minSeparation: profile.type === 'large_area' ? 30 : 100,
          environment: profile.type === 'large_area' ? 'large_area' : 'mixed'
        }
      
      case 'close_only': // POIs que só são visíveis de perto
        return {
          rings: [25, 50, 100, 200],
          sectorsPerRing: 12,
          minSeparation: 20,
          environment: 'dense_urban'
        }
      
      default:
        return this.getConfigForEnvironment(profile.urban_density === 'very_dense' ? 'dense_urban' : 'mixed')
    }
  }

  private getConfigForEnvironment(env: 'dense_urban' | 'mixed' | 'open_natural' | 'large_area'): GeometricConfig {
    const configs = {
      dense_urban: {
        rings: [75, 150, 300, 600],        // Próximo para áreas densas
        sectorsPerRing: 8,                  // 45° por setor
        minSeparation: 50,
        environment: env
      },
      mixed: {
        rings: [100, 300, 800, 1500],      // Médio
        sectorsPerRing: 8,
        minSeparation: 80,
        environment: env
      },
      open_natural: {
        rings: [200, 500, 1200, 3000, 6000], // Amplo para natureza
        sectorsPerRing: 12,                    // 30° por setor, mais granular
        minSeparation: 100,
        environment: env
      },
      large_area: {
        rings: [50, 100, 200, 400, 800],      // Múltiplos anéis - perímetro completo
        sectorsPerRing: 16,                   // 22.5° por setor - cobertura densa
        minSeparation: 30,                    // Permite POVs próximos para cobertura completa
        environment: env
      }
    }
    
    return configs[env]
  }
  
  private generateCandidates(poi: POIInput, config: GeometricConfig): POVCandidate[] {
    const candidates: POVCandidate[] = []
    const degreesPerSector = 360 / config.sectorsPerRing
    
    config.rings.forEach((distance, ringIndex) => {
      for (let sector = 0; sector < config.sectorsPerRing; sector++) {
        const bearing = sector * degreesPerSector
        const coords = this.calculateDestination(poi.lat, poi.lng, distance, bearing)
        
        const candidate: POVCandidate = {
          name: this.generateName(distance, bearing, config.environment),
          lat: coords.lat,
          lng: coords.lng,
          azimuth_deg: (bearing + 180) % 360, // Azimute do POV para o POI
          distance_m: distance,
          access: this.estimateAccess(distance, bearing, config.environment),
          vantage: this.estimateVantage(distance, config.environment),
          visibility_quality: this.estimateVisibility(distance, config.environment),
          ring: ringIndex,
          sector: sector,
          score: 0 // Será calculado depois
        }
        
        candidates.push(candidate)
      }
    })
    
    return candidates
  }
  
  private calculateDestination(lat: number, lng: number, distance: number, bearing: number) {
    const R = 6371000 // Raio da Terra em metros
    const toRad = (deg: number) => deg * Math.PI / 180
    const toDeg = (rad: number) => rad * 180 / Math.PI
    
    const lat1 = toRad(lat)
    const lng1 = toRad(lng)
    const bearingRad = toRad(bearing)
    
    const lat2 = Math.asin(
      Math.sin(lat1) * Math.cos(distance / R) +
      Math.cos(lat1) * Math.sin(distance / R) * Math.cos(bearingRad)
    )
    
    const lng2 = lng1 + Math.atan2(
      Math.sin(bearingRad) * Math.sin(distance / R) * Math.cos(lat1),
      Math.cos(distance / R) - Math.sin(lat1) * Math.sin(lat2)
    )
    
    return {
      lat: parseFloat(toDeg(lat2).toFixed(8)), // 8 decimais = ~1.1m precisão
      lng: parseFloat(toDeg(lng2).toFixed(8))  // 8 decimais = ~1.1m precisão
    }
  }
  
  private generateName(distance: number, bearing: number, environment: string): string {
    const directions = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW']
    const dirIndex = Math.round(bearing / 45) % 8
    const direction = directions[dirIndex]
    
    // IMPORTANTE: Nomes genéricos pois coordenadas são calculadas matematicamente
    // A validação de estradas reais será feita pela IA na Etapa 3
    
    if (environment === 'large_area') {
      if (distance > 600) return `Area perimeter road ${direction}`
      if (distance > 300) return `Area access street ${direction}`
      if (distance > 150) return `Area boundary street ${direction}`
      if (distance > 75) return `Area entrance ${direction}`
      return `Area perimeter ${direction}`
    }
    
    if (environment === 'open_natural') {
      if (distance > 3000) return `Calculated highway point ${direction}`
      if (distance > 1000) return `Calculated road point ${direction}`
      if (distance > 500) return `Calculated access point ${direction}`
      return `Calculated local point ${direction}`
    }
    
    if (environment === 'dense_urban') {
      if (distance > 1000) return `Calculated elevated point ${direction}`
      if (distance > 400) return `Calculated bridge point ${direction}`
      if (distance < 200) return `Calculated street point ${direction}`
      return `Calculated avenue point ${direction}`
    }
    
    // mixed
    if (distance > 2000) return `Calculated highway point ${direction}`
    if (distance > 800) return `Calculated bridge point ${direction}`
    return `Calculated road point ${direction}`
  }
  
  private estimateAccess(distance: number, bearing: number, environment: string): 'walk' | 'car' | 'both' {
    // Priorizar acesso de carro para visualização durante condução
    
    if (environment === 'large_area') {
      // Áreas grandes: ruas ao redor são tipicamente acessíveis por carro
      if (distance > 400) return 'car'    // Ruas perimetrais distantes
      if (distance > 200) return 'both'   // Ruas perimetrais próximas
      if (distance > 100) return 'both'   // Ruas de acesso
      return 'both' // Muito próximo - pedestres e carros
    }
    
    if (environment === 'open_natural') {
      if (distance > 3000) return 'car'   // Rodovias distantes
      if (distance > 1000) return 'both'  // Estradas de acesso
      if (distance < 500) return 'both'   // Acesso próximo
      return 'car' // Estradas médias
    }
    
    if (environment === 'dense_urban') {
      if (distance < 200) return 'both'   // Ruas próximas
      if (distance < 1000) return 'car'   // Viadutos e marginais
      return 'car' // Pontos elevados acessíveis por rodovia
    }
    
    // mixed - priorizar car para condução
    if (distance < 300) return 'both'     // Ruas locais
    if (distance < 2000) return 'car'     // Rodovias e avenidas
    return 'car' // Estradas distantes
  }
  
  private estimateVantage(distance: number, environment: string): POVItem['vantage'] {
    // Priorizar tipos de vantage acessíveis por carro em movimento
    
    if (environment === 'large_area') {
      // Áreas grandes: foco em ruas e pontes ao redor
      if (distance > 600) return 'highway'    // Rodovias perimetrais
      if (distance > 300) return 'street'     // Ruas perimetrais
      if (distance > 150) return 'bridge'     // Possíveis pontes ou viadutos
      if (distance > 75) return 'street'      // Ruas de acesso
      return 'street' // Ruas próximas ao perímetro
    }
    
    if (environment === 'open_natural') {
      if (distance > 3000) return 'highway'   // Rodovias distantes
      if (distance > 1000) return 'bridge'    // Pontes e viadutos
      if (distance > 500) return 'street'     // Estradas de acesso
      return 'street' // Ruas próximas
    }
    
    if (environment === 'dense_urban') {
      if (distance > 1000) return 'highway'   // Marginais e viadutos
      if (distance > 400) return 'bridge'     // Pontes urbanas
      if (distance > 150) return 'street'     // Avenidas
      return 'street' // Ruas locais
    }
    
    // mixed - foco em infraestrutura rodoviária
    if (distance > 2000) return 'highway'     // Rodovias
    if (distance > 800) return 'bridge'       // Pontes e viadutos
    if (distance > 300) return 'street'       // Avenidas
    return 'street' // Ruas locais
  }
  
  private estimateVisibility(distance: number, environment: string): POVItem['visibility_quality'] {
    if (environment === 'open_natural') {
      if (distance > 3000) return 'excellent'
      if (distance > 800) return 'good'
      return 'moderate'
    }
    
    if (environment === 'dense_urban') {
      if (distance > 500) return 'good'      // Pontos elevados
      if (distance < 100) return 'limited'   // Rua próxima com obstáculos
      return 'moderate'
    }
    
    return 'good'
  }
  
  private scoreAndFilterCandidates(candidates: POVCandidate[], config: GeometricConfig): POVCandidate[] {
    return candidates.map(candidate => {
      let score = 100 // Base score
      
      // Bonificação por diversidade angular
      score += candidate.sector * 2
      
      // Penalização por distância excessiva em urbano
      if (config.environment === 'dense_urban' && candidate.distance_m > 800) {
        score -= 30
      }
      
      // Bonificação para pontos próximos adequados para carro
      if (candidate.access === 'both' && candidate.distance_m < 200) {
        score += 20
      }
      
      // Bonificação por qualidade de visibilidade
      const visibilityBonus = {
        'excellent': 25,
        'good': 15,
        'moderate': 5,
        'limited': -10
      }
      score += visibilityBonus[candidate.visibility_quality]
      
      return { ...candidate, score }
    })
  }
  
  private selectBestPOVs(candidates: POVCandidate[], config: GeometricConfig): POVItem[] {
    // Ordenar por score
    const sorted = candidates.sort((a, b) => b.score - a.score)
    
    const selected: POVItem[] = []
    const minSeparation = config.minSeparation
    
    for (const candidate of sorted) {
      // Verificar separação mínima
      const tooClose = selected.some(existing => {
        const distance = this.calculateDistance(
          candidate.lat, candidate.lng,
          existing.lat, existing.lng
        )
        return distance < minSeparation
      })
      
      if (!tooClose && selected.length < 8) { // Máximo 8 POVs
        selected.push({
          name: candidate.name,
          lat: candidate.lat,
          lng: candidate.lng,
          azimuth_deg: candidate.azimuth_deg,
          distance_m: candidate.distance_m,
          access: candidate.access,
          vantage: candidate.vantage,
          visibility_quality: candidate.visibility_quality
        })
      }
    }
    
    // Garantir pelo menos um POV acessível por carro próximo
    const hasNearCarAccess = selected.some(p => 
      (p.access === 'car' || p.access === 'both') && p.distance_m <= 300
    )
    
    if (!hasNearCarAccess && selected.length > 0) {
      // Forçar o primeiro POV próximo a ser acessível por carro
      const nearestIdx = selected.findIndex(p => p.distance_m <= 300)
      if (nearestIdx >= 0) {
        selected[nearestIdx] = {
          ...selected[nearestIdx],
          access: 'both',
          vantage: 'street'
        }
      }
    }
    
    return selected
  }
  
  private calculateDistance(lat1: number, lng1: number, lat2: number, lng2: number): number {
    const R = 6371000
    const toRad = (deg: number) => deg * Math.PI / 180
    
    const dLat = toRad(lat2 - lat1)
    const dLng = toRad(lng2 - lng1)
    const a = Math.sin(dLat/2) * Math.sin(dLat/2) +
              Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) *
              Math.sin(dLng/2) * Math.sin(dLng/2)
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a))
    
    return R * c
  }
}
