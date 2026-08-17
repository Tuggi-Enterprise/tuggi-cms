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
 *  · letting the refusal route write `communicated_at` in the same call;
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
  isRefusedAtTriage,
  isTriageGate,
  isTriageOverdue,
  triageDeadline,
  type TriageRefusal,
} from '@/lib/partnerships/triage'
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

test('#377 crit. 6 · BR-B2B-010 item 4: 80 hours after the approval, an unpublished place is OVERDUE', () => {
  const status = deriveTriageStatus(
    { approvedAt: APPROVED_AT, places: [{ published: false, refusal: null }] },
    hoursAfter(APPROVED_AT, 80)
  )

  assert.equal(status.kind, 'overdue')
  assert.equal(isTriageOverdue(status), true)
  assert.equal(status.kind === 'overdue' && status.deadline, '2026-08-18T10:32:00.000Z')
  // 80 hours from the approval is 8 hours past a 72-hour deadline, so the whole-day count is
  // zero and the copy reads `venceu hoje`. Criterion 6 pastes §3.1's example (`venceu há 2
  // dias`) next to its 80 hours; the two do not add up, and the arithmetic is what the partner
  // was promised — the question went back to `design` on the card.
  assert.equal(status.kind === 'overdue' && status.days, 0)
})

test('#377 · spec §3.1: two days past the deadline is `venceu há 2 dias`, and the plural is ICU', () => {
  const status = deriveTriageStatus(
    { approvedAt: APPROVED_AT, places: [{ published: false, refusal: null }] },
    hoursAfter(APPROVED_AT, 72 + 48)
  )
  assert.equal(status.kind === 'overdue' && status.days, 2)

  const copy = messages().Partnerships.triage.overdue as string
  assert.match(copy, /=0 \{venceu hoje\}/, 'under a day past is not "venceu há 0 dias"')
  assert.match(copy, /one \{venceu há # dia\}/)
  assert.match(copy, /other \{venceu há # dias\}/)
})

test('#377 · spec §3.1: inside the deadline it reads `até 18/08, 10h32`, hour included', () => {
  const status = deriveTriageStatus(
    { approvedAt: APPROVED_AT, places: [{ published: false, refusal: null }] },
    hoursAfter(APPROVED_AT, 24)
  )
  assert.equal(status.kind, 'within')

  // The hour is not decoration: 72 hours from 10h32 expire at 10h32, and a date alone would tell
  // the operator he has the whole day.
  assert.equal(messages().Partnerships.triage.within, 'até {deadline}')
  assert.match(formatDeadline('2026-08-18T13:32:00.000Z'), /^18\/08, \d{2}h\d{2}$/)
  assert.match(formatClockTime('2026-08-18T13:32:00.000Z'), /^\d{2}h\d{2}$/)
  assert.equal(formatDeadline(null), '—')
})

test('#377 · spec §3.1: under twelve hours left it reads `vence hoje`', () => {
  const facts = { approvedAt: APPROVED_AT, places: [{ published: false, refusal: null }] }

  assert.equal(TRIAGE_DUE_SOON_HOURS, 12)
  assert.equal(deriveTriageStatus(facts, hoursAfter(APPROVED_AT, 59)).kind, 'within')
  assert.equal(deriveTriageStatus(facts, hoursAfter(APPROVED_AT, 61)).kind, 'due_today')
  // The last instant before it expires is still not overdue.
  assert.equal(deriveTriageStatus(facts, hoursAfter(APPROVED_AT, 72)).kind, 'due_today')
  assert.equal(messages().Partnerships.triage.dueToday, 'vence hoje, {time}')
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
  assert.equal(decidedOnly.kind, 'overdue')

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
    deriveTriageStatus(
      {
        approvedAt: APPROVED_AT,
        places: [
          { published: true, refusal: null },
          { published: false, refusal: null },
        ],
      },
      late
    ).kind,
    'overdue',
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
  assert.equal(status.kind, 'overdue')
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

test('#377 · a partnership whose every place was refused is `Recusado na triagem`', () => {
  const base = {
    proposalStatus: 'promoted' as const,
    conference: EMPTY_CONFERENCE,
    clientId: CLIENT_ID,
    contractSigned: true,
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

test('#377 · the refused row opens the CLIENT detail, where the refusal is', () => {
  assert.equal(
    detailPath('refused_at_triage', { submissionId: 'sub-1', clientId: CLIENT_ID }),
    `/admin/partnerships/clients/${CLIENT_ID}`
  )
})

// ── The column, in the queue ─────────────────────────────────────────────────────────────────

test('#377 crit. 6 · DS-A11Y-003: the column is TEXT, and the queue reads it from the pure module', () => {
  const queue = read('components/admin/partnerships/PartnershipsQueue.tsx')

  assert.match(queue, /queue\.columns\.triage/, 'the column has a header')
  assert.match(queue, /triageText\(/, 'and its cell is text')
  assert.match(queue, /deriveTriageStatus\(/)

  // One `now` for the whole table: two rows approved in the same minute must not disagree about
  // the deadline because they rendered milliseconds apart, and the counter above the table has to
  // count exactly the rows the column marks.
  assert.match(queue, /const now = new Date\(\)/)

  // The overdue rows come first (spec §6.1) — a broken 72-hour promise outranks a slow row.
  assert.match(queue, /isTriageOverdue/)
  assert.match(messages().Partnerships.queue.overdueCount, /triagem vencida/)

  // The same text function serves the detail header, so the list and the detail cannot disagree
  // about a promise made to a partner.
  assert.match(read('components/admin/partnerships/PartnershipDetail.tsx'), /triageText\(/)
})
