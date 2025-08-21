import { createClient } from '@supabase/supabase-js'
import { POIInput, POVItem, GeminiPOVResponse } from '@/types/pov-types'
import { POVSuggestionsService } from './pov-suggestions-service'
import { callGeminiAPI } from '@/lib/utils/rate-limiter'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

export interface POIGeometry {
  bounds?: {
    northeast: { lat: number; lng: number }
    southwest: { lat: number; lng: number }
  }
  viewport?: {
    northeast: { lat: number; lng: number }
    southwest: { lat: number; lng: number }
  }
  area_size?: 'small' | 'medium' | 'large' | 'very_large'
  estimated_radius?: number
}

export interface EnhancedPOVRequest {
  poi_id: string
  poi_name: string
  poi_lat: number
  poi_lng: number
  poi_types?: string[]
  city?: string
  country?: string
  limit?: number
  use_gemini?: boolean
  geometry?: POIGeometry
}

export interface EnhancedPOVSuggestion {
  id: string
  lat: number
  lng: number
  distance_m: number
  bearing_deg: number
  access_type: 'walk' | 'car' | 'both'
  vantage_type: string
  confidence_score: number
  reasoning: string
  estimated_visibility: 'poor' | 'fair' | 'good' | 'excellent'
  source: 'pattern_based' | 'gemini_enhanced' | 'gemini_original'
  gemini_reasoning?: string
}

export class GeminiEnhancedPOVService {
  private patternService = new POVSuggestionsService()

  /**
   * Gera sugestões separadas: padrões históricos + Gemini AI (sem consolidação)
   */
  async generateEnhancedSuggestions(request: EnhancedPOVRequest): Promise<EnhancedPOVSuggestion[]> {
    console.log(`🚀 Generating separate AI suggestions for: ${request.poi_name}`)
    
    try {
      const allSuggestions: EnhancedPOVSuggestion[] = []

      // 1. Detectar geometria do POI se não fornecida
      if (!request.geometry) {
        request.geometry = await this.detectPOIGeometry(request)
        console.log(`📐 Detected POI area: ${request.geometry.area_size} (radius: ~${request.geometry.estimated_radius}m)`)
      }

      // 2. Gerar sugestões baseadas em padrões (aprendizado histórico)
      const patternSuggestions = await this.generatePatternBasedSuggestions(request)
      allSuggestions.push(...patternSuggestions)
      console.log(`🧠 Generated ${patternSuggestions.length} pattern-based suggestions`)

      // 3. Usar Gemini para gerar novas sugestões (sem consolidação)
      if (request.use_gemini !== false) {
        const geminiSuggestions = await this.generateGeminiEnhancedSuggestions(request, []) // Sem sugestões existentes
        allSuggestions.push(...geminiSuggestions)
        console.log(`🤖 Generated ${geminiSuggestions.length} Gemini AI suggestions`)
      }

      // 4. NÃO consolidar - manter separados para comparação
      console.log(`📊 Returning ${allSuggestions.length} separate suggestions for comparison`)
      return allSuggestions

    } catch (error) {
      console.error('❌ Error generating AI suggestions:', error)
      throw error
    }
  }

