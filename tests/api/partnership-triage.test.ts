/**
 * The 72-hour clock of the triage and the refusal that stops it — #377, épico #356.
 *
 * THE ASSERTION THIS SUITE EXISTS FOR is the difference between `decided_at` and
 * `communicated_at`. BR-B2B-010, item 4, promises the partner that within 72 straight hours of
 * the partnership's approval either the place is published or the refusal WAS COMMUNICATED, and a
 * screen that stops the clock on the DECISION reads "on time" for a partner nobody has told. That
 * is one test here, and it is the one that must never be made green by changing the criterion.
 *
 * Mutations run against this suite, each one turning it red:
 *  · stopping the clock on `decidedAt` instead of `communicatedAt`;
 *  · counting the deadline from `created_at` instead of `approved_at`;
 *  · dropping `refused_at_triage` out of `TERMINAL_STATES` (it would reappear under the default
 *    filter, which is criterion 4);
 *  · putting `refusal_not_communicated` in `TERMINAL_STATES`, or deriving it after `published`
 *    (the row leaves the default filter still owing the communication — DS-COPY-020, point 5);
 *  · rounding the last hour either side of the deadline to zero, or naming it `hoje`;
 *  · letting the refusal route write `communicated_at` in the same call;
 *  · offering `Tente de novo` after a refusal whose fate is unknown;
 *  · offering an action that removes the partnership on the terminal state (criterion 33).
 *
 * Run with: npm run test:api
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

import {
  TRIAGE_DEADLINE_HOURS,
  TRIAGE_DUE_SOON_HOURS,
  TRIAGE_GATES,
  currentRefusal,
  deriveTriageStatus,
  hasUncommunicatedRefusal,
  isRefusedAtTriage,
  isTriageGate,
  isTriageOverdue,
  triageDeadline,
  type PlaceTriageOutcome,
  type TriageRefusal,
} from '@/lib/partnerships/triage'
import { triageDeadlineText } from '@/components/admin/partnerships/triage-text'
import {
  IN_PROGRESS_STATES,
  PIPELINE_STATES,
  TERMINAL_STATES,
  derivePipelineState,
  detailPath,
} from '@/lib/partnerships/pipeline'
import { formatClockTime, formatDeadline } from '@/components/admin/partner-proposals/format'
import { EMPTY_CONFERENCE } from '@/lib/partner-form/regularity'

const REPO_ROOT = resolve(import.meta.dirname, '../..')

function read(relative: string): string {
  return readFileSync(resolve(REPO_ROOT, relative), 'utf8')
}

function messages(): Record<string, any> {
  return JSON.parse(read('messages/pt.json'))
}

/**
 * The source WITHOUT its comments. Every static assertion about what a file does reads this: a
 * ruler that reads prose measures the prose, and the header of every module here explains at
 * length the very thing the assertion says must not happen.
 */
function code(relative: string): string {
  return read(relative)
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '')
}

const CLIENT_ID = '44444444-4444-4444-4444-444444444444'
const PLACE_ID = '77777777-7777-7777-7777-777777777777'

/** `approved_at` at 10h32, which is the hour spec §3.1 writes its examples with. */
const APPROVED_AT = '2026-08-15T10:32:00.000Z'

/** `APPROVED_AT` + `TRIAGE_DEADLINE_HOURS`, spelled out so the ladder below can be read. */
const DEADLINE = '2026-08-18T10:32:00.000Z'

function refusal(overrides: Partial<TriageRefusal> = {}): TriageRefusal {
  return {
    id: '99999999-9999-9999-9999-999999999999',
    attractionId: PLACE_ID,
    gate: 2,
    reason: 'O insumo é o cadastro mínimo: nome, endereço e telefone.',
    decidedAt: '2026-08-16T09:00:00.000Z',
    decidedByLabel: 'ana@tuggi.app',
    communicatedAt: null,
    ...overrides,
  }
}

function hoursAfter(iso: string, hours: number): Date {
  return new Date(new Date(iso).getTime() + hours * 3_600_000)
}

// ── The clock — BR-B2B-010, item 4 ───────────────────────────────────────────────────────────

test('#377 · BR-B2B-010 item 4: the deadline is 72 STRAIGHT hours from `clients.approved_at`', () => {
  assert.equal(TRIAGE_DEADLINE_HOURS, 72)

  // A Saturday approval expires on a Tuesday, and nothing about the weekend moves it — the 5th
  // edge case of the rule says holidays and weekends do not stop the clock.
  const saturday = '2026-08-15T10:32:00.000Z'
  assert.equal(new Date(saturday).getUTCDay(), 6, 'the fixture has to be a Saturday to mean this')
  assert.equal(triageDeadline(saturday), '2026-08-18T10:32:00.000Z')

  assert.equal(triageDeadline(null), null, 'no approval, no deadline')
  assert.equal(triageDeadline('not a date'), null)
})

