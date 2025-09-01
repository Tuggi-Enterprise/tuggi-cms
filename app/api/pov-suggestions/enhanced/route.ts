import { NextRequest, NextResponse } from 'next/server'
import { GeminiEnhancedPOVService } from '@/lib/services/gemini-enhanced-pov-service'

export async function POST(request: NextRequest) {
  // TEMPORARILY DISABLED - AI trigger points functionality
  console.log('🚫 Enhanced POV suggestions API temporarily disabled')
  
  return NextResponse.json(
    { 
      error: 'Enhanced POV suggestions API is temporarily disabled',
      details: 'AI trigger points functionality has been temporarily disabled'
    },
    { status: 503 }
  )
}

export async function GET(request: NextRequest) {
  // TEMPORARILY DISABLED - AI trigger points functionality
  console.log('🚫 Enhanced POV suggestions API (GET) temporarily disabled')
  
  return NextResponse.json(
    { 
      error: 'Enhanced POV suggestions API is temporarily disabled',
      details: 'AI trigger points functionality has been temporarily disabled'
    },
    { status: 503 }
  )
}
