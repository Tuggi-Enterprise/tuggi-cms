import { createClient } from '@supabase/supabase-js'
import 'dotenv/config'

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!

if (!supabaseUrl || !supabaseServiceKey) {
  throw new Error('Missing Supabase environment variables')
}

const supabase = createClient(supabaseUrl, supabaseServiceKey)

export interface POI {
  id: string
  name: string
  lat: number
  lng: number
  google_types?: string[]
  category?: string
  urban_density?: string
}

export interface POVSuggestion {
  id: string
  lat: number
  lng: number
  distance_m: number
  bearing_deg: number
  access_type: 'walk' | 'car' | 'both'
  vantage_type?: string
  confidence_score: number
  reasoning: string
  estimated_visibility: 'poor' | 'fair' | 'good' | 'excellent'
  pattern_based: boolean
}

export interface SuggestionRequest {
  poi_id: string
  poi_name: string
  poi_lat: number
  poi_lng: number
  poi_types?: string[]
  limit?: number
  min_confidence?: number
}

export class POVSuggestionsService {
  
  /**
   * Gera sugestões de trigger points para um POI
   */
  async generateSuggestions(request: SuggestionRequest): Promise<POVSuggestion[]> {
    console.log(`🎯 Generating POV suggestions for POI: ${request.poi_name}`)
    
    try {
      // 1. Analisar POI e determinar características
      const poiAnalysis = await this.analyzePOI(request)
      console.log(`📊 POI Analysis: ${poiAnalysis.category} in ${poiAnalysis.urban_density} area`)
      
      // 2. Buscar exemplos similares
      const similarExamples = await this.findSimilarExamples(poiAnalysis)
      console.log(`🔍 Found ${similarExamples.length} similar examples`)
      
      // 3. Extrair padrões de sucesso
      const patterns = this.extractSuccessPatterns(similarExamples)
      console.log(`📈 Extracted ${patterns.length} success patterns`)
      
      // 4. Gerar candidatos baseado nos padrões
      const candidates = this.generateCandidates(request, patterns)
      console.log(`🎯 Generated ${candidates.length} candidates`)
      
      // 5. Validar e rankear candidatos
      const validatedCandidates = await this.validateCandidates(candidates, similarExamples, poiAnalysis)
      console.log(`✅ Validated ${validatedCandidates.length} candidates`)
      
      // 6. Filtrar e retornar top sugestões
      const limit = request.limit || 10
      const minConfidence = request.min_confidence || 70
      
      const suggestions = validatedCandidates
        .filter(c => c.confidence_score >= minConfidence)
        .sort((a, b) => b.confidence_score - a.confidence_score)
        .slice(0, limit)
      
      console.log(`🎉 Returning ${suggestions.length} suggestions`)
      return suggestions
      
    } catch (error) {
      console.error('❌ Error generating suggestions:', error)
      throw new Error(`Failed to generate suggestions: ${error instanceof Error ? error.message : String(error)}`)
    }
  }
  
  /**
   * Analisa características do POI
   */
  private async analyzePOI(request: SuggestionRequest) {
    const category = this.classifyPOICategory(request.poi_types || [], request.poi_name)
    const urbanDensity = this.detectUrbanDensity(request.poi_lat, request.poi_lng)
    
    return {
      category,
      urban_density: urbanDensity,
      poi_types: request.poi_types || [],
      name: request.poi_name
    }
  }
  
  /**
   * Busca exemplos similares no dataset de treinamento
   */
  private async findSimilarExamples(poiAnalysis: any) {
    const { data: examples, error } = await supabase
      .schema('core')
      .from('pov_training_examples')
      .select(`
        id,
        poi_name,
        poi_category,
        urban_density,
        distance_m,
        bearing_deg,
        access_type,
        trigger_type,
        priority,
        quality_score,
        is_positive_example,
        context_text
      `)
      .eq('poi_category', poiAnalysis.category)
      .eq('urban_density', poiAnalysis.urban_density)
      .eq('is_positive_example', true)
      .gte('quality_score', 80)
      .order('quality_score', { ascending: false })
      .limit(50)
    
    if (error) {
      throw new Error(`Failed to fetch similar examples: ${error.message}`)
    }
    
    return examples || []
  }
  
  /**
   * Extrai padrões de sucesso dos exemplos
   */
  private extractSuccessPatterns(examples: any[]) {
    if (examples.length === 0) {
      return []
    }
    
    // Agrupar por características similares
    const patterns = []
    
    // Padrão 1: Distâncias de sucesso
    const distances = examples.map(ex => ex.distance_m)
    const avgDistance = distances.reduce((a, b) => a + b, 0) / distances.length
    const distanceRange = {
      min: Math.min(...distances),
      max: Math.max(...distances),
      avg: Math.round(avgDistance)
    }
    
    // Padrão 2: Direções preferidas
    const bearings = examples.map(ex => ex.bearing_deg)
    const bearingSectors = this.groupBearingsIntoSectors(bearings)
    
    // Padrão 3: Tipos de acesso preferidos
    const accessTypes = examples.map(ex => ex.access_type)
    const accessTypeCounts = accessTypes.reduce((acc, type) => {
      acc[type] = (acc[type] || 0) + 1
      return acc
    }, {} as Record<string, number>)
    
    const preferredAccess = Object.entries(accessTypeCounts)
      .sort(([,a], [,b]) => b - a)[0][0]
    
    patterns.push({
      type: 'distance',
      data: distanceRange,
      confidence: examples.length / 50 // Normalizado
    })
    
    patterns.push({
      type: 'bearing',
      data: bearingSectors,
      confidence: examples.length / 50
    })
    
    patterns.push({
      type: 'access',
      data: { preferred: preferredAccess, distribution: accessTypeCounts },
      confidence: examples.length / 50
    })
    
    return patterns
  }
  
