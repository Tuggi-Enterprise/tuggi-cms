/**
 * The ranking copy — #747, the `design` half.
 *
 * The mechanism shipped with the catalogue EMPTY and the contract "a missing key means the piece
 * does not leave". The sentences exist now (`docs/design/spec-comunicacao-ranking-2026-09.md`
 * §1.2/§1.3/§1.4 and the `design` handover on #747), so this file proves two things at once: that
 * what is published is what `design` wrote, and that the fail-closed contract survived being
 * filled in.
 *
 * The rules under test, and what each one is defending:
 *   - **BR-RANKING-002 item 2** — never the number of participants, nor anything it can be
 *     deduced from. No literal digit in a sentence: every number comes from a variable about the
 *     recipient, or does not exist.
 *   - **BR-COMUNICACAO-012 item 1.4.e** and **DS-COPY-070** — no clock, and the ban reaches what
 *     can be deduced from one. Two clocks disagree here and neither is the tourist's.
 *   - **BR-COMUNICACAO-012 item 2** — no cadence promise while BR-COMUNICACAO-014 is `proposta`.
 *   - **BR-COMUNICACAO-017** — the e-mail channel, and why its nine keys are still closed.
 *   - **BR-RANKING-008** — the streak states its LENGTH, from `core.account_streak`, and the
 *     length is a present state, not a countdown.
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
  '../../supabase/functions/_shared/ranking-comm-i18n.ts'
)
const ORCHESTRATOR_PATH = resolve(
  import.meta.dirname,
  '../../supabase/functions/daily-gamification-orchestrator/index.ts'
)

const PIECES = ['streak_at_risk', 'rank_at_risk', 'rank_drop'] as const

let mod: any

before(async () => {
  mod = await import(pathToFileURL(MODULE_PATH).href)
})

/**
 * Swap a catalogue entry for the duration of one test and put the real one back.
 *
 * The earlier version of this file `delete`d the keys it had planted, which was harmless while
 * the catalogue was empty and would now ERASE the published sentence for every test that runs
 * after it. Snapshot and restore, never delete.
 */
function withCatalog(overrides: Record<string, unknown>, body: () => void): void {
  const previous = new Map<string, unknown>()
  for (const key of Object.keys(overrides)) {
    previous.set(key, mod.RANKING_COPY_CATALOG[key])
    mod.RANKING_COPY_CATALOG[key] = overrides[key]
  }
  try {
    body()
  } finally {
    for (const [key, value] of previous) {
      if (value === undefined) delete mod.RANKING_COPY_CATALOG[key]
      else mod.RANKING_COPY_CATALOG[key] = value
    }
  }
}

/** Every sentence the catalogue publishes today, flattened out of its plural pairs. */
function publishedSentences(): Array<{ key: string; lang: string; value: string }> {
  const out: Array<{ key: string; lang: string; value: string }> = []
  for (const [key, byLang] of Object.entries(mod.RANKING_COPY_CATALOG as Record<string, any>)) {
    for (const [lang, raw] of Object.entries(byLang as Record<string, any>)) {
      if (typeof raw === 'string') out.push({ key, lang, value: raw })
      else {
        out.push({ key, lang, value: raw.one })
        out.push({ key, lang, value: raw.other })
      }
    }
  }
  return out
}

// ===============================================================================================
// THE ORDINAL — the mirror, and the parity that keeps it from drifting
// ===============================================================================================

/**
 * Ranks 1 to 30 in the five languages, written out. This is a CITATION of spec §1.5 and of the
 * app's `ORDINAL_CONTEXT` (`tuggi-drive-v2/src/modules/wrapped/utils/rankingFormat.ts`), not a
 * second implementation of the rule: deriving the expectation from a rule in the test would make
 * the test agree with any bug the rule has.
 */
