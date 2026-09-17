/**
 * The ranking copy fails CLOSED — #747.
 *
 * The sentences of the three pieces belong to `design` (CLAUDE.md §1) and did not exist when the
 * mechanism was built. So the contract of this half is not "a default sentence": it is **a missing
 * key means the piece does not leave**, and this file is what makes that a promise instead of an
 * intention.
 *
 * It also holds the ceilings that are structural rather than editorial:
 *   - **BR-RANKING-002 item 2** — no literal digit in a sentence, because every number in these
 *     pieces comes from a variable about the recipient or does not exist. That is what closes the
 *     door on a denominator arriving as text.
 *   - **BR-COMUNICACAO-012 item 1.4.e** — no countdown in hours. `streak_at_risk` supplies no
 *     variables at all, so its copy cannot interpolate one.
 *   - **BR-COMUNICACAO-012 item 2** — no cadence promise while BR-COMUNICACAO-014 is `proposta`.
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

let mod: any

before(async () => {
  mod = await import(pathToFileURL(MODULE_PATH).href)
})

test('#747: with the catalogue empty, no piece has copy in any of the five languages', () => {
  for (const lang of mod.RANKING_COPY_LANGS) {
    for (const piece of ['streak_at_risk', 'rank_at_risk', 'rank_drop']) {
      assert.equal(
        mod.resolveRankingPushCopy(piece, lang, { rank: 4, points: 20 }),
        null,
        `${piece}/${lang} must fail closed while the value is pending`
      )
      assert.equal(mod.resolveRankingEmailCopy(piece, lang, { rank: 4, points: 20 }), null)
    }
  }
})

test('#747: every key the mechanism can emit is declared, so the handover has a finite list', () => {
  // 3 pieces × 2 push keys + 3 pieces × 3 e-mail keys.
  assert.equal(mod.RANKING_COPY_KEYS.length, 15)
  assert.equal(new Set(mod.RANKING_COPY_KEYS).size, 15)
  for (const key of mod.RANKING_COPY_KEYS) {
    assert.match(key, /^ranking\.(push|email)\.(streak_at_risk|rank_at_risk|rank_drop)\./)
  }
})

test('#747: a key filled for one language leaves the other four closed', () => {
  mod.RANKING_COPY_CATALOG['ranking.push.rank_drop.title'] = { en: 'Position lost' }
  mod.RANKING_COPY_CATALOG['ranking.push.rank_drop.body'] = { en: 'You are now {{rank}}.' }
  try {
    assert.deepEqual(mod.resolveRankingPushCopy('rank_drop', 'en', { rank: 4 }), {
      title: 'Position lost',
      body: 'You are now 4.',
    })
    assert.equal(mod.resolveRankingPushCopy('rank_drop', 'it', { rank: 4 }), null)
    assert.equal(mod.resolveRankingPushCopy('rank_drop', 'pt-br', { rank: 4 }), null)
  } finally {
    delete mod.RANKING_COPY_CATALOG['ranking.push.rank_drop.title']
    delete mod.RANKING_COPY_CATALOG['ranking.push.rank_drop.body']
  }
})

test('#747: half a piece is not a piece — a title without its body sends nothing', () => {
  mod.RANKING_COPY_CATALOG['ranking.push.rank_drop.title'] = { en: 'Position lost' }
  try {
    assert.equal(mod.resolveRankingPushCopy('rank_drop', 'en', { rank: 4 }), null)
  } finally {
    delete mod.RANKING_COPY_CATALOG['ranking.push.rank_drop.title']
  }
})

test('BR-RANKING-002 item 2: a sentence carrying a literal number is refused, not published', () => {
  mod.RANKING_COPY_CATALOG['ranking.push.rank_drop.title'] = { en: 'You are 4 of 13' }
  mod.RANKING_COPY_CATALOG['ranking.push.rank_drop.body'] = { en: 'Come back.' }
  try {
    assert.equal(mod.resolveRankingPushCopy('rank_drop', 'en', { rank: 4 }), null)
  } finally {
    delete mod.RANKING_COPY_CATALOG['ranking.push.rank_drop.title']
    delete mod.RANKING_COPY_CATALOG['ranking.push.rank_drop.body']
  }
})

test('BR-COMUNICACAO-012 item 1.4.e: the streak piece supplies no variables, so it cannot count hours or days', () => {
  assert.deepEqual(mod.rankingCopyVars('streak_at_risk', { rank: 4, points: 20 }), {})

  mod.RANKING_COPY_CATALOG['ranking.push.streak_at_risk.title'] = { en: 'Your streak' }
  mod.RANKING_COPY_CATALOG['ranking.push.streak_at_risk.body'] = { en: 'Ends in {{hours}}.' }
  try {
    assert.equal(
      mod.resolveRankingPushCopy('streak_at_risk', 'en', mod.rankingCopyVars('streak_at_risk', { rank: 4, points: 20 })),
      null
    )
  } finally {
    delete mod.RANKING_COPY_CATALOG['ranking.push.streak_at_risk.title']
    delete mod.RANKING_COPY_CATALOG['ranking.push.streak_at_risk.body']
  }
})

test('#747: a variable the mechanism does not supply fails closed instead of rendering blank', () => {
  mod.RANKING_COPY_CATALOG['ranking.push.rank_drop.title'] = { en: 'Hello {{nickname}}' }
  mod.RANKING_COPY_CATALOG['ranking.push.rank_drop.body'] = { en: 'You dropped.' }
  try {
    assert.equal(mod.resolveRankingPushCopy('rank_drop', 'en', { rank: 4 }), null)
  } finally {
    delete mod.RANKING_COPY_CATALOG['ranking.push.rank_drop.title']
    delete mod.RANKING_COPY_CATALOG['ranking.push.rank_drop.body']
  }
})

test('#747: there is no fallback language — silence beats a sentence in the wrong language', () => {
  mod.RANKING_COPY_CATALOG['ranking.push.rank_at_risk.title'] = { 'pt-br': 'Sua posição' }
  mod.RANKING_COPY_CATALOG['ranking.push.rank_at_risk.body'] = { 'pt-br': 'Você está em {{rank}}.' }
  try {
    assert.equal(mod.resolveRankingPushCopy('rank_at_risk', 'en', { rank: 4 }), null)
    assert.equal(mod.resolveRankingPushCopy('rank_at_risk', 'it', { rank: 4 }), null)
  } finally {
    delete mod.RANKING_COPY_CATALOG['ranking.push.rank_at_risk.title']
    delete mod.RANKING_COPY_CATALOG['ranking.push.rank_at_risk.body']
  }
})

test('#747: the five languages of the app, and `pt-PT` is not `pt-BR`', () => {
  assert.deepEqual([...mod.RANKING_COPY_LANGS], ['pt-br', 'pt-pt', 'en', 'es', 'it'])
  assert.equal(mod.normalizeCopyLang('pt-PT'), 'pt-pt')
  assert.equal(mod.normalizeCopyLang('pt_BR'), 'pt-br')
  assert.equal(mod.normalizeCopyLang('it-IT'), 'it')
  assert.equal(mod.normalizeCopyLang(null), 'en')
})

test('#747: the orchestrator withholds the piece when the copy is missing, instead of sending it bare', () => {
  // Source ruler: the orchestrator imports a remote URL and cannot be loaded here.
  const source = readFileSync(ORCHESTRATOR_PATH, 'utf8')
  assert.match(source, /resolveRankingPushCopy\(/)
  // The send is conditional on the resolved copy, and the fallback is the daily retrospective —
  // never a push with an empty or hard-coded body.
  assert.match(source, /rankingCopy && decision \?/)
  assert.equal(/title:\s*['"`][A-Za-zÀ-ÿ]/.test(source.split('rankingCopy')[1] ?? ''), false)
})
