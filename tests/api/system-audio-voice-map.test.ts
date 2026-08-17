/**
 * `supabase/functions/_shared/ttsGenerator.ts` — os dois tiers de voz.
 *
 * Duas garantias, e a segunda é a que importa mais:
 *
 * 1. o tier `hd` resolve para `{locale}-Chirp3-HD-{Voz}` nos 11 locales em que o
 *    Google publica Chirp 3: HD, e **cai para `legacy` em pt-PT**, que não está na
 *    lista — sem trocar por pt-BR, que entregaria sotaque errado no ouvido do turista;
 * 2. sem `options`, `getVoiceConfig` devolve exatamente a voz de sempre. Toda narração
 *    de POI já gravada passou por aqui; um default diferente mudaria a voz do acervo.
 *
 * Módulo Deno puro, carregado por caminho montado em tempo de execução.
 *
 * Run with: npm run test:api
 */

import { test, before } from 'node:test'
import assert from 'node:assert/strict'
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

interface ResolvedVoice {
  name: string
  languageCode: string
  pitch: number
  tierUsed: 'legacy' | 'hd'
}

interface TtsModule {
  getVoiceConfig: (
    language: string,
    gender: 'male' | 'female',
    tier?: 'legacy' | 'hd',
    voiceName?: string
  ) => ResolvedVoice
  isHdAvailable: (language: string) => boolean
  recommendedVoice: (language: string, gender: 'male' | 'female') => string
  CHIRP3_HD_VOICES: ReadonlyArray<{ name: string; gender: 'male' | 'female' }>
  CHIRP3_HD_DEFAULT_VOICE: Record<'male' | 'female', string>
  CHIRP3_HD_VOICE_BY_LOCALE: Record<string, Record<'male' | 'female', string>>
  CHIRP3_HD_LANGUAGE_CODES: ReadonlySet<string>
}

const MODULE_PATH = resolve(
  import.meta.dirname,
  '../../supabase/functions/_shared/ttsGenerator.ts'
)

/** Os 11 locales do app em que o Chirp 3: HD é GA. `pt-pt` fica de fora de propósito. */
const HD_LOCALES = [
  'pt-br',
  'en-us',
  'en-gb',
  'es-es',
  'fr-fr',
  'de-de',
  'it-it',
  'ja-jp',
  'ko-kr',
  'cmn-cn',
  'ru-ru',
]

let mod: TtsModule

before(async () => {
  mod = (await import(pathToFileURL(MODULE_PATH).href)) as TtsModule
})

test('tier hd resolve para Chirp3-HD nos 11 locales publicados pelo Google', () => {
  for (const locale of HD_LOCALES) {
    for (const gender of ['male', 'female'] as const) {
      const voice = mod.getVoiceConfig(locale, gender, 'hd')

      assert.equal(voice.tierUsed, 'hd', `${locale}/${gender} deveria ser hd`)
      assert.match(voice.name, /-Chirp3-HD-[A-Za-z]+$/, `${locale}/${gender}: ${voice.name}`)
      assert.ok(
        voice.name.startsWith(`${voice.languageCode}-Chirp3-HD-`),
        `${voice.name} não começa pelo languageCode ${voice.languageCode}`
      )
    }
  }
})

test('pt-pt não tem Chirp 3: HD e cai para a voz atual, sem virar pt-BR', () => {
  const voice = mod.getVoiceConfig('pt-pt', 'male', 'hd')

  assert.equal(voice.tierUsed, 'legacy')
  assert.equal(voice.languageCode, 'pt-PT')
  assert.equal(voice.name, 'pt-PT-Wavenet-B')
  assert.equal(mod.isHdAvailable('pt-pt'), false)
})

test('o par de fallback existe no roster e tem o gênero declarado', () => {
  const roster = new Map(mod.CHIRP3_HD_VOICES.map((v) => [v.name, v.gender]))

  assert.equal(roster.get(mod.CHIRP3_HD_DEFAULT_VOICE.male), 'male')
  assert.equal(roster.get(mod.CHIRP3_HD_DEFAULT_VOICE.female), 'female')
})

// ---------------------------------------------------------------------------
// Mapa de voz por idioma. Não é medição — é hipótese construída sobre o caráter
// que o Google publica por voz e sobre o registro que cada língua carrega. O que
// os testes protegem é a integridade do mapa, não o acerto do gosto: voz que não
// existe, gênero trocado ou idioma sem Chirp 3: HD são defeito; "Algenib combina
// com alemão?" é pergunta para ouvido nativo.
// ---------------------------------------------------------------------------

