import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { createRouteHandlerClient } from '@supabase/auth-helpers-nextjs'
import { cookies } from 'next/headers'

// Use service role key for database access (bypasses RLS)
const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

console.log('🔧 DEBUG: Supabase URL configured:', !!process.env.NEXT_PUBLIC_SUPABASE_URL)
console.log('🔧 DEBUG: Supabase Service Role Key configured:', !!process.env.SUPABASE_SERVICE_ROLE_KEY)

export const POST = async function(request: NextRequest) {
  try {
    console.log('🚀 Starting description generation (BYPASS MODE)...')
    
    // Basic security check - verify session exists
    const supabase = createRouteHandlerClient({ cookies })
    const { data: { session }, error } = await supabase.auth.getSession()
    
    if (error || !session) {
      console.log('❌ No authenticated user found')
      return NextResponse.json(
        { error: 'Unauthorized - Authentication required' },
        { status: 401 }
      )
    }
    
    console.log('✅ User authenticated:', session.user.email)
    
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
    
    // Ensure businessInfo is always an array
    const safeBusinessInfo = Array.isArray(businessInfo) ? businessInfo : []

    // Photo information
    const photoInfo = photos_references > 0 ? `${photos_references} photos available` : 'No photos available'

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

    // 1. Check if POI is in a group (do this regardless of coordinate source)
    let groupId = null
    let groupMembers = null
    if (attractionId) {
      console.log(`🔍 Checking if POI ${attractionId} is in a group...`)
      try {
        const { data: groupMember, error: groupError } = await supabase
          .schema('core')
          .from('attraction_group_members')
          .select('group_id')
          .eq('attraction_id', attractionId)
          .maybeSingle()
        
        if (groupError) {
          console.warn('Error checking group membership:', groupError)
        } else if (groupMember && groupMember.group_id) {
          groupId = groupMember.group_id
          console.log(`✅ POI is in group: ${groupId}`)
          // Fetch all group members
          const { data: members, error: membersError } = await supabase
            .schema('core')
            .from('attraction_group_members')
            .select('attraction_id')
            .eq('group_id', groupId)
          
          if (membersError) {
            console.warn('Error fetching group members:', membersError)
          } else if (members && members.length > 0) {
            // Fetch metadata for all group members
            const ids = members.map(m => m.attraction_id)
            const { data: pois, error: poisError } = await supabase
              .schema('core')
              .from('attractions')
              .select('*')
              .in('id', ids)
            
            if (poisError) {
              console.warn('Error fetching POI data:', poisError)
            } else {
              groupMembers = pois
              console.log(`📋 Fetched ${pois?.length || 0} group members:`, pois?.map(p => p.name))
            }
          }
        } else {
          console.log(`❌ POI is not in any group`)
        }
      } catch (error) {
        console.warn('Error in group detection:', error)
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
    let combinedName = name || 'Unknown'
    let combinedTypes = Array.isArray(google_types) ? google_types : []
    let combinedRating = rating || 'Not available'
    let combinedPhotos = photos_references || 0
    let combinedReferenceLinks = Array.isArray(reference_links) ? reference_links : []
    if (groupMembers && groupMembers.length > 1) {
      console.log(`🔗 Combining data for ${groupMembers.length} group members`)
      combinedName = groupMembers.map(p => p.name).join(', ')
      combinedTypes = groupMembers.flatMap(p => Array.isArray(p.google_types) ? p.google_types : []).filter(Boolean)
      const ratings = groupMembers.map(p => p.rating).filter(Boolean)
      combinedRating = ratings.length > 0 ? ratings.join(', ') : 'Not available'
      combinedPhotos = groupMembers.reduce((sum, p) => sum + (p.photos_references?.length || 0), 0)
      combinedReferenceLinks = groupMembers.flatMap(p => Array.isArray(p.reference_links) ? p.reference_links : [])
      console.log(`📝 Combined name: ${combinedName}`)
      console.log(`📝 Combined types: ${combinedTypes.join(', ')}`)
      console.log(`📝 Combined rating: ${combinedRating}`)
    } else {
      console.log(`📝 Using individual POI data (not in group or single member)`)
    }

    // 3. Generate different prompts for single vs group POIs
    let prompt = ''
    
    // Debug all variables before using them in template
    console.log('🔍 DEBUG - All variables before template:')
    console.log('- combinedName:', combinedName)
    console.log('- combinedTypes:', combinedTypes)
    console.log('- combinedRating:', combinedRating)
    console.log('- combinedPhotos:', combinedPhotos)
    console.log('- combinedReferenceLinks:', combinedReferenceLinks)
    console.log('- locationDetails:', locationDetails)
    console.log('- safeBusinessInfo:', safeBusinessInfo)
    console.log('- sourcesSection:', sourcesSection)
    console.log('- google_place_id:', google_place_id)
    console.log('- lat:', lat)
    console.log('- lng:', lng)
    
    if (groupMembers && groupMembers.length > 1) {
      // GROUP POI PROMPT
      console.log(`🎯 Using GROUP POI prompt for ${groupMembers.length} attractions`)
      prompt = `
    You are a professional travel‑guide assistant with deep expertise in global history, culture, and tourism.

          STRICT RULES
          - Use only verifiable facts from the sources provided or other official heritage/tourism sites (e.g., Wikipedia, IPHAN/UNESCO, government portals).
          - If unsure about a date or detail, omit it. Do NOT guess, infer, or invent.
          - Always prioritize historical context, original purpose, and major transformations over time, then mention cultural or environmental relevance.
          - Include 1–3 notable, confirmed facts such as year of construction/foundation, original function, important events, restorations, or environmental/cultural impact.
          - Keep sentences short and fluid for text-to-speech. Avoid lists or bullet points.
          - Do NOT include neighborhood, city, region, coordinates, street names, directions, opening hours, or prices.
          - OUTPUT: Only the final text in Brazilian Portuguese. No links, headings, or meta notes.

          TASK
          Write a concise (max 300 words), factual, engaging description for a GROUP of nearby attractions in Brazilian Portuguese. Spark curiosity and a sense of discovery while staying strictly factual.

          GROUP OF ATTRACTIONS DATA
          - Names: ${combinedName}
          - Location: ${locationDetails}
          - Latitude/Longitude: ${lat && lng ? `${lat}, ${lng}` : 'Not available'}
          - AUTHORITATIVE SOURCES: ${sourcesSection}

          INSTRUCTIONS
          1) State that these are nearby attractions that can be visited together.
          2) Emphasize what connects them (shared history, style, theme, timeline).
          3) Mention each by name at least once, but keep the narrative unified and fluid.
          4) If data is scarce, keep it brief and strictly factual.
          5) The text will come immediately after an audio cue such as “À sua frente…”, “À direita…” or “À esquerda…”, so do not include this directional cue in the text.
          6) Always start with the structure: “[continuação do áudio direcional] [nome do POI], [ano de construção/fundação se confirmado] [fato principal]”.
          7) Example: “fica a Represa Guarapiranga, formada em 1908 com o represamento do rio Guarapiranga.”
          8) After the first sentence, add 2–3 short sentences about historical changes, current function, and confirmed cultural or environmental importance.
          9) If multiple relevant facts exist, weave them naturally into the narrative.
          10) If reliable information is scarce, keep it brief but factual.
          - OUTPUT: Only the final text in Brazilian Portuguese. No links, headings, or meta notes.
          `
    } else {
      // SINGLE POI PROMPT
      console.log(`🎯 Using SINGLE POI prompt for individual attraction`)
      prompt = `
        You are a professional travel-guide assistant with deep expertise in global history, culture, and tourism.

          STRICT RULES

          Use only verifiable facts from the sources provided or other official heritage/tourism sites (e.g., Wikipedia, IPHAN/UNESCO, government portals).
          If unsure about a date or detail, omit it. Do NOT guess, infer, or invent.
          Always prioritize historical context, original purpose, and major transformations over time, then mention cultural or environmental relevance.
          Include 1–3 notable, confirmed facts such as year of construction/foundation, original function, important events, restorations, or environmental/cultural impact.
          Keep sentences short and fluid for text-to-speech. Avoid lists or bullet points.
          Do NOT include neighborhood, city, region, coordinates, street names, directions, opening hours, or prices.
          OUTPUT: Only the final text in Brazilian Portuguese. No links, headings, or meta notes.

          TASK
          Write a concise (max 200 words), factual, engaging description of the attraction in Brazilian Portuguese. Spark curiosity and a sense of discovery while staying strictly factual.

          ATTRACTION DATA

          - Name: ${combinedName}
          - Location: ${locationDetails}
          - Latitude/Longitude: ${lat && lng ? `${lat}, ${lng}` : 'Not available'}
          - Authoritative Sources: ${sourcesSection}

          INSTRUCTIONS

          1 - The text will come immediately after an audio cue such as “À sua frente…”, “À direita…” or “À esquerda…”, so do not include this directional cue in the text.
          2 - Always start with the structure: “[continuação do áudio direcional] [nome do POI], [ano de construção/fundação se confirmado] [fato principal]”.
          3 - Example: “fica a Represa Guarapiranga, formada em 1908 com o represamento do rio Guarapiranga.”
          4 - After the first sentence, add 2–3 short sentences about historical changes, current function, and confirmed cultural or environmental importance.
          5 - If multiple relevant facts exist, weave them naturally into the narrative.
          6 - If reliable information is scarce, keep it brief but factual.
          - OUTPUT: Only the final text in Brazilian Portuguese. No links, headings, or meta notes.
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
              temperature: 0.5,
              topK: 40,
              topP: 0.95,
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
    console.error('❌ Error generating description:', error)
    console.error('❌ Error stack:', error instanceof Error ? error.stack : 'No stack trace')
    return NextResponse.json(
      { error: 'Failed to generate description' },
      { status: 500 }
    )
  }
}