  /**
   * Detecta a geometria e área do POI
   */
  private async detectPOIGeometry(request: EnhancedPOVRequest): Promise<POIGeometry> {
    try {
      // Estimar área baseada nos tipos do POI
      const poiTypes = request.poi_types || []
      let estimatedRadius = 50 // Padrão para POIs pequenos
      let areaSize: 'small' | 'medium' | 'large' | 'very_large' = 'medium'

      // Classificação por tipos conhecidos
      if (poiTypes.some(type => ['park', 'natural_feature'].includes(type))) {
        // Parques podem ser grandes
        estimatedRadius = 200
        areaSize = 'large'
      } else if (poiTypes.some(type => ['shopping_mall', 'university', 'hospital'].includes(type))) {
        // Complexos médios a grandes
        estimatedRadius = 150
        areaSize = 'medium'
      } else if (poiTypes.some(type => ['tourist_attraction', 'museum', 'church'].includes(type))) {
        // Atrações pontuais
        estimatedRadius = 75
        areaSize = 'small'
      } else if (poiTypes.some(type => ['establishment', 'point_of_interest'].includes(type))) {
        // POIs genéricos - médio
        estimatedRadius = 100
        areaSize = 'medium'
      }

      // Ajustar baseado no nome
      const name = request.poi_name.toLowerCase()
      if (name.includes('parque') || name.includes('park')) {
        estimatedRadius = Math.max(estimatedRadius, 200)
        areaSize = 'large'
      } else if (name.includes('shopping') || name.includes('mall')) {
        estimatedRadius = Math.max(estimatedRadius, 150)
        areaSize = 'medium'
      } else if (name.includes('ponte') || name.includes('bridge')) {
        estimatedRadius = 100
        areaSize = 'medium'
      } else if (name.includes('museu') || name.includes('museum')) {
        estimatedRadius = 75
        areaSize = 'small'
      }

      // Criar bounds estimados baseado no raio
      const latOffset = estimatedRadius / 111000 // Aproximadamente 1 grau = 111km
      const lngOffset = estimatedRadius / (111000 * Math.cos(request.poi_lat * Math.PI / 180))

      const geometry: POIGeometry = {
        bounds: {
          northeast: { lat: request.poi_lat + latOffset, lng: request.poi_lng + lngOffset },
          southwest: { lat: request.poi_lat - latOffset, lng: request.poi_lng - lngOffset }
        },
        viewport: {
          northeast: { lat: request.poi_lat + latOffset * 1.5, lng: request.poi_lng + lngOffset * 1.5 },
          southwest: { lat: request.poi_lat - latOffset * 1.5, lng: request.poi_lng - lngOffset * 1.5 }
        },
        area_size: areaSize,
        estimated_radius: estimatedRadius
      }

      return geometry
    } catch (error) {
      console.error('Error detecting POI geometry:', error)
      // Fallback para geometria padrão
      return {
        area_size: 'medium',
        estimated_radius: 100
      }
    }
  }

  /**
   * Estratégia de cobertura baseada no tamanho da área
   */
  private getAreaStrategy(areaSize: 'small' | 'medium' | 'large' | 'very_large'): string {
    switch (areaSize) {
      case 'small':
        return 'Single optimal viewpoint with direct sightline'
      case 'medium':
        return 'Multiple angles covering main facades/entrances'
      case 'large':
        return 'Perimeter coverage with overview perspectives'
      case 'very_large':
        return 'Strategic entrance points + elevated overviews'
      default:
        return 'Balanced multi-angle coverage'
    }
  }

  /**
   * Gera sugestões baseadas em padrões históricos
   */
  private async generatePatternBasedSuggestions(request: EnhancedPOVRequest): Promise<EnhancedPOVSuggestion[]> {
    try {
      const patternRequest = {
        poi_id: request.poi_id,
        poi_name: request.poi_name,
        poi_lat: request.poi_lat,
        poi_lng: request.poi_lng,
        poi_types: request.poi_types,
        limit: 5 // Limite menor para padrões
      }

      const patternSuggestions = await this.patternService.generateSuggestions(patternRequest)
      
      return patternSuggestions.map(suggestion => ({
        ...suggestion,
        source: 'pattern_based' as const,
        vantage_type: suggestion.vantage_type || 'general'
      }))
    } catch (error) {
      console.error('Error generating pattern-based suggestions:', error)
      return []
    }
  }

  /**
   * Usa Gemini para melhorar sugestões existentes e gerar novas
   */
  private async generateGeminiEnhancedSuggestions(
    request: EnhancedPOVRequest, 
    existingSuggestions: EnhancedPOVSuggestion[]
  ): Promise<EnhancedPOVSuggestion[]> {
    try {
      // Buscar contexto adicional (feedback histórico, trigger points existentes)
      const context = await this.gatherContextData(request)
      
      // Preparar prompt para o Gemini
      const prompt = this.buildGeminiPrompt(request, existingSuggestions, context)
      
      // Chamar Gemini API
      const geminiResponse = await callGeminiAPI('gemini-1.5-pro', prompt, 'pov_enhancement')
      
      // Processar resposta
      return this.processGeminiResponse(geminiResponse, request)
      
    } catch (error) {
      console.error('Error with Gemini enhancement:', error)
      return []
    }
  }

  /**
   * Busca dados de contexto para informar o Gemini
   */
  private async gatherContextData(request: EnhancedPOVRequest) {
    try {
      // Buscar trigger points existentes próximos
      const { data: nearbyTriggerPoints } = await supabase
        .schema('core')
        .from('trigger_points_with_coords')
        .select('*')
        .neq('attraction_id', request.poi_id)
        .limit(10)

      // Buscar feedback histórico para POIs similares
      const { data: historicalFeedback } = await supabase
        .schema('core')
        .from('pov_training_examples')
        .select('*')
        .eq('is_positive_example', false) // Focar em exemplos rejeitados
        .limit(20)

      // Buscar POIs similares na mesma região
      const { data: similarPOIs } = await supabase
        .schema('core')
        .from('attractions')
        .select('name, google_types, city')
        .eq('city', request.city || '')
        .neq('id', request.poi_id)
        .limit(5)

      return {
        nearbyTriggerPoints: nearbyTriggerPoints || [],
        historicalFeedback: historicalFeedback || [],
        similarPOIs: similarPOIs || []
      }
    } catch (error) {
      console.error('Error gathering context:', error)
      return { nearbyTriggerPoints: [], historicalFeedback: [], similarPOIs: [] }
    }
  }