test('#377 crit. 6 · BR-B2B-010 item 4: a client with no `approved_at` shows `—`', () => {
  const status = deriveTriageStatus(
    { approvedAt: null, places: [{ published: false, refusal: null }] },
    new Date(APPROVED_AT)
  )
  assert.equal(status.kind, 'not_started')
  assert.equal(messages().Partnerships.triage.none, '—')
})

/**
 * THE WHOLE LADDER, AND IT IS DERIVED FROM `approved_at` + 72 h — never from an example.
 *
 * DS-COPY-025, edge case 1, is the reason this test is written as a table of HOURS SINCE THE
 * APPROVAL and not as a list of expected sentences: the first version of criterion 6 asserted
 * `venceu há 2 dias` for an approval 80 hours old, which is 8 hours past a 72-hour deadline. The
 * conta is the specification; the sentence is what the conta prints.
 */
const LADDER: Array<{
  sinceApproval: number
  kind: string
  count?: number
  hasSecondLine: boolean
}> = [
  { sinceApproval: 50, kind: 'within', hasSecondLine: false },
  { sinceApproval: 59, kind: 'within', hasSecondLine: false },
  { sinceApproval: 60, kind: 'due_soon', count: 12, hasSecondLine: true },
  { sinceApproval: 68, kind: 'due_soon', count: 4, hasSecondLine: true },
  { sinceApproval: 71, kind: 'due_soon', count: 1, hasSecondLine: true },
  { sinceApproval: 71.5, kind: 'due_last_hour', hasSecondLine: true },
  { sinceApproval: 72, kind: 'due_last_hour', hasSecondLine: true },
  { sinceApproval: 72.5, kind: 'overdue_first_hour', hasSecondLine: true },
  { sinceApproval: 73, kind: 'overdue_hours', count: 1, hasSecondLine: true },
  { sinceApproval: 80, kind: 'overdue_hours', count: 8, hasSecondLine: true },
  { sinceApproval: 95, kind: 'overdue_hours', count: 23, hasSecondLine: true },
  { sinceApproval: 96, kind: 'overdue_days', count: 1, hasSecondLine: true },
  { sinceApproval: 120, kind: 'overdue_days', count: 2, hasSecondLine: true },
]

test('#377 crit. 6 · DS-COPY-025: the ladder is the conta, and 80 h is `venceu há 8 h`', () => {
  const facts = { approvedAt: APPROVED_AT, places: [{ published: false, refusal: null }] }

  for (const step of LADDER) {
    const status = deriveTriageStatus(facts, hoursAfter(APPROVED_AT, step.sinceApproval))
    const at = `${step.sinceApproval} h after the approval`

    assert.equal(status.kind, step.kind, at)
    if (typeof step.count === 'number') {
      const value = 'hours' in status ? status.hours : 'days' in status ? status.days : null
      assert.equal(value, step.count, `${at}: the conta, not an example`)
    }
    // DS-COPY-025, point 5: the absolute instant stays on screen while the first line is
    // relative, and it is the deadline — not `now`, and not the approval.
    assert.equal(triageDeadlineText(status) !== null, step.hasSecondLine, `${at}: second line`)
    if (step.hasSecondLine) {
      // The DEADLINE, formatted the one way this screen formats it — compared against the
      // formatter rather than against a literal hour, because the hour is local and CI is not in
      // São Paulo.
      assert.equal(triageDeadlineText(status), formatDeadline(DEADLINE), at)
      assert.match(formatDeadline(DEADLINE), /^18\/08, \d{2}h\d{2}$/)
    }
  }

  // 80 h is the number `design` measured with, and it is 8 HOURS past a 72-hour deadline.
  const eightHoursLate = deriveTriageStatus(facts, hoursAfter(APPROVED_AT, 80))
  assert.equal(isTriageOverdue(eightHoursLate), true)
  assert.equal(eightHoursLate.kind === 'overdue_hours' && eightHoursLate.hours, 8)
  assert.equal(
    eightHoursLate.kind !== 'not_started' && eightHoursLate.kind !== 'closed'
      ? eightHoursLate.deadline
      : null,
    DEADLINE
  )
})

