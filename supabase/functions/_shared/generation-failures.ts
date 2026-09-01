/**
 * BR-CONTEUDO-004 item 5 — o que o app tem direito de receber quando a produção
 * de conteúdo NÃO terminou com áudio.
 *
 * WHY THIS FILE EXISTS
 * --------------------
 * `generate-description` tinha três caminhos que respondiam **HTTP 200 com
 * `success: true`** sem `audio_url` utilizável: TTS/Storage que não produziu
 * arquivo, lock de outro processo, e o upsert final que falhou sem ser
 * conferido. Do lado do app o resultado é o mesmo nos três: a chamada foi
 * gasta, `GuideEngine.setupAudioGenerationListener` escreve um `console.warn` e
 * segue, e **nada fica disponível para a avaliação seguinte** — que é
 * exatamente o que o item 5 da regra promete ao turista que chega primeiro num
 * POI virgem.
 *
 * WHY IT CANNOT BE A 200
 * ----------------------
 * O app classifica falha por código, mas só no ramo `if (error)` de
 * `invokeWithAuthRetry` — e esse ramo **só existe para resposta não-2xx**
 * (`docs/contracts/edge-functions.md`, "Gate de produção", §3). Uma recusa ou
 * uma falha devolvida em 200 é invisível para ele por construção: não é
 * preferência de estilo, é a diferença entre a falha aparecer no painel e não
 * existir. O vocabulário do corpo é o mesmo do gate de produção —
 * `{ error, rule, … }`, com o código em `error` e nunca uma frase para o
 * turista (a redação é da tela, `design`).
 *
 * O QUE **NÃO** ENTRA AQUI
 * ------------------------
 * Ausência de conteúdo-base não é falha: POI publicado que ninguém narrou é o
 * estado esperado do acervo (BR-CONTEUDO-004 itens 1 e 5) e ausência de áudio
 * não vira erro para o turista (BR-AUDIO-023 item 3). Recusa de regra de
 * negócio também não: ela já tem código próprio —
 * `content_production_not_entitled` (BR-CONTEUDO-003, 403) e
 * `partner_place_requires_partner_input` (BR-B2B-016 item 9). Este módulo cobre
 * só o caso em que **houve produção e o áudio não saiu**.
 */

/** Códigos que vão no campo `error` do corpo. Só estes, e nunca uma frase. */
export const GenerationFailureCode = {
  /** Houve texto, o áudio não saiu: TTS sem chave, ou upload que falhou. 502. */
  AUDIO_SYNTHESIS_FAILED: 'audio_synthesis_failed',
  /** Outro processo detém o lock do mesmo (POI, idioma, gênero). 409. */
  GENERATION_LOCKED: 'generation_locked',
  /** O upsert final não gravou: nada foi persistido, nada há para tocar. 500. */
  DESCRIPTION_WRITE_FAILED: 'description_write_failed',
} as const

export type GenerationFailureCode =
  (typeof GenerationFailureCode)[keyof typeof GenerationFailureCode]

/** Status HTTP por código. Um lugar só — o corpo e o status mentem juntos ou
 *  não mentem (CLAUDE.md §6).
 *
 *  Por que 502 no áudio: quem falhou foi o fornecedor (Google TTS ou o Storage),
 *  não a nossa lógica, e o painel precisa distinguir isso do 500 genérico do
 *  `catch` global. Por que 409 no lock: é conflito de concorrência e a próxima
 *  tentativa resolve — o app já repete no ciclo seguinte.
 *
 *  Para o app publicado os três caem no MESMO balde
 *  (`AUDIO_GENERATION_PROVIDER_FAILED`, `audioGenerationFailure.ts`): ele só
 *  separa 403, 408 e 504. A distinção existe para quem consulta o log, e é por
 *  isso que ela mora no status E no código. */
const HTTP_STATUS: Record<GenerationFailureCode, number> = {
  [GenerationFailureCode.AUDIO_SYNTHESIS_FAILED]: 502,
  [GenerationFailureCode.GENERATION_LOCKED]: 409,
  [GenerationFailureCode.DESCRIPTION_WRITE_FAILED]: 500,
}

/**
 * A falha tipada. `message` É o código, de propósito: o laço do lote devolve
 * `String(e)` no item, e assim o item carrega o mesmo vocabulário da resposta
 * single sem uma segunda tabela de tradução.
 */
export class GenerationFailure extends Error {
  readonly code: GenerationFailureCode
  /** Causa técnica curta, para o log. Nunca PII, nunca texto de POI. */
  readonly reason: string | null

  constructor(code: GenerationFailureCode, reason?: string | null) {
    super(code)
    this.name = 'GenerationFailure'
    this.code = code
    this.reason = reason ?? null
  }

  get httpStatus(): number {
    return HTTP_STATUS[this.code]
  }
}

/**
 * Reconhece a falha pela FORMA, não por `instanceof`.
 *
 * O bundle da função é montado pelo Deno a partir de especificadores `.ts`, e
 * uma segunda cópia do módulo no grafo faria `instanceof` responder `false`
 * calado — a resposta voltaria a ser 500 genérico e o código sumiria do corpo.
 * Mesma escolha, e pelo mesmo motivo, de `classifyAudioGenerationFailure` no
 * app.
 */
export function asGenerationFailure(error: unknown): GenerationFailure | null {
  const candidate = error as { code?: unknown; reason?: unknown } | null
  const code = candidate?.code
  if (
    typeof code === 'string' &&
    (Object.values(GenerationFailureCode) as string[]).includes(code)
  ) {
    return error instanceof GenerationFailure
      ? error
      : new GenerationFailure(
          code as GenerationFailureCode,
          typeof candidate?.reason === 'string' ? candidate.reason : null,
        )
  }
  return null
}

/**
 * A resposta. Mesma forma do gate de produção: código em `error`, regra em
 * `rule`, e nada que o turista possa ler.
 */
export function createGenerationFailureResponse(
  failure: GenerationFailure,
  headers: Record<string, string>,
): Response {
  return new Response(
    JSON.stringify({
      error: failure.code,
      rule: 'BR-CONTEUDO-004',
      ...(failure.reason ? { reason: failure.reason } : {}),
    }),
    {
      status: failure.httpStatus,
      headers: { ...headers, 'Content-Type': 'application/json' },
    },
  )
}
