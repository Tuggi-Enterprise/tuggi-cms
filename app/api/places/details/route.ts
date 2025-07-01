import { NextRequest, NextResponse } from 'next/server'

export async function GET(request: NextRequest) {
  const searchParams = request.nextUrl.searchParams
  const place_id = searchParams.get('place_id')
  const fields = searchParams.get('fields')
  const language = searchParams.get('language')
  
  if (!place_id) {
    return NextResponse.json(
      { error: 'Missing required parameter: place_id' },
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
      place_id,
      fields: fields || 'place_id,name,formatted_address,geometry,types,rating,user_ratings_total,photos,website,opening_hours,formatted_phone_number,international_phone_number,url,vicinity,business_status,price_level,address_components',
      key: apiKey,
    })

    if (language) {
      params.append('language', language)
    }

    const url = `https://maps.googleapis.com/maps/api/place/details/json?${params}`
    
    const response = await fetch(url)
    const data = await response.json()

    if (data.status === 'OK' && data.result) {
      return NextResponse.json({
        status: 'OK',
        result: data.result
      })
    } else if (data.status === 'ZERO_RESULTS' || data.status === 'NOT_FOUND') {
      // Valid responses that just mean no data found
      return NextResponse.json({
        status: data.status,
        result: null
      })
    } else {
      console.error('Google Places Details API error:', data.status, data.error_message)
      return NextResponse.json({
        status: data.status,
        error: data.error_message || 'Unknown API error',
        result: null
      }, { status: 400 })
    }
  } catch (error) {
    console.error('Error calling Google Places Details API:', error)
    return NextResponse.json(
      { error: 'Failed to fetch place details' },
      { status: 500 }
    )
  }
} 