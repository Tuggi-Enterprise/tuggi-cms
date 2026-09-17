/**
 * The ranking E-MAIL — #747, the channel of whoever push does not reach.
 *
 * The push half is proved by `ranking-comm-copy.test.ts` and `ranking-communication.test.ts`.
 * This file proves the half that shipped on 2026-09-17: the nine sentences of spec §2.6 and the
 * four gates between "the mechanism decided to mail you" and "Resend was called".
 *
 * The rules under test:
 *   - **BR-COMUNICACAO-017 item 3 / item 5** — the two consents and the single unsubscribe list
 *     belong to `marketing.get_ranking_email_audience`, NOT to this side. What is proved here is
 *     that nothing re-checks them: an address absent from the audience is simply not a recipient.
 *   - **BR-COMUNICACAO-017 item 6.a** — no `@privaterelay.appleid.com` before the sending domain
 *     is registered in the Apple Developer Account, and the gate fails CLOSED.
 *   - **BR-COMUNICACAO-017 item 8.c** — an automatic dispatch leaves an audit line in place of
 *     the human confirmation of BR-COMUNICACAO-014 item 9, and that line carries no PII.
 *   - **BR-COMUNICACAO-017 item 9 / 9.a** — the piece speaks to whoever IS in the roster. The
 *     sentence *"a sua linha não apareceu nesta semana"* was written on this very card and could
 *     not be used; this file is what stops it coming back.
 *   - **BR-COMUNICACAO-017 item 8.e** — one piece per ADDRESS per weekly cycle, never per day.
 *     The slot is reserved before the send, the reservation is the only authorisation, and an
 *     address that already spent its cycle — or one whose reservation could not be proved — is
 *     discarded in silence.
 *   - **BR-COMUNICACAO-014 item 6.3** — the 7-day bucket has no arbiter in code, so the number of
 *     unarbitrated sends is COUNTED. A test that asserted zero here would be asserting a gate
 *     that does not exist.
 *   - **BR-RANKING-002 item 2** — no participant total and no literal digit; every number is a
 *     variable about the recipient.
 *
 * Run with: npm run test:api
 */

import { test, before } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

const I18N_PATH = resolve(
  import.meta.dirname,
  '../../supabase/functions/_shared/ranking-comm-i18n.ts'
)
const PLAN_PATH = resolve(
  import.meta.dirname,
  '../../supabase/functions/_shared/ranking-email.ts'
)
const ORCHESTRATOR_PATH = resolve(
  import.meta.dirname,
  '../../supabase/functions/daily-gamification-orchestrator/index.ts'
)
const SENDER_PATH = resolve(
  import.meta.dirname,
  '../../supabase/functions/send-newsletter/index.ts'
)

let i18n: any
let plan: any

before(async () => {
  i18n = await import(pathToFileURL(I18N_PATH).href)
  plan = await import(pathToFileURL(PLAN_PATH).href)
})

/** Vars for a positional piece, the way `dispatchRankingEmail` builds them. */
function positionVars(piece: string, lang: string, rank: number) {
  return i18n.rankingCopyVars(piece, lang, { rank, points: 40 })
}

/** Vars for the streak piece, the way `dispatchRankingEmail` builds them. */
function streakVars(lang: string, days: number) {
  return i18n.rankingCopyVars('streak_at_risk', lang, { rank: null, points: null, streakDays: days })
}

function audienceRow(user_id: string, email: string, language: string | null) {
  return { user_id, email, language }
}

function decision(user_id: string, piece: string, rank: number | null = 4, points: number | null = 40) {
  return { user_id, piece, channel: 'email', rank, points }
}

// ---------------------------------------------------------------------------------------------
// THE PLURAL SCOPE — the one technical question the copy handover named
// ---------------------------------------------------------------------------------------------