const ORDINAL_PARITY: Record<string, readonly string[]> = {
  pt: [
    '1º', '2º', '3º', '4º', '5º', '6º', '7º', '8º', '9º', '10º',
    '11º', '12º', '13º', '14º', '15º', '16º', '17º', '18º', '19º', '20º',
    '21º', '22º', '23º', '24º', '25º', '26º', '27º', '28º', '29º', '30º',
  ],
  it: [
    '1º', '2º', '3º', '4º', '5º', '6º', '7º', '8º', '9º', '10º',
    '11º', '12º', '13º', '14º', '15º', '16º', '17º', '18º', '19º', '20º',
    '21º', '22º', '23º', '24º', '25º', '26º', '27º', '28º', '29º', '30º',
  ],
  es: [
    '1.º', '2.º', '3.º', '4.º', '5.º', '6.º', '7.º', '8.º', '9.º', '10.º',
    '11.º', '12.º', '13.º', '14.º', '15.º', '16.º', '17.º', '18.º', '19.º', '20.º',
    '21.º', '22.º', '23.º', '24.º', '25.º', '26.º', '27.º', '28.º', '29.º', '30.º',
  ],
  en: [
    '1st', '2nd', '3rd', '4th', '5th', '6th', '7th', '8th', '9th', '10th',
    '11th', '12th', '13th', '14th', '15th', '16th', '17th', '18th', '19th', '20th',
    '21st', '22nd', '23rd', '24th', '25th', '26th', '27th', '28th', '29th', '30th',
  ],
  fr: [
    '1er', '2e', '3e', '4e', '5e', '6e', '7e', '8e', '9e', '10e',
    '11e', '12e', '13e', '14e', '15e', '16e', '17e', '18e', '19e', '20e',
    '21e', '22e', '23e', '24e', '25e', '26e', '27e', '28e', '29e', '30e',
  ],
}

test('#747 spec §1.5: the server ordinal is identical to the app table for ranks 1 to 30, in the five languages', () => {
  for (const [lang, expected] of Object.entries(ORDINAL_PARITY)) {
    for (let rank = 1; rank <= 30; rank += 1) {
      assert.equal(
        mod.formatRankOrdinal(rank, lang),
        expected[rank - 1],
        `${lang}/${rank}: the Edge Function drifted from tuggi-drive-v2 rankingFormat.ts`
      )
    }
  }
})

test("#747 spec §1.5: one language's ordinal rule applied to another is the failure this mirror exists to catch", () => {
  // French: `er` belongs to the number 1 ALONE. An English-shaped rule prints `21er`.
  assert.equal(mod.formatRankOrdinal(1, 'fr'), '1er')
  assert.equal(mod.formatRankOrdinal(21, 'fr'), '21e')
  assert.equal(mod.formatRankOrdinal(31, 'fr'), '31e')
  // English: the teens exception is on the LAST TWO digits, so 11 is not `11st`.
  assert.equal(mod.formatRankOrdinal(11, 'en'), '11th')
  assert.equal(mod.formatRankOrdinal(12, 'en'), '12th')
  assert.equal(mod.formatRankOrdinal(13, 'en'), '13th')
  assert.equal(mod.formatRankOrdinal(21, 'en'), '21st')
  assert.equal(mod.formatRankOrdinal(112, 'en'), '112th')
  assert.equal(mod.formatRankOrdinal(121, 'en'), '121st')
})

test('#747 spec §6 item 10: composed in `pt` with rank 3 the body carries `3º` — never `3o`, `3°` or a bare `3`', () => {
  const copy = mod.resolveRankingPushCopy(
    'rank_at_risk',
    'pt',
    mod.rankingCopyVars('rank_at_risk', 'pt', { rank: 3, points: 41 })
  )
  assert.ok(copy, 'the piece must resolve in pt')
  assert.match(copy.body, /\b3º lugar\b/)
  assert.doesNotMatch(copy.body, /3o |3° /)
})

// ===============================================================================================
// THE LANGUAGES — five for push, four for e-mail, and one Portuguese
// ===============================================================================================

