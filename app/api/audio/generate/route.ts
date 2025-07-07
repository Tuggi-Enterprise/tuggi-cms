import { NextRequest, NextResponse } from 'next/server'
import { generateAudioWithGoogleTTS } from '@/lib/providers/googleTTS'

// Text preprocessing function to optimize for TTS narration
function preprocessTextForTTS(text: string): string {
  let processedText = text

  // Add natural pauses for better flow
  processedText = processedText.replace(/\. /g, '. ')
  processedText = processedText.replace(/\, /g, ', ')
  
  // Improve pronunciation of common Portuguese terms
  processedText = processedText.replace(/\bséc\./g, 'século')
  processedText = processedText.replace(/\bSéc\./g, 'Século')
  processedText = processedText.replace(/\bd\.C\./g, 'depois de Cristo')
  processedText = processedText.replace(/\ba\.C\./g, 'antes de Cristo')
  
  // Handle numbers and dates better
  processedText = processedText.replace(/\b(\d{4})\b/g, (match, year) => {
    // Convert years to more natural speech
    return `ano ${year}`
  })
  
  // Add emphasis to attraction names (first mention)
  const sentences = processedText.split('.')
  if (sentences.length > 0) {
    // Add slight pause before the main content
    processedText = sentences[0] + '...' + sentences.slice(1).join('.')
  }
  
  // Ensure proper sentence endings for natural flow
  processedText = processedText.replace(/([.!?])\s*/g, '$1 ')
  
  return processedText.trim()
}

// Voice selection based on content characteristics
function selectOptimalVoice(text: string): string {
  // For cultural/historical content, use warm, professional voices
  const isFormal = text.includes('história') || text.includes('cultural') || text.includes('patrimônio')
  const isMuseum = text.includes('museu') || text.includes('exposição') || text.includes('coleção')
  
  if (isFormal || isMuseum) {
    return 'nova' // Professional, clear female voice
  } else if (text.includes('parque') || text.includes('natureza')) {
    return 'alloy' // Warm, friendly voice for nature content
  } else {
    return 'nova' // Default professional voice
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json()
    const { text, attractionId, voice, speed, provider } = body

    if (!text || !attractionId) {
      return NextResponse.json(
        { error: 'Missing required parameters: text and attractionId' },
        { status: 400 }
      )
    }

    const selectedProvider = provider || 'openai'

    // Preprocess text for better TTS quality
    const optimizedText = preprocessTextForTTS(text)
    
    // Select optimal voice if not specified
    const selectedVoice = voice || selectOptimalVoice(text)
    
    // Adjust speed for tourism content (slightly slower for comprehension)
    const selectedSpeed = speed || 0.9

    let audioBuffer: ArrayBuffer | null = null
    let mimeType = 'audio/mpeg'
    let providerUsed = selectedProvider

    if (selectedProvider === 'google') {
      try {
        // Call Google TTS provider
        const googleResult = await generateAudioWithGoogleTTS({
          text: optimizedText,
          voice: selectedVoice,
          speed: selectedSpeed
        })
        audioBuffer = googleResult.audioBuffer
        mimeType = googleResult.mimeType || 'audio/mpeg'
      } catch (err) {
        // Fallback to OpenAI if Google fails
        providerUsed = 'openai'
      }
    }

    if (!audioBuffer || providerUsed === 'openai') {
      // Existing OpenAI logic
      const openaiApiKey = process.env.OPENAI_API_KEY
      if (!openaiApiKey) {
        return NextResponse.json(
          { error: 'OpenAI API key not configured' },
          { status: 500 }
        )
      }
      const ttsResponse = await fetch('https://api.openai.com/v1/audio/speech', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${openaiApiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          model: 'tts-1',
          input: optimizedText,
          voice: selectedVoice,
          response_format: 'mp3',
          speed: selectedSpeed
        })
      })
      if (!ttsResponse.ok) {
        const errorData = await ttsResponse.json()
        console.error('OpenAI TTS error:', errorData)
        return NextResponse.json(
          { error: 'Failed to generate audio with OpenAI TTS' },
          { status: 500 }
        )
      }
      audioBuffer = await ttsResponse.arrayBuffer()
    }

    // Convert ArrayBuffer to base64 for transport
    const audioBase64 = Buffer.from(audioBuffer).toString('base64')
    return NextResponse.json({
      success: true,
      audioData: audioBase64,
      mimeType,
      size: audioBuffer.byteLength,
      provider: providerUsed
    })
  } catch (error) {
    console.error('Error generating audio:', error)
    return NextResponse.json(
      { error: 'Failed to generate audio' },
      { status: 500 }
    )
  }
} 