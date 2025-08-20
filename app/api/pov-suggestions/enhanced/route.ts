import { NextRequest, NextResponse } from 'next/server'
import { GeminiEnhancedPOVService } from '@/lib/services/gemini-enhanced-pov-service'

export async function POST(request: NextRequest) {
  try {
    const body = await request.json()
    const {
      poi_id,
      poi_name,
      poi_lat,
      poi_lng,
      poi_types,
      city,
      country,
      limit,
      use_gemini = true
    } = body

    // Validar campos obrigatórios
    if (!poi_id || !poi_name || !poi_lat || !poi_lng) {
      return NextResponse.json(
        { error: 'Missing required fields: poi_id, poi_name, poi_lat, poi_lng' },
        { status: 400 }
      )
    }

    console.log(`🚀 Enhanced POV suggestions request for: ${poi_name}`)

    // Criar serviço e gerar sugestões
    const service = new GeminiEnhancedPOVService()
    
    const suggestions = await service.generateEnhancedSuggestions({
      poi_id,
      poi_name,
      poi_lat,
      poi_lng,
      poi_types,
      city,
      country,
      limit,
      use_gemini
    })

    console.log(`✅ Generated ${suggestions.length} enhanced suggestions`)

    return NextResponse.json({
      success: true,
      suggestions,
      metadata: {
        total_generated: suggestions.length,
        sources_used: [...new Set(suggestions.map(s => s.source))],
        gemini_enabled: use_gemini,
        timestamp: new Date().toISOString()
      }
    })

  } catch (error) {
    console.error('❌ Error generating enhanced POV suggestions:', error)
    
    return NextResponse.json(
      { 
        error: 'Failed to generate enhanced suggestions',
        details: error instanceof Error ? error.message : String(error)
      },
      { status: 500 }
    )
  }
}

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url)
  const poi_id = searchParams.get('poi_id')
  const poi_name = searchParams.get('poi_name')
  const poi_lat = searchParams.get('poi_lat')
  const poi_lng = searchParams.get('poi_lng')
  const limit = searchParams.get('limit')
  const use_gemini = searchParams.get('use_gemini')

  if (!poi_id || !poi_name || !poi_lat || !poi_lng) {
    return NextResponse.json(
      { error: 'Missing required query parameters: poi_id, poi_name, poi_lat, poi_lng' },
      { status: 400 }
    )
  }

  try {
    const service = new GeminiEnhancedPOVService()
    
    const suggestions = await service.generateEnhancedSuggestions({
      poi_id,
      poi_name,
      poi_lat: parseFloat(poi_lat),
      poi_lng: parseFloat(poi_lng),
      limit: limit ? parseInt(limit) : undefined,
      use_gemini: use_gemini !== 'false'
    })

    return NextResponse.json({
      success: true,
      suggestions,
      metadata: {
        total_generated: suggestions.length,
        sources_used: [...new Set(suggestions.map(s => s.source))],
        gemini_enabled: use_gemini !== 'false',
        timestamp: new Date().toISOString()
      }
    })

  } catch (error) {
    console.error('❌ Error generating enhanced POV suggestions:', error)
    
    return NextResponse.json(
      { 
        error: 'Failed to generate enhanced suggestions',
        details: error instanceof Error ? error.message : String(error)
      },
      { status: 500 }
    )
  }
}