test('#377 crit. 6 · DS-COPY-025 point 3: no face of this clock says `hoje`', () => {
  // A calendar word derived from an INSTANT lies whenever the window crosses midnight: a deadline
  // at 23h50 read 20 hours later did not expire "hoje". The whole `triage` block is scanned and
  // not only the two keys that used to say it, because the next `hoje` will be written somewhere
  // else.
  const copy = JSON.stringify(messages().Partnerships.triage)
  assert.equal(/\bhoje\b/i.test(copy), false, `the triage copy still says "hoje": ${copy}`)

  // And the keys that did are gone rather than left unused (CLAUDE.md §6).
  const triage = messages().Partnerships.triage as Record<string, unknown>
  assert.equal(triage.dueToday, undefined)
  assert.equal(triage.overdue, undefined)
})

test('#377 · DS-COPY-025 points 1, 2 and 4: each face has its copy, and the band under the unit is named', () => {
  const triage = messages().Partnerships.triage as Record<string, string>

  // Far from the deadline the act is to plan, so the instant is in the FIRST line, with the hour:
  // 72 hours from 10h32 expire at 10h32, and a date alone would suggest the whole day.
  assert.equal(triage.within, 'até {deadline}')
  assert.match(formatDeadline('2026-08-18T13:32:00.000Z'), /^18\/08, \d{2}h\d{2}$/)
  assert.match(formatClockTime('2026-08-18T13:32:00.000Z'), /^\d{2}h\d{2}$/)
  assert.equal(formatDeadline(null), '—')

  // Close to it the act is to move, so the copy counts. The verb changes with the number, which is
  // why this one is ICU and `overdueHours` is not (`venceu há 1 h` and `venceu há 8 h` are the
  // same form).
  assert.match(triage.dueSoon, /one \{falta # h\}/)
  assert.match(triage.dueSoon, /other \{faltam # h\}/)
  assert.equal(triage.overdueHours, 'venceu há {count} h')
  assert.match(triage.overdueDays, /one \{venceu há # dia\}/)
  assert.match(triage.overdueDays, /other \{venceu há # dias\}/)

  // Point 4: `falta 0 h` and `venceu há 0 h` do not exist — the band below the unit is named.
  assert.equal(triage.dueLastHour, 'falta menos de 1 h')
  assert.equal(triage.overdueFirstHour, 'venceu há menos de 1 h')
})

test('#377 · spec §3.1: `TRIAGE_DUE_SOON_HOURS` is where the relative counter starts, and it is 12', () => {
  const facts = { approvedAt: APPROVED_AT, places: [{ published: false, refusal: null }] }

  assert.equal(TRIAGE_DUE_SOON_HOURS, 12)
  assert.equal(deriveTriageStatus(facts, hoursAfter(APPROVED_AT, 59.9)).kind, 'within')
  assert.equal(deriveTriageStatus(facts, hoursAfter(APPROVED_AT, 60)).kind, 'due_soon')
  // The instant of the deadline itself has not expired.
  assert.equal(isTriageOverdue(deriveTriageStatus(facts, hoursAfter(APPROVED_AT, 72))), false)
})

test('#377 · DS-COPY-025 point 5: the detail header folds the instant into its single line', () => {
  const messagesPt = messages().Partnerships.triage as Record<string, string>
  assert.equal(messagesPt.headerLine, 'Triagem: {value}')
  assert.equal(messagesPt.headerLineWithDeadline, 'Triagem: {value} (prazo {deadline})')

  // The header has no second line to give, so it uses the parenthesised form whenever the queue
  // would have drawn one — the same predicate, out of the same module.
  const detail = code('components/admin/partnerships/PartnershipDetail.tsx')
  assert.match(detail, /triageDeadlineText\(status\)/)
  assert.match(detail, /triage\.headerLineWithDeadline/)
})

test('#377 · the closed and not-started faces have no second line and no clock', () => {
  const closed = deriveTriageStatus(
    { approvedAt: APPROVED_AT, places: [{ published: true, refusal: null }] },
    hoursAfter(APPROVED_AT, 200)
  )
  assert.equal(triageDeadlineText(closed), null)
  assert.equal(triageDeadlineText({ kind: 'not_started' }), null)
  // `within` prints the instant in the first line, so a second one would print it twice.
  assert.equal(
    triageDeadlineText(
      deriveTriageStatus(
        { approvedAt: APPROVED_AT, places: [{ published: false, refusal: null }] },
        hoursAfter(APPROVED_AT, 24)
      )
    ),
    null
  )
})

test('#377 · BR-B2B-010 item 4: PUBLISHING stops the clock', () => {
  const status = deriveTriageStatus(
    { approvedAt: APPROVED_AT, places: [{ published: true, refusal: null }] },
    hoursAfter(APPROVED_AT, 200)
  )
  assert.equal(status.kind, 'closed')
  assert.equal(status.kind === 'closed' && status.by, 'published')
})

test('#377 · BR-B2B-010 item 4 · BR-B2B-011 item 5: only the COMMUNICATED refusal stops the clock', () => {
  const late = hoursAfter(APPROVED_AT, 100)

  // Decided and not communicated: the partner has not been told, so the promise is still open.
  // This is THE assertion of this suite — making it green by reading `decidedAt` would tell the
  // operator a partnership is closed while nobody has spoken to the partner.
  const decidedOnly = deriveTriageStatus(
    { approvedAt: APPROVED_AT, places: [{ published: false, refusal: refusal() }] },
    late
  )
  // `isTriageOverdue` and not one face of the ladder: what this asserts is that the promise is
  // still open, which is true whichever hour of lateness it is.
  assert.equal(isTriageOverdue(decidedOnly), true)

  const communicated = deriveTriageStatus(
    {
      approvedAt: APPROVED_AT,
      places: [{ published: false, refusal: refusal({ communicatedAt: '2026-08-17T09:00:00.000Z' }) }],
    },
    late
  )
  assert.equal(communicated.kind, 'closed')
  assert.equal(communicated.kind === 'closed' && communicated.by, 'refusal_communicated')
})

test('#377 · BR-B2B-033 item 3: with three places, the clock closes only when every one is resolved', () => {
  const late = hoursAfter(APPROVED_AT, 100)
  const told = refusal({ communicatedAt: '2026-08-17T09:00:00.000Z' })

  assert.equal(
    isTriageOverdue(
      deriveTriageStatus(
        {
          approvedAt: APPROVED_AT,
          places: [
            { published: true, refusal: null },
            { published: false, refusal: null },
          ],
        },
        late
      )
    ),
    true,
    'one address published does not answer for the other'
  )

  assert.equal(
    deriveTriageStatus(
      {
        approvedAt: APPROVED_AT,
        places: [
          { published: true, refusal: null },
          { published: false, refusal: told },
        ],
      },
      late
    ).kind,
    'closed'
  )
})

test('#377 · a partnership with no place yet still runs the clock', () => {
  // The triage of BR-B2B-010, item 3, has to produce an outcome even when nobody created the
  // place: "no place at all" is not a closed outcome, it is the work not started.
  const status = deriveTriageStatus({ approvedAt: APPROVED_AT, places: [] }, hoursAfter(APPROVED_AT, 100))
  assert.equal(isTriageOverdue(status), true)
})

// ── The refusal — BR-B2B-011 ──────────────────────────────────────────────────────────────────

test('#377 · BR-B2B-011 item 5: the refusal in force is the NEWEST, and the older rounds stay', () => {
  const first = refusal({ id: 'a0000000-0000-0000-0000-000000000001', decidedAt: '2026-08-16T09:00:00.000Z' })
  const second = refusal({ id: 'a0000000-0000-0000-0000-000000000002', decidedAt: '2026-08-20T09:00:00.000Z' })

  assert.equal(currentRefusal([first, second])?.id, second.id)
  assert.equal(currentRefusal([second, first])?.id, second.id)
  assert.equal(currentRefusal([]), null)
})

test('#377 · BR-B2B-011: the three gates are 1, 2 and 3 — and nothing else is a gate', () => {
  assert.deepEqual(TRIAGE_GATES, [1, 2, 3])
  for (const gate of TRIAGE_GATES) assert.equal(isTriageGate(gate), true)
  for (const other of [0, 4, -1, '1', 1.5, null, undefined, {}]) {
    assert.equal(isTriageGate(other), false, `${String(other)} is not a gate`)
  }
})

test('#377 · BR-B2B-011 item 4: every gate has a label, and none of them describes gate 3', () => {
  const triage = messages().Partnerships.triage
  const labels = TRIAGE_GATES.map((gate) => triage.gates[String(gate)] as string)

  for (const label of labels) assert.equal(typeof label, 'string')
  assert.equal(new Set(labels).size, 3, 'three gates, three distinct labels')

  // BR-B2B-011, item 6, and criterion 32: the copy never describes gate 3. The internal screen
  // has to NAME it — the refusal says which gate refused (item 4) — and naming is not describing:
  // the two motives the rule gives it ("falta de legalização", "falta de fit com a marca") appear
  // nowhere.
  const copy = JSON.stringify(triage).toLowerCase()
  for (const forbidden of ['portão 3', 'portao 3', 'fit com a marca', 'legalização', 'legalizacao']) {
    assert.equal(copy.indexOf(forbidden), -1, `the copy must not say "${forbidden}"`)
  }
})

test('#377 · BR-B2B-011 item 4: the reason is required, and the copy says why', () => {
  const triage = messages().Partnerships.triage
  // "Não foi aprovado" is what the rule forbids, so the field that carries what was missing is
  // not optional and the hint says so.
  assert.match(triage.refuseReasonHint, /o que faltou/i)
  assert.match(triage.refuseReasonLabel, /o que faltou/i)
})

test('#377 · BR-B2B-010 item 4: registering and communicating are two acts, in copy and in route', () => {
  const triage = messages().Partnerships.triage

  // The screen says, where the operator clicks, that the decision tells nobody.
  assert.match(triage.refuseSeparateAct, /comunic/i)
  assert.match(triage.notCommunicated, /72 horas/)
  // And that the CMS sends nothing: there is no channel to the partner here, and a button called
  // `Já comuniquei` beside a system that quietly sends nothing is how a partner ends up untold.
  assert.match(triage.communicateBody, /não envia/i)

  // Comments stripped: this file EXPLAINS `communicated_at` at length, and a static ruler that
  // reads prose measures the prose (it has caught this team out before).
  const register = code(
    'app/api/admin/partnerships/clients/[clientId]/places/[attractionId]/triage-refusal/route.ts'
  )
  assert.equal(
    register.indexOf('communicated_at'),
    -1,
    'the act that registers the refusal must not stamp the communication'
  )
  const insert = code('lib/core/triage-refusal-service.ts')
  assert.match(insert, /\.insert\(\{\s*attraction_id: input\.attractionId,/)
  assert.equal(
    /\.insert\(\{[^}]*communicated_at/.test(insert),
    false,
    'the INSERT carries four columns, and the fifth is the one a separate act writes'
  )

  const communicate = read(
    'app/api/admin/partnerships/clients/[clientId]/places/[attractionId]/triage-refusal/communicate/route.ts'
  )
  assert.match(communicate, /markCommunicated/)
})

test('#377 · BR-B2B-011 item 5: a failed refusal is never offered `Tente de novo`', () => {
  const triage = messages().Partnerships.triage as Record<string, string>

  // The two failures are different facts and the copy says opposite things about them. A 4xx is
  // the route answering before it wrote: the criterion or the reason has to change, and repeating
  // is safe. Not knowing is the other one, and there repeating creates a SECOND row in an
  // append-only table — the guard `TGB11` stops a refusal from being rewritten, never from being
  // written twice.
  assert.equal(triage.refuseFailed, undefined, 'the ambiguous single message is gone')
  assert.match(triage.refuseRejected, /nada foi registrado/i)
  assert.match(triage.refuseRejected, /registre de novo/i)
  assert.match(triage.refuseUnknownTitle, /não sabemos/i)
  assert.match(triage.refuseUnknownBody, /duas recusas/i)

  // `Tente de novo` belongs to acts that are safe to repeat. Publishing is one (the same place
  // published twice is the same state); the communication is another (write-once by `refusalId`).
  // The refusal is not, and neither of its two messages may say it.
  for (const key of ['refuseRejected', 'refuseUnknownTitle', 'refuseUnknownBody']) {
    assert.equal(/tente de novo/i.test(triage[key]), false, `${key} must not offer a blind retry`)
  }
  assert.match(triage.communicateFailed, /tente de novo/i, 'that UPDATE IS write-once per refusal')

  // And the panel behaves the way the copy says: the unknown case hands the screen back instead of
  // leaving the button that produced it on screen.
  const panel = code('components/admin/partnerships/TriageRefusalPanel.tsx')
  assert.match(panel, /onRefusalUnknown\(\)/)
  assert.equal(panel.indexOf('triage.refuseFailed'), -1)

  // The two outcomes are told apart by the STATUS, and only a 4xx is "nothing was written": the
  // 503 of `write_failed` is a write whose fate we do not know.
  const detail = code('components/admin/partnerships/PartnershipDetail.tsx')
  assert.match(detail, /response\.status >= 400 && response\.status < 500 \? 'refused' : 'failed'/)
})

test('#377 · the write-once stamp is decided by the DATABASE, not by an `if`', () => {
  const service = read('lib/core/triage-refusal-service.ts')

  // `communicated_at IS NULL` in the UPDATE plus rows-affected is what settles two operators
  // clicking at the same time. Reading first and writing after would stamp it twice.
  assert.match(service, /\.is\('communicated_at', null\)/)
  assert.match(service, /rows\.length > 0/)

  // The refusal itself is never rewritten: no DELETE verb is granted and the guard refuses any
  // UPDATE of the decision (BR-B2B-011, item 5).
  assert.equal(service.indexOf('.delete('), -1, 'append-only: there is no delete here')
})

// ── The terminal state — criterion 33 ────────────────────────────────────────────────────────

test('#377 crit. 33 · BR-B2B-010 6th edge case · BR-B2B-027 item 3: the terminal state is not an ending', () => {
  const states = messages().Partnerships.states as Record<string, string>
  assert.equal(states.refused_at_triage, 'Recusado na triagem')
  assert.equal(messages().Partnerships.triage.partnershipContinues, 'A parceria continua.')

  // It is terminal — it is not work, so it never shows up under the default filter (criterion 4)
  // — and it is filterable by name.
  assert.equal(TERMINAL_STATES.indexOf('refused_at_triage') >= 0, true)
  assert.equal(IN_PROGRESS_STATES.indexOf('refused_at_triage'), -1)
  assert.equal(PIPELINE_STATES.indexOf('refused_at_triage') >= 0, true)

  // The line is rendered by the screen, in the terminal state, and by the panel where the
  // decision is taken — not in a footnote afterwards.
  const detail = read('components/admin/partnerships/PartnershipDetail.tsx')
  assert.match(detail, /state === 'refused_at_triage'/)
  assert.match(detail, /triage\.partnershipContinues/)
  assert.match(read('components/admin/partnerships/TriageRefusalPanel.tsx'), /triage\.partnershipContinues/)
})

test('#377 crit. 33 · BR-B2B-027 item 3: nothing on the esteira offers to remove the partnership', () => {
  const copy = JSON.stringify(messages().Partnerships).toLowerCase()

  // Refusing a place ends nothing: the QR, the first-touch attribution and the revenue share
  // stay whole, and no published POI leaves the catalogue. There is no act on this surface that
  // could suggest otherwise.
  for (const forbidden of [
    'encerrar a parceria',
    'remover a parceria',
    'cancelar a parceria',
    'excluir a parceria',
    'desfazer a parceria',
    'tirar do catálogo',
  ]) {
    assert.equal(copy.indexOf(forbidden), -1, `the copy must not offer "${forbidden}"`)
  }

  // And it says the opposite, in the panel where the operator is about to refuse.
  assert.match(messages().Partnerships.triage.refuseBody, /a parceria continua/i)
})

test('#377 · BR-B2B-011: the refusal writes ONE table, and reaches neither the client nor the place', () => {
  const service = read('lib/core/triage-refusal-service.ts')
  const route = read(
    'app/api/admin/partnerships/clients/[clientId]/places/[attractionId]/triage-refusal/route.ts'
  )

  // BR-B2B-010, 6th edge case, and BR-B2B-027, item 3, in the only form that survives a future
  // commit: there is no path from here to `core.clients` or to `core.attractions`.
  for (const forbidden of ["from('clients')", "from('attractions')", 'setApproved', 'setCoordinate']) {
    assert.equal(service.indexOf(forbidden), -1, `the refusal service must not reach ${forbidden}`)
    assert.equal(route.indexOf(forbidden), -1, `the refusal route must not reach ${forbidden}`)
  }
})

// ── The pipeline state ───────────────────────────────────────────────────────────────────────

test('#377 · the state of a refused place: decided AND not in the app', () => {
  assert.equal(isRefusedAtTriage({ published: false, refusal: refusal() }), true)
  assert.equal(isRefusedAtTriage({ published: false, refusal: null }), false)
  // Refused, corrected and published IS published — BR-B2B-011, item 5, describes that round
  // trip, and the refusal on the record is history, not the current state.
  assert.equal(isRefusedAtTriage({ published: true, refusal: refusal() }), false)
})

test('#377 · a partnership whose every place was refused AND communicated is `Recusado na triagem`', () => {
  const base = {
    proposalStatus: 'promoted' as const,
    conference: EMPTY_CONFERENCE,
    clientId: CLIENT_ID,
    contractSigned: true,
    // Every case below is a refusal the partner was already told about: without this, the state is
    // `Recusa não comunicada` and the next test is the one that says so.
    uncommunicatedRefusal: false,
  }

  assert.equal(
    derivePipelineState({ ...base, placeCount: 1, publishedPlaceCount: 0, refusedPlaceCount: 1 }),
    'refused_at_triage'
  )

  // One of two refused and the other still in curation: there is work left, and the row belongs
  // in the work queue rather than in a terminal state.
  assert.equal(
    derivePipelineState({ ...base, placeCount: 2, publishedPlaceCount: 0, refusedPlaceCount: 1 }),
    'place_in_curation'
  )

  // One published and one refused: the partnership delivered an address. `Publicado` wins,
  // because there IS a place in front of tourists.
  assert.equal(
    derivePipelineState({ ...base, placeCount: 2, publishedPlaceCount: 1, refusedPlaceCount: 1 }),
    'published'
  )

  // Absent `refusedPlaceCount` behaves exactly as before this card.
  assert.equal(
    derivePipelineState({ ...base, placeCount: 1, publishedPlaceCount: 0 }),
    'place_in_curation'
  )
})

// ── The two states of the refusal — DS-COPY-020, point 5 ─────────────────────────────────────

test('#377 · DS-COPY-020 point 5: a refusal nobody communicated is WORK, and it beats `published`', () => {
  const base = {
    proposalStatus: 'promoted' as const,
    conference: EMPTY_CONFERENCE,
    clientId: CLIENT_ID,
    contractSigned: true,
  }

  // The row `design` measured: one place, refused, not communicated. It used to derive
  // `refused_at_triage` and leave the default filter owing the communication.
  assert.equal(
    derivePipelineState({
      ...base,
      placeCount: 1,
      publishedPlaceCount: 0,
      refusedPlaceCount: 1,
      uncommunicatedRefusal: true,
    }),
    'refusal_not_communicated'
  )

  // Two places, one published and one refused without the communication: the state used to be
  // `Publicado`, which is also outside the default filter. An act owed to somebody outside the
  // company outranks anything the pipeline knows about itself.
  assert.equal(
    derivePipelineState({
      ...base,
      placeCount: 2,
      publishedPlaceCount: 1,
      refusedPlaceCount: 1,
      uncommunicatedRefusal: true,
    }),
    'refusal_not_communicated'
  )

  // And it is WORK: in the default filter, with a next step in the infinitive, and not terminal.
  assert.equal(IN_PROGRESS_STATES.indexOf('refusal_not_communicated') >= 0, true)
  assert.equal(TERMINAL_STATES.indexOf('refusal_not_communicated'), -1)
  assert.equal(PIPELINE_STATES.indexOf('refusal_not_communicated') >= 0, true)

  const pt = messages().Partnerships
  assert.equal(pt.states.refusal_not_communicated, 'Recusa não comunicada')
  assert.equal(pt.nextSteps.refusal_not_communicated, 'Comunicar a recusa ao parceiro')
  assert.equal(pt.nextSteps.refused_at_triage, '—', 'the terminal one owes nothing')
})

test('#377 · DS-COPY-020 point 5: `hasUncommunicatedRefusal` is the one reading of "was the partner told"', () => {
  const told = refusal({ communicatedAt: '2026-08-17T09:00:00.000Z' })

  assert.equal(hasUncommunicatedRefusal([{ published: false, refusal: refusal() }]), true)
  assert.equal(hasUncommunicatedRefusal([{ published: false, refusal: told }]), false)
  assert.equal(hasUncommunicatedRefusal([{ published: false, refusal: null }]), false)
  assert.equal(hasUncommunicatedRefusal([]), false)

  // ANY place is enough — one published address does not answer for the refusal of another.
  assert.equal(
    hasUncommunicatedRefusal([
      { published: true, refusal: null },
      { published: false, refusal: refusal() },
    ]),
    true
  )

  // A place refused, corrected and PUBLISHED does not count, for the same reason it closes the
  // clock and `isRefusedAtTriage` ignores it: the outcome the partner was promised happened, and
  // `PlaceBand` offers no control to communicate the refusal of a published place — a next step
  // with no control on the screen would be a worse defect than the one this fixes.
  assert.equal(hasUncommunicatedRefusal([{ published: true, refusal: refusal() }]), false)
})

/**
 * THE COROLLARY OF DS-COPY-020, POINT 5, and it is the one assertion that would have caught the
 * whole defect: if `{n} com a triagem vencida` counts a row, clicking it has to show that row.
 *
 * The counter scans every row and the table renders the default filter, so the guarantee is
 * `isTriageOverdue(status) ⇒ IN_PROGRESS_STATES.includes(state)`. It is asserted over the two pure
 * modules and over every combination of place outcomes, not over the component — a counter taught
 * to read the filtered list would make the symptom disappear and leave the row hidden.
 */
test('#377 · DS-COPY-020 point 5: the overdue counter and the default filter cannot disagree', () => {
  const told = refusal({ communicatedAt: '2026-08-17T09:00:00.000Z' })
  const outcomes: Record<string, PlaceTriageOutcome> = {
    pending: { published: false, refusal: null },
    published: { published: true, refusal: null },
    refusedTold: { published: false, refusal: told },
    refusedSilent: { published: false, refusal: refusal() },
  }
  const names = Object.keys(outcomes)
  const now = hoursAfter(APPROVED_AT, 200)

  // Every partnership of zero, one or two places, over the four outcomes a place can be in.
  const combinations: string[][] = [[]]
  for (const first of names) {
    combinations.push([first])
    for (const second of names) combinations.push([first, second])
  }

  for (const combination of combinations) {
    const places = combination.map((name) => outcomes[name])
    const status = deriveTriageStatus({ approvedAt: APPROVED_AT, places }, now)
    if (!isTriageOverdue(status)) continue

    const state = derivePipelineState({
      // `discarded` is excluded because it is unreachable with an approved client:
      // `discardProposal` updates only rows with `status = 'submitted'`, so a promoted proposal
      // cannot be discarded and a partnership with no client has no `approved_at` to be late from.
      proposalStatus: 'promoted',
      conference: EMPTY_CONFERENCE,
      clientId: CLIENT_ID,
      contractSigned: true,
      placeCount: places.length,
      publishedPlaceCount: places.filter((place) => place.published).length,
      refusedPlaceCount: places.filter(isRefusedAtTriage).length,
      uncommunicatedRefusal: hasUncommunicatedRefusal(places),
    })

    assert.equal(
      IN_PROGRESS_STATES.indexOf(state) >= 0,
      true,
      `[${combination.join(', ')}] is overdue and derives ${state}, which the default filter hides`
    )
  }
})

test('#377 · the refused row opens the CLIENT detail, where the refusal is', () => {
  // The client detail is a tab of the record now; the refusal is still band 4, unmoved.
  assert.equal(
    detailPath('refused_at_triage', { submissionId: 'sub-1', clientId: CLIENT_ID }),
    `/admin/clients?clientId=${CLIENT_ID}&tab=partnership`
  )
})

// ── The column, in the list ──────────────────────────────────────────────────────────────────
//
// The queue was retired: `ClientDirectory` is the one list now, and the column moved to it
// unchanged. What these three assert is unchanged too — the column is text, it reads the pure
// module, and one `now` serves the whole table.

test('#377 crit. 6 · DS-A11Y-003: the column is TEXT, and the list reads it from the pure module', () => {
  const queue = read('components/admin/clients/ClientDirectory.tsx')

  assert.match(queue, /columns\.triage/, 'the column has a header')
  assert.match(queue, /triageText\(/, 'and its cell is text')
  assert.match(queue, /deriveTriageStatus\(/)

  // One `now` for the whole table: two rows approved in the same minute must not disagree about
  // the deadline because they rendered milliseconds apart, and the counter above the table has to
  // count exactly the rows the column marks.
  assert.match(queue, /const now = new Date\(\)/)

  // The overdue rows come first (spec §6.1) — a broken 72-hour promise outranks a slow row.
  // The sort moved to the pure module with the rest of the list's decisions; the screen renders
  // what it returns, which is why the assertion follows it there.
  assert.match(read('lib/clients/directory-filter.ts'), /isTriageOverdue/)
  assert.match(
    read('lib/clients/directory-filter.ts'),
    /if \(lateA !== lateB\) return lateA \? -1 : 1/,
    'a broken promise sorts above a longer idle row'
  )
  assert.match(messages().Partnerships.queue.overdueCount, /triagem vencida/)

  // The same text function serves the detail header, so the list and the detail cannot disagree
  // about a promise made to a partner.
  assert.match(read('components/admin/partnerships/PartnershipDetail.tsx'), /triageText\(/)
})

test('#377 crit. 6 · DS-COPY-025 point 5: the cell draws the second line, in text and not in `title`', () => {
  const queue = code('components/admin/clients/ClientDirectory.tsx')

  // The instant of the deadline is rendered as a sibling line in `text-xs`, exactly the pair the
  // `Parado há` column next door already uses. A `title` attribute does not reach the keyboard, and
  // here the instant is the record of what was promised to a partner.
  assert.match(queue, /triageDeadlineText\(status\)/)
  assert.match(queue, /\{deadline && \(/)
  assert.match(queue, /className="block text-xs text-gray-500 dark:text-gray-400">\s*\{deadline\}/)
})

test('#377 · DS-COPY-020 point 2: the row that owes the communication says so in `O que falta`', () => {
  const queue = code('components/admin/clients/ClientDirectory.tsx')

  // A refused place keeps its curation pendencies, and `whatIsMissing` prefers those counts to the
  // next step. For this state it must not: the work of the row is the act owed to the partner, and
  // `2 pendências que bloqueiam` would answer a question nobody is asking.
  assert.match(queue, /row\.state === 'refusal_not_communicated'/)
  assert.match(queue, /return p\('nextSteps\.refusal_not_communicated'\)/)
})
