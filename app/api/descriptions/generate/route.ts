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
    const body = await request.json()
    
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
      id: attractionId, // allow id to be passed in body
      google_place_id, // allow google_place_id to be passed in body
      lat: providedLat, // coordinates can be provided directly
      lng: providedLng, // coordinates can be provided directly
      reference_links // accept reference_links from body
    } = body

    console.log('🔍 COORDINATE FETCH DEBUG:', {
      attractionId: attractionId || 'not provided',
      google_place_id: google_place_id || 'not provided',
      providedLat: providedLat || 'not provided',
      providedLng: providedLng || 'not provided',
      name: name
    })

    if (!name || !city || !country) {
      return NextResponse.json(
        { error: 'Missing required parameters: name, city, country' },
        { status: 400 }
      )
    }

    const apiKey = process.env.GEMINI_API_KEY
    if (!apiKey) {
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
    ].filter(Boolean).join(', ')

    // Process Google Types for better categorization (prioritize over generic category)
    const categories = google_types && Array.isArray(google_types) 
      ? google_types.slice(0, 5).join(', ') // Show up to 5 types for rich context
      : google_types || 'Tourist attraction'

    // Format rating information
    const ratingInfo = rating 
      ? `${rating}/5 stars${user_ratings_total ? ` (${user_ratings_total} reviews)` : ''}`
      : 'Not rated'

    // Format price level
    const priceInfo = price_level 
      ? `Price level: ${price_level}/4 (${price_level === 1 ? 'Inexpensive' : price_level === 2 ? 'Moderate' : price_level === 3 ? 'Expensive' : 'Very Expensive'})`
      : null

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

    // Photo information
    const photoInfo = photos_references > 0 ? `${photos_references} photos available` : 'No photos available'

    // Use provided coordinates first, then fetch from DB if not provided
    let lat = providedLat
    let lng = providedLng
    
    // Only fetch from database if coordinates weren't provided directly
    if ((!lat || !lng) && (attractionId || google_place_id)) {
      let attraction_id = attractionId
      
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
    } else {
      console.log('No identifiers (id or google_place_id) provided')
    }

    // 1. Check if POI is in a group (do this regardless of coordinate source)
    let groupId = null
    let groupMembers = null
    if (attractionId) {
      console.log(`🔍 Checking if POI ${attractionId} is in a group...`)
      const { data: groupMember } = await supabase
        .schema('core')
        .from('attraction_group_members')
        .select('group_id')
        .eq('attraction_id', attractionId)
        .maybeSingle()
      if (groupMember && groupMember.group_id) {
        groupId = groupMember.group_id
        console.log(`✅ POI is in group: ${groupId}`)
        // Fetch all group members
        const { data: members } = await supabase
          .schema('core')
          .from('attraction_group_members')
          .select('attraction_id')
          .eq('group_id', groupId)
        if (members && members.length > 0) {
          // Fetch metadata for all group members
          const ids = members.map(m => m.attraction_id)
          const { data: pois } = await supabase
            .schema('core')
            .from('attractions')
            .select('*')
            .in('id', ids)
          groupMembers = pois
          console.log(`📋 Fetched ${pois?.length || 0} group members:`, pois?.map(p => p.name))
        }
      } else {
        console.log(`❌ POI is not in any group`)
      }
    } else {
      console.log(`⚠️ No attractionId provided, skipping group detection`)
    }

    console.log(`Generating description for: ${name} (${lat && lng ? `${lat}, ${lng}` : 'no coordinates'})`);

    const referenceLinksSection = reference_links && reference_links.length > 0
      ? `\n### REFERENCE LINKS\n${reference_links.map((link: string) => `- ${link}`).join('\n')}\nUse these links as primary sources for facts and details.\n`
      : '';

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

    // 2. If in a group, concatenate metadata for prompt
    let combinedName = name
    let combinedTypes = google_types
    let combinedRating = rating
    let combinedPhotos = photos_references
    let combinedReferenceLinks = reference_links
    if (groupMembers && groupMembers.length > 1) {
      console.log(`🔗 Combining data for ${groupMembers.length} group members`)
      combinedName = groupMembers.map(p => p.name).join(', ')
      combinedTypes = groupMembers.flatMap(p => p.google_types || []).filter(Boolean)
      combinedRating = groupMembers.map(p => p.rating).filter(Boolean).join(', ')
      combinedPhotos = groupMembers.reduce((sum, p) => sum + (p.photos_references?.length || 0), 0)
      combinedReferenceLinks = groupMembers.flatMap(p => p.reference_links || [])
      console.log(`📝 Combined name: ${combinedName}`)
      console.log(`📝 Combined types: ${combinedTypes.join(', ')}`)
      console.log(`📝 Combined rating: ${combinedRating}`)
    } else {
      console.log(`📝 Using individual POI data (not in group or single member)`)
    }

    // 3. Generate different prompts for single vs group POIs
    let prompt = ''
    
    if (groupMembers && groupMembers.length > 1) {
      // GROUP POI PROMPT
      console.log(`🎯 Using GROUP POI prompt for ${groupMembers.length} attractions`)
      prompt = `
    You are a professional travel‑guide assistant with deep expertise in global history, culture, and tourism.

          STRICT RULES
          - Use only verifiable facts from the sources provided below or other official heritage/tourism sites (e.g., Wikipedia, IPHAN/UNESCO, government portals).
          - If unsure about a date or detail, OMIT it. Do NOT guess, infer, or invent.
          - If reliable information is limited, produce a SHORTER description.
          - Prioritize historical connections, cultural relevance, and notable architectural/artistic elements that LINK these sites.
          - Write short, clear sentences optimized for text‑to‑speech (pleasant rhythm, no lists).
          - Avoid subjective superlatives and marketing language.
          - Do NOT include neighborhood, city, region, coordinates, street names, directions, opening hours, or prices.
          - OUTPUT: Only the final text in Brazilian Portuguese. No links, headings, or meta notes.

          AUTHORITATIVE SOURCES
          ${sourcesSection}

          TASK
          Write a concise (max 150 words), factual, engaging description for a GROUP of nearby attractions in Brazilian Portuguese. Spark curiosity and a sense of discovery while staying strictly factual.

          GROUP OF ATTRACTIONS DATA
          - Names: ${combinedName}
          - Location: ${locationDetails}
          - Google Types: ${combinedTypes.join(', ')}
          - Ratings: ${combinedRating}
          - Place ID: ${google_place_id || 'Not available'}
          - Latitude/Longitude: ${lat && lng ? `${lat}, ${lng}` : 'Not available'}
          - Business Info: ${businessInfo.length > 0 ? businessInfo.join(', ') : 'Standard tourist attractions'}

          INSTRUCTIONS
          1) State that these are nearby attractions that can be visited together.
          2) Emphasize what connects them (shared history, style, theme, timeline).
          3) Mention each by name at least once, but keep the narrative unified and fluid.
          4) If data is scarce, keep it brief and strictly factual.
          `
    } else {
      // SINGLE POI PROMPT
      console.log(`🎯 Using SINGLE POI prompt for individual attraction`)
      prompt = `
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
        - Name: ${combinedName}
        - Location: ${locationDetails}
        - Google Types: ${combinedTypes.join(', ')}
        - Rating: ${combinedRating}
        - Place ID: ${google_place_id || 'Not available'}
        - Latitude/Longitude: ${lat && lng ? `${lat}, ${lng}` : 'Not available'}
        - Business Info: ${businessInfo.length > 0 ? businessInfo.join(', ') : 'Standard tourist attraction'}

        INSTRUCTIONS
        1) Mention the POI name in the first sentence.
        2) Include year of construction/foundation ONLY if confirmed; otherwise omit.
        3) Highlight 1–2 key facts (restorations, episodes, curiosities) ONLY if verified.
        4) If data is scarce, keep it brief and strictly factual.
        `
    }