test('toda voz do mapa existe no roster, com o gênero certo', () => {
  const roster = new Map(mod.CHIRP3_HD_VOICES.map((v) => [v.name, v.gender]))

  for (const [locale, pair] of Object.entries(mod.CHIRP3_HD_VOICE_BY_LOCALE)) {
    for (const gender of ['male', 'female'] as const) {
      const voice = pair[gender]
      assert.ok(roster.has(voice), `${locale}/${gender}: voz "${voice}" não existe`)
      assert.equal(roster.get(voice), gender, `${locale}: "${voice}" não é ${gender}`)
    }
  }
})

test('o mapa só cobre idiomas que têm Chirp 3: HD', () => {
  for (const locale of Object.keys(mod.CHIRP3_HD_VOICE_BY_LOCALE)) {
    assert.equal(mod.isHdAvailable(locale), true, `${locale} não tem Chirp 3: HD`)
  }
  assert.equal(mod.CHIRP3_HD_VOICE_BY_LOCALE['pt-pt'], undefined, 'pt-PT não tem HD')
})

test('sem escolha explícita, sai a voz DO IDIOMA — não uma voz global', () => {
  // O lote atravessa doze línguas; se o default fosse global, o mapa não existiria.
  assert.equal(mod.getVoiceConfig('de-de', 'male', 'hd').name, 'de-DE-Chirp3-HD-Algieba')
  assert.equal(mod.getVoiceConfig('es-es', 'male', 'hd').name, 'es-ES-Chirp3-HD-Puck')
  assert.equal(mod.getVoiceConfig('ja-jp', 'female', 'hd').name, 'ja-JP-Chirp3-HD-Achernar')
  assert.equal(mod.getVoiceConfig('cmn-cn', 'female', 'hd').name, 'cmn-CN-Chirp3-HD-Erinome')

  assert.notEqual(
    mod.recommendedVoice('de-de', 'male'),
    mod.recommendedVoice('es-es', 'male'),
    'alemão e espanhol não podem cair na mesma voz — é o caso que motivou o mapa'
  )
})

test('idioma sem linha no mapa cai no par de fallback', () => {
  assert.equal(mod.recommendedVoice('en-au', 'male'), mod.CHIRP3_HD_DEFAULT_VOICE.male)
  assert.equal(mod.recommendedVoice('en-au', 'female'), mod.CHIRP3_HD_DEFAULT_VOICE.female)
})

test('voz escolhida pelo operador é respeitada; voz inexistente cai no padrão', () => {
  assert.equal(mod.getVoiceConfig('pt-br', 'male', 'hd', 'Iapetus').name, 'pt-BR-Chirp3-HD-Iapetus')
  assert.equal(
    mod.getVoiceConfig('pt-br', 'male', 'hd', 'NãoExiste').name,
    `pt-BR-Chirp3-HD-${mod.CHIRP3_HD_DEFAULT_VOICE.male}`
  )
})

test('sem tier, a voz do acervo de POI não muda', () => {
  const legacyPairs: Array<[string, 'male' | 'female', string]> = [
    ['pt-br', 'male', 'pt-BR-Neural2-B'],
    ['pt-br', 'female', 'pt-BR-Neural2-A'],
    ['en-us', 'male', 'en-US-Neural2-J'],
    ['en-us', 'female', 'en-US-Neural2-F'],
    ['cmn-cn', 'male', 'cmn-CN-Wavenet-B'],
    ['ru-ru', 'female', 'ru-RU-Wavenet-A'],
  ]

  for (const [locale, gender, expected] of legacyPairs) {
    assert.equal(mod.getVoiceConfig(locale, gender).name, expected)
    assert.equal(mod.getVoiceConfig(locale, gender).tierUsed, 'legacy')
  }
})

test('idioma desconhecido continua caindo no inglês, como antes', () => {
  const voice = mod.getVoiceConfig('nl-nl', 'male', 'hd')
  assert.equal(voice.name, 'en-US-Neural2-J')
  assert.equal(voice.tierUsed, 'legacy')
})

test('o roster do Chirp 3: HD tem as 30 vozes, com gênero declarado', () => {
  assert.equal(mod.CHIRP3_HD_VOICES.length, 30)
  assert.equal(mod.CHIRP3_HD_VOICES.filter((v) => v.gender === 'female').length, 14)
  assert.equal(mod.CHIRP3_HD_VOICES.filter((v) => v.gender === 'male').length, 16)
  assert.equal(mod.CHIRP3_HD_LANGUAGE_CODES.has('pt-PT'), false)
})