test('BR-COMUNICACAO-017: plural is scoped PER FIELD, so one piece can mix a pair and two single strings', () => {
  // `streak_at_risk.subject` is a `{one, other}` pair; the `heading` and `body` of the SAME piece
  // are single strings. If selection were per PIECE, one of the two would break — either the pair
  // would not resolve, or the single strings would demand a `{{count}}` they do not carry.
  for (const lang of ['pt', 'en', 'es', 'it']) {
    const one = i18n.resolveRankingEmailCopy('streak_at_risk', lang, streakVars(lang, 1))
    const many = i18n.resolveRankingEmailCopy('streak_at_risk', lang, streakVars(lang, 4))
    assert.ok(one, `streak_at_risk/${lang} did not resolve at count=1`)
    assert.ok(many, `streak_at_risk/${lang} did not resolve at count=4`)

    // The subject is the only field that moves with the count.
    assert.notEqual(one.subject, many.subject, `${lang}: the subject did not inflect`)
    assert.equal(one.heading, many.heading, `${lang}: the heading inflected and must not`)
    assert.equal(one.body, many.body, `${lang}: the body inflected and must not`)

    // And the count actually landed in the subject — the pair is not decorative.
    assert.match(one.subject, /\b1\b/)
    assert.match(many.subject, /\b4\b/)
  }
})

test('BR-RANKING-002: the singular form is a real sentence, so a one-day streak never prints "1 dias"', () => {
  assert.equal(i18n.resolveRankingEmailCopy('streak_at_risk', 'pt', streakVars('pt', 1))!.subject,
    'Sua sequência está em 1 dia')
  assert.equal(i18n.resolveRankingEmailCopy('streak_at_risk', 'it', streakVars('it', 1))!.subject,
    'La tua serie è a 1 giorno')
  assert.equal(i18n.resolveRankingEmailCopy('streak_at_risk', 'it', streakVars('it', 6))!.subject,
    'La tua serie è a 6 giorni')
})

test('BR-COMUNICACAO-017: the two positional pieces carry no {{count}} and resolve with rank alone', () => {
  for (const piece of ['rank_drop', 'rank_at_risk']) {
    for (const lang of ['pt', 'en', 'es', 'it']) {
      const copy = i18n.resolveRankingEmailCopy(piece, lang, positionVars(piece, lang, 4))
      assert.ok(copy, `${piece}/${lang} did not resolve with rank alone`)
      // `rankingCopyVars` supplies no `count` to these two, so a plural pair here would be `null`.
      assert.equal(positionVars(piece, lang, 4).count, undefined)
    }
  }
})

test('BR-RANKING-002 item 2: {{points}} appears in none of the nine e-mail sentences', () => {
  // Not debt: a single string with `{{points}}` prints "1 pontos" the day an account has one
  // point, and a plural pair would never resolve because these pieces are given no `count`.
  for (const key of Object.keys(i18n.RANKING_COPY_CATALOG)) {
    if (!key.startsWith('ranking.email.')) continue
    for (const value of Object.values(i18n.RANKING_COPY_CATALOG[key])) {
      const forms = typeof value === 'string' ? [value] : Object.values(value as Record<string, string>)
      for (const form of forms) {
        assert.doesNotMatch(form as string, /\{\{\s*points\s*\}\}/, `${key} names {{points}}`)
      }
    }
  }
})

// ---------------------------------------------------------------------------------------------
// FAIL CLOSED PER LANGUAGE — the case the card asked to see proved
// ---------------------------------------------------------------------------------------------

test('BR-COMUNICACAO-017: a piece missing one key in one language does not leave in that language, and the others are untouched', () => {
  const key = 'ranking.email.rank_drop.heading'
  const saved = { ...i18n.RANKING_COPY_CATALOG[key] }
  try {
    delete i18n.RANKING_COPY_CATALOG[key].it

    assert.equal(
      i18n.resolveRankingEmailCopy('rank_drop', 'it', positionVars('rank_drop', 'it', 4)),
      null,
      'Italian resolved with one of its three keys missing'
    )
    for (const lang of ['pt', 'en', 'es']) {
      assert.ok(
        i18n.resolveRankingEmailCopy('rank_drop', lang, positionVars('rank_drop', lang, 4)),
        `${lang} was taken down by the Italian gap`
      )
    }

    // And the plan agrees: the Italian reader is discarded, counted, and the other three go out.
    const result = plan.planRankingEmails({
      audience: [
        audienceRow('u-pt', 'a@tuggi.app', 'pt'),
        audienceRow('u-en', 'b@tuggi.app', 'en'),
        audienceRow('u-es', 'c@tuggi.app', 'es'),
        audienceRow('u-it', 'd@tuggi.app', 'it'),
      ],
      decisions: [
        decision('u-pt', 'rank_drop'), decision('u-en', 'rank_drop'),
        decision('u-es', 'rank_drop'), decision('u-it', 'rank_drop'),
      ],
      streakDaysByUserId: new Map(),
      relayDomainVerifiedRaw: 'true',
    })
    assert.equal(result.recipients.length, 3)
    assert.equal(result.discarded.no_copy, 1)
    assert.deepEqual(result.recipients.map((r: any) => r.lang).sort(), ['en', 'es', 'pt'])
  } finally {
    i18n.RANKING_COPY_CATALOG[key] = saved
  }
})