  /**
   * Constrói o prompt para o Gemini
   */
  private buildGeminiPrompt(
    request: EnhancedPOVRequest, 
    existingSuggestions: EnhancedPOVSuggestion[], 
    context: any
  ): string {
    const rejectedPatterns = context.historicalFeedback
      .map((fb: any) => `- ${fb.feedback || 'No specific reason'} (Distance: ${fb.distance_m}m, Direction: ${fb.bearing_deg}°)`)
      .slice(0, 10)
      .join('\n')

    const geometry = request.geometry
    const areaInfo = geometry ? `
**POI AREA ANALYSIS**:
- **Size**: ${geometry.area_size} (estimated radius: ~${geometry.estimated_radius}m)
- **Bounds**: NE(${geometry.bounds?.northeast.lat.toFixed(4)}, ${geometry.bounds?.northeast.lng.toFixed(4)}) to SW(${geometry.bounds?.southwest.lat.toFixed(4)}, ${geometry.bounds?.southwest.lng.toFixed(4)})
- **Coverage Strategy**: ${geometry.area_size ? this.getAreaStrategy(geometry.area_size) : 'Balanced multi-angle coverage'}` : ''

    return `You are an expert AI for AUDIO TRIGGER POINT optimization. Generate 3-5 strategic locations where tourists will hear audio descriptions about the POI.

**CRITICAL MISSION**: These are audio activation zones. When tourists pass through these points, they will automatically hear descriptive audio about the POI. The locations must be:
1. **Naturally traversed** by tourists (main roads, popular routes, transit paths)
2. **Optimal for audio experience** (good POI visibility + natural stopping/slowing points)
3. **Accessible by target audience** (car tourists are priority)

**POI TARGET**: ${request.poi_name} at ${request.poi_lat}, ${request.poi_lng} (${request.city || 'Unknown'})
**POI Types**: ${request.poi_types?.join(', ') || 'Unknown'}
${areaInfo}

**AUDIO ACTIVATION STRATEGY**:
- **Primary**: Main roads/highways where cars naturally slow down with POI views
- **Secondary**: Parking areas where tourists stop and can observe while listening
- **Tertiary**: Pedestrian areas with high foot traffic and clear sightlines

**ACCESS PRIORITY** (for audio trigger effectiveness):
1. **"car" access** - Main roads, highway viewpoints, drive-by locations
2. **"both" access** - Parking + short walk areas, transit stops
3. **"walk" only** - AVOID unless exceptional foot traffic

**DISTANCE OPTIMIZATION** for audio experience:
- **Small POIs** (museums, monuments): 100-400m (intimate audio experience)
- **Medium POIs** (shopping, buildings): 200-600m (comprehensive audio coverage)  
- **Large POIs** (parks, complexes): 300-800m (overview audio perspective)

**REJECTED PATTERNS** (avoid these failed locations):
${rejectedPatterns ? rejectedPatterns.split('\n').slice(0, 5).join('\n') : 'None available'}

**GENERATE AUDIO TRIGGER POINTS** prioritizing:
- **Main approach roads** where tourists naturally arrive
- **Highway overpasses/bridges** with unobstructed POI views
- **Popular parking areas** where tourists stop and observe
- **Public transit stops** with POI visibility
- **Tourist route intersections** with natural slowing points
- **Scenic pullouts** and designated viewpoints

**STRICTLY AVOID**:
- Private property, restricted access areas
- Building rooftops, hiking trails requiring effort
- Areas with poor POI visibility or audio interference
- Locations where tourists don't naturally pass

**OUTPUT** (JSON only, no explanations):
{
  "enhanced_suggestions": [
    {
      "action": "new",
      "lat": -23.5505,
      "lng": -46.6333,
      "distance_m": 250,
      "bearing_deg": 45,
      "access_type": "car",
      "vantage_type": "main_road",
      "confidence_score": 90,
      "reasoning": "Main approach road where tourists naturally slow down, excellent POI visibility for audio experience",
      "estimated_visibility": "excellent"
    }
  ]
}

**AUDIO TRIGGER EXAMPLES**:
✅ **EXCELLENT**: Main roads with POI views, popular parking areas, tourist route points, highway scenic stops
❌ **POOR**: Hidden locations, private areas, places tourists don't naturally visit

Remember: These points will trigger automatic audio - prioritize natural tourist flow patterns and clear POI visibility.`
  }

