import { NextRequest, NextResponse } from 'next/server'
import { requireAuth } from '@/lib/core/auth-helpers'
import { GeminiDescriptionService } from '@/lib/services/gemini-descriptions/gemini-description.service'
import type { POIData, GeminiDescriptionOptions } from '@/lib/services/gemini-descriptions/types'
import { createClient } from '@supabase/supabase-js'

/**
 * Helper function to get Supabase admin client for database operations
 */
function getSupabaseAdmin() {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
  const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY
  
  if (!supabaseUrl || !supabaseKey) {
    throw new Error('Missing required environment variables: NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY')
  }
  
  return createClient(supabaseUrl, supabaseKey, {
    auth: { 
      autoRefreshToken: false, 
      persistSession: false,
      detectSessionInUrl: false
    }
  })
}

/**
 * Save description to database (similar to DescriptionService.saveDescription)
 */
async function saveDescriptionToDB(
  attractionId: string,
  description: string,
  verification: { aprovada: boolean; pontuacao: number; problemas: string[]; sugestoes_melhoria: string } | null,
  language: string = 'pt-br',
  descriptionId?: string
): Promise<{ success: boolean; description_id?: string; error?: string }> {
  try {
    console.log(`💾 Saving description in ${language} for attraction ${attractionId}`)
    
    const supabase = getSupabaseAdmin()
    
    // Check if description already exists
    const { data: existingDescription, error: checkError } = await supabase
      .schema('core')
      .from('attraction_descriptions')
      .select('id')
      .eq('attraction_id', attractionId)
      .eq('language', language)
      .maybeSingle()

    if (checkError && checkError.code !== 'PGRST116') {
      throw new Error(`Error checking existing description: ${checkError.message}`)
    }

    let savedDescription
    if (existingDescription || descriptionId) {
      // Update existing description
      const { data: updatedDescription, error: updateError } = await supabase
        .schema('core')
        .from('attraction_descriptions')
        .update({
          description: description,
          verification_status: verification?.aprovada ? 'approved' : 'needs_review',
          last_verified_at: new Date().toISOString()
        })
        .eq('id', descriptionId || existingDescription?.id)
        .select('id')
        .single()

      if (updateError) {
        throw new Error(`Error updating description: ${updateError.message}`)
      }
      savedDescription = updatedDescription
    } else {
      // Insert new description
      const { data: newDescription, error: insertError } = await supabase
        .schema('core')
        .from('attraction_descriptions')
        .insert({
          attraction_id: attractionId,
          language: language,
          description: description,
          verification_status: verification?.aprovada ? 'approved' : 'needs_review',
          last_verified_at: new Date().toISOString()
        })
        .select('id')
        .single()

      if (insertError) {
        throw new Error(`Error inserting description: ${insertError.message}`)
      }
      savedDescription = newDescription
    }

    console.log(`✅ Description saved in ${language} with ID:`, savedDescription?.id)
    
    return { success: true, description_id: savedDescription?.id }

  } catch (error: any) {
    console.error(`❌ Error saving description:`, error)
    return { success: false, error: error.message }
  }
}

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
 * - Automatic database persistence (like the old system)
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

    // Save description to database (like the old system)
    let savedDescriptionId: string | null = null
    if (!poiData.id) {
      console.warn('⚠️ POI ID not provided, skipping database save')
    } else {
      const saveResult = await saveDescriptionToDB(
        poiData.id,
        description,
        validation || null,
        options.language || 'pt-br',
        body.description_id // Support updating existing description
      )

      if (!saveResult.success) {
        console.error('⚠️ Failed to save description to database:', saveResult.error)
        // Continue anyway - description was generated successfully
      } else {
        savedDescriptionId = saveResult.description_id || null
        console.log(`💾 Description saved to database with ID: ${savedDescriptionId}`)
      }
    }

    // Prepare response (compatible with existing endpoint for comparison)
    return NextResponse.json({
      success: true,
      description,
      description_id: savedDescriptionId,
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

