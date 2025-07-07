import { NextRequest, NextResponse } from 'next/server'

export async function POST(request: NextRequest) {
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
      image_url 
    } = body

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

    const prompt = `
    You are a knowledgeable and friendly travel-guide assistant with deep expertise in Brazilian history and culture.
    
    Your task: create a short (max 120 words) audio-friendly description of a tourist attraction for an international audience.  
    Make it **engaging, factual, and pleasant to hear**, highlighting:
    
    • Year of creation or foundation  
    • Key historical events or transformations (dates, restorations, famous episodes)  
    • Cultural or architectural curiosities that capture attention  
    • Why this place is relevant or iconic today  
    
    ### ATTRACTION DATA
    - Name: ${name}
    - Location: ${locationDetails}
    - Google Types (detailed categories): ${categories}
    - Rating: ${ratingInfo}
    - ${priceInfo || 'Price information not available'}
  
    - Business Info: ${businessInfo.length > 0 ? businessInfo.join(', ') : 'Standard tourist attraction'}
    ${existing_description ? `\n### EXISTING DESCRIPTION\n"${existing_description}"\nIf it is poor or inaccurate, replace it with a better version.` : ''}
    
    ### INSTRUCTIONS
    1. Quickly consult reliable sources (e.g., Wikipedia, IPHAN, official tourism or heritage sites) to confirm dates and facts.  
    2. Start the narration by mentioning the **POI name** in the very first sentence.  
    3. Do **NOT** mention directions (left, right, front, etc.).  
    4. Do **NOT** mention neighborhood, city, or region—focus solely on the site itself.  
    5. Avoid second-person language and exaggerated enthusiasm; keep a neutral, professional tone.  
    6. If historical details are scarce, provide a concise factual overview instead.  
    7. **Output only the description text in Brazilian Portuguese**. Do not include any headers, tags, or notes about AI.
    
    Return only the final description.`;



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
              temperature: 0.7,
              topK: 40,
              topP: 0.95,
              maxOutputTokens: 300,
            }
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
} 