// ---------------------------------------------------------------------------------------------
// THE GATES
// ---------------------------------------------------------------------------------------------

test('BR-COMUNICACAO-017 item 6.a: no Apple relay address leaves while the sending domain is unverified, and the gate fails closed', () => {
  const audience = [
    audienceRow('u-1', 'abc123@privaterelay.appleid.com', 'pt'),
    audienceRow('u-2', 'someone@gmail.com', 'pt'),
  ]
  const decisions = [decision('u-1', 'rank_drop'), decision('u-2', 'rank_drop')]

  // Anything that is not the literal `true` is unverified — absent, empty, "yes", "1", "TRUE ".
  for (const raw of [undefined, null, '', 'yes', '1', 'false']) {
    const result = plan.planRankingEmails({ audience, decisions, streakDaysByUserId: new Map(), relayDomainVerifiedRaw: raw })
    assert.equal(result.recipients.length, 1, `relay address left with the secret set to ${JSON.stringify(raw)}`)
    assert.equal(result.discarded.apple_relay_domain_unverified, 1)
    assert.equal(result.recipients[0].email, 'someone@gmail.com')
  }

  // Verified: the relay address is a recipient like any other. Those are the 70 accounts that
  // otherwise receive silence and conclude the product forgot them.
  const open = plan.planRankingEmails({ audience, decisions, streakDaysByUserId: new Map(), relayDomainVerifiedRaw: 'true' })
  assert.equal(open.recipients.length, 2)
  assert.equal(open.discarded.apple_relay_domain_unverified, 0)
})

test('BR-COMUNICACAO-017: `fr` is written in the catalogue and stays out of the audience', () => {
  // Writing is not turning on. The sentence exists so the day `FOOTER_LABELS`, `FALLBACK_NAME`
  // and `SITE_LOCALE` learn French, nothing in this catalogue has to change.
  assert.ok(i18n.RANKING_COPY_CATALOG['ranking.email.rank_drop.body'].fr)
  assert.equal(i18n.mailableEmailLang('fr'), null)

  const result = plan.planRankingEmails({
    audience: [audienceRow('u-fr', 'f@tuggi.app', 'fr'), audienceRow('u-pt', 'p@tuggi.app', 'pt-BR')],
    decisions: [decision('u-fr', 'rank_drop'), decision('u-pt', 'rank_drop')],
    streakDaysByUserId: new Map(),
    relayDomainVerifiedRaw: 'true',
  })
  assert.equal(result.recipients.length, 1)
  assert.equal(result.recipients[0].lang, 'pt')
  assert.equal(result.discarded.language_not_published, 1)
})

test('BR-COMUNICACAO-017 items 3 and 5: an address the audience resolver did not return is not a recipient, and nothing re-checks consent here', () => {
  // The two consents and `marketing.email_unsubscribes` are the database's gate. An empty
  // audience — which is exactly what an unapplied migration produces upstream — sends nothing.
  const none = plan.planRankingEmails({
    audience: [],
    decisions: [decision('u-1', 'rank_drop')],
    streakDaysByUserId: new Map(),
    relayDomainVerifiedRaw: 'true',
  })
  assert.equal(none.recipients.length, 0)
  assert.equal(none.audienceSize, 0)

  // And an address in the audience with no piece for today gets nothing either.
  const noPiece = plan.planRankingEmails({
    audience: [audienceRow('u-1', 'a@tuggi.app', 'pt')],
    decisions: [],
    streakDaysByUserId: new Map(),
    relayDomainVerifiedRaw: 'true',
  })
  assert.equal(noPiece.recipients.length, 0)
  assert.equal(noPiece.discarded.no_decision, 1)

  // The plan has no consent field at all: re-reading it here would be the second gate. The scan
  // is over the CODE, with the comments stripped — the header of that file names both columns,
  // which is exactly the documentation this assertion is defending.
  const code = readFileSync(PLAN_PATH, 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '')
  assert.doesNotMatch(code, /email_opt_in|ranking_opt_in/)
})

