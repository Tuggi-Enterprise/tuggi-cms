import { NextRequest, NextResponse } from 'next/server'

export async function GET(request: NextRequest) {
  try {
    const apiKey = process.env.GEMINI_API_KEY
    
    if (!apiKey) {
      return NextResponse.json(
        { error: 'GEMINI_API_KEY not found in environment variables' },
        { status: 500 }
      )
    }

    // Test with a simple prompt
    const testPrompt = 'Say "Hello World" in Portuguese'
    
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
                text: testPrompt
              }
            ]
          }
        ],
        generationConfig: {
          temperature: 0.2,
          maxOutputTokens: 50,
        },
      })
    })

    if (!response.ok) {
      const errorData = await response.json()
      return NextResponse.json(
        { 
          error: 'Gemini API test failed',
          status: response.status,
          details: errorData
        },
        { status: 500 }
      )
    }

    const data = await response.json()
    const generatedText = data.candidates?.[0]?.content?.parts?.[0]?.text

    return NextResponse.json({
      success: true,
      apiKeyConfigured: !!apiKey,
      response: generatedText,
      fullResponse: data
    })

  } catch (error) {
    console.error('Test endpoint error:', error)
    return NextResponse.json(
      { 
        error: 'Test failed',
        details: error instanceof Error ? error.message : 'Unknown error'
      },
      { status: 500 }
    )
  }
}
