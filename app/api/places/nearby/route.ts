import { NextRequest, NextResponse } from 'next/server'

export async function GET(request: NextRequest) {
  const searchParams = request.nextUrl.searchParams
  const location = searchParams.get('location')
  const radius = searchParams.get('radius')
  const type = searchParams.get('type')
  const keyword = searchParams.get('keyword')
  const language = searchParams.get('language')
  
  if (!location || !radius || !type) {
    return NextResponse.json(
      { error: 'Missing required parameters: location, radius, type' },
      { status: 400 }
    )
  }

  const apiKey = process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY
  if (!apiKey) {
    return NextResponse.json(
      { error: 'Google Maps API key not configured' },
      { status: 500 }
    )
  }

  try {
    const params = new URLSearchParams({
      location,
      radius,
      type,
      key: apiKey,
    })

    if (keyword) {
      params.append('keyword', keyword)
    }

    if (language) {
      params.append('language', language)
    }

    const url = `https://maps.googleapis.com/maps/api/place/nearbysearch/json?${params}`
    
    const response = await fetch(url)
    const data = await response.json()

    if (data.status === 'OK' || data.status === 'ZERO_RESULTS') {
      return NextResponse.json({
        status: data.status,
        results: data.results || []
      })
    } else {
      console.error('Google Places API error:', data.status, data.error_message)
      return NextResponse.json({
        status: data.status,
        error: data.error_message || 'Unknown API error',
        results: []
      }, { status: 400 })
    }
  } catch (error) {
    console.error('Error calling Google Places API:', error)
    return NextResponse.json(
      { error: 'Failed to fetch places data' },
      { status: 500 }
    )
  }
}