  /**
   * Agrupa bearings em setores (N, NE, E, SE, S, SW, W, NW)
   */
  private groupBearingsIntoSectors(bearings: number[]) {
    const sectors = {
      N: 0, NE: 0, E: 0, SE: 0, S: 0, SW: 0, W: 0, NW: 0
    }
    
    bearings.forEach(bearing => {
      const normalized = (bearing + 22.5) % 360
      const sectorIndex = Math.floor(normalized / 45)
      const sectorNames = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW']
      const sector = sectorNames[sectorIndex]
      sectors[sector as keyof typeof sectors]++
    })
    
    return sectors
  }
  
  /**
   * Gera candidatos baseado nos padrões
   */
  private generateCandidates(request: SuggestionRequest, patterns: any[]) {
    const candidates: POVSuggestion[] = []
    
    // Encontrar padrão de distância
    const distancePattern = patterns.find(p => p.type === 'distance')
    if (!distancePattern) return candidates
    
    // Encontrar padrão de direção
    const bearingPattern = patterns.find(p => p.type === 'bearing')
    if (!bearingPattern) return candidates
    
    // Encontrar padrão de acesso
    const accessPattern = patterns.find(p => p.type === 'access')
    
    const distances = this.generateDistanceCandidates(distancePattern.data)
    const bearings = this.generateBearingCandidates(bearingPattern.data)
    
    // Gerar candidatos para cada combinação
    for (const distance of distances) {
      for (const bearing of bearings) {
        const candidate = this.calculateDestination(
          request.poi_lat, 
          request.poi_lng, 
          bearing, 
          distance
        )
        
        candidates.push({
          id: `candidate_${Date.now()}_${Math.random()}`,
          lat: candidate.lat,
          lng: candidate.lng,
          distance_m: distance,
          bearing_deg: bearing,
          access_type: accessPattern?.data.preferred || 'both',
          confidence_score: 75, // Base score, será refinado
          reasoning: `Based on ${patterns.length} success patterns`,
          estimated_visibility: 'good',
          pattern_based: true
        })
      }
    }
    
    return candidates
  }
  
  /**
   * Gera candidatos de distância baseado no padrão
   */
  private generateDistanceCandidates(distancePattern: any) {
    const distances = []
    
    // Distância média
    distances.push(distancePattern.avg)
    
    // Distâncias típicas
    if (distancePattern.min !== distancePattern.avg) {
      distances.push(distancePattern.min)
    }
    if (distancePattern.max !== distancePattern.avg) {
      distances.push(distancePattern.max)
    }
    
    // Distâncias intermediárias
    const mid1 = Math.round((distancePattern.min + distancePattern.avg) / 2)
    const mid2 = Math.round((distancePattern.avg + distancePattern.max) / 2)
    
    if (mid1 !== distancePattern.avg && mid1 !== distancePattern.min) {
      distances.push(mid1)
    }
    if (mid2 !== distancePattern.avg && mid2 !== distancePattern.max) {
      distances.push(mid2)
    }
    
    return [...new Set(distances)].sort((a, b) => a - b)
  }
  
  /**
   * Gera candidatos de direção baseado no padrão
   */
  private generateBearingCandidates(bearingPattern: any) {
    const bearings = []
    
    // Direções com mais exemplos (top 4)
    const sortedSectors = Object.entries(bearingPattern)
      .sort(([,a], [,b]) => (b as number) - (a as number))
      .slice(0, 4)
    
    for (const [sector] of sortedSectors) {
      const bearing = this.sectorToBearing(sector)
      bearings.push(bearing)
    }
    
    return bearings
  }
  
  /**
   * Converte setor (N, NE, E, etc.) para bearing em graus
   */
  private sectorToBearing(sector: string): number {
    const sectorMap: Record<string, number> = {
      'N': 0, 'NE': 45, 'E': 90, 'SE': 135,
      'S': 180, 'SW': 225, 'W': 270, 'NW': 315
    }
    return sectorMap[sector] || 0
  }
  
