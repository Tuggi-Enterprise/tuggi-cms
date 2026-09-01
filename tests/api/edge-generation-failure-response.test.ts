/**
 * BR-CONTEUDO-004 item 5 — produção que termina sem áudio não responde 200.
 *
 * `generate-description` tinha três caminhos que devolviam **HTTP 200 com
 * `success: true`** e nenhum `audio_url` utilizável: TTS/Storage que não
 * produziu arquivo, lock de outro processo, e o upsert final que ninguém
 * conferia. O app não enxerga nenhum deles — ele classifica falha no ramo
 * `if (error)` de `invokeWithAuthRetry`, e esse ramo só existe para não-2xx
 * (`docs/contracts/edge-functions.md`, "Gate de produção" §3). A chamada era
 * gasta e nada ficava disponível para a avaliação seguinte, que é o que o item
 * 5 da regra promete.
 *
 * O módulo é fonte Deno (especificadores `.ts`), então ele entra por um caminho
 * montado em tempo de execução — um import estático terminaria em `.ts` e
 * reprovaria o `npm run type-check` do repositório inteiro. Ele é puro: não
 * precisa do global `Deno` aqui.
 *
 * Run with: npm run test:api
 */

import { test, before } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

interface GenerationFailuresModule {
  GenerationFailureCode: Record<string, string>
  GenerationFailure: new (code: string, reason?: string | null) => {
    code: string
    reason: string | null
    message: string
    httpStatus: number
  }
  asGenerationFailure: (error: unknown) => { code: string; reason: string | null } | null
  createGenerationFailureResponse: (
    failure: { code: string; reason: string | null; httpStatus: number },
    headers: Record<string, string>
  ) => Response
}

const MODULE_PATH = resolve(
  import.meta.dirname,
  '../../supabase/functions/_shared/generation-failures.ts'
)

const DESCRIPTION_PATH = resolve(
  import.meta.dirname,
  '../../supabase/functions/generate-description/index.ts'
)

const TRANSLATED_AUDIO_PATH = resolve(
  import.meta.dirname,
  '../../supabase/functions/generate-translated-audio/index.ts'
)

/** Fonte com os comentários removidos, para que um comentário não passe teste. */
function sourceOf(path: string): string {
  return readFileSync(path, 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '')
}

// Carregado em `before` e não no topo: o runner transpila este arquivo para CJS,
// onde top-level await é erro de build.
let mod: GenerationFailuresModule

before(async () => {
  mod = (await import(pathToFileURL(MODULE_PATH).href)) as GenerationFailuresModule
})

// ── 1. O vocabulário: um código por causa, e nenhum deles é 2xx ───────────────

test('BR-CONTEUDO-004: os três códigos são estes, e o app depende do literal', () => {
  // Renomear qualquer um destes é mudança de contrato app↔CMS: o app casa por
  // string (`audioGenerationFailure.ts`) e um nome novo vira falha genérica.
  assert.deepEqual(Object.values(mod.GenerationFailureCode).sort(), [
    'audio_synthesis_failed',
    'description_write_failed',
    'generation_locked',
  ])
})

test('BR-CONTEUDO-004 item 5: nenhuma falha de produção responde 2xx', () => {
  for (const code of Object.values(mod.GenerationFailureCode)) {
    const status = new mod.GenerationFailure(code).httpStatus
    assert.ok(
      status < 200 || status >= 300,
      `${code} respondeu ${status}: em 2xx o app não classifica nada`
    )
  }
})

test('BR-CONTEUDO-004: o status separa o dono da falha', () => {
  const { GenerationFailure, GenerationFailureCode: codes } = mod
  // Fornecedor (Google TTS ou Storage), não a nossa lógica.
  assert.equal(new GenerationFailure(codes.AUDIO_SYNTHESIS_FAILED).httpStatus, 502)
  // Concorrência: a próxima tentativa resolve.
  assert.equal(new GenerationFailure(codes.GENERATION_LOCKED).httpStatus, 409)
  // Nosso banco não gravou.
  assert.equal(new GenerationFailure(codes.DESCRIPTION_WRITE_FAILED).httpStatus, 500)
})

test('BR-CONTEUDO-003: a resposta fala o vocabulário do gate de produção', async () => {
  const failure = new mod.GenerationFailure(
    mod.GenerationFailureCode.AUDIO_SYNTHESIS_FAILED,
    'storage_upload_failed'
  )
  const response = mod.createGenerationFailureResponse(failure, {})

  assert.equal(response.status, 502)
  assert.equal(response.headers.get('Content-Type'), 'application/json')

  const body = (await response.json()) as Record<string, unknown>
  // Mesma forma de `createProductionRefusedResponse`: código em `error`, regra
  // em `rule`. Chave nova aqui é chave que o app nunca vai ler.
  assert.deepEqual(Object.keys(body).sort(), ['error', 'reason', 'rule'])
  assert.equal(body.error, 'audio_synthesis_failed')
  assert.equal(body.rule, 'BR-CONTEUDO-004')
  assert.equal(body.reason, 'storage_upload_failed')
})