  /**
   * Processa a resposta do Gemini
   */
  private processGeminiResponse(geminiResponse: any, request: EnhancedPOVRequest): EnhancedPOVSuggestion[] {
    try {
      const suggestions: EnhancedPOVSuggestion[] = []
      
      if (geminiResponse.enhanced_suggestions) {
        geminiResponse.enhanced_suggestions.forEach((suggestion: any, index: number) => {
          // Filtrar sugestões "walk" impraticáveis
          if (this.isImpracticalWalkSuggestion(suggestion)) {
            console.log(`🚫 Filtering impractical walk suggestion: ${suggestion.vantage_type} - ${suggestion.reasoning}`)
            return // Skip esta sugestão
          }

          const enhancedSuggestion: EnhancedPOVSuggestion = {
            id: suggestion.action === 'enhance' 
              ? `enhanced_${suggestion.original_id}` 
              : `gemini_${Date.now()}_${index}`,
            lat: suggestion.lat,
            lng: suggestion.lng,
            distance_m: suggestion.distance_m,
            bearing_deg: suggestion.bearing_deg,
            access_type: suggestion.access_type,
            vantage_type: suggestion.vantage_type,
            confidence_score: suggestion.confidence_score,
            reasoning: suggestion.reasoning,
            estimated_visibility: suggestion.estimated_visibility,
            source: suggestion.action === 'enhance' ? 'gemini_enhanced' : 'gemini_original',
            gemini_reasoning: suggestion.gemini_reasoning
          }
          
          suggestions.push(enhancedSuggestion)
        })
      }
      
      return suggestions
    } catch (error) {
      console.error('Error processing Gemini response:', error)
      return []
    }
  }

  /**
   * Verifica se uma sugestão "walk" é impraticável
   */
  private isImpracticalWalkSuggestion(suggestion: any): boolean {
    if (suggestion.access_type !== 'walk') {
      return false // Não é walk, não precisa filtrar
    }

    const impracticalKeywords = [
      'rooftop', 'roof', 'building top', 'top of', 'alto de', 'topo de', 'cobertura',
      'balcony', 'balcão', 'varanda', 'terraço', 'terrace',
      'climbing', 'hiking', 'escalada', 'caminhada íngreme',
      'private', 'restricted', 'privado', 'restrito',
      'helicopter', 'drone', 'aerial', 'aéreo'
    ]

    const textToCheck = `${suggestion.vantage_type} ${suggestion.reasoning} ${suggestion.gemini_reasoning}`.toLowerCase()
    
    return impracticalKeywords.some(keyword => textToCheck.includes(keyword.toLowerCase()))
  }

  /**
   * Remove duplicatas e rankeia sugestões
   */
  private removeDuplicatesAndRank(suggestions: EnhancedPOVSuggestion[]): EnhancedPOVSuggestion[] {
    // Remover duplicatas baseado em proximidade (< 50m)
    const unique: EnhancedPOVSuggestion[] = []
    
    for (const suggestion of suggestions) {
      const isDuplicate = unique.some(existing => {
        const distance = this.calculateDistance(
          suggestion.lat, suggestion.lng,
          existing.lat, existing.lng
        )
        return distance < 50 // 50 metros de tolerância
      })
      
      if (!isDuplicate) {
        unique.push(suggestion)
      }
    }

          // Rankear priorizando "car" > "both" > "walk", depois por confiança e fonte
    return unique.sort((a, b) => {
      // 1. Priorizar por tipo de acesso
      const accessWeight = {
        'car': 10,     // Máxima prioridade para car
        'both': 7,     // Segunda prioridade
        'walk': 3      // Menor prioridade
      }
      
      // 2. Priorizar por fonte
      const sourceWeight = {
        'gemini_original': 4,
        'gemini_enhanced': 3,
        'pattern_based': 2
      }
      
      // 3. Calcular peso total: access_type é o fator mais importante
      const aWeight = (accessWeight[a.access_type] || 5) * 100 + 
                      sourceWeight[a.source] * a.confidence_score
      const bWeight = (accessWeight[b.access_type] || 5) * 100 + 
                      sourceWeight[b.source] * b.confidence_score
      
      return bWeight - aWeight
    })
  }

  /**
   * Calcula distância entre dois pontos
   */
  private calculateDistance(lat1: number, lng1: number, lat2: number, lng2: number): number {
    const R = 6371000 // Raio da Terra em metros
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