  /**
   * Calcula destino baseado em origem, bearing e distância
   */
  private calculateDestination(lat: number, lng: number, bearing: number, distance: number) {
    const R = 6371000 // Earth radius in meters
    const lat1 = lat * Math.PI / 180
    const lng1 = lng * Math.PI / 180
    const bearingRad = bearing * Math.PI / 180
    
    const lat2 = Math.asin(
      Math.sin(lat1) * Math.cos(distance / R) +
      Math.cos(lat1) * Math.sin(distance / R) * Math.cos(bearingRad)
    )
    
    const lng2 = lng1 + Math.atan2(
      Math.sin(bearingRad) * Math.sin(distance / R) * Math.cos(lat1),
      Math.cos(distance / R) - Math.sin(lat1) * Math.sin(lat2)
    )
    
    return {
      lat: lat2 * 180 / Math.PI,
      lng: lng2 * 180 / Math.PI
    }
  }
  
  /**
   * Valida candidatos usando IA e contexto
   */
  private async validateCandidates(candidates: POVSuggestion[], similarExamples: any[], poiAnalysis: any) {
    const validatedCandidates = []
    
    for (const candidate of candidates) {
      try {
        // Calcular score baseado em similaridade com exemplos
        const similarityScore = this.calculateSimilarityScore(candidate, similarExamples)
        
        // Ajustar score baseado em fatores ambientais
        const environmentalScore = this.calculateEnvironmentalScore(candidate, poiAnalysis)
        
        // Score final
        const finalScore = Math.min(100, similarityScore + environmentalScore)
        
        validatedCandidates.push({
          ...candidate,
          confidence_score: finalScore,
          reasoning: `Similarity: ${similarityScore.toFixed(1)}, Environment: ${environmentalScore.toFixed(1)}`
        })
        
      } catch (error) {
        console.warn(`⚠️ Failed to validate candidate ${candidate.id}:`, error)
        // Incluir com score baixo
        validatedCandidates.push({
          ...candidate,
          confidence_score: 30,
          reasoning: 'Validation failed'
        })
      }
    }
    
    return validatedCandidates
  }
  
  /**
   * Calcula score de similaridade com exemplos existentes
   */
  private calculateSimilarityScore(candidate: POVSuggestion, examples: any[]): number {
    let totalScore = 0
    let count = 0
    
    for (const example of examples) {
      // Similaridade de distância
      const distanceDiff = Math.abs(candidate.distance_m - example.distance_m)
      const distanceScore = Math.max(0, 100 - distanceDiff / 10)
      
      // Similaridade de direção
      const bearingDiff = Math.abs(candidate.bearing_deg - example.bearing_deg)
      const bearingScore = Math.max(0, 100 - bearingDiff / 5)
      
      // Similaridade de acesso
      const accessScore = candidate.access_type === example.access_type ? 100 : 50
      
      const exampleScore = (distanceScore + bearingScore + accessScore) / 3
      totalScore += exampleScore * (example.quality_score / 100)
      count++
    }
    
    return count > 0 ? totalScore / count : 50
  }
  
  /**
   * Calcula score baseado em fatores ambientais
   */
  private calculateEnvironmentalScore(candidate: POVSuggestion, poiAnalysis: any): number {
    let score = 0
    
    // Bônus para distâncias ideais baseado na densidade urbana
    if (poiAnalysis.urban_density === 'very_dense') {
      if (candidate.distance_m >= 50 && candidate.distance_m <= 300) score += 20
    } else if (poiAnalysis.urban_density === 'dense') {
      if (candidate.distance_m >= 100 && candidate.distance_m <= 500) score += 20
    } else {
      if (candidate.distance_m >= 200 && candidate.distance_m <= 1000) score += 20
    }
    
    // Bônus para tipos de acesso apropriados
    if (poiAnalysis.category === 'shopping' && candidate.access_type === 'car') score += 15
    if (poiAnalysis.category === 'park' && candidate.access_type === 'walk') score += 15
    
    return score
  }
  
  /**
   * Classifica categoria do POI
   */
  private classifyPOICategory(googleTypes: string[], name: string): string {
    if (googleTypes.includes('park') || googleTypes.includes('natural_feature')) {
      return 'park'
    }
    if (googleTypes.includes('shopping_mall') || name.toLowerCase().includes('shopping')) {
      return 'shopping'
    }
    if (googleTypes.includes('museum') || googleTypes.includes('tourist_attraction')) {
      return 'landmark'
    }
    if (googleTypes.includes('establishment') || googleTypes.includes('point_of_interest')) {
      return 'building'
    }
    return 'building'
  }
  
  /**
   * Detecta densidade urbana baseada em coordenadas
   */
  private detectUrbanDensity(lat: number, lng: number): string {
    // São Paulo centro: very_dense
    if (lat >= -23.57 && lat <= -23.52 && lng >= -46.66 && lng <= -46.62) {
      return 'very_dense'
    }
    // São Paulo periferia: dense
    if (lat >= -23.75 && lat <= -23.40 && lng >= -46.80 && lng <= -46.40) {
      return 'dense'
    }
    // Outras áreas metropolitanas: mixed
    if (lat >= -23.85 && lat <= -23.30 && lng >= -46.90 && lng <= -46.30) {
      return 'mixed'
    }
    // Áreas rurais: open
    return 'open'
  }
}
