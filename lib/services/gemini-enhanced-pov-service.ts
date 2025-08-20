import { createClient } from '@supabase/supabase-js'
import { POIInput, POVItem, GeminiPOVResponse } from '@/types/pov-types'
import { POVSuggestionsService } from './pov-suggestions-service'
import { callGeminiAPI } from '@/lib/utils/rate-limiter'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

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
   * Gera sugestões inteligentes usando padrões históricos + Gemini AI
   */
  async generateEnhancedSuggestions(request: EnhancedPOVRequest): Promise<EnhancedPOVSuggestion[]> {
    console.log(`🚀 Generating AI-powered POV suggestions for: ${request.poi_name}`)
    
    try {
      const allSuggestions: EnhancedPOVSuggestion[] = []

      // 1. Gerar sugestões baseadas em padrões (aprendizado histórico)
      const patternSuggestions = await this.generatePatternBasedSuggestions(request)
      allSuggestions.push(...patternSuggestions)
      console.log(`🧠 Generated ${patternSuggestions.length} pattern-based suggestions`)

      // 2. Usar Gemini para melhorar e gerar novas sugestões
      if (request.use_gemini !== false) {
        const geminiSuggestions = await this.generateGeminiEnhancedSuggestions(request, allSuggestions)
        allSuggestions.push(...geminiSuggestions)
        console.log(`🤖 Generated ${geminiSuggestions.length} Gemini AI suggestions`)
      }

      // 3. Remover duplicatas e rankear (priorizar Gemini)
      const uniqueSuggestions = this.removeDuplicatesAndRank(allSuggestions)
      
      // 4. Aplicar limite
      const limit = request.limit || 10
      const finalSuggestions = uniqueSuggestions.slice(0, limit)

      console.log(`✅ Returning ${finalSuggestions.length} AI-powered suggestions`)
      return finalSuggestions

    } catch (error) {
      console.error('❌ Error generating AI suggestions:', error)
      throw error
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
        source: 'pattern_based' as const
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

    return `You are an expert tourism AI specializing in finding optimal viewpoints for Points of Interest (POIs). You have deep knowledge of geography, urban planning, and tourist behavior.

**TASK**: Generate intelligent trigger point suggestions for optimal POI viewing experiences.

**POI INFORMATION**:
- Name: ${request.poi_name}
- Location: ${request.poi_lat}, ${request.poi_lng}
- City: ${request.city || 'Unknown'}
- Types: ${request.poi_types?.join(', ') || 'Unknown'}

**EXISTING PATTERN-BASED SUGGESTIONS** (${existingSuggestions.length} from historical data):
${existingSuggestions.slice(0, 6).map((s, i) => 
  `${i+1}. Location: ${s.lat}, ${s.lng}
     Distance: ${s.distance_m}m, Direction: ${s.bearing_deg}°
     Access: ${s.access_type}, Confidence: ${s.confidence_score}%
     Reasoning: ${s.reasoning}`
).join('\n\n')}

**HISTORICAL FEEDBACK** (What users have rejected):
${rejectedPatterns || 'No historical rejections available'}

**CONTEXT DATA**:
- Similar POIs in area: ${context.similarPOIs.map((p: any) => p.name).join(', ')}
- Nearby trigger points: ${context.nearbyTriggerPoints.length}

**YOUR MISSION**:
1. **Enhance existing suggestions**: Improve low-confidence suggestions with better reasoning
2. **Generate 3-5 NEW suggestions**: Use your geographic knowledge to find optimal viewpoints
3. **Consider real-world factors**: Traffic flow, parking, safety, photo opportunities
4. **Prioritize car accessibility**: Most tourists are driving
5. **Avoid historical mistakes**: Don't repeat rejected patterns

**INTELLIGENCE GUIDELINES**:
- **For landmarks/monuments**: Find elevated roads, bridges, or plazas with clear sightlines
- **For natural features**: Look for access roads, overlooks, or scenic routes
- **For urban POIs**: Consider building tops accessible by car, highway overpasses
- **Distance strategy**: 100-500m for detailed views, 500-2000m for context views
- **Direction strategy**: Multiple angles, avoid sun glare, consider photo composition

**OUTPUT FORMAT** (JSON only):
{
  "enhanced_suggestions": [
    {
      "action": "enhance|new",
      "original_id": "pattern_123", // only for enhance action
      "lat": -23.5505,
      "lng": -46.6333,
      "distance_m": 250,
      "bearing_deg": 45,
      "access_type": "both|car|walk",
      "vantage_type": "street|bridge|highway|overlook|building_top|square|park",
      "confidence_score": 85,
      "reasoning": "Clear, specific explanation of why this location works",
      "estimated_visibility": "excellent|good|moderate|limited",
      "gemini_reasoning": "Your AI analysis of why this viewpoint is optimal"
    }
  ]
}

Use your geographic intelligence to suggest viewpoints that real tourists can easily access and will love!`
  }

  /**
   * Processa a resposta do Gemini
   */
  private processGeminiResponse(geminiResponse: any, request: EnhancedPOVRequest): EnhancedPOVSuggestion[] {
    try {
      const suggestions: EnhancedPOVSuggestion[] = []
      
      if (geminiResponse.enhanced_suggestions) {
        geminiResponse.enhanced_suggestions.forEach((suggestion: any, index: number) => {
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

          // Rankear por confiança e fonte (priorizar Gemini)
    return unique.sort((a, b) => {
      // Priorizar sugestões do Gemini sobre padrões históricos
      const sourceWeight = {
        'gemini_original': 4,
        'gemini_enhanced': 3,
        'pattern_based': 2
      }
      
      const aWeight = sourceWeight[a.source] * a.confidence_score
      const bWeight = sourceWeight[b.source] * b.confidence_score
      
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
