/**
 * CLI Test Script for Contextual Narration Edge Function
 * 
 * Usage:
 *   npx tsx --env-file=.env scripts/test-contextual-narration.ts <POI_ID>
 */

import { createClient } from '@supabase/supabase-js'
import * as dotenv from 'dotenv'
import { resolve } from 'path'

// Load environment variables
dotenv.config({ path: resolve(process.cwd(), '.env') })

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL || ''
const SUPABASE_ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || ''

if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
    console.error('❌ Missing Supabase environment variables')
    process.exit(1)
}

const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY)

async function testContextualNarration(poiId: string) {
    console.log(`🚀 Testing Contextual Narration for POI: ${poiId}\n`)

    const payload = {
        action: 'generate_text',
        target_poi: {
            id: poiId,
            name: 'Bragança Paulista',
            type: 'Cidade Histórica',
            bearing: 45, // User heading is 0, so POI is on the right
            distance: 350
        },
        travel_mode: 'drive',
        user_context: {
            location: { latitude: -22.952, longitude: -46.541 },
            speed: 60,
            heading: 0,
            language: 'pt-br',
            previous_poi: {
                name: 'Represa do Jaguari',
                type: 'Natureza',
                played_at: new Date(Date.now() - 1000 * 60 * 15).toISOString() // 15 mins ago
            },
            next_poi: {
                name: 'Mercado Municipal',
                type: 'Gastronomia'
            }
        }
    }

    console.log('--- STEP 1: Generate Text ---')
    console.log('Payload:', JSON.stringify(payload, null, 2))

    let startTime = Date.now()
    const { data: textData, error: textError } = await supabase.functions.invoke('generate-contextual-narration', {
        body: payload
    })

    if (textError) {
        console.error('❌ Error generating text:', textError)
        try {
            const errorBody = await textError.context.text()
            console.error('Error Body:', errorBody)
        } catch (e) { }
        return
    }

    console.log(`✅ Text Generated in ${Date.now() - startTime}ms`)
    console.log('Response:', JSON.stringify(textData, null, 2))

    const scriptText = textData.data?.text_content
    if (!scriptText) {
        console.error('❌ No script text in response')
        return
    }

    console.log('\n--- STEP 2: Generate Audio (Lazy) ---')
    const audioPayload = {
        ...payload,
        action: 'generate_audio'
    }

    startTime = Date.now()
    const { data: audioData, error: audioError } = await supabase.functions.invoke('generate-contextual-narration', {
        body: audioPayload
    })

    if (audioError) {
        console.error('❌ Error generating audio:', audioError)
        return
    }

    console.log(`✅ Audio Generated in ${Date.now() - startTime}ms`)
    console.log('Response:', JSON.stringify(audioData, null, 2))
}

const poiId = process.argv[2] || '50cd5835-70db-41be-9084-3adcae63c15e'
testContextualNarration(poiId).catch(console.error)