test('BR-COMUNICACAO-017 item 8.c: the audit line counts everything and names nobody', () => {
  const result = plan.planRankingEmails({
    audience: [
      audienceRow('u-1', 'abc@privaterelay.appleid.com', 'pt'),
      audienceRow('u-2', 'jean@tuggi.app', 'fr'),
      audienceRow('u-3', 'ok@tuggi.app', 'en'),
      audienceRow('u-4', 'nodecision@tuggi.app', 'en'),
    ],
    decisions: [decision('u-1', 'rank_drop'), decision('u-2', 'rank_drop'), decision('u-3', 'rank_drop')],
    streakDaysByUserId: new Map(),
    relayDomainVerifiedRaw: undefined,
  })
  const line = plan.rankingEmailAuditLine(result, undefined)

  assert.match(line, /audience=4/)
  assert.match(line, /mailable=1/)
  assert.match(line, /discarded=3/)
  assert.match(line, /apple_relay_domain_unverified=1/)
  assert.match(line, /language_not_published=1/)
  assert.match(line, /no_decision=1/)
  assert.match(line, /domain_verified=false/)

  // No PII: BR-COMUNICACAO-014 item 5 counts, it does not name.
  assert.doesNotMatch(line, /@/)
  assert.doesNotMatch(line, /u-\d/)
})

test('BR-COMUNICACAO-014 item 6.3: with no cadence arbiter, the sends that leave unarbitrated are COUNTED, not assumed to be zero', () => {
  // The 7-day bucket is shared with the newsletter and the gate is a single SQL function that
  // does not exist (BR-COMUNICACAO-017 item 4.b). Building a fourth blind gate in TypeScript is
  // the defect BR-COMUNICACAO-014 item 7 exists to prevent, so the absence is made observable.
  const result = plan.planRankingEmails({
    audience: [audienceRow('u-1', 'a@tuggi.app', 'pt'), audienceRow('u-2', 'b@tuggi.app', 'en')],
    decisions: [decision('u-1', 'rank_drop'), decision('u-2', 'rank_drop')],
    streakDaysByUserId: new Map(),
    relayDomainVerifiedRaw: 'true',
  })
  assert.equal(result.cadenceArbiterAbsent, 2)
  assert.equal(result.cadenceArbiterAbsent, result.recipients.length)
  assert.match(plan.rankingEmailAuditLine(result, 'true'), /no_cadence_arbiter=2/)
})

// ---------------------------------------------------------------------------------------------
// THE CYCLE SLOT — BR-COMUNICACAO-017 item 8.e, the ceiling the daily window would otherwise miss
// ---------------------------------------------------------------------------------------------

/** A plan with one mailable recipient per address, the way `dispatchRankingEmail` builds it. */
function planFor(rows: Array<[string, string]>, pieces: Record<string, string> = {}) {
  return plan.planRankingEmails({
    audience: rows.map(([u, email]) => audienceRow(u, email, 'pt')),
    decisions: rows.map(([u]) => decision(u, pieces[u] ?? 'rank_drop')),
    streakDaysByUserId: new Map(),
    relayDomainVerifiedRaw: 'true',
  })
}

test('BR-COMUNICACAO-017 item 8.e: an address that already spent its cycle is discarded, not mailed', async () => {
  const built = planFor([['u-1', 'spent@tuggi.app'], ['u-2', 'fresh@tuggi.app']])
  assert.equal(built.recipients.length, 2)

  const asked: string[] = []
  const claimed = await plan.claimRankingEmailSlots(built, async (r: any) => {
    asked.push(r.email)
    // `reserved: false` is what the RPC answers when the unique index already holds this cycle.
    return r.email === 'spent@tuggi.app' ? 'cycle_already_claimed' : 'reserved'
  })

  // Every recipient was ASKED; only the one that won the row leaves.
  assert.equal(asked.length, built.recipients.length)
  assert.deepEqual(claimed.recipients.map((r: any) => r.email), ['fresh@tuggi.app'])
  assert.equal(claimed.discarded.cycle_already_claimed, 1)

  const line = plan.rankingEmailAuditLine(claimed, 'true')
  assert.match(line, /cycle_already_claimed=1/)
  assert.match(line, /mailable=1/)
  assert.doesNotMatch(line, /@/)
  assert.doesNotMatch(line, /u-\d/)
})

