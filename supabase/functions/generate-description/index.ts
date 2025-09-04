/**
 * Supabase Edge Function: Generate POI Description
 * 
 * Standalone implementation for Edge Functions
 * No external service dependencies
 */

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

// =====================================
// INTERFACES AND TYPES
// =====================================

interface ProcessingResult<T> {
  success: boolean
  data?: T
  error?: string
  processing_time: number
  metadata: {
    step: string
    model_used?: string
    tokens_consumed?: number
    quality_score?: number
    progress?: number
    status: 'pending' | 'processing' | 'completed' | 'failed'
    user_id?: string
    request_id?: string
    timestamp: string
  }
}

interface DescriptionData {
  description: string
  verification?: any
  description_id?: string
  quality_analysis?: any
}

interface DescriptionResult extends ProcessingResult<DescriptionData> {}

interface POIData {
  id?: string
  name: string
  city: string
  country: string
  state?: string
  google_types?: string[]
  lat?: number
  lng?: number
  website?: string
  reference_links?: string[]
}

interface DescriptionOptions {
  language?: string
  use_dynamic_sources?: boolean
  enrich_with_osm?: boolean
  persist_verification?: boolean
  auto_generate_audio?: boolean
  user_id?: string
  request_id?: string
  gender?: 'male' | 'female'  // Add gender field
}

// =====================================
// MAIN SERVICE CLASS
// =====================================

class EdgeDescriptionService {
  private supabase: any

  constructor() {
    const supabaseUrl = Deno.env.get('SUPABASE_URL') || Deno.env.get('NEXT_PUBLIC_SUPABASE_URL')
    const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')
    
    if (!supabaseUrl || !supabaseKey) {
      throw new Error('Missing required environment variables: SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY')
    }
    
    this.supabase = createClient(supabaseUrl, supabaseKey, {
      auth: { 
        autoRefreshToken: false, 
        persistSession: false,
        detectSessionInUrl: false
      }
    })
  }

  /**
   * Generate description using Gemini API
   */
  async generate(
    poiData: POIData, 
    options: DescriptionOptions = {}
  ): Promise<DescriptionResult> {
    const startTime = Date.now()
    
    try {
      console.log(`🚀 Generating description for: ${poiData.name}`)
      
      // Validate required parameters
      if (!poiData.name || !poiData.city || !poiData.country) {
        return {
          success: false,
          error: 'Missing required parameters: name, city, country',
          processing_time: Date.now() - startTime,
          metadata: {
            step: 'validation',
            status: 'failed',
            user_id: options.user_id,
            request_id: options.request_id || `edge_${Date.now()}`,
            timestamp: new Date().toISOString()
          }
        }
      }

      // Get API key
      const apiKey = Deno.env.get('GEMINI_API_KEY') || Deno.env.get('GOOGLE_GEMINI_API_KEY')
      if (!apiKey) {
        return {
          success: false,
          error: 'Gemini API key not configured',
          processing_time: Date.now() - startTime,
          metadata: {
            step: 'configuration',
            status: 'failed',
            user_id: options.user_id,
            request_id: options.request_id || `edge_${Date.now()}`,
            timestamp: new Date().toISOString()
          }
        }
      }

      // Build prompt for Gemini
      const prompt = this.buildPrompt(poiData, options)
      
      // Generate description using Gemini
      const description = await this.generateWithGemini(prompt, apiKey, poiData)
      
      if (!description) {
        return {
          success: false,
          error: 'Failed to generate description with Gemini API',
          processing_time: Date.now() - startTime,
          metadata: {
            step: 'generation',
            status: 'failed',
            user_id: options.user_id,
            request_id: options.request_id || `edge_${Date.now()}`,
            timestamp: new Date().toISOString()
          }
        }
      }

      // Calculate quality score
      const qualityScore = this.calculateQualityScore(description, poiData)
      
      // Determine model used
      const modelUsed = this.determineModel(poiData.google_types || [])

      const result: DescriptionResult = {
        success: true,
        processing_time: Date.now() - startTime,
        data: {
          description,
          quality_analysis: {
            overall_score: qualityScore,
            confidence_level: qualityScore >= 80 ? 'high' : qualityScore >= 60 ? 'medium' : 'low',
            model_used: modelUsed
          }
        },
        metadata: {
          step: 'description_generation',
          model_used: modelUsed,
          quality_score: qualityScore,
          progress: 100,
          status: 'completed',
          user_id: options.user_id,
          request_id: options.request_id || `edge_${Date.now()}`,
          timestamp: new Date().toISOString()
        }
      }

      // Save description if POI ID provided
      if (poiData.id && options.persist_verification !== false) {
        await this.saveDescription(
          poiData.id, 
          description, 
          options.language || 'pt-br',
          options.gender || 'male'  // Default to male if not specified
        )
      }

      return result

    } catch (error: any) {
      console.error('❌ Error generating description:', error)
      return {
        success: false,
        error: error.message || 'Unknown error occurred',
        processing_time: Date.now() - startTime,
        metadata: {
          step: 'exception_handling',
          status: 'failed',
          user_id: options.user_id,
          request_id: options.request_id || `edge_${Date.now()}`,
          timestamp: new Date().toISOString()
        }
      }
    }
  }

