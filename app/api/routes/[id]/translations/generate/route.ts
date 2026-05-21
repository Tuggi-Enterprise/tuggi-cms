/**
 * POST /api/routes/[id]/translations/generate
 * Proxy para a Edge Function generate-translated-audio (route mode).
 * O browser não chama a EF diretamente — esta rota CMS gerencia a auth.
 */

import { NextRequest, NextResponse } from 'next/server'
import { getSupabaseService } from '@/lib/core/supabase-client'

export const dynamic = 'force-dynamic'

export async function POST(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  const routeId = params.id
  const body = await req.json()
  const { language, gender = 'male', generateAudio = true } = body

  if (!language) {
    return NextResponse.json({ error: 'language is required' }, { status: 400 })
  }

  const supabase = getSupabaseService()

  const { data, error } = await supabase.functions.invoke('generate-translated-audio', {
    body: {
      routeId,
      targetLanguage: language,
      voiceGender:    gender,
      generateAudio,
    },
  })

  if (error) {
    console.error('[translations/generate] EF error:', error)
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  return NextResponse.json(data)
}
