import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { withAuth, withRateLimit } from '@/lib/auth-middleware'

// Use service role key for database access (bypasses RLS)
const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

export const POST = withAuth(withRateLimit(10, 60000)(async function(request: NextRequest) {
  try {
    console.log('🚀 Starting description generation (FIXED)...')
    const body = await request.json()
    console.log('📦 Request body received:', JSON.stringify(body, null, 2))
    
    const { 
      name, 
      city, 
      country, 
      state,
      formatted_address,
      vicinity,
      google_types, 
      rating, 
      user_ratings_total,
      price_level,
      business_status,
      opening_hours,
      website,
      formatted_phone_number,
      photos_references,
      existing_description,
      image_url,
      id: attractionId,
      google_place_id,
      lat: providedLat,
      lng: providedLng,
      reference_links
    } = body

    console.log('✅ Required parameters check:', { name: !!name, city: !!city, country: !!country })
    if (!name || !city || !country) {
      console.error('❌ Missing required parameters:', { name: !!name, city: !!city, country: !!country })
      return NextResponse.json(
        { error: 'Missing required parameters: name, city, country' },
        { status: 400 }
      )
    }

    const apiKey = process.env.GEMINI_API_KEY
    console.log('🔑 API Key check:', apiKey ? 'Configured' : 'NOT CONFIGURED')
    if (!apiKey) {
      console.error('❌ Gemini API key not configured')
      return NextResponse.json(
        { error: 'Gemini API key not configured' },
        { status: 500 }
      )
    }

    // Construct location details
    const locationDetails = [
      formatted_address,
      vicinity,
      state && state !== city ? `${city}, ${state}` : city,
      country
    ].filter(Boolean).join(', ') || 'Location not specified'

    // Process Google Types for better categorization
    const categories = google_types && Array.isArray(google_types) 
      ? google_types.slice(0, 5).join(', ')
      : google_types || 'Tourist attraction'

    // Format rating information
    const ratingInfo = rating 
      ? `${rating}/5 stars${user_ratings_total ? ` (${user_ratings_total} reviews)` : ''}`
      : 'Not rated'

    // Format business information
    const businessInfo = []
    if (business_status && business_status !== 'OPERATIONAL') {
      businessInfo.push(`Status: ${business_status}`)
    }
    if (opening_hours) {
      businessInfo.push('Has operating hours information')
    }
    if (website) {
      businessInfo.push('Has official website')
    }
    if (formatted_phone_number) {
      businessInfo.push('Phone contact available')
    }
    
    const safeBusinessInfo = Array.isArray(businessInfo) ? businessInfo : []

    // Use provided coordinates first, then fetch from DB if not provided
    let lat = providedLat
    let lng = providedLng
    
    // Only fetch from database if coordinates weren't provided directly
    if ((!lat || !lng) && (attractionId || google_place_id)) {
      let attraction_id = attractionId
      
      try {
        // If only google_place_id is provided, fetch the attraction id first
        if (!attraction_id && google_place_id) {
          console.log(`Looking up attraction with google_place_id: ${google_place_id}`)
          const { data: attraction, error: attractionError } = await supabase
            .schema('core')
            .from('attractions')
            .select('id')
            .eq('google_place_id', google_place_id)
            .maybeSingle()
          
          if (attractionError) {
            console.warn('Error fetching attraction by google_place_id:', attractionError)
          } else if (attraction) {
            console.log(`Found attraction with id: ${attraction.id}`)
          } else {
            console.log('No attraction found with that google_place_id')
          }
          attraction_id = attraction?.id
        }
        
        if (attraction_id) {
          console.log(`Looking up coordinates for attraction_id: ${attraction_id}`)
          const { data: coordinate, error: coordError } = await supabase
            .schema('core')
            .from('attraction_coordinate')
            .select('latitude, longitude')
            .eq('attraction_id', attraction_id)
            .maybeSingle()
          
          if (coordError) {
            console.warn('Error fetching coordinates:', coordError)
          } else if (coordinate) {
            console.log(`Found coordinates: ${coordinate.latitude}, ${coordinate.longitude}`)
          } else {
            console.log('No coordinates found for this attraction')
          }
          lat = coordinate?.latitude
          lng = coordinate?.longitude
        } else {
          console.log('No attraction_id available for coordinate lookup')
        }
      } catch (error) {
        console.warn('Error in coordinate lookup:', error)
      }
    } else {
      console.log('No identifiers (id or google_place_id) provided')
    }

    console.log(`Generating description for: ${name} (${lat && lng ? `${lat}, ${lng}` : 'no coordinates'})`);

    // Build sources section including website and reference links
    const sources = [];
    if (website) {
      sources.push(`- ${website} (Official Website)`);
    }
    if (reference_links && reference_links.length > 0) {
      sources.push(...reference_links.map((link: string) => `- ${link}`));
    }
    
    const sourcesSection = sources.length > 0
      ? `\n### AUTHORITATIVE SOURCES\n${sources.join('\n')}\nUse these sources as primary references for facts, dates, and details.\n`
      : '';

    // Generate prompt for single POI
    const prompt = `
You are a professional travel‑guide assistant with deep expertise in global history, culture, and tourism.

    STRICT RULES
    - Use only verifiable facts from the sources provided below or other official heritage/tourism sites (e.g., Wikipedia, IPHAN/UNESCO, government portals).
    - If unsure about a date or detail, OMIT it. Do NOT guess, infer, or invent.
    - If reliable information is limited, produce a SHORTER description.
    - Prioritize historical significance, cultural relevance, and notable architectural/artistic elements.
    - Write short, clear sentences optimized for text‑to‑speech (pleasant rhythm, no lists).
    - Avoid subjective superlatives and marketing language.
    - Do NOT include neighborhood, city, region, coordinates, street names, directions, opening hours, or prices.
    - OUTPUT: Only the final text in Brazilian Portuguese. No links, headings, or meta notes.

    AUTHORITATIVE SOURCES
    ${sourcesSection}

    TASK
    Write a concise (max 80 words), factual, engaging description of the attraction in Brazilian Portuguese. Spark curiosity and a sense of discovery while staying strictly factual.

    ATTRACTION DATA
    - Name: ${name}
    - Location: ${locationDetails}
    - Google Types: ${Array.isArray(google_types) ? google_types.join(', ') : google_types || 'tourist_attraction'}
    - Rating: ${ratingInfo}
    - Place ID: ${google_place_id || 'Not available'}
    - Latitude/Longitude: ${lat && lng ? `${lat}, ${lng}` : 'Not available'}
    - Business Info: ${safeBusinessInfo.length > 0 ? safeBusinessInfo.join(', ') : 'Standard tourist attraction'}

    INSTRUCTIONS
    1) Mention the POI name in the first sentence.
    2) Include year of construction/foundation ONLY if confirmed; otherwise omit.
    3) Highlight 1–2 key facts (restorations, episodes, curiosities) ONLY if verified.
    4) If data is scarce, keep it brief and strictly factual.
    `

    console.log("📝 Prompt sent to Gemini API:", prompt);

    const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-pro:generateContent?key=${apiKey}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        contents: [
          {
            parts: [
              {
                text: prompt
              }
            ]
          }
        ],
        generationConfig: {
          temperature: 0.2,
          topK: 40,
          topP: 0.9,
          maxOutputTokens: 320,
        },
      })
    })

    console.log('📡 Gemini API response status:', response.status)

    if (!response.ok) {
      const errorData = await response.json()
      console.error('❌ Gemini API error:', errorData)
      return NextResponse.json(
        { error: 'Failed to generate description with AI', details: errorData },
        { status: 500 }
      )
    }

    const data = await response.json()
    console.log('📄 Gemini API response data:', JSON.stringify(data, null, 2))
    
    const generatedText = data.candidates?.[0]?.content?.parts?.[0]?.text
    
    if (!generatedText) {
      console.error('❌ No text generated by Gemini')
      return NextResponse.json(
        { error: 'No description generated by AI' },
        { status: 500 }
      )
    }

    console.log('✅ Successfully generated description:', generatedText)

    return NextResponse.json({
      description: generatedText.trim()
    })

  } catch (error) {
    console.error('❌ Error generating description:', error)
    console.error('❌ Error stack:', error instanceof Error ? error.stack : 'No stack trace')
    return NextResponse.json(
      { error: 'Failed to generate description', details: error instanceof Error ? error.message : 'Unknown error' },
      { status: 500 }
    )
  }
}))
