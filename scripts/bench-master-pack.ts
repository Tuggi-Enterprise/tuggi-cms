/**
 * BANCADA DE CALIBRAÇÃO DO GERADOR DE DESCRIÇÃO — instrumento, não produto.
 *
 * PARA QUE SERVE. Rodar `generateMasterPack` contra uma lista de POIs reais e imprimir TUDO o
 * que o modelo viu e produziu — a frase de assunto realmente enviada, a colheita crua do passo 1
 * com as etiquetas como vieram, as métricas de custo e a narração final —, para um humano ler e
 * decidir, COM DADO, se vale mexer no prompt depois de 2026-09-30. Setembro é mês de medição dos
 * cards #652/#653/#654 e o pipeline está congelado; esta bancada existe justamente para que a
 * decisão de outubro não seja de memória.
 *
 * O QUE ELA NÃO FAZ, E É O DESENHO INTEIRO:
 *   - não persiste NADA (nem `core.attraction_descriptions`, nem storage, nem log de geração);
 *   - não gasta TTS (não importa nem chama `ttsGenerator`);
 *   - não invoca a Edge Function publicada — chama o miolo de LLM direto, no processo.
 * O custo de uma rodada é 1 ou 2 chamadas de grounding por POI, e nada além disso.
 * `tests/api/bench-master-pack.test.ts` trava essas três ausências por leitura deste fonte.
 *
 * POR QUE IMPORTA O MÓDULO EM VEZ DE RECRIAR O PROMPT. SSOT (CLAUDE.md §6): prompt copiado
 * diverge do produto no primeiro ajuste, e a bancada passa a medir outra coisa. O módulo é Deno
 * puro e é carregado por CAMINHO MONTADO em tempo de execução — um import estático terminaria em
 * `.ts` e reprovaria o `npm run type-check` do repositório inteiro (`scripts/` está fora do
 * `include` do tsconfig, mas o `tests/` que exercita esta bancada não está).
 *
 * DE ONDE VÊM A FRASE DE ASSUNTO E A COLHEITA CRUA. Do FIO, não de dedução: `generateMasterPack`
 * não devolve nem uma nem outra, e o prompt não pode ser tocado para que devolvesse. Esta bancada
 * embrulha `globalThis.fetch` e grava o corpo REALMENTE enviado a
 * `generativelanguage.googleapis.com` e a resposta REALMENTE recebida. O veredito de cada
 * tentativa sai de `judgeRetrievalOutput`, exportado pelo próprio módulo — a bancada não
 * reimplementa o portão do passo 1, ela o chama.
 *
 * CHAVE. `GEMINI_API_KEY` vem do ambiente, como no resto do repo, nunca de arquivo. Ela viaja na
 * QUERY STRING da chamada do Gemini: nenhuma URL é gravada nem impressa, e todo texto que sai
 * daqui passa por `redact()`.
 *
 * Uso:
 *   npx tsx --env-file=.env scripts/bench-master-pack.ts <entrada.json> [--out saida.json]
 *                                                        [--language en-US] [--duration 25] [--limit N]
 *
 * Entrada — array JSON:
 *   [{ "id": "...", "name": "...", "city": "...", "state": "...", "country": "...",
 *      "entity_kind": "poi|place|event", "place_type": null, "estrato": "relevante|intermediario|obscuro" }]
 */

import { readFileSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

// ─────────────────────────────────────────────────────────────────────────────
// Contratos
// ─────────────────────────────────────────────────────────────────────────────

type Estrato = 'relevante' | 'intermediario' | 'obscuro' | 'sem-estrato'
type EntityKind = 'poi' | 'place' | 'event'
type FactScope = 'place' | 'area' | 'mixed'

interface BenchPoi {
    id?: string
    name: string
    city?: string | null
    state?: string | null
    country?: string | null
    entity_kind?: EntityKind
    place_type?: string | null
    estrato?: Estrato
}

interface MasterPackResultShape {
    description: string
    facts_pack_json: { category: string; text: string }[]
    grounded?: boolean
    sourceCount?: number
    searchQueryCount?: number
    retrievalAttempts?: number
    factScope?: FactScope
    modelUsed?: string
    timings?: unknown
}

interface RetrievalVerdictShape {
    usable: boolean
    reason: 'ok' | 'empty' | 'none' | 'refusal' | 'no_bullets'
    taggedBullets: number
}

interface MasterPackModule {
    generateMasterPack: (
        poiName: string,
        locationContext: string,
        rawContext: string,
        language: string,
        apiKey: string,
        poiData?: unknown,
        audioDuration?: number,
        memberPois?: unknown[],
        referenceLinks?: string[],
        entity?: { kind: EntityKind; placeType?: string | null },
    ) => Promise<MasterPackResultShape>
    judgeRetrievalOutput: (text: string) => RetrievalVerdictShape
}

/** Uma chamada de LLM como ela foi pelo fio. `prompt` só é guardado no passo 1 — é o que a
 *  calibração lê; o system_instruction do passo 2 é o mesmo para todos os POIs. */
interface WireCall {
    step: 'retrieve' | 'compose'
    model: string
    ok: boolean
    httpStatus: number | null
    error?: string
    prompt?: string
    responseText: string
    finishReason: string | null
    webSearchQueries: string[]
    groundingChunks: number
    verdict?: RetrievalVerdictShape
}

interface PoiRun {
    id: string | null
    name: string
    estrato: Estrato
    entityKind: EntityKind
    placeType: string | null
    locationContext: string
    ok: boolean
    error: string | null
    elapsedMs: number
    /** A primeira linha do prompt do passo 1, do fio. */
    subjectLine: string | null
    /** Cada tentativa de colheita, na ordem, com o veredito do portão do próprio módulo. */
    retrieval: {
        model: string
        ok: boolean
        error?: string
        finishReason: string | null
        verdictReason: string
        usable: boolean
        taggedBullets: number
        searchQueries: string[]
        groundingChunks: number
        rawFacts: string
    }[]
    /** A colheita ACEITA, crua, com as etiquetas como vieram. `null` = SAFE MODE. */
    factsRaw: string | null
    safeMode: boolean
    searchQueryCount: number | null
    retrievalAttempts: number | null
    modelUsed: string | null
    sourceCount: number | null
    grounded: boolean | null
    factScope: FactScope | null
    description: string | null
    factsPack: { category: string; text: string }[] | null
    timings: unknown
    /** O que o módulo escreveu em console durante a chamada — capturado para não picotar o bloco. */
    moduleLogs: string[]
}

// ─────────────────────────────────────────────────────────────────────────────
// locationContext — a MESMA montagem da Edge Function
// ─────────────────────────────────────────────────────────────────────────────

/**
 * #654 — cidade, estado e país, do mais específico ao mais amplo, com o `filter(Boolean)`
 * derrubando o que faltar sem deixar vírgula solta, e `"an unknown location"` quando não sobra
 * nada. É o que faz a busca do passo 1 achar ESTE "Fonte da Juventude" e não um homônimo.
 *
 * ESTA É A SEGUNDA CÓPIA DA MONTAGEM, E ISSO ESTÁ DECLARADO EM VEZ DE ESCONDIDO. A primeira mora
 * inline em `generate-description/index.ts` (símbolo `locationContext`). Extrair para um módulo
 * compartilhado — o que SSOT pediria — exige editar a Edge Function em pleno mês de medição
 * (#652/#653/#654, congelada até 2026-09-30) e reescrever o teste `#654 — the location context is
 * joined from the three fields`, que fixa aquele trecho por regex no fonte. O preço de esperar é
 * esta cópia; o preço de não declarar seria ela divergir calada. Por isso o teste desta bancada
 * afirma as duas coisas: que ela se comporta igual, e que o trecho da EF continua sendo aquele —
 * no dia em que a EF mudar, o teste quebra e diz que a bancada ficou para trás.
 * Depois de 2026-09-30, o certo é extrair e apagar esta função.
 */
export const buildLocationContext = (
    city?: string | null,
    state?: string | null,
    country?: string | null,
): string =>
    [city || null, state || null, country || null]
        .filter(Boolean)
        .join(', ') || 'an unknown location'

// ─────────────────────────────────────────────────────────────────────────────
// Instrumentação do fio
// ─────────────────────────────────────────────────────────────────────────────

const GEMINI_HOST = 'generativelanguage.googleapis.com'

let wire: WireCall[] = []
const realFetch = globalThis.fetch

/** A chave viaja na query string. Nada que saia daqui pode carregá-la — nem por acidente. */
let apiKeyForRedaction = ''
const redact = (text: string): string =>
    apiKeyForRedaction && text ? text.split(apiKeyForRedaction).join('[REDACTED]') : text

const installWireTap = (): void => {
    globalThis.fetch = (async (input: Parameters<typeof fetch>[0], init?: RequestInit) => {
        const url = String(input instanceof Request ? input.url : input)
        if (!url.includes(GEMINI_HOST)) return realFetch(input as never, init)

        // Só o modelo é extraído da URL. A URL inteira NUNCA é guardada: ela contém `?key=`.
        const model = url.match(/models\/([^:?]+):/)?.[1] ?? 'unknown'
        const body = JSON.parse(String(init?.body ?? '{}'))
        // O passo 1 é o único que manda `tools` (google_search). O passo 2 manda system_instruction.
        const step: WireCall['step'] = Array.isArray(body.tools) ? 'retrieve' : 'compose'
        const call: WireCall = {
            step,
            model,
            ok: false,
            httpStatus: null,
            responseText: '',
            finishReason: null,
            webSearchQueries: [],
            groundingChunks: 0,
        }
        if (step === 'retrieve') call.prompt = String(body.contents?.[0]?.parts?.[0]?.text ?? '')
        wire.push(call)

        let res: Response
        try {
            res = await realFetch(input as never, init)
        } catch (e) {
            call.error = redact(e instanceof Error ? e.message : String(e))
            throw e
        }
        call.httpStatus = res.status

        // `clone()` para ler sem consumir o corpo que o módulo vai ler.
        try {
            const data = await res.clone().json()
            if (data?.error) call.error = redact(String(data.error.message ?? 'erro sem mensagem'))
            const cand = data?.candidates?.[0]
            call.finishReason = cand?.finishReason ?? null
            call.responseText = ((cand?.content?.parts ?? []) as { text?: string }[])
                .map((p) => p.text ?? '')
                .join('')
            call.webSearchQueries = cand?.groundingMetadata?.webSearchQueries ?? []
            call.groundingChunks = cand?.groundingMetadata?.groundingChunks?.length ?? 0
            call.ok = res.ok && !data?.error
        } catch {
            call.error = call.error ?? `HTTP ${res.status}: corpo não é JSON`
        }
        return res
    }) as typeof fetch
}

/** O módulo fala em console durante a chamada. Capturado para o bloco do POI sair inteiro. */
const captureConsole = (sink: string[]) => {
    const original = { log: console.log, warn: console.warn, error: console.error }
    const push = (level: string) => (...args: unknown[]) =>
        sink.push(`${level} ${redact(args.map((a) => (typeof a === 'string' ? a : JSON.stringify(a))).join(' '))}`)
    console.log = push('log')
    console.warn = push('warn')
    console.error = push('error')
    return () => {
        console.log = original.log
        console.warn = original.warn
        console.error = original.error
    }
}

// ─────────────────────────────────────────────────────────────────────────────
// Impressão
// ─────────────────────────────────────────────────────────────────────────────

const RULE = '═'.repeat(96)
const SUB = '─'.repeat(96)
const out = (s = '') => process.stdout.write(`${s}\n`)

const printRun = (run: PoiRun, index: number, total: number): void => {
    out()
    out(RULE)
    out(`[${run.estrato}] ${index + 1}/${total} · ${run.name}`)
    out(`locationContext: ${run.locationContext}`)
    out(`entity: ${run.entityKind}${run.placeType ? ` (${run.placeType})` : ''}${run.id ? ` · id ${run.id}` : ''}`)
    out(RULE)

    out()
    out('1. FRASE DE ASSUNTO REALMENTE ENVIADA (passo 1, lida do fio)')
    out(SUB)
    out(run.subjectLine ?? '(nenhuma chamada de colheita chegou a sair)')

    out()
    out('2. COLHEITA CRUA DO PASSO 1 (etiquetas como vieram)')
    out(SUB)
    if (run.retrieval.length === 0) {
        out('(nenhuma tentativa registrada)')
    }
    run.retrieval.forEach((r, i) => {
        out(
            `tentativa ${i + 1}/${run.retrieval.length} · ${r.model} · veredito=${r.verdictReason} ` +
            `· usable=${r.usable} · bullets_etiquetados=${r.taggedBullets} · queries=${r.searchQueries.length} ` +
            `· chunks=${r.groundingChunks}${r.finishReason && r.finishReason !== 'STOP' ? ` · finishReason=${r.finishReason}` : ''}` +
            `${r.error ? ` · erro=${r.error}` : ''}`,
        )
        if (r.searchQueries.length > 0) out(`  buscas executadas: ${r.searchQueries.join(' | ')}`)
        out(r.rawFacts ? r.rawFacts : '(resposta vazia)')
        out()
    })

    out('3. MÉTRICAS')
    out(SUB)
    out(
        `searchQueryCount=${run.searchQueryCount ?? '-'}  retrievalAttempts=${run.retrievalAttempts ?? '-'}  ` +
        `sourceCount=${run.sourceCount ?? '-'}  grounded=${run.grounded ?? '-'}  factScope=${run.factScope ?? 'none'}`,
    )
    out(`modelUsed=${run.modelUsed ?? '-'}  ·  ${run.elapsedMs} ms`)

    out()
    out('4. DESCRIÇÃO FINAL')
    out(SUB)
    if (run.ok) {
        out(run.description ?? '')
        if (run.factsPack && run.factsPack.length > 0) {
            out()
            out('master_facts:')
            run.factsPack.forEach((f) => out(`  ${f.category}|${f.text}`))
        }
    } else {
        out(`FALHOU — ${run.error}`)
    }

    out()
    out('5. SAFE MODE')
    out(SUB)
    out(
        run.safeMode
            ? 'SIM — CAIU EM SAFE MODE: nenhuma colheita aproveitável, a narração saiu do ramo genérico (sem fato, sem fonte).'
            : 'não',
    )

    if (run.moduleLogs.length > 0) {
        out()
        out('log do módulo')
        out(SUB)
        run.moduleLogs.forEach((l) => out(`  ${l}`))
    }
}

const printSummary = (runs: PoiRun[]): void => {
    const estratos = [...new Set(runs.map((r) => r.estrato))]
    out()
    out(RULE)
    out(`RESUMO AGREGADO — ${runs.length} POI(s)`)
    out(RULE)

    const line = (label: string, rows: PoiRun[]) => {
        const total = rows.length
        const falhas = rows.filter((r) => !r.ok).length
        // "NONE" no sentido do portão do passo 1: tentativa que não serviu, por qualquer motivo.
        // O motivo é discriminado embaixo porque `none` literal e recusa em prosa doem diferente.
        const comNone = rows.filter((r) => r.retrieval.some((t) => !t.usable)).length
        const segundaTentativa = rows.filter((r) => (r.retrievalAttempts ?? r.retrieval.length) >= 2).length
        const safeMode = rows.filter((r) => r.safeMode).length
        const queries = rows.map((r) => r.searchQueryCount ?? 0)
        const mediaQueries = total > 0 ? (queries.reduce((a, b) => a + b, 0) / total).toFixed(2) : '0.00'
        const scope = (s: FactScope) => rows.filter((r) => r.factScope === s).length
        const semScope = rows.filter((r) => !r.factScope).length

        out()
        out(`${label} — ${total} POI(s)${falhas > 0 ? `, ${falhas} falha(s)` : ''}`)
        out(`  colheita recusada em ao menos 1 tentativa (NONE / recusa / fora do contrato): ${comNone}`)
        out(`  precisaram da 2ª tentativa (fallback de modelo, pedágio pago 2x): ${segundaTentativa}`)
        out(`  caíram em SAFE MODE: ${safeMode}`)
        out(`  média de searchQueryCount: ${mediaQueries}  (equilíbrio 2.5 vs 3.x em ~2,95 — #652)`)
        out(`  factScope: place=${scope('place')}  area=${scope('area')}  mixed=${scope('mixed')}  nenhum=${semScope}`)

        const motivos = new Map<string, number>()
        rows.forEach((r) => r.retrieval.forEach((t) => motivos.set(t.verdictReason, (motivos.get(t.verdictReason) ?? 0) + 1)))
        out(
            `  vereditos por tentativa: ${[...motivos.entries()]
                .sort((a, b) => b[1] - a[1])
                .map(([k, v]) => `${k}=${v}`)
                .join('  ') || '(nenhum)'}`,
        )
    }

    estratos.forEach((e) => line(`estrato ${e}`, runs.filter((r) => r.estrato === e)))
    if (estratos.length > 1) line('TODOS', runs)
}

// ─────────────────────────────────────────────────────────────────────────────
// Execução
// ─────────────────────────────────────────────────────────────────────────────

const MODULE_PATH = resolve(
    import.meta.dirname,
    '../supabase/functions/_shared/masterPackGenerator.ts',
)

const flag = (argv: string[], name: string): string | undefined => {
    const i = argv.indexOf(`--${name}`)
    return i >= 0 ? argv[i + 1] : undefined
}

const main = async (): Promise<void> => {
    const argv = process.argv.slice(2)
    // Todo flag aceito aqui leva valor, então o argumento seguinte a um `--x` nunca é posicional.
    const positional: string[] = []
    for (let i = 0; i < argv.length; i++) {
        if (argv[i].startsWith('--')) { i++; continue }
        positional.push(argv[i])
    }
    const inputPath = positional[0]

    if (!inputPath) {
        out('uso: npx tsx --env-file=.env scripts/bench-master-pack.ts <entrada.json> [--out saida.json] [--language en-US] [--duration 25] [--limit N]')
        process.exit(1)
    }

    const apiKey = process.env.GEMINI_API_KEY
    if (!apiKey) {
        out('GEMINI_API_KEY ausente no ambiente. Rode com `--env-file=.env` ou exporte a variável.')
        process.exit(1)
    }
    apiKeyForRedaction = apiKey

    // en-US de propósito: é o idioma em que o passo 1 colhe, e ler a rodada em inglês evita
    // misturar qualidade de TRADUÇÃO com qualidade de COLHEITA, que são coisas diferentes.
    const language = flag(argv, 'language') ?? 'en-US'
    const audioDuration = Number(flag(argv, 'duration') ?? 25)
    const limit = Number(flag(argv, 'limit') ?? Number.POSITIVE_INFINITY)
    const stamp = new Date().toISOString().replace(/[:.]/g, '-')
    const outPath = resolve(flag(argv, 'out') ?? `bench-master-pack.${stamp}.json`)

    const parsed = JSON.parse(readFileSync(resolve(inputPath), 'utf8')) as BenchPoi[]
    if (!Array.isArray(parsed)) throw new Error('a entrada precisa ser um array JSON')
    const pois = parsed.slice(0, limit)

    const mod = (await import(pathToFileURL(MODULE_PATH).href)) as MasterPackModule
    installWireTap()

    out(RULE)
    out(`BANCADA MASTER PACK — ${pois.length} POI(s) · idioma ${language} · ${audioDuration}s`)
    out('não persiste nada · não gasta TTS · não chama a Edge Function publicada')
    out(`custo estimado: ${pois.length}–${pois.length * 2} chamadas com grounding`)
    out(RULE)

    const runs: PoiRun[] = []

    for (const [index, poi] of pois.entries()) {
        const entityKind: EntityKind =
            poi.entity_kind === 'event' || poi.entity_kind === 'place' ? poi.entity_kind : 'poi'
        const locationContext = buildLocationContext(poi.city, poi.state, poi.country)
        const moduleLogs: string[] = []
        wire = []

        const startedAt = Date.now()
        let result: MasterPackResultShape | null = null
        let error: string | null = null

        const restoreConsole = captureConsole(moduleLogs)
        try {
            result = await mod.generateMasterPack(
                poi.name,
                locationContext,
                // O mesmo `rawContext` que a Edge Function manda quando o CMS não sobrescreve.
                'App Batch Generation',
                language,
                apiKey,
                undefined,
                audioDuration,
                [],
                [],
                { kind: entityKind, placeType: poi.place_type ?? null },
            )
        } catch (e) {
            // Falha de um POI é registrada e a rodada segue. Sem retry automático: repetir em
            // lote é como uma rodada de calibração vira uma fatura de grounding.
            error = redact(e instanceof Error ? e.message : String(e))
        } finally {
            restoreConsole()
        }
        const elapsedMs = Date.now() - startedAt

        const retrieveCalls = wire.filter((c) => c.step === 'retrieve')
        // O veredito é o do PRÓPRIO módulo, não uma releitura: `judgeRetrievalOutput` é o portão
        // que decidiu, na hora, se aquela colheita seguia para o passo 2.
        const retrieval = retrieveCalls.map((c) => {
            const verdict = c.ok
                ? mod.judgeRetrievalOutput(c.responseText)
                : { usable: false, reason: 'empty' as const, taggedBullets: 0 }
            // A ordem espelha a do módulo: erro de HTTP e finishReason != STOP descartam a
            // tentativa ANTES do portão, e o veredito de texto nem chega a ser consultado.
            const truncated = !!c.finishReason && c.finishReason !== 'STOP'
            const verdictReason = !c.ok
                ? (c.error ? 'erro_http' : 'empty')
                : truncated
                    ? `finish_${c.finishReason}`
                    : verdict.reason
            return {
                model: c.model,
                ok: c.ok,
                error: c.error,
                finishReason: c.finishReason,
                verdictReason,
                usable: c.ok && !truncated && verdict.usable,
                taggedBullets: verdict.taggedBullets,
                searchQueries: c.webSearchQueries,
                groundingChunks: c.groundingChunks,
                rawFacts: c.responseText,
            }
        })
        const accepted = retrieval.find((r) => r.usable) ?? null

        const run: PoiRun = {
            id: poi.id ?? null,
            name: poi.name,
            estrato: poi.estrato ?? 'sem-estrato',
            entityKind,
            placeType: poi.place_type ?? null,
            locationContext,
            ok: !!result,
            error,
            elapsedMs,
            subjectLine: retrieveCalls[0]?.prompt?.split('\n')[0] ?? null,
            retrieval,
            factsRaw: accepted ? accepted.rawFacts : null,
            // SAFE MODE é o ramo genérico do passo 2: ele roda exatamente quando NENHUMA colheita
            // passou no portão — o mesmo que `factScope === undefined` reporta do lado do módulo.
            safeMode: !accepted,
            searchQueryCount: result?.searchQueryCount ?? retrieval.reduce((a, r) => a + r.searchQueries.length, 0),
            retrievalAttempts: result?.retrievalAttempts ?? retrieval.length,
            modelUsed: result?.modelUsed ?? null,
            sourceCount: result?.sourceCount ?? null,
            grounded: result?.grounded ?? null,
            factScope: result?.factScope ?? null,
            description: result ? redact(result.description) : null,
            factsPack: result?.facts_pack_json ?? null,
            timings: result?.timings ?? null,
            moduleLogs,
        }

        runs.push(run)
        printRun(run, index, pois.length)
    }

    printSummary(runs)

    // A rodada gravada é o que permite comparar DEPOIS de mexer no prompt. Sem isso a calibração
    // vira memória — e memória não compara duas rodadas.
    writeFileSync(
        outPath,
        JSON.stringify(
            {
                generatedAt: new Date().toISOString(),
                language,
                audioDuration,
                input: resolve(inputPath),
                module: 'supabase/functions/_shared/masterPackGenerator.ts',
                runs,
            },
            null,
            2,
        ),
        'utf8',
    )
    out()
    out(`rodada gravada em ${outPath}`)
}

/**
 * Só roda quando ESTE arquivo é o entrypoint do processo. `tests/api/bench-master-pack.test.ts`
 * importa a bancada para conferir a montagem do `locationContext`, e sem esta guarda o import
 * dispararia uma rodada paga contra o Gemini dentro da suíte.
 */
const isEntrypoint =
    !!process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url

if (isEntrypoint) {
    main().catch((e) => {
        out(`bancada falhou: ${redact(e instanceof Error ? e.stack ?? e.message : String(e))}`)
        process.exit(1)
    })
}
