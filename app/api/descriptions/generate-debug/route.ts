import { NextRequest, NextResponse } from 'next/server'
import { createRouteHandlerClient } from '@supabase/auth-helpers-nextjs'
import { cookies } from 'next/headers'
import { createClient } from '@supabase/supabase-js'

// Use service role key for database access (bypasses RLS)
const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

export async function POST(request: NextRequest) {
  try {
    console.log('🚀 DEBUG ENDPOINT: Starting authentication check...')
    
    // Step 1: Create Supabase client
    const supabaseAuth = createRouteHandlerClient({ cookies })
    console.log('✅ DEBUG ENDPOINT: Supabase client created')
    
    // Step 2: Get session
    console.log('🔍 DEBUG ENDPOINT: Getting session...')
    const { data: { session }, error } = await supabaseAuth.auth.getSession()
    
    console.log('🔍 DEBUG ENDPOINT: Session check:', {
      hasSession: !!session,
      hasError: !!error,
      error: error?.message,
      userEmail: session?.user?.email
    })
    
    if (error || !session) {
      console.log('❌ DEBUG ENDPOINT: No authenticated user')
      return NextResponse.json(
        { error: 'Unauthorized - Authentication required' },
        { status: 401 }
      )
    }

    console.log('✅ DEBUG ENDPOINT: User authenticated, checking CMS access...')

    // Step 3: Check CMS user
    console.log('👤 DEBUG ENDPOINT: Checking CMS user...')
    const { data: cmsUser, error: cmsError } = await supabase
      .schema('core')
      .from('cms_users')
      .select('role, is_active')
      .eq('email', session.user.email)
      .eq('is_active', true)
      .single()

    console.log('👤 DEBUG ENDPOINT: CMS user check:', {
      hasCmsUser: !!cmsUser,
      hasError: !!cmsError,
      error: cmsError?.message,
      role: cmsUser?.role,
      isActive: cmsUser?.is_active
    })

    if (cmsError || !cmsUser) {
      console.log('❌ DEBUG ENDPOINT: CMS access denied')
      return NextResponse.json(
        { error: 'Unauthorized - CMS access denied' },
        { status: 403 }
      )
    }

    // Step 4: Check role
    console.log('🔑 DEBUG ENDPOINT: Checking role authorization...')
    if (!['admin', 'editor'].includes(cmsUser.role)) {
      console.log('❌ DEBUG ENDPOINT: Insufficient privileges:', cmsUser.role)
      return NextResponse.json(
        { error: 'Unauthorized - Insufficient privileges' },
        { status: 403 }
      )
    }

    console.log('✅ DEBUG ENDPOINT: Authentication successful, processing request...')

    // Step 5: Process the actual request
    const body = await request.json()
    console.log('📦 DEBUG ENDPOINT: Request body received:', JSON.stringify(body, null, 2))
    
    const { 
      name, 
      city, 
      country, 
      google_types
    } = body

    console.log('✅ DEBUG ENDPOINT: Required parameters check:', { name: !!name, city: !!city, country: !!country })
    
    if (!name || !city || !country) {
      console.error('❌ DEBUG ENDPOINT: Missing required parameters')
      return NextResponse.json(
        { error: 'Missing required parameters: name, city, country' },
        { status: 400 }
      )
    }

    const apiKey = process.env.GEMINI_API_KEY
    console.log('🔑 DEBUG ENDPOINT: API Key check:', apiKey ? 'Configured' : 'NOT CONFIGURED')
    
    if (!apiKey) {
      console.error('❌ DEBUG ENDPOINT: Gemini API key not configured')
      return NextResponse.json(
        { error: 'Gemini API key not configured' },
        { status: 500 }
      )
    }

    // Simple prompt for testing
    const prompt = `Write a short description (max 80 words) in Brazilian Portuguese for this tourist attraction:

Name: ${name}
Location: ${city}, ${country}
Types: ${Array.isArray(google_types) ? google_types.join(', ') : google_types || 'tourist_attraction'}

Write only the description in Portuguese, no additional text.`

    console.log('📝 DEBUG ENDPOINT: Sending prompt to Gemini:', prompt)

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
          maxOutputTokens: 200,
        },
      })
    })

    console.log('📡 DEBUG ENDPOINT: Gemini API response status:', response.status)

    if (!response.ok) {
      const errorData = await response.json()
      console.error('❌ DEBUG ENDPOINT: Gemini API error:', errorData)
      return NextResponse.json(
        { error: 'Failed to generate description with AI', details: errorData },
        { status: 500 }
      )
    }

    const data = await response.json()
    console.log('📄 DEBUG ENDPOINT: Gemini API response data:', JSON.stringify(data, null, 2))
    
    const generatedText = data.candidates?.[0]?.content?.parts?.[0]?.text
    
    if (!generatedText) {
      console.error('❌ DEBUG ENDPOINT: No text generated by Gemini')
      return NextResponse.json(
        { error: 'No description generated by AI' },
        { status: 500 }
      )
    }

    console.log('✅ DEBUG ENDPOINT: Successfully generated description:', generatedText)

    return NextResponse.json({
      description: generatedText.trim()
    })

  } catch (error) {
    console.error('❌ DEBUG ENDPOINT: Error:', error)
    console.error('❌ DEBUG ENDPOINT: Error stack:', error instanceof Error ? error.stack : 'No stack trace')
    return NextResponse.json(
      { error: 'Failed to generate description', details: error instanceof Error ? error.message : 'Unknown error' },
      { status: 500 }
    )
  }
}