test('#747 spec §1.6: the cascade is this module\'s and NOT the daily module\'s — `fr` reads French', () => {
  assert.deepEqual([...mod.RANKING_COPY_LANGS], ['pt', 'en', 'es', 'fr', 'it'])
  assert.equal(mod.normalizeCopyLang('fr'), 'fr')
  assert.equal(mod.normalizeCopyLang('fr-CA'), 'fr')
  // `daily-push-i18n.ts`'s `getTranslation` says, in writing, "Anything else (e.g. fr) gets en".
  // Inheriting that map would ship French pushes in English with no log and no failure.
  const copy = mod.resolveRankingPushCopy(
    'rank_drop',
    mod.normalizeCopyLang('fr'),
    mod.rankingCopyVars('rank_drop', 'fr', { rank: 4, points: 20 })
  )
  assert.ok(copy)
  assert.equal(copy.title, 'Tu passes 4e au classement')
  assert.notEqual(copy.title, 'You dropped to 4th place')
})

test('#747 spec §1.6: there is ONE Portuguese — `pt-PT`, `pt-BR` and `pt` are the same set', () => {
  assert.equal(mod.normalizeCopyLang('pt'), 'pt')
  assert.equal(mod.normalizeCopyLang('pt-PT'), 'pt')
  assert.equal(mod.normalizeCopyLang('pt_BR'), 'pt')
  assert.equal(mod.normalizeCopyLang('pt-br'), 'pt')
  assert.equal(mod.normalizeCopyLang('it-IT'), 'it')
  assert.equal(mod.normalizeCopyLang('de'), 'en')
  assert.equal(mod.normalizeCopyLang(null), 'en')
})

test('BR-COMUNICACAO-017: the promotional e-mail sender publishes FOUR languages, and `fr` is not one of them', () => {
  // Spec §2.1: `FOOTER_LABELS`, `FALLBACK_NAME` and `SITE_LOCALE` carry pt/en/es/it. A French
  // recipient would read a Portuguese footer and be called `traveler`, in English.
  assert.deepEqual([...mod.RANKING_EMAIL_LANGS], ['pt', 'en', 'es', 'it'])
  assert.equal(mod.mailableEmailLang('fr'), null)
  assert.equal(mod.mailableEmailLang('fr-CA'), null)
  assert.equal(mod.mailableEmailLang('de'), 'en')
  assert.equal(mod.mailableEmailLang('pt-PT'), 'pt')
  assert.equal(mod.mailableEmailLang('it'), 'it')
})

// ===============================================================================================
// THE CATALOGUE — what is published, and what is still closed
// ===============================================================================================

test('#747: every key the mechanism can emit is declared, so the handover has a finite list', () => {
  // 3 pieces × 2 push keys + 3 pieces × 3 e-mail keys.
  assert.equal(mod.RANKING_COPY_KEYS.length, 15)
  assert.equal(new Set(mod.RANKING_COPY_KEYS).size, 15)
  for (const key of mod.RANKING_COPY_KEYS) {
    assert.match(key, /^ranking\.(push|email)\.(streak_at_risk|rank_at_risk|rank_drop)\./)
  }
})

test('BR-COMUNICACAO-012 item 1.4: the three push pieces leave in all five languages', () => {
  for (const piece of PIECES) {
    for (const lang of mod.RANKING_COPY_LANGS) {
      const vars = mod.rankingCopyVars(piece, lang, { rank: 4, points: 20, streakDays: 3 })
      const copy = mod.resolveRankingPushCopy(piece, lang, vars)
      assert.ok(copy, `${piece}/${lang} must have copy`)
      assert.ok(copy.title.trim().length > 0)
      assert.ok(copy.body.trim().length > 0)
    }
  }
})

