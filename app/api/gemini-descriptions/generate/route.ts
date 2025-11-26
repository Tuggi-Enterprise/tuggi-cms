import { NextRequest, NextResponse } from 'next/server'
import { requireAuth } from '@/lib/core/auth-helpers'
import { GeminiDescriptionService } from '@/lib/services/gemini-descriptions/gemini-description.service'
import type { POIData, GeminiDescriptionOptions } from '@/lib/services/gemini-descriptions/types'

/**
 * Gemini Description Generation API
 * 
 * New clean module for generating descriptions using Gemini via Google AI Studio
 * This endpoint works in parallel with the existing description service for comparison
 * 
 * Features:
 * - Simple and direct prompts
 * - Multiple style options (touristic, historical, cultural, simple)
 * - Flexible model selection
 * - Rate limiting built-in
 * - Compatible interface for easy comparison
 */
export async function POST(request: NextRequest) {
  try {
    console.log('🚀 Starting Gemini Description generation (new module)...')
    
    // Authentication check
    const authResult = await requireAuth(request)
    if (authResult instanceof NextResponse) {
      return authResult // Return error response
    }
    
    const { user_id, user_email } = authResult
    
    const body = await request.json()
    
    // Support both formats: new format (poi_data + options) and legacy format
    let poiData: POIData
    let options: GeminiDescriptionOptions
    
    if (body.poi_data && body.options) {
      // New format from POIDetailsModal
      poiData = body.poi_data
      options = {
        ...body.options,
        user_id: user_id!,
        request_id: `gemini_api_${Date.now()}`
      }
    } else {
      // Legacy format (backward compatibility)
      const {
        id: attractionId,
        name,
        city,
        country,
        state,
        formatted_address,
        google_types,
        // Options
        model,
        style = 'touristic',
        language = 'pt-br',
        maxWords,
        audioDuration,
        temperature,
        topK,
        topP,
        maxTokens,
        customPrompt,
        additionalContext,
        validate = true,
        systemInstruction
      } = body

      poiData = {
        id: attractionId,
        name: name || 'Unknown',
        city,
        country,
        state,
        formatted_address,
        google_types
      }

      options = {
        model,
        style,
        language,
        maxWords,
        audioDuration,
        temperature,
        topK,
        topP,
        maxTokens,
        customPrompt,
        additionalContext,
        validate,
        systemInstruction,
        user_id: user_id!,
        request_id: `gemini_api_${Date.now()}`
      }
    }

    // Validate required fields
    if (!poiData || !poiData.name) {
      return NextResponse.json(
        { 
          error: 'POI data and name are required',
          success: false
        },
        { status: 400 }
      )
    }

    console.log('📝 Calling GeminiDescriptionService.generate()...')
    console.log(`📊 Options:`, {
      model: options.model || 'default',
      style: options.style || 'default',
      language: options.language || 'default'
    })
    
    // Call Gemini Description Service
    const result = await GeminiDescriptionService.generate(poiData, options)

    if (!result.success) {
      console.error('❌ GeminiDescriptionService failed:', result.error)
      return NextResponse.json(
        { 
          error: result.error || 'Failed to generate description',
          success: false
        },
        { status: 500 }
      )
    }

    // Extract data from result
    const description = result.description
    const validation = result.validation

    if (!description) {
      return NextResponse.json(
        { error: 'No description generated', success: false },
        { status: 500 }
      )
    }

    console.log(`✅ Description generated successfully (${description.length} chars)`)
    if (validation) {
      console.log(`📊 Validation: ${validation.aprovada ? 'APPROVED' : 'NEEDS_REVIEW'} (${validation.pontuacao}/100)`)
    }

    // Prepare response (compatible with existing endpoint for comparison)
    return NextResponse.json({
      success: true,
      description,
      description_id: null, // New module doesn't persist to DB yet
      verification: validation ? {
        aprovada: validation.aprovada,
        pontuacao: validation.pontuacao,
        problemas: validation.problemas,
        sugestoes_melhoria: validation.sugestoes_melhoria
      } : null,
      metadata: {
        ...result.metadata,
        module: 'gemini-descriptions',
        version: '1.0.0'
      },
      processing_time: result.processing_time
    })

  } catch (error: any) {
    console.error('❌ Error in Gemini Description API:', error)
    return NextResponse.json(
      { 
        error: error.message || 'Internal server error',
        success: false
      },
      { status: 500 }
    )
  }
}