// Construct the prompt for cultural/historical description
// const prompt = `Generate a cultural and historical description for a tourist attraction. 

// Details:
// - Name: ${name}
// - Location: ${city}, ${country}
// - Category: ${category || 'Not specified'}
// - Rating: ${rating ? `${rating}/5` : 'Not available'}
// - ${photoInfo}

// Please provide a rich, informative description that includes:
// 1. Historical significance and background
// 2. Cultural importance and context
// 3. Interesting facts or unique features
// 4. What makes this place special for tourists
// 5. Mention the **neighborhood, city or region** to help contextualize the narration geographically.

// The description should be engaging, informative, and approximately 200-300 words. Write in a professional but accessible tone suitable for tourists. Focus on factual information about the attraction's history, cultural significance, and notable features.

// Do not include practical information like opening hours, prices, or directions. Focus purely on the cultural and historical narrative.`

    // Call Google Gemini API - try AI Studio endpoint first, fallback to Cloud API
    const endpoints = [
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-pro-latest:generateContent?key=${apiKey}`,
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-pro:generateContent?key=${apiKey}`
    ]

    let geminiResponse = null
    let lastError = null
    console.log("Prompt sent to Gemini API:", prompt);

    for (const endpoint of endpoints) {
      try {
        geminiResponse = await fetch(endpoint, {
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

        if (geminiResponse.ok) {
          break // Success, exit loop
        } else {
          const errorData = await geminiResponse.json()
          lastError = errorData
          console.warn(`Failed with endpoint ${endpoint}:`, errorData)
        }
      } catch (error) {
        console.warn(`Error with endpoint ${endpoint}:`, error)
        lastError = error
      }
    }

    if (!geminiResponse || !geminiResponse.ok) {
      console.error('Gemini API error:', lastError)
      return NextResponse.json(
        { error: 'Failed to generate description with AI. Please check your API key and ensure the Generative AI API is enabled in Google Cloud Console.' },
        { status: 500 }
      )
    }

    const geminiData = await geminiResponse.json()
    
    // Extract the generated text
    const generatedText = geminiData.candidates?.[0]?.content?.parts?.[0]?.text
    
    if (!generatedText) {
      return NextResponse.json(
        { error: 'No description generated by AI' },
        { status: 500 }
      )
    }

    return NextResponse.json({
      description: generatedText.trim()
    })

  } catch (error) {
    console.error('Error generating description:', error)
    return NextResponse.json(
      { error: 'Failed to generate description' },
      { status: 500 }
    )
  }
}))