test('BR-AUDIO-023: o corpo não carrega frase para o turista', async () => {
  const body = (await mod
    .createGenerationFailureResponse(
      new mod.GenerationFailure(mod.GenerationFailureCode.GENERATION_LOCKED),
      {}
    )
    .json()) as Record<string, unknown>

  // Sem `reason`, sobram duas chaves — e nenhuma delas é texto de tela. A
  // redação é do `design`; ausência de áudio não vira aviso ao usuário.
  assert.deepEqual(Object.keys(body).sort(), ['error', 'rule'])
  for (const value of Object.values(body)) {
    assert.ok(
      typeof value === 'string' && !value.includes(' '),
      `"${String(value)}" parece frase, e frase daqui é uma segunda cópia da tela`
    )
  }
})

test('a falha é reconhecida pela forma, não por `instanceof`', () => {
  // O bundle do Deno pode acabar com duas cópias do módulo no grafo; aí
  // `instanceof` responde `false` calado e o código some do corpo.
  const foreign = { code: 'audio_synthesis_failed', reason: 'tts_key_missing' }
  assert.equal(mod.asGenerationFailure(foreign)?.code, 'audio_synthesis_failed')
  assert.equal(mod.asGenerationFailure(foreign)?.reason, 'tts_key_missing')

  assert.equal(mod.asGenerationFailure(new Error('boom')), null)
  assert.equal(mod.asGenerationFailure({ code: 'something_else' }), null)
  assert.equal(mod.asGenerationFailure(null), null)
})

test('o `message` É o código: o item do lote fala a mesma língua do single', () => {
  const failure = new mod.GenerationFailure(
    mod.GenerationFailureCode.GENERATION_LOCKED
  )
  assert.equal(failure.message, 'generation_locked')
})

// ── 2. A fiação em `generate-description` ────────────────────────────────────

test('BR-CONTEUDO-004 item 5: o lock não volta mais embrulhado em 200', () => {
  const code = sourceOf(DESCRIPTION_PATH)
  // `return { error: "Race condition detected - please retry", status: "retry" }`
  // era um objeto com a chave `error` DENTRO de um 200 `success: true`.
  assert.ok(!code.includes('"retry"'), 'o status "retry" voltou a existir')
  assert.ok(!code.includes('Race condition detected'))
  assert.ok(code.includes('GenerationFailureCode.GENERATION_LOCKED'))
})

test('BR-CONTEUDO-004 item 5: o upsert final é conferido antes de virar sucesso', () => {
  const code = sourceOf(DESCRIPTION_PATH)
  // Sem a conferência, `finalRows` null espalhava `{ ...null, status: "generated" }`
  // — 200 sem a chave `audio_url` e sem uma linha gravada.
  assert.ok(code.includes('error: finalError'))
  assert.ok(code.includes('GenerationFailureCode.DESCRIPTION_WRITE_FAILED'))
})

test('BR-CONTEUDO-004 item 5: pediu áudio e não há áudio termina em falha', () => {
  const code = sourceOf(DESCRIPTION_PATH)
  assert.ok(code.includes('GenerationFailureCode.AUDIO_SYNTHESIS_FAILED'))
  // As duas causas do `publicUrl` nulo têm donos diferentes e nomes diferentes.
  assert.ok(code.includes('tts_key_missing'))
  assert.ok(code.includes('storage_upload_failed'))
  // E o `upErr` deixou de ser silêncio.
  assert.ok(code.includes('if (upErr)'))
})

test('BR-CONTEUDO-004: texto puro pedido pelo CMS continua sendo 200', () => {
  const code = sourceOf(DESCRIPTION_PATH)
  // `audioFailureReason` só é escrito dentro de `if (shouldGenerateAudio)`;
  // `generate_audio: false` nunca entra no ramo e nunca vira erro.
  const guard = code.indexOf('if (shouldGenerateAudio) {')
  const firstReason = code.indexOf('audioFailureReason = ')
  assert.ok(guard > -1 && firstReason > guard)
})

test('BR-CONTEUDO-004: o caminho single devolve a falha tipada antes do 500 genérico', () => {
  const code = sourceOf(DESCRIPTION_PATH)
  const typed = code.indexOf('createGenerationFailureResponse(')
  const generic = code.indexOf('JSON.stringify({ error: String(e) })')
  assert.ok(typed > -1, 'o `catch` global voltou a ter só o 500 genérico')
  assert.ok(typed < generic, 'o 500 genérico engole a falha tipada')
})

test('BR-CONTEUDO-004: no lote o veredito é por item, e no vocabulário do contrato', () => {
  const code = sourceOf(DESCRIPTION_PATH)
  // O envelope do lote segue 200 (o laço trata item a item e o resto do lote
  // segue — contrato §4), mas o item carrega o código puro, não
  // `"GenerationFailure: audio_synthesis_failed"`.
  assert.ok(code.includes('error: failure ? failure.code : String(e)'))
})

// ── 3. A função irmã: conferida, e o defeito não existe lá ───────────────────

test('BR-CONTEUDO-003: `generate-translated-audio` já falha alto sem chave de TTS', () => {
  const code = sourceOf(TRANSLATED_AUDIO_PATH)
  // Era esta guarda que faltava na irmã: sem chave, ela responde 500 antes de
  // prometer qualquer coisa. E o caminho de POI só chega ao `success: true`
  // depois de `uploadAudioToStorage`, que lança em vez de devolver nulo.
  assert.ok(code.includes('!GEMINI_API_KEY || !GOOGLE_CLOUD_API_KEY'))
  assert.ok(code.includes('Missing required API keys'))
  assert.ok(
    code.includes('const uploadAudioToStorage = async') &&
      code.includes('throw new Error(`Failed to upload audio:')
  )
})
