import { NextRequest, NextResponse } from 'next/server'
import { POVSuggestionsService, SuggestionRequest } from '@/lib/services/pov-suggestions-service'

const suggestionsService = new POVSuggestionsService()

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url)
    
    // Parâmetros obrigatórios
    const poiId = searchParams.get('poi_id')
    const poiName = searchParams.get('poi_name')
    const poiLat = searchParams.get('poi_lat')
    const poiLng = searchParams.get('poi_lng')
    
    // Validação de parâmetros obrigatórios
    if (!poiId || !poiName || !poiLat || !poiLng) {
      return NextResponse.json(
        { 
          error: 'Missing required parameters: poi_id, poi_name, poi_lat, poi_lng' 
        },
        { status: 400 }
      )
    }
    
    // Parâmetros opcionais
    const poiTypes = searchParams.get('poi_types')?.split(',') || []
    const limit = parseInt(searchParams.get('limit') || '10')
    const minConfidence = parseInt(searchParams.get('min_confidence') || '70')
    
    // Validação de tipos
    const lat = parseFloat(poiLat)
    const lng = parseFloat(poiLng)
    
    if (isNaN(lat) || isNaN(lng)) {
      return NextResponse.json(
        { error: 'Invalid coordinates: poi_lat and poi_lng must be valid numbers' },
        { status: 400 }
      )
    }
    
    if (isNaN(limit) || limit < 1 || limit > 50) {
      return NextResponse.json(
        { error: 'Invalid limit: must be between 1 and 50' },
        { status: 400 }
      )
    }
    
    if (isNaN(minConfidence) || minConfidence < 0 || minConfidence > 100) {
      return NextResponse.json(
        { error: 'Invalid min_confidence: must be between 0 and 100' },
        { status: 400 }
      )
    }
    
    // Construir request
    const suggestionRequest: SuggestionRequest = {
      poi_id: poiId,
      poi_name: poiName,
      poi_lat: lat,
      poi_lng: lng,
      poi_types: poiTypes,
      limit,
      min_confidence: minConfidence
    }
    
    console.log(`🚀 API: Generating suggestions for ${poiName} (${lat}, ${lng})`)
    
    // Gerar sugestões
    const suggestions = await suggestionsService.generateSuggestions(suggestionRequest)
    
    console.log(`✅ API: Generated ${suggestions.length} suggestions`)
    
    return NextResponse.json({
      success: true,
      data: {
        poi: {
          id: poiId,
          name: poiName,
          lat,
          lng,
          types: poiTypes
        },
        suggestions,
        metadata: {
          total_suggestions: suggestions.length,
          limit,
          min_confidence: minConfidence,
          generated_at: new Date().toISOString()
        }
      }
    })
    
  } catch (error) {
    console.error('❌ API Error:', error)
    
    return NextResponse.json(
      { 
        error: 'Failed to generate suggestions',
        details: error instanceof Error ? error.message : 'Unknown error'
      },
      { status: 500 }
    )
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json()
    
    // Validação de parâmetros obrigatórios
    const { poi_id, poi_name, poi_lat, poi_lng, poi_types, limit, min_confidence } = body
    
    if (!poi_id || !poi_name || poi_lat === undefined || poi_lng === undefined) {
      return NextResponse.json(
        { 
          error: 'Missing required fields: poi_id, poi_name, poi_lat, poi_lng' 
        },
        { status: 400 }
      )
    }
    
    // Validação de tipos
    const lat = parseFloat(poi_lat)
    const lng = parseFloat(poi_lng)
    
    if (isNaN(lat) || isNaN(lng)) {
      return NextResponse.json(
        { error: 'Invalid coordinates: poi_lat and poi_lng must be valid numbers' },
        { status: 400 }
      )
    }
    
    // Construir request
    const suggestionRequest: SuggestionRequest = {
      poi_id,
      poi_name,
      poi_lat: lat,
      poi_lng: lng,
      poi_types: poi_types || [],
      limit: limit || 10,
      min_confidence: min_confidence || 70
    }
    
    console.log(`🚀 API POST: Generating suggestions for ${poi_name} (${lat}, ${lng})`)
    
    // Gerar sugestões
    const suggestions = await suggestionsService.generateSuggestions(suggestionRequest)
    
    console.log(`✅ API POST: Generated ${suggestions.length} suggestions`)
    
    return NextResponse.json({
      success: true,
      data: {
        poi: {
          id: poi_id,
          name: poi_name,
          lat,
          lng,
          types: poi_types || []
        },
        suggestions,
        metadata: {
          total_suggestions: suggestions.length,
          limit: limit || 10,
          min_confidence: min_confidence || 70,
          generated_at: new Date().toISOString()
        }
      }
    })
    
  } catch (error) {
    console.error('❌ API POST Error:', error)
    
    return NextResponse.json(
      { 
        error: 'Failed to generate suggestions',
        details: error instanceof Error ? error.message : 'Unknown error'
      },
      { status: 500 }
    )
  }
}