  /**
   * Build prompt for Gemini
   */
  private buildPrompt(poiData: POIData, options: DescriptionOptions): string {
    const language = options.language || 'pt-br'
    
    return `You are an expert travel guide writer. Produce a concise, factual description in Brazilian Portuguese.

CRITICAL RULES:
- Use well-known historical facts and verifiable information about the location
- NEVER INVENT physical features, functions, or services
- NEVER SPECULATE with words like "aproximadamente", "cerca de", "provavelmente"
- ABSOLUTELY FORBIDDEN: "patrimônio histórico", "tombado", "IPHAN" unless explicitly confirmed
- Start with the POI name; never start with the city
- Include 1–2 visible/observable elements when certain
- End with a natural closing line
- Target length: 30-100 words for audio guide

TONE & ENGAGEMENT:
- Friendly, knowledgeable tour guide voice
- Share interesting historical facts, cultural significance
- Include curious details about architecture, founding, or local characteristics
- Warm, engaging tone while maintaining accuracy

POI DATA:
- Name: ${poiData.name}
- Location: ${poiData.city}${poiData.state ? `, ${poiData.state}` : ''}, ${poiData.country}
- Types: ${poiData.google_types?.join(', ') || 'point_of_interest'}
- Website: ${poiData.website || 'Not available'}

OUTPUT: Only the final Portuguese text.

[Generation ID: ${Date.now()}-${Math.random().toString(36).substr(2, 9)}]`
  }

  /**
   * Generate description using Gemini API
   */
  private async generateWithGemini(prompt: string, apiKey: string, poiData: POIData): Promise<string | null> {
    const modelType = this.determineModel(poiData.google_types || [])
    
    const endpoints = modelType === 'pro' ? [
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-pro:generateContent?key=${apiKey}`,
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-pro:generateContent?key=${apiKey}`
    ] : [
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${apiKey}`,
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-pro:generateContent?key=${apiKey}`
    ]
    
    console.log(`🤖 Using Gemini ${modelType.toUpperCase()} for ${modelType === 'pro' ? 'data-rich' : 'limited-data'} POI`)

    for (const endpoint of endpoints) {
      try {
        const response = await fetch(endpoint, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            contents: [{
              parts: [{
                text: prompt
              }]
            }],
            generationConfig: {
              temperature: 0.7,
              topK: 40,
              topP: 0.8,
              maxOutputTokens: 350,
              candidateCount: 1
            }
          })
        })

        if (!response.ok) {
          console.log(`❌ Gemini API error: ${response.status} ${response.statusText}`)
          continue
        }

        const data = await response.json()
        
        if (data.candidates && data.candidates[0] && data.candidates[0].content) {
          const description = data.candidates[0].content.parts[0].text.trim()
          return description
        } else {
          console.log('⚠️ No valid content in Gemini response:', data)
        }

      } catch (error) {
        console.error(`❌ Error with endpoint ${endpoint}:`, error)
        continue
      }
    }

    return null
  }

  /**
   * Determine which Gemini model to use
   */
  private determineModel(googleTypes: string[]): 'pro' | 'flash' {
    const proTypes = ['tourist_attraction', 'locality', 'political', 'point_of_interest']
    const hasProType = googleTypes.some(type => proTypes.includes(type))
    return hasProType ? 'pro' : 'flash'
  }

  /**
   * Calculate quality score
   */
  private calculateQualityScore(description: string, poiData: POIData): number {
    let score = 70 // Base score
    
    // Length appropriateness
    const wordCount = description.split(/\s+/).length
    if (wordCount >= 20 && wordCount <= 100) score += 15
    else if (wordCount >= 15 && wordCount <= 120) score += 10
    else if (wordCount < 10) score -= 20
    
    // Structure quality
    if (description.includes('Curiosidade:')) score += 10
    if (description.match(/\b(século|fundad|construíd|estabelecid)\b/i)) score += 10
    if (description.match(/\b\d{4}\b/)) score += 10
    
    // Language quality
    if (!description.includes('importante') || !description.includes('rica história')) score += 10
    
    // POI-centered start
    if (description.toLowerCase().startsWith(poiData.name.toLowerCase().split(' ')[0])) score += 15
    
    return Math.min(Math.max(score, 0), 100)
  }

  /**
   * Save description to database
   */
  private async saveDescription(attractionId: string, description: string, language: string, gender: 'male' | 'female'): Promise<void> {
    try {
      console.log(`💾 Attempting to save description for attraction: ${attractionId}`)
      console.log(`🌐 Language: ${language}`)
      console.log(`👤 Gender: ${gender}`)
      console.log(`📝 Description length: ${description.length} characters`)
      
      // Try without schema first (PostgREST default)
      let { error } = await this.supabase
        .from('attraction_descriptions')
        .upsert({
          attraction_id: attractionId,
          language: language,
          gender: gender,
          description: description,
          verification_status: 'needs_review',
          last_verified_at: new Date().toISOString()
        }, {
          onConflict: 'attraction_id,language,gender'  // Use the correct unique constraint
        })

      if (error) {
        console.warn(`⚠️ Error saving without schema: ${error.message}`)
        
        // Try with core schema
        const { error: coreError } = await this.supabase
          .schema('core')
          .from('attraction_descriptions')
          .upsert({
            attraction_id: attractionId,
            language: language,
            gender: gender,
            description: description,
            verification_status: 'needs_review',
            last_verified_at: new Date().toISOString()
          }, {
            onConflict: 'attraction_id,language,gender'  // Use the correct unique constraint
          })
        
        if (coreError) {
          console.error(`❌ Error saving with core schema: ${coreError.message}`)
          throw coreError
        } else {
          console.log(`✅ Description saved with core schema for attraction: ${attractionId}`)
        }
      } else {
        console.log(`✅ Description saved without schema for attraction: ${attractionId}`)
      }
    } catch (error) {
      console.error(`💥 Fatal error in saveDescription: ${error}`)
      throw error
    }
  }
}

