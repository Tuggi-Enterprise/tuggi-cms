import { NextRequest, NextResponse } from 'next/server'
import { ReverseGeocodingService } from '@/lib/services/reverse-geocoding.service'
import { validateCoordinates } from '@/lib/utils/coordinate-validation'

export async function POST(request: NextRequest) {
  try {
    const body = await request.json()
    const { lat, lng } = body

    if (lat === undefined || lng === undefined) {
      return NextResponse.json(
        { error: 'Missing required fields: lat, lng' },
        { status: 400 }
      )
    }

    const coordValidation = validateCoordinates(lat, lng)
    if (!coordValidation.valid) {
      return NextResponse.json(
        { error: coordValidation.error || 'Invalid coordinates' },
        { status: 400 }
      )
    }

    const result = await ReverseGeocodingService.reverseGeocode(lat, lng)

    if (!result) {
      return NextResponse.json(
        { error: 'Reverse geocoding failed' },
        { status: 404 }
      )
    }

    return NextResponse.json(result)
  } catch (error) {
    console.error('❌ Error in reverse geocoding endpoint:', error)
    return NextResponse.json(
      { 
        error: 'Internal server error',
        details: error instanceof Error ? error.message : 'Unknown error'
      },
      { status: 500 }
    )
  }
}

