/**
 * The daily retention push goes to the whole base, once a day, by cron. Its copy
 * had two logic defects and one grammar defect reaching production:
 *
 *  - `body(name, heard, 0)` is reachable — `get_morning_push_candidates()` filters
 *    `(missed_count > 0 OR heard_count > 0)` while the orchestrator picks the body
 *    by `heard_count` alone — and it printed "mas 0 segredos ficaram pelo caminho";
 *  - the count was glued to a fixed noun, so it printed "revelou 1 historias";
 *  - the body ended in an order to switch the guide on, which BR-MONETIZACAO-055
 *    refuses for the `free` tier.
 *
 * Spec: docs/design/copy-push-diario-2026-08.md, section 7 (definition of done).
 *
 * Two halves, and both are needed:
 *  1. the copy module itself (`_shared/daily-push-i18n.ts`), rendered over the
 *     five cases of the spec, in the five languages;
 *  2. a source ruler over `daily-gamification-orchestrator/index.ts`, because
 *     that file CANNOT be loaded here: it imports
 *     `https://esm.sh/@supabase/supabase-js@2` on its first line, which Node
 *     cannot resolve and `mock.module` does not intercept. Without the ruler,
 *     half 1 would keep passing while someone re-inlined the copy into the
 *     function.
 *
 * The module is Deno source (`.ts` specifier), so it is loaded through a path
 * built at run time — a static import ending in `.ts` fails `npm run type-check`
 * for the whole repo.
 *
 * Run with: npm run test:api
 */

import { test, before } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

const MODULE_PATH = resolve(
  import.meta.dirname,
  '../../supabase/functions/_shared/daily-push-i18n.ts'
)
const FUNCTION_PATH = resolve(
  import.meta.dirname,
  '../../supabase/functions/daily-gamification-orchestrator/index.ts'
)

interface DailyPushStrings {
  title: string
  fallback: string
  body: (name: string, heard: number, missed: number) => string
  body_zero_heard: (name: string, missed: number) => string
}

const LANGS = ['pt-br', 'pt-pt', 'en', 'es', 'it'] as const
type Lang = (typeof LANGS)[number]

/** Exactly 20 characters, the length the spec budgets for, and no digit in it. */
const NICK = 'Bartolomeu Guimaraes'

let TRANSLATIONS: Record<Lang, DailyPushStrings>
let getTranslation: (lang: string) => DailyPushStrings

before(async () => {
  const mod = await import(pathToFileURL(MODULE_PATH).href)
  TRANSLATIONS = mod.TRANSLATIONS
  getTranslation = mod.getTranslation
  assert.ok(TRANSLATIONS, 'TRANSLATIONS is not exported')
  assert.equal(typeof getTranslation, 'function', 'getTranslation is not exported')
})

/** The five cases of the spec, section 7, as (label, renderer). */
const renderCases = (t: DailyPushStrings) => [
  { label: 'body(nick, 1, 1)', body: t.body(NICK, 1, 1), heard: 1, missed: 1 },
  { label: 'body(nick, 5, 12)', body: t.body(NICK, 5, 12), heard: 5, missed: 12 },
  { label: 'body(nick, 5, 0)', body: t.body(NICK, 5, 0), heard: 5, missed: 0 },
  { label: 'body_zero_heard(nick, 1)', body: t.body_zero_heard(NICK, 1), heard: 0, missed: 1 },
  { label: 'body_zero_heard(nick, 12)', body: t.body_zero_heard(NICK, 12), heard: 0, missed: 12 },
]

/** The body is always two sentences joined by a single space. */
const firstSentence = (body: string) => {
  const cut = body.indexOf('. ')
  assert.notEqual(cut, -1, `body has no second sentence: ${body}`)
  return body.slice(0, cut + 1)
}
const secondSentence = (body: string) => body.slice(body.indexOf('. ') + 2)

/** Every user-visible string the module can produce, for the sweeps below. */
const allStrings = (): string[] => {
  const out: string[] = []
  for (const lang of LANGS) {
    const t = TRANSLATIONS[lang]
    out.push(t.title, t.fallback)
    for (const c of renderCases(t)) out.push(c.body)
    out.push(t.body(NICK, 999, 999), t.body(NICK, 999, 0), t.body_zero_heard(NICK, 999))
  }
  return out
}

// --- The structure the spec asks for (section 7, item 7) ---------------------

test('the five languages keep title, fallback and both body signatures', () => {
  for (const lang of LANGS) {
    const t = TRANSLATIONS[lang]
    assert.ok(t, `missing language: ${lang}`)
    assert.equal(typeof t.title, 'string', `${lang}: title`)
    assert.equal(typeof t.fallback, 'string', `${lang}: fallback`)
    assert.equal(t.body.length, 3, `${lang}: body must take (name, heard, missed)`)
    assert.equal(t.body_zero_heard.length, 2, `${lang}: body_zero_heard must take (name, missed)`)
  }
})

test('getTranslation routes each tag to its own set, and the unknown tag to en', () => {
  assert.equal(getTranslation('pt-BR'), TRANSLATIONS['pt-br'])
  assert.equal(getTranslation('pt-PT'), TRANSLATIONS['pt-pt'])
  assert.equal(getTranslation('pt'), TRANSLATIONS['pt-br'])
  assert.equal(getTranslation('es-AR'), TRANSLATIONS['es'])
  assert.equal(getTranslation('it'), TRANSLATIONS['it'])
  assert.equal(getTranslation(''), TRANSLATIONS['pt-br'])
  // The app ships five interface languages and the fifth is French, which has no
  // entry here and falls back to English. Known and accepted (spec, section 8).
  assert.equal(getTranslation('fr'), TRANSLATIONS['en'])
})