test('BR-COMUNICACAO-017 item 8.e: a reservation that cannot be proved sends nothing, and the failure is counted', async () => {
  // "Sem contagem provada, nenhum e-mail sai": an RPC error — 55000, 22023, 23514 — is silence.
  const errored = await plan.claimRankingEmailSlots(planFor([['u-1', 'a@tuggi.app']]), async () => 'claim_failed')
  assert.equal(errored.recipients.length, 0)
  assert.equal(errored.discarded.claim_failed, 1)
  assert.match(plan.rankingEmailAuditLine(errored, 'true'), /claim_failed=1/)

  // And a claim that REJECTS is the same verdict: failing closed is not the caller's to remember.
  const thrown = await plan.claimRankingEmailSlots(planFor([['u-1', 'a@tuggi.app']]), async () => {
    throw new Error('network')
  })
  assert.equal(thrown.recipients.length, 0)
  assert.equal(thrown.discarded.claim_failed, 1)
})

test('BR-COMUNICACAO-017 item 8.e with BR-COMUNICACAO-012 item 1.4.e: two pieces for one address reserve ONCE, and the perishable one wins', async () => {
  // The ceiling is keyed on the ADDRESS, so two accounts sharing one compete before the
  // reservation — reserving three times to find out which passes would burn the cycle on the
  // least urgent piece.
  const rows = [
    audienceRow('u-1', 'Shared@tuggi.app', 'pt'),
    audienceRow('u-2', 'shared@tuggi.app', 'pt'),
  ]
  const decisions = [
    decision('u-1', 'rank_drop'),
    { user_id: 'u-2', piece: 'streak_at_risk', channel: 'email', rank: null, points: null },
  ]
  const streaks = new Map([['u-2', 3]])

  for (const order of [rows, [...rows].reverse()]) {
    const built = plan.planRankingEmails({
      audience: order,
      decisions,
      streakDaysByUserId: streaks,
      relayDomainVerifiedRaw: 'true',
    })
    // One recipient for the address, and it is the streak — the most perishable of the two.
    assert.equal(built.recipients.length, 1)
    assert.equal(built.recipients[0].piece, 'streak_at_risk')
    assert.equal(built.discarded.address_superseded, 1)

    const asked: string[] = []
    const claimed = await plan.claimRankingEmailSlots(built, async (r: any) => {
      asked.push(r.piece)
      return 'reserved'
    })
    assert.deepEqual(asked, ['streak_at_risk'])
    assert.equal(claimed.recipients.length, 1)
  }
})

test('BR-COMUNICACAO-017 item 8.e: the orchestrator reserves BEFORE it delivers, and never gives the slot back', () => {
  const source = readFileSync(ORCHESTRATOR_PATH, 'utf8')
  const body = source.slice(source.indexOf('async function dispatchRankingEmail'))
  const claimAt = body.indexOf('claimRankingEmailSlots')
  const deliverAt = body.indexOf('send-newsletter/ranking')
  assert.ok(claimAt > -1, 'the cycle slot is not reserved at all')
  assert.ok(deliverAt > claimAt, 'delivery happens before the reservation that authorises it')
  assert.match(body, /claim_ranking_email_slot/)
  // What leaves is what the reservation returned, never the pre-claim plan.
  assert.match(body, /recipients: claimed\.recipients/)
  // No release in the catch: a slot handed back costs two e-mails to the same person.
  assert.doesNotMatch(body, /release_ranking_email_slot|unclaim|delete_ranking_email/)
  // The audit line of item 8.c is printed after the reservation, or the two ceilings read zero.
  assert.ok(body.indexOf('rankingEmailAuditLine') > claimAt, 'the audit line predates the reservation')
})

// ---------------------------------------------------------------------------------------------
// THE SENTENCES THEMSELVES — literals, because a literal here is a CITATION of spec §2.6
// ---------------------------------------------------------------------------------------------