// =====================================
// EDGE FUNCTION HANDLER
// =====================================

serve(async (req) => {
  // CORS headers
  const corsHeaders = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
  }

  // Handle CORS preflight
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  try {
    console.log('🚀 Edge Function: generate-description started')
    
    // Validate HTTP method
    if (req.method !== 'POST') {
      return new Response(
        JSON.stringify({ error: 'Method not allowed' }),
        { 
          status: 405, 
          headers: { ...corsHeaders, 'Content-Type': 'application/json' }
        }
      )
    }

    // Simple JWT validation (basic check)
    const authHeader = req.headers.get('Authorization')
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return new Response(
        JSON.stringify({ 
          success: false,
          error: 'Missing or invalid Authorization header',
          metadata: {
            step: 'authentication',
            status: 'failed',
            timestamp: new Date().toISOString()
          }
        }),
        { 
          status: 401, 
          headers: { ...corsHeaders, 'Content-Type': 'application/json' }
        }
      )
    }

    // Parse request body
    let requestBody
    try {
      requestBody = await req.json()
    } catch (error) {
      return new Response(
        JSON.stringify({ 
          success: false,
          error: 'Invalid JSON in request body',
          metadata: {
            step: 'parsing',
            status: 'failed',
            timestamp: new Date().toISOString()
          }
        }),
        { 
          status: 400, 
          headers: { ...corsHeaders, 'Content-Type': 'application/json' }
        }
      )
    }

    // Validate required fields
    const { poi_data, options = {} } = requestBody

    if (!poi_data) {
      return new Response(
        JSON.stringify({ 
          success: false,
          error: 'Missing required field: poi_data',
          metadata: {
            step: 'validation',
            status: 'failed',
            timestamp: new Date().toISOString()
          }
        }),
        { 
          status: 400, 
          headers: { ...corsHeaders, 'Content-Type': 'application/json' }
        }
      )
    }

    // Extract user ID from JWT (basic implementation)
    const token = authHeader.replace('Bearer ', '')
    const user_id = extractUserIdFromToken(token) || 'unknown'

    // Add user context to options
    const enhancedOptions = {
      ...options,
      user_id,
      request_id: `edge_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`
    }

    console.log('📝 Generating description for POI:', poi_data.name)

    // Generate description using service
    const service = new EdgeDescriptionService()
    const result = await service.generate(poi_data, enhancedOptions)

    console.log('📊 Description generation completed:', {
      success: result.success,
      processing_time: result.processing_time,
      quality_score: result.data?.quality_analysis?.overall_score,
      model_used: result.metadata?.model_used
    })

    // Return result with CORS headers
    return new Response(
      JSON.stringify(result),
      {
        status: result.success ? 200 : 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      }
    )

  } catch (error: any) {
    console.error('💥 Unexpected error in Edge Function:', error)
    
    return new Response(
      JSON.stringify({
        success: false,
        error: 'Internal server error',
        processing_time: 0,
        metadata: {
          step: 'exception_handling',
          status: 'failed',
          timestamp: new Date().toISOString(),
          error_details: error.message
        }
      }),
      {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      }
    )
  }
})

// Helper function to extract user ID from JWT (basic implementation)
function extractUserIdFromToken(token: string): string | null {
  try {
    // Basic JWT parsing (in production, use proper JWT library)
    const parts = token.split('.')
    if (parts.length !== 3) return null
    
    const payload = JSON.parse(atob(parts[1]))
    return payload.sub || payload.user_id || null
  } catch {
    return null
  }
}

console.log('🔧 Edge Function: generate-description loaded')
