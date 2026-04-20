import { NextRequest, NextResponse } from 'next/server'
import { getSupabaseRouteHandler } from '@/lib/core/supabase-client'
import { generateAudioWithGoogleTTS } from '@/lib/providers/googleTTS'
import { supabase } from '@/lib/supabase'
import { cookies } from 'next/headers'

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
  // Force "em [year]" instead of "no ano de [year]" for naturalness
  processedText = processedText.replace(/\bno ano de (\d{4})\b/g, 'em $1')

  // Do NOT force "ano" before 4 digits (removed previous rule)

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
  // For cultural/historical content, use warm, professional male voices
  const isFormal = text.includes('história') || text.includes('cultural') || text.includes('patrimônio')
  const isMuseum = text.includes('museu') || text.includes('exposição') || text.includes('coleção')

  if (isFormal || isMuseum) {
    return 'onyx' // Professional, clear male voice
  } else if (text.includes('parque') || text.includes('natureza')) {
    return 'alloy' // Warm, friendly male voice for nature content
  } else {
    return 'onyx' // Default professional male voice
  }
}

export const POST = async function (request: NextRequest) {
  try {
    console.log('🚀 Starting audio generation...')

    // Check for internal API key first (for server-to-server calls)
    const authHeader = request.headers.get('authorization')
    const isInternalCall = authHeader === `Bearer ${process.env.INTERNAL_API_KEY || 'internal-key'}`

    let userEmail = 'internal-call'

    if (!isInternalCall) {
      // Regular authentication check for user requests
      const cookieStore = await cookies()
      const supabaseAuth = getSupabaseRouteHandler(cookieStore)
      const { data: { session }, error } = await supabaseAuth.auth.getSession()

      if (error || !session) {
        console.log('❌ No authenticated user found')
        return NextResponse.json(
          { error: 'Unauthorized - Authentication required' },
          { status: 401 }
        )
      }

      userEmail = session.user.email || 'unknown'
      console.log('✅ User authenticated:', userEmail)
    } else {
      console.log('✅ Internal API call authenticated')
    }

    const body = await request.json()
    let { text, attractionId, voice, speed, provider } = body

    if (!text || !attractionId) {
      return NextResponse.json(
        { error: 'Missing required parameters: text and attractionId' },
        { status: 400 }
      )
    }

    // 1. Check if POI is in a group
    let groupMembers = null
    const { data: groupMember } = await supabase
      .schema('core')
      .from('attraction_group_members')
      .select('group_id')
      .eq('attraction_id', attractionId)
      .maybeSingle()
    if (groupMember && groupMember.group_id) {
      // Fetch all group members
      const { data: members } = await supabase
        .schema('core')
        .from('attraction_group_members')
        .select('attraction_id')
        .eq('group_id', groupMember.group_id)
      if (members && members.length > 0) {
        // Fetch metadata for all group members
        const ids = members.map(m => m.attraction_id)
        const { data: pois } = await supabase
          .schema('core')
          .from('attractions')
          .select('name')
          .in('id', ids)
        groupMembers = pois
      }
    }

    // 2. If in a group, concatenate names for TTS
    if (groupMembers && groupMembers.length > 1) {
      text = groupMembers.map(p => p.name).join(', ')
    }

    const selectedProvider = provider || 'openai'

    // Preprocess text for better TTS quality
    const optimizedText = preprocessTextForTTS(text)

    // Select optimal voice if not specified
    const selectedVoice = voice || selectOptimalVoice(text)

    // Adjust speed for tourism content (optimized for clarity)
    const selectedSpeed = speed || 1.2

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
        audioBuffer = googleResult.audioBuffer as unknown as ArrayBuffer
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