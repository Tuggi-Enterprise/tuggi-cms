/**
 * POI migration pipeline — the operator's language and voice choice must reach the TTS step.
 *
 * Regression #157: `executeMultiLanguageAudioStep` declared `const languages = ['en-us',
 * 'es-es']` inside itself, shadowing the parameter of the same name, and sent a fixed
 * `voiceGender: 'male'`. The selector offers the 12 content languages of BR-IDIOMA-001, the
 * UI reported success, and the POI came out with 2 narrations. Shadowing raises neither a
 * type error nor a lint error, so this test is the only barrier: it fails if the local
 * declaration comes back.
 *
 * Run with: npm run test:api
 */

import { describe, it, before, after, beforeEach } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const ATTRACTION_ID = '22222222-2222-2222-2222-222222222222'

interface AudioRequest {
  attractionId: string
  targetLanguage: string
  voiceGender: string
}

/** Bodies handed to the generate-translated-audio Edge Function, in call order. */
let requests: AudioRequest[] = []
let originalFetch: typeof globalThis.fetch

/**
 * Stand-in for the service-role client: the step only reads the source description before
 * translating, so one chain that ends in maybeSingle() is enough.
 */
function createFakeService() {
  const chain: any = {
    select: () => chain,
    eq: () => chain,
    in: () => chain,
    order: () => chain,
    limit: () => chain,
    maybeSingle: async () => ({
      data: { description: 'Descrição em português do POI.', language: 'pt-br' },
      error: null,
    }),
  }
  return { schema: () => ({ from: () => chain }) }
}

type PipelineInternals = {
  executeMultiLanguageAudioStep(
    attractionId: string,
    languages: string[],
    voiceGender: 'male' | 'female'
  ): Promise<{ success: boolean; data?: any; error?: string }>
}

let pipeline: PipelineInternals

before(async () => {
  process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://project.supabase.co'
  process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY = 'anon-key-for-test'

  const { mock } = await import('node:test')
  mock.module('@/lib/core/supabase-client', {
    namedExports: {
      getSupabase: () => createFakeService(),
      getSupabaseService: () => createFakeService(),
      getSupabaseRouteHandler: () => createFakeService(),
    },
  })

  originalFetch = globalThis.fetch
  globalThis.fetch = (async (_url: any, init: any) => {
    requests.push(JSON.parse(init.body))
    return {
      ok: true,
      status: 200,
      json: async () => ({ success: true, data: { audioUrl: 'https://cdn/audio.mp3' } }),
      text: async () => '',
    }
  }) as any

  const mod = await import('@/lib/services/poi-migration-pipeline')
  // The step is `private static`: TypeScript's privacy is compile-time only, and going through
  // executePipeline would mean faking the whole homolog→core migration to reach one HTTP call.
  pipeline = mod.PoiMigrationPipeline as unknown as PipelineInternals
})

after(() => {
  globalThis.fetch = originalFetch
})

beforeEach(() => {
  requests = []
})

describe('multi-language audio step (#157, BR-IDIOMA-001)', () => {
  it('generates one narration per selected language, not a fixed pair', async () => {
    // Three languages picked in the screen, plus the source language the POI is authored in.
    const step = await pipeline.executeMultiLanguageAudioStep(
      ATTRACTION_ID,
      ['pt-br', 'en-us', 'fr-fr', 'de-de'],
      'male'
    )

    assert.equal(step.success, true, step.error)
    assert.deepEqual(
      requests.map(r => r.targetLanguage),
      ['en-us', 'fr-fr', 'de-de'],
      'the pipeline must ask for what the operator selected — the old code always sent en-us and es-es'
    )
    assert.equal(requests.length, 3, 'three languages selected, three narrations')
    assert.ok(
      requests.every(r => r.attractionId === ATTRACTION_ID),
      'every request targets the POI being processed'
    )
  })

  it('honours a language the old hardcoded pair never contained', async () => {
    // en-gb is the tag this screen used to get wrong, and es-es is the one the hardcoded pair
    // always produced: asking for en-gb alone proves the selection drives the calls.
    await pipeline.executeMultiLanguageAudioStep(ATTRACTION_ID, ['en-gb'], 'male')

    assert.deepEqual(requests.map(r => r.targetLanguage), ['en-gb'])
  })

  it('carries the selected voice gender instead of a fixed male voice', async () => {
    await pipeline.executeMultiLanguageAudioStep(ATTRACTION_ID, ['es-es', 'it-it'], 'female')

    assert.deepEqual(
      requests.map(r => r.voiceGender),
      ['female', 'female'],
      'voice gender travels from the screen to the TTS request'
    )
  })

  it('does not re-spend TTS budget on the source language', async () => {
    // The narration in the source language is produced by the audio step upstream; asking for
    // it again here would pay Google TTS twice for the same audio.
    const step = await pipeline.executeMultiLanguageAudioStep(ATTRACTION_ID, ['pt-br'], 'male')

    assert.equal(step.success, true)
    assert.equal(step.data?.skipped, true, 'nothing to translate is a skip, not a failure')
    assert.equal(requests.length, 0, 'no Edge Function call when only the source language is selected')
  })

  it('deduplicates and normalises the selection', async () => {
    await pipeline.executeMultiLanguageAudioStep(ATTRACTION_ID, ['EN-US', 'en-us', ' es-es '], 'male')

    assert.deepEqual(requests.map(r => r.targetLanguage), ['en-us', 'es-es'])
  })
})

describe('language tags offered by the POI processing screen (BR-IDIOMA-001)', () => {
  /** String literals of a `code: '...'`-shaped list, in file order. */
  function extractCodes(source: string, arrayName: string): string[] {
    const block = source.slice(source.indexOf(`${arrayName} = [`))
    const end = block.indexOf(']')
    return [...block.slice(0, end).matchAll(/code:\s*'([^']+)'/g)].map(m => m[1])
  }

  it('offers only tags the Edge Function zod gate accepts', () => {
    const screen = readFileSync(
      new URL('../../app/[locale]/poi-processing/page.tsx', import.meta.url),
      'utf8'
    )
    const schemas = readFileSync(
      new URL('../../supabase/functions/_shared/validation-schemas.ts', import.meta.url),
      'utf8'
    )

    const offered = extractCodes(screen, 'const LANGUAGES')
    const accepted = [
      ...schemas
        .slice(schemas.indexOf('const LANGUAGE_CODES = ['))
        .slice(0, schemas.slice(schemas.indexOf('const LANGUAGE_CODES = [')).indexOf(']'))
        .matchAll(/"([a-z-]+)"/g),
    ].map(m => m[1])

    // A ruler that finds nothing passes for the wrong reason: prove both lists were read.
    assert.equal(offered.length, 12, 'the screen offers the 12 content languages of BR-IDIOMA-001')
    assert.ok(accepted.length >= 20, `zod language enum not parsed (${accepted.length} entries)`)

    const rejected = offered.filter(code => !accepted.includes(code))
    assert.deepEqual(
      rejected,
      [],
      `these tags take 400 at the Edge Function and the operator only sees "failed": ${rejected.join(', ')}`
    )
    assert.ok(
      offered.includes('en-gb'),
      'British English is en-gb — UK is a reserved synonym of GB, absent from the IANA registry (RFC 5646 §2.2.4)'
    )
  })
})
