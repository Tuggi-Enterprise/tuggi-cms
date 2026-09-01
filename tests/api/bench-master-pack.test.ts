/**
 * A BANCADA DE CALIBRAÇÃO (`scripts/bench-master-pack.ts`) — as duas coisas que precisam ser
 * verdade para ela poder ser rodada à vontade contra POIs reais.
 *
 * 1. O `locationContext` que ela monta é O MESMO da Edge Function, fallback incluído. A bancada
 *    tem a segunda cópia dessa montagem, declarada no fonte dela e não escondida: extrair para um
 *    módulo compartilhado exigiria editar `generate-description/index.ts` em pleno mês de medição
 *    (#652/#653/#654, congelado até 2026-09-30). O que este arquivo garante é que a cópia não
 *    divirja calada — se a EF mudar a montagem, o teste quebra e aponta a bancada, que passaria a
 *    calibrar um prompt que a produção não envia.
 *
 * 2. Ela não gasta TTS, não persiste e não chama a Edge Function publicada. É o desenho inteiro
 *    do instrumento, e vale mais provado por leitura do fonte do que prometido em comentário: o
 *    dia em que alguém "só adicionar" um `insert` de resultado, a rodada de bancada passa a
 *    escrever em `core.attraction_descriptions` como se fosse produção.
 *
 * Módulos carregados por caminho montado em tempo de execução — import estático terminaria em
 * `.ts` e reprovaria o `npm run type-check` do repositório inteiro.
 *
 * Run with: npm run test:api
 */

import { test, before } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

interface BenchModule {
  buildLocationContext: (
    city?: string | null,
    state?: string | null,
    country?: string | null,
  ) => string
}

const BENCH_PATH = resolve(import.meta.dirname, '../../scripts/bench-master-pack.ts')
const DESCRIPTION_PATH = resolve(
  import.meta.dirname,
  '../../supabase/functions/generate-description/index.ts',
)

let bench: BenchModule

before(async () => {
  // Importar a bancada NÃO pode disparar uma rodada: ela só chama `main()` quando é o
  // entrypoint do processo. Se essa guarda cair, este `before` faz chamadas pagas ao Gemini.
  bench = (await import(pathToFileURL(BENCH_PATH).href)) as BenchModule
})

// ── 1. A montagem do locationContext ─────────────────────────────────────────

test('bancada — o locationContext junta cidade, estado e país na ordem da Edge Function', () => {
  assert.equal(
    bench.buildLocationContext('Búzios', 'Rio de Janeiro', 'Brazil'),
    'Búzios, Rio de Janeiro, Brazil',
  )
})

test('bancada — campo ausente é derrubado sem deixar vírgula solta', () => {
  const semEstado = bench.buildLocationContext('Búzios', null, 'Brazil')
  assert.equal(semEstado, 'Búzios, Brazil')
  assert.equal(/,\s*,/.test(semEstado), false, 'vírgula solta no meio')

  assert.equal(bench.buildLocationContext('Búzios', null, null), 'Búzios')
  assert.equal(bench.buildLocationContext('Búzios', 'Rio de Janeiro', null), 'Búzios, Rio de Janeiro')
  // String vazia é falsy e cai no mesmo `filter(Boolean)` da EF — não é caso especial aqui.
  assert.equal(bench.buildLocationContext('', 'Rio de Janeiro', ''), 'Rio de Janeiro')
})

test('bancada — sem nada, o fallback é o mesmo texto que a Edge Function envia', () => {
  assert.equal(bench.buildLocationContext(null, null, null), 'an unknown location')
  assert.equal(bench.buildLocationContext(undefined, undefined, undefined), 'an unknown location')
  assert.equal(bench.buildLocationContext('', '', ''), 'an unknown location')
})

test('bancada — a Edge Function continua montando o contexto do mesmo jeito', () => {
  // Este é o teste de DERIVA. A cópia da bancada só é aceitável enquanto for idêntica; quando
  // este `assert` falhar, a EF mudou e a bancada precisa acompanhar (ou, depois de 2026-09-30,
  // a montagem precisa ser extraída para um lugar só e a cópia apagada).
  const src = readFileSync(DESCRIPTION_PATH, 'utf8')
  assert.match(
    src,
    /const locationContext = \[\s*cityName,\s*poiDataFromDB\?\.state \|\| null,\s*poiDataFromDB\?\.country \|\| null,\s*\]\.filter\(Boolean\)\.join\(", "\) \|\| "an unknown location";/,
    'a montagem do locationContext na Edge Function mudou — a bancada ficou para trás',
  )
})

// ── 2. O que a bancada não pode fazer ────────────────────────────────────────

/** Comentário não é código: a bancada FALA de TTS e de persistência para dizer que não os usa. */
const benchCode = (): string =>
  readFileSync(BENCH_PATH, 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .split('\n')
    .filter((l) => !l.trim().startsWith('//'))
    .join('\n')

test('bancada — nenhum import estático fora da biblioteca padrão do Node', () => {
  const sources = [...benchCode().matchAll(/^\s*import\s[^\n]*?from\s+'([^']+)'/gm)].map((m) => m[1])
  assert.ok(sources.length > 0, 'o fonte da bancada deveria ter imports')
  sources.forEach((s) =>
    assert.ok(s.startsWith('node:'), `import estático inesperado na bancada: ${s}`),
  )
})

test('bancada — o único import dinâmico é o gerador, e nada de TTS, storage ou persistência', () => {
  const code = benchCode()

  const dynamic = [...code.matchAll(/await import\(([^)]*)\)/g)]
  assert.equal(dynamic.length, 1, 'a bancada só pode carregar um módulo em tempo de execução')
  assert.match(code, /'\.\.\/supabase\/functions\/_shared\/masterPackGenerator\.ts'/)

  const proibidos = [
    'generateAudioWithTTS',
    'ttsGenerator',
    'mp3Encoder',
    'loudness',
    'attraction_descriptions',
    'createClient',
    '@supabase',
    'SERVICE_ROLE',
    '.storage',
    '.insert(',
    '.upsert(',
    '.update(',
    'functions/v1',
    'functions.invoke',
  ]
  proibidos.forEach((termo) =>
    assert.equal(
      code.includes(termo),
      false,
      `a bancada não pode referenciar \`${termo}\` — ela não persiste e não gasta TTS`,
    ),
  )
})

test('bancada — a chave da API vem do ambiente e não é impressa', () => {
  const code = benchCode()
  assert.match(code, /process\.env\.GEMINI_API_KEY/)
  // A chave viaja na query string da chamada do Gemini: a URL não pode ser guardada nem impressa.
  assert.equal(/wire\.push\([^)]*url/.test(code), false, 'a URL do Gemini carrega `?key=`')
  assert.match(code, /const redact = /, 'todo texto que sai da bancada passa pelo redator')
})