test('BR-COMUNICACAO-017 item 9.a: no e-mail sentence speaks to somebody outside the roster', () => {
  // The refused sentence was *"a sua linha não apareceu nesta semana"*, written on this card. The
  // family is the same: "you did not enter", "come back to the list", "turn the scoreboard on".
  const OUTSIDE = [
    /não apareceu/i, /not (there|appear)/i, /no apareci/i, /non (è|e) apparsa/i,
    /n'(est|a) pas apparu/i, /volte a aparecer/i, /ative o placar/i, /entre no (placar|ranking)/i,
    /você não entrou/i, /you did not enter/i,
  ]
  for (const key of Object.keys(i18n.RANKING_COPY_CATALOG)) {
    if (!key.startsWith('ranking.email.')) continue
    for (const [lang, value] of Object.entries(i18n.RANKING_COPY_CATALOG[key])) {
      const forms = typeof value === 'string' ? [value] : Object.values(value as Record<string, string>)
      for (const form of forms) {
        for (const pattern of OUTSIDE) {
          assert.doesNotMatch(form as string, pattern, `${key}/${lang} addresses somebody outside the roster`)
        }
      }
    }
  }
})

test('BR-COMUNICACAO-017: the published e-mail sentences are `design`\'s, spec §2.6, character for character', () => {
  const rendered = (piece: string, lang: string, rank = 4) =>
    i18n.resolveRankingEmailCopy(piece, lang, positionVars(piece, lang, rank))

  assert.deepEqual(rendered('rank_drop', 'pt'), {
    subject: 'Alguém passou à sua frente no placar',
    heading: 'Você está em 4º lugar',
    body: 'Alguém pontuou e passou à sua frente no placar desta semana. A semana não acabou, e a lista se refaz a cada história narrada com o guia ligado.',
  })
  assert.deepEqual(rendered('rank_at_risk', 'en', 3), {
    subject: 'Someone is a few points from you on the standings',
    heading: 'You are in 3rd place, and your hours have run out',
    body: "With no hours left, the guide stops narrating — and the week's scoring stops with it. Your row stays where it is while the list keeps moving.",
  })
  assert.deepEqual(
    i18n.resolveRankingEmailCopy('streak_at_risk', 'es', streakVars('es', 5)),
    {
      subject: 'Tu racha está en 5 días',
      heading: 'Falta una historia para que la racha continúe',
      body: 'La racha cuenta los días seguidos con al menos una historia narrada. Un día sin ninguna reinicia la cuenta desde cero.',
    }
  )
  // The ordinal is the reader's, and it is the mirror of the app's table: `2.º` in Spanish,
  // `2º` in Italian, and English's teens exception is on the last two digits.
  assert.equal(rendered('rank_drop', 'es', 2)!.heading, 'Estás en el 2.º puesto')
  assert.equal(rendered('rank_drop', 'it', 2)!.heading, 'Ora sei 2º in classifica')
  assert.equal(rendered('rank_drop', 'en', 12)!.heading, 'You are in 12th place')
})

// ---------------------------------------------------------------------------------------------
// THE WIRING — the two Edge Functions cannot be imported (remote `esm.sh`), so their contract is
// read from the source. This is the weakest evidence in the file and it is here on purpose: the
// gap it covers is "somebody deleted the call", not "the logic is wrong".
// ---------------------------------------------------------------------------------------------

test('BR-COMUNICACAO-017 item 8: the dispatch fails CLOSED when the audience resolver is missing', () => {
  const source = readFileSync(ORCHESTRATOR_PATH, 'utf8')
  assert.match(source, /get_ranking_email_audience/)
  // The error branch returns before anything is sent, and says so.
  assert.match(source, /is unavailable \(\$\{error\.code[\s\S]{0,120}No e-mail sent/)
  // The plan and the audit line are the ones under test above — not a second implementation.
  assert.match(source, /planRankingEmails/)
  assert.match(source, /rankingEmailAuditLine/)
  assert.match(source, /send-newsletter\/ranking/)
})

test('BR-COMUNICACAO-017 item 5: the ranking e-mail leaves through the sender that already owns the unsubscribe', () => {
  const source = readFileSync(SENDER_PATH, 'utf8')
  const route = source.slice(source.indexOf("if (path === '/ranking')"))
  assert.ok(route.length > 0, 'the /ranking route is gone')
  // Same signed unsubscribe link and the same RFC 8058 one-click headers as every other Tuggi
  // e-mail — one mechanism, one list (BR-COMUNICACAO-015).
  assert.match(route, /buildUnsubscribeUrl/)
  assert.match(route, /unsubscribeHeaders\(oneClickUrl\)/)
  // It is below `requireAdmin`: the route is machine/admin only and opens no public relay.
  assert.ok(
    source.indexOf('const auth = await requireAdmin(') < source.indexOf("if (path === '/ranking')"),
    'the /ranking route sits above requireAdmin and is therefore public'
  )
})