test('BR-COMUNICACAO-017: the nine e-mail keys are FILLED, and the fail-closed contract survived being filled', () => {
  // These keys were empty until 2026-09-17 because the only e-mail copy that existed described an
  // account ABSENT from the roster, and this mechanism only ever resolves accounts that are IN
  // it — the refusal that became BR-COMUNICACAO-017 item 9.a. Spec §2.6 replaced it with nine
  // sentences for the account that is in the roster, and the audience gates are proved in
  // `tests/api/ranking-email.test.ts`. What this one keeps proving is the CONTRACT: all three
  // fields or none, and no fallback to another language.
  for (const piece of PIECES) {
    for (const lang of mod.RANKING_COPY_LANGS) {
      const vars = piece === 'streak_at_risk' ? { count: 3 } : { rank: mod.formatRankOrdinal(4, lang) }
      assert.ok(
        mod.resolveRankingEmailCopy(piece, lang, vars),
        `${piece}/${lang}: the e-mail copy did not resolve`
      )
    }
  }

  // Drop one of the three fields and the whole piece goes silent in that language, and only in
  // that language. A subject with no body is not a degraded e-mail, it is a defect.
  withCatalog({
    'ranking.email.rank_drop.body': { ...mod.RANKING_COPY_CATALOG['ranking.email.rank_drop.body'], pt: '' },
  }, () => {
    assert.equal(mod.resolveRankingEmailCopy('rank_drop', 'pt', { rank: '4º' }), null)
    assert.ok(mod.resolveRankingEmailCopy('rank_drop', 'en', { rank: '4th' }))
  })
})

test('#747: a key filled in four languages and missing in the fifth only goes dark in the fifth', () => {
  // The case the card asks to see proved: a hole in one language is not a hole in the piece.
  const filled = { ...(mod.RANKING_COPY_CATALOG['ranking.push.rank_drop.title'] as Record<string, unknown>) }
  delete filled.it
  withCatalog({ 'ranking.push.rank_drop.title': filled }, () => {
    for (const lang of ['pt', 'en', 'es', 'fr']) {
      const vars = mod.rankingCopyVars('rank_drop', lang, { rank: 4, points: 20 })
      assert.ok(
        mod.resolveRankingPushCopy('rank_drop', lang, vars),
        `${lang} still has its sentence and must still leave`
      )
    }
    assert.equal(
      mod.resolveRankingPushCopy('rank_drop', 'it', mod.rankingCopyVars('rank_drop', 'it', { rank: 4, points: 20 })),
      null,
      'only the language without text goes silent'
    )
  })
})

test('#747: half a piece is not a piece — a title without its body sends nothing', () => {
  withCatalog({ 'ranking.push.rank_drop.body': undefined }, () => {
    assert.equal(
      mod.resolveRankingPushCopy('rank_drop', 'en', mod.rankingCopyVars('rank_drop', 'en', { rank: 4, points: 20 })),
      null
    )
  })
})

test('#747: there is no fallback language — silence beats a sentence in the wrong language', () => {
  withCatalog(
    {
      'ranking.push.rank_at_risk.title': { pt: 'Sua posição' },
      'ranking.push.rank_at_risk.body': { pt: 'Você está em {{rank}}.' },
    },
    () => {
      assert.equal(
        mod.resolveRankingPushCopy('rank_at_risk', 'en', mod.rankingCopyVars('rank_at_risk', 'en', { rank: 4, points: 1 })),
        null
      )
      assert.equal(
        mod.resolveRankingPushCopy('rank_at_risk', 'it', mod.rankingCopyVars('rank_at_risk', 'it', { rank: 4, points: 1 })),
        null
      )
    }
  )
})

// ===============================================================================================
// THE CEILINGS — structural, not editorial
// ===============================================================================================

test('BR-RANKING-002 item 2: a sentence carrying a literal number is refused, not published', () => {
  withCatalog({ 'ranking.push.rank_drop.title': { en: 'You are 4 of 13' } }, () => {
    assert.equal(
      mod.resolveRankingPushCopy('rank_drop', 'en', mod.rankingCopyVars('rank_drop', 'en', { rank: 4, points: 20 })),
      null
    )
  })
})

test('BR-RANKING-002 item 2: no published sentence carries a digit, a percentage or a denominator', () => {
  for (const { key, lang, value } of publishedSentences()) {
    const withoutPlaceholders = value.replace(/\{\{\s*[a-z_]+\s*\}\}/g, '')
    assert.doesNotMatch(withoutPlaceholders, /\d/, `${key}/${lang} carries a literal digit`)
    assert.doesNotMatch(value, /%/, `${key}/${lang} carries a percentage`)
  }
})