test('es.title says recorrido, not jornada (jornada is a working day in Spanish)', () => {
  assert.equal(TRANSLATIONS['es'].title, 'Tu recorrido de ayer')
})

// --- The character budget: a collapsed Android notification shows ONE line ----

test('DS-COPY-004: no body passes 120 characters with a 20-char nickname and 3-digit counts', () => {
  assert.equal(NICK.length, 20)
  for (const lang of LANGS) {
    const t = TRANSLATIONS[lang]
    const worst = [
      ...renderCases(t).map((c) => c.body),
      t.body(NICK, 999, 999),
      t.body(NICK, 999, 0),
      t.body_zero_heard(NICK, 999),
    ]
    for (const body of worst) {
      assert.ok(body.length <= 120, `${lang}: ${body.length} chars > 120 — ${body}`)
    }
  }
})

test('DS-COPY-004: the first sentence is <= 45 characters and never carries the name', () => {
  for (const lang of LANGS) {
    const t = TRANSLATIONS[lang]
    const bodies = [
      ...renderCases(t).map((c) => c.body),
      t.body(NICK, 999, 999),
      t.body_zero_heard(NICK, 999),
    ]
    for (const body of bodies) {
      const first = firstSentence(body)
      assert.ok(first.length <= 45, `${lang}: first sentence ${first.length} chars > 45 — ${first}`)
      assert.ok(!first.includes(NICK), `${lang}: the name is in the first sentence — ${first}`)
    }
  }
})

// --- Defect 1: missed = 0 is reachable and must not print a zero -------------

test('with missed = 0 the body prints no zero and ends on the map sentence', () => {
  for (const lang of LANGS) {
    const t = TRANSLATIONS[lang]
    const body = t.body(NICK, 5, 0)
    assert.ok(!body.includes('0'), `${lang}: the body prints a literal zero — ${body}`)
    // The closing sentence is the map one (P), the same that closes body_zero_heard.
    assert.equal(secondSentence(body), secondSentence(t.body_zero_heard(NICK, 12)), `${lang}: missed = 0 did not fall back to the map sentence`)
    assert.ok(secondSentence(body).startsWith(NICK), `${lang}: the map sentence lost the name`)
  }
})

// --- Defect 2: the count picks a whole sentence, not a glued noun ------------

test('with a count of 1 the body carries no plural noun (it: c\'era 1 luogo, not luoghi)', () => {
  const plurals = /histórias|historias|stories|storie|pontos|places|puntos|luoghi/
  for (const lang of LANGS) {
    for (const c of renderCases(TRANSLATIONS[lang])) {
      if (c.heard !== 1 && c.missed !== 1) continue
      assert.ok(!plurals.test(c.body), `${lang}: ${c.label} kept a plural noun — ${c.body}`)
    }
  }
})

test('with a count above 1 the body carries the plural noun', () => {
  const plurals = /histórias|historias|stories|storie|pontos|places|puntos|luoghi/
  for (const lang of LANGS) {
    const t = TRANSLATIONS[lang]
    assert.ok(plurals.test(t.body(NICK, 5, 12)), `${lang}: body(5, 12) lost the plural`)
    assert.ok(plurals.test(t.body_zero_heard(NICK, 12)), `${lang}: body_zero_heard(12) lost the plural`)
  }
})

// --- BR-COMUNICACAO-002 item 2: `missed` counts places, never content --------

test('BR-COMUNICACAO-002: the nearby-places sentence never names content', () => {
  const content = /história|historia|hist[óo]rias|story|stories|storia|storie|segredo|secret|mist[ée]rio|misterio|mystery/i
  for (const lang of LANGS) {
    const t = TRANSLATIONS[lang]
    // Second sentence of `body` (M) and first sentence of `body_zero_heard` (L).
    assert.ok(!content.test(secondSentence(t.body(NICK, 5, 12))), `${lang}: M names content`)
    assert.ok(!content.test(firstSentence(t.body_zero_heard(NICK, 12))), `${lang}: L names content`)
  }
})

// --- Tone: no emoji, no order to act -----------------------------------------

test('DS-COPY-004: no string in TRANSLATIONS carries an emoji', () => {
  const pictographic = /\p{Extended_Pictographic}/u
  for (const s of allStrings()) {
    assert.ok(!pictographic.test(s), `emoji in a push string — ${s}`)
  }
})

test('BR-MONETIZACAO-055: no string orders the traveller to switch the guide on', () => {
  const activation = /ligar|ativar|activate|turn on|encender|activar|attivare|accendere/i
  for (const s of allStrings()) {
    assert.ok(!activation.test(s), `the copy orders an act the free tier refuses — ${s}`)
  }
})

// --- The source ruler over the Edge Function ---------------------------------

test('the orchestrator reads the copy from _shared and does not re-inline it', () => {
  const src = readFileSync(FUNCTION_PATH, 'utf8')
  assert.match(
    src,
    /from\s+'\.\.\/_shared\/daily-push-i18n\.ts'/,
    'the function no longer imports the shared copy module'
  )
  assert.ok(
    !/const\s+TRANSLATIONS\b/.test(src),
    'the copy was re-inlined into the Edge Function — it becomes untestable there'
  )
  assert.ok(
    !/const\s+getTranslation\b/.test(src),
    'a second getTranslation was declared in the Edge Function'
  )
})

test('the orchestrator still picks body_zero_heard by heard_count alone', () => {
  const src = readFileSync(FUNCTION_PATH, 'utf8')
  assert.match(src, /user\.heard_count\s*>\s*0/, 'the zero-heard branch changed its selector')
  assert.match(src, /i18n\.body\(/, 'the function stopped calling body()')
  assert.match(src, /i18n\.body_zero_heard\(/, 'the function stopped calling body_zero_heard()')
})
