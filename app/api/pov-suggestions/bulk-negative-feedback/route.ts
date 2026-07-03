import { NextRequest, NextResponse } from 'next/server'
import { cookies } from 'next/headers'

interface BulkNegativeFeedbackRequest {
  poiId: string
  poiName: string
  poiLat: number
  poiLng: number
  suggestions: {
    suggestionId: string
    coordinates: { lat: number; lng: number }
    accessType: string
    source: string
    confidence: number
    reasoning: string
  }[]
}

export async function POST(request: NextRequest) {
  // TEMPORARILY DISABLED - AI trigger points functionality
  console.log('🚫 Bulk negative feedback API temporarily disabled')
  
  return NextResponse.json(
    { 
      success: false,
      error: 'Bulk negative feedback API is temporarily disabled',
      details: 'AI trigger points functionality has been temporarily disabled'
    },
    { status: 503 }
  )
}