test('DS-COPY-070 and BR-COMUNICACAO-012 item 1.4.e: no published sentence carries a clock, not even by deduction', () => {
  // The daily window and the streak day (midnight UTC) are two different clocks and neither is
  // the tourist's, so "today" is as false as "3 hours left" for somebody in UTC−3 at 22h.
  //
  // The scan is by TOKEN, not by substring, and that is deliberate: `ora` is Italian for *now*
  // and opens `Ora sei {{rank}} in classifica`, while `hora`/`heure`/`ora`/`hour` in the third
  // piece is the UNIT OF BALANCE (BR-MONETIZACAO-048), not a countdown. Banning them as
  // substrings would reject `design`'s own copy, which is why spec §6 item 7's literal scan
  // cannot be run as written.
  const CLOCK_WORDS = new Set([
    'hoje', 'today', "aujourd'hui", 'oggi', 'hoy',
    'amanhã', 'tomorrow', 'demain', 'domani', 'mañana',
    'minuto', 'minutos', 'minute', 'minutes', 'minuti',
    'prazo', 'deadline', 'tempo', 'temps', 'tiempo', 'time',
  ])
  for (const { key, lang, value } of publishedSentences()) {
    for (const token of value.toLowerCase().split(/[^\p{L}\p{M}']+/u)) {
      assert.equal(
        CLOCK_WORDS.has(token),
        false,
        `${key}/${lang}: the sentence says "${token}", which lets the reader estimate a deadline`
      )
    }
  }
})

test('BR-COMUNICACAO-012 item 2 and BR-RANKING-006: no published sentence promises a cadence or a prize', () => {
  const FORBIDDEN = [
    /\bspam\b/i, /\bsemanalmente\b/i, /\bweekly\b/i, /\bchaque semaine\b/i,
    /\bprêmio\b/i, /\bpremio\b/i, /\bprize\b/i, /\bprix\b/i, /\btroféu\b/i, /\btrophy\b/i, /\bbadge\b/i,
  ]
  for (const { key, lang, value } of publishedSentences()) {
    for (const pattern of FORBIDDEN) {
      assert.doesNotMatch(value, pattern, `${key}/${lang} matches ${pattern}`)
    }
  }
})

test('#747: a variable the mechanism does not supply fails closed instead of rendering blank', () => {
  withCatalog({ 'ranking.push.rank_drop.title': { en: 'Hello {{nickname}}' } }, () => {
    assert.equal(
      mod.resolveRankingPushCopy('rank_drop', 'en', mod.rankingCopyVars('rank_drop', 'en', { rank: 4, points: 20 })),
      null
    )
  })
})

test('#747: the variables are scoped per piece — neither can reach for the other one\'s', () => {
  // The streak has no position to state (BR-RANKING-002: the piece speaks of the streak, not of
  // the table), and the two rank pieces have no day count.
  const streakVars = mod.rankingCopyVars('streak_at_risk', 'en', { rank: 4, points: 20, streakDays: 3 })
  assert.deepEqual(streakVars, { count: 3 })
  const dropVars = mod.rankingCopyVars('rank_drop', 'en', { rank: 4, points: 20.4, streakDays: 3 })
  assert.deepEqual(dropVars, { rank: '4th', points: 20 })

  withCatalog({ 'ranking.push.streak_at_risk.body': { en: 'You are {{rank}}.' } }, () => {
    assert.equal(mod.resolveRankingPushCopy('streak_at_risk', 'en', streakVars), null)
  })
  withCatalog({ 'ranking.push.rank_drop.body': { en: 'It is at {{count}} days.' } }, () => {
    assert.equal(mod.resolveRankingPushCopy('rank_drop', 'en', dropVars), null)
  })
})

test('BR-COMUNICACAO-012 item 1.4.e: a sentence asking for hours finds no such variable and does not leave', () => {
  withCatalog({ 'ranking.push.streak_at_risk.body': { en: 'Ends in {{hours}}.' } }, () => {
    assert.equal(
      mod.resolveRankingPushCopy(
        'streak_at_risk',
        'en',
        mod.rankingCopyVars('streak_at_risk', 'en', { rank: null, points: null, streakDays: 5 })
      ),
      null
    )
  })
})

// ===============================================================================================
// THE STREAK COUNT — BR-RANKING-008, and the precondition that makes it fail closed
// ===============================================================================================

test('BR-RANKING-008: without a measured streak length the piece does not leave — the count is never invented', () => {
  // `core.account_streak` arrives from migration `20260917120000` of `db-tuggiApp`. Until it is
  // applied the orchestrator's read fails, `streakDays` is `null`, and this is the whole
  // behaviour of the piece: silence, not a made-up number and not a number-free variant.
  for (const streakDays of [null, undefined, 0, Number.NaN]) {
    assert.deepEqual(
      mod.rankingCopyVars('streak_at_risk', 'pt', { rank: null, points: null, streakDays }),
      {},
      `streakDays=${String(streakDays)} must supply no variable`
    )
    assert.equal(
      mod.resolveRankingPushCopy(
        'streak_at_risk',
        'pt',
        mod.rankingCopyVars('streak_at_risk', 'pt', { rank: null, points: null, streakDays })
      ),
      null
    )
  }
})

test('BR-RANKING-008: with a measured length the streak piece states the DAYS, and the plural is selected per language', () => {
  const expectedOther: Record<string, string> = {
    pt: 'Sua sequência está em 3 dias',
    en: 'Your streak is at 3 days',
    es: 'Tu racha está en 3 días',
    fr: 'Ta série est à 3 jours',
    it: 'La tua serie è a 3 giorni',
  }
  const expectedOne: Record<string, string> = {
    pt: 'Sua sequência está em 1 dia',
    en: 'Your streak is at 1 day',
    es: 'Tu racha está en 1 día',
    fr: 'Ta série est à 1 jour',
    it: 'La tua serie è a 1 giorno',
  }
  for (const lang of mod.RANKING_COPY_LANGS) {
    const many = mod.resolveRankingPushCopy(
      'streak_at_risk',
      lang,
      mod.rankingCopyVars('streak_at_risk', lang, { rank: null, points: null, streakDays: 3 })
    )
    assert.ok(many, `${lang} must resolve`)
    assert.equal(many.title, expectedOther[lang])

    // `one` never renders in production — the sender's floor is two days — and it exists because
    // a missing plural form becomes an empty string, not a visible bug. Spec §1.3.
    const single = mod.resolveRankingPushCopy(
      'streak_at_risk',
      lang,
      mod.rankingCopyVars('streak_at_risk', lang, { rank: null, points: null, streakDays: 1 })
    )
    assert.ok(single, `${lang} must render the singular without an exception`)
    assert.equal(single.title, expectedOne[lang])
  }
})

// ===============================================================================================
// THE SENTENCES ARE `design`'s — citation of the spec, character for character
// ===============================================================================================

test("#747 spec §1.2: the drop title is `design`'s sentence in the five languages, with the ordinal in place", () => {
  const expected: Record<string, string> = {
    pt: 'Você caiu para 4º lugar',
    en: 'You dropped to 4th place',
    es: 'Bajaste al 4.º puesto',
    fr: 'Tu passes 4e au classement',
    it: 'Ora sei 4º in classifica',
  }
  for (const lang of mod.RANKING_COPY_LANGS) {
    const copy = mod.resolveRankingPushCopy(
      'rank_drop',
      lang,
      mod.rankingCopyVars('rank_drop', lang, { rank: 4, points: 20 })
    )
    assert.ok(copy)
    assert.equal(copy.title, expected[lang])
  }
})

test('DS-COPY-071: the drop body names the EXTERNAL cause, and DS-COPY-069 keeps the gendered verb out of `fr`/`it`', () => {
  const ptBody = mod.resolveRankingCopy('ranking.push.rank_drop.body', 'pt', {})
  assert.equal(
    ptBody,
    'Alguém passou à sua frente no placar desta semana. E a semana ainda não acabou.'
  )
  // The account dropped because another one scored; a piece that accuses somebody who did nothing
  // wrong costs an iOS permission that never comes back.
  assert.doesNotMatch(ptBody, /você perdeu/i)
  // `être`/`essere` + participle inflects for the reader's gender, which we decided not to know.
  const frTitle = mod.resolveRankingCopy('ranking.push.rank_drop.title', 'fr', { rank: '4e' })
  const itTitle = mod.resolveRankingCopy('ranking.push.rank_drop.title', 'it', { rank: '4º' })
  assert.doesNotMatch(frTitle, /descendu/i)
  assert.doesNotMatch(itTitle, /sces[oa]/i)
  assert.doesNotMatch(`${frTitle} ${itTitle}`, /\(e\)|\(a\)/)
})

test('BR-MONETIZACAO-055 and BR-COMUNICACAO-008: the balance piece states facts and orders no act the tier refuses', () => {
  const body = mod.resolveRankingCopy('ranking.push.rank_at_risk.body', 'pt', { rank: '4º' })
  assert.equal(
    body,
    'Você está em 4º lugar, com alguém a poucos pontos de distância. Sem horas, o guia para de narrar.'
  )
  // No imperative to buy and none to switch the guide on — in `free` that act is refused.
  assert.doesNotMatch(body, /compre|assine|ligue o guia|renove/i)
})

// ===============================================================================================
// THE ORCHESTRATOR — the source ruler, because the function imports a remote URL
// ===============================================================================================

test('#747: the orchestrator withholds the piece when the copy is missing, instead of sending it bare', () => {
  const source = readFileSync(ORCHESTRATOR_PATH, 'utf8')
  assert.match(source, /resolveRankingPushCopy\(/)
  // The send is conditional on the resolved copy, and the fallback is the daily retrospective —
  // never a push with an empty or hard-coded body.
  assert.match(source, /rankingCopy && decision \?/)
  assert.equal(/title:\s*['"`][A-Za-zÀ-ÿ]/.test(source.split('rankingCopy')[1] ?? ''), false)
})

test('BR-RANKING-008: the orchestrator reads the streak length from `core.account_streak` and from nowhere else', () => {
  const source = readFileSync(ORCHESTRATOR_PATH, 'utf8')
  // One counter, one owner (CLAUDE.md §6). The sibling RPC `drive.get_streak_v1()` identifies the
  // caller by `auth.uid()` and cannot answer about a third party, so it must not appear here.
  assert.match(source, /from\('account_streak'\)/)
  assert.match(source, /current_streak_days/)
  assert.equal(source.includes("rpc('get_streak_v1'"), false)
  // And it is a READ that fails closed: nothing in this function computes a day count.
  assert.equal(/streakDays:\s*\d/.test(source), false)
})

test('BR-MONETIZACAO-081 item 6.4: the balance piece taps into the paywall carrying its funnel origin', () => {
  const source = readFileSync(ORCHESTRATOR_PATH, 'utf8')
  assert.match(source, /rank_at_risk:\s*'tuggi:\/\/plans\?source=rank_at_risk'/)
  // The two pieces that speak of the table land on the table.
  assert.match(source, /streak_at_risk:\s*'tuggi:\/\/ranking'/)
  assert.match(source, /rank_drop:\s*'tuggi:\/\/ranking'/)
})

test('BR-COMUNICACAO-017: a language the sender cannot address stays out of the e-mail audience', () => {
  // The gate moved out of the orchestrator and into `_shared/ranking-email.ts` when the send was
  // wired (#747), which is what made it executable instead of grep-able — the behaviour itself is
  // proved in `tests/api/ranking-email.test.ts`. What is checked here is that the orchestrator
  // still routes through that one plan rather than growing a second copy of the gate.
  const source = readFileSync(ORCHESTRATOR_PATH, 'utf8')
  assert.match(source, /planRankingEmails/)
  assert.doesNotMatch(source, /mailableEmailLang\(/, 'the language gate has a second implementation')
  assert.match(
    readFileSync(
      resolve(import.meta.dirname, '../../supabase/functions/_shared/ranking-email.ts'),
      'utf8'
    ),
    /mailableEmailLang\(row\.language\)/
  )
})
