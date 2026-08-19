/**
 * The 72-hour clock of the partner-place triage, and the refusal that stops it — BR-B2B-010,
 * item 4, and BR-B2B-011.
 *
 * WHAT THE RULE PROMISES, literally: in up to **72 straight hours** counted from the APPROVAL
 * OF THE PARTNERSHIP (`partner.clients.approved_at`), either the place is published or the refusal
 * was COMMUNICATED to the partner. Holidays and weekends do not stop it (BR-B2B-010, 5th edge
 * case). It is a promise published to the partner, which is why the queue shows it in TEXT and
 * never in colour alone (DS-A11Y-003).
 *
 * THE ORDER OF READING IS PART OF THE RULE, not a rendering preference: published first
 * (`core.attractions.approved`), then the COMMUNICATED refusal, then the running clock. Reading
 * `decided_at` instead of `communicated_at` is the one mistake this module exists to prevent —
 * it would read "on time" for a partner nobody has told, and the `data` wrote that warning into
 * `COMMENT ON COLUMN partner.partner_triage_refusals.communicated_at` on purpose.
 *
 * PURE, in the mould of `place-readiness.ts` and for the same reason: the queue column, the
 * detail header and the terminal state all call this, so the three cannot disagree about
 * whether a partnership is late (DS-COMPONENTE-020, point 4).
 *
 * A REGISTERED REFUSAL AND A COMMUNICATED ONE ARE DIFFERENT FACTS, and they answer different
 * questions:
 *  · the CLOCK only stops on the COMMUNICATED one — BR-B2B-010, item 4, says "or the refusal
 *    was communicated", and BR-B2B-011, item 5, repeats it ("a recusa comunicada encerra o
 *    prazo");
 *  · the registered-and-not-communicated refusal is its own PIPELINE STATE, `Recusa não
 *    comunicada`, and it is work — `hasUncommunicatedRefusal` is what the pipeline reads for it
 *    (DS-COPY-020, point 5). The terminal `Recusado na triagem` comes only after the
 *    communication.
 * A row can therefore show a running or overdue clock while its refusal is already decided: the
 * decision was taken and the partner has not been told. That is exactly the state the operator
 * has to see in order to close it, and `design` closed the spec divergence of #377 by putting
 * that fact in the `Estado` column instead of ending the clock (spec §3.1, revised).
 *
 * THE FACES OF THE CLOCK ARE SIX, AND EVERY ONE IS A CONTA — DS-COPY-025. Whole hours (`floor`)
 * under a day either side of the deadline, whole 24-hour periods beyond that, and the band below
 * the unit is NAMED (`menos de 1 h`) rather than rounded to zero. No face of this clock is a
 * calendar word: `hoje` derived from an INSTANT lies whenever the window crosses midnight, which
 * is DS-COPY-025, point 3, and is why `due_today` no longer exists.
 */

/** BR-B2B-010, item 4. The only place this number exists in the CMS. */
export const TRIAGE_DEADLINE_HOURS = 72

/**
 * How close to the deadline the relative counter (`faltam 8 h`) replaces the absolute instant
 * (`até 18/08, 10h32`) — spec §3.1 and DS-COPY-025, points 1 and 2. It is the `design`'s
 * threshold, not a rule. Named here because a literal `12` inside a comparison is the kind of
 * number that gets a second value somewhere else.
 */
export const TRIAGE_DUE_SOON_HOURS = 12

const HOUR_MS = 3_600_000
const DAY_MS = 86_400_000

/**
 * Which of the three gates of BR-B2B-011 refused, in the order the rule numbers them. A number
 * and not a vocabulary, because the taxonomy belongs to the rule — the same decision
 * `partner.partner_triage_refusals.gate` is documented with.
 */
export type TriageGate = 1 | 2 | 3

export const TRIAGE_GATES: TriageGate[] = [1, 2, 3]

export function isTriageGate(value: unknown): value is TriageGate {
  return value === 1 || value === 2 || value === 3
}

/**
 * One row of `partner.partner_triage_refusals`, as a screen may see it.
 *
 * `decidedBy` is NOT here: the column is an `auth.users(id)`, and a uuid is not something to
 * put in front of an operator. The service resolves it into `decidedByLabel` with the same
 * lookup the rest of the pipeline uses, and it fails to null rather than printing an id.
 */
export interface TriageRefusal {
  id: string
  attractionId: string
  /**
   * Null only for a row the CHECK constraint cannot produce — see `toRefusal`. The screen then
   * shows the reason without naming a gate, rather than naming the wrong one.
   */
  gate: TriageGate | null
  /** What was missing, in the words communicated to the partner — BR-B2B-011, item 4. */
  reason: string
  decidedAt: string
  decidedByLabel: string | null
  /** THE stamp that stops the clock. Null means decided and not yet told. */
  communicatedAt: string | null
}

/**
 * One place of the partnership, reduced to what the clock needs — the two stamps and nothing
 * else. A full `TriageRefusal` satisfies it, and the queue can build it without resolving the
 * operator's name for every row of a 500-row list.
 */
export interface PlaceTriageOutcome {
  /** `PlaceReadiness.published` — the visibility predicate of the place's own `entity_kind`. */
  published: boolean
  /** The refusal in force, if any. Many rows per place is by design (BR-B2B-011, item 5). */
  refusal: Pick<TriageRefusal, 'decidedAt' | 'communicatedAt'> | null
}

/**
 * The eight faces of the clock — six of them relative, and every relative one carries the
 * `deadline` so the screen can print the absolute instant beside it (DS-COPY-025, point 5).
 *
 * `hours` and `days` are the CONTA and never an example: the copy interpolates them, and the
 * only place they are computed is `deriveTriageStatus`.
 */
export type TriageStatus =
  /** No `approved_at` on the client: the clock has not started (spec §3.1, 4th row). */
  | { kind: 'not_started' }
  /** Both outcomes of BR-B2B-010, item 4, are outcomes — and both stop the clock. */
  | { kind: 'closed'; by: 'published' | 'refusal_communicated' }
  /** More than `TRIAGE_DUE_SOON_HOURS` left: the absolute instant, because the act is to plan. */
  | { kind: 'within'; deadline: string }
  /** 1 h to `TRIAGE_DUE_SOON_HOURS` left, in whole hours. */
  | { kind: 'due_soon'; deadline: string; hours: number }
  /** Under an hour left. Named, never rounded to zero (DS-COPY-025, point 4). */
  | { kind: 'due_last_hour'; deadline: string }
  /** Under an hour past the deadline. The other half of point 4. */
  | { kind: 'overdue_first_hour'; deadline: string }
  /** 1 h to 23 h past, in whole hours. */
  | { kind: 'overdue_hours'; deadline: string; hours: number }
  /** 24 h or more past, in whole 24-hour periods — the convention `Parado há` uses next door. */
  | { kind: 'overdue_days'; deadline: string; days: number }

/**
 * The refusal in force for a place: the one with the greatest `decided_at`.
 *
 * The table is append-only and keeps every round, because re-applying reopens the triage
 * (BR-B2B-011, item 5). The current one is the newest; the older ones are the history of what
 * was told to the partner and are never rewritten (the `TGB11` guard).
 */
export function currentRefusal(refusals: TriageRefusal[]): TriageRefusal | null {
  let current: TriageRefusal | null = null
  for (const refusal of refusals) {
    if (current === null || refusal.decidedAt > current.decidedAt) current = refusal
  }
  return current
}

/** `approved_at` + 72 straight hours, as an ISO instant. Null when there is no approval yet. */
export function triageDeadline(approvedAt: string | null): string | null {
  if (!approvedAt) return null
  const approved = new Date(approvedAt)
  if (Number.isNaN(approved.getTime())) return null
  return new Date(approved.getTime() + TRIAGE_DEADLINE_HOURS * HOUR_MS).toISOString()
}

/**
 * A place is `Recusado na triagem` when a refusal is on the record and the place is not in the
 * app — the derivation the `data` wrote down for this card. Publishing wins over a refusal on
 * purpose: a place that was refused, corrected and published IS published, and BR-B2B-011,
 * item 5, describes exactly that round trip.
 */
export function isRefusedAtTriage(place: PlaceTriageOutcome): boolean {
  return !place.published && place.refusal !== null
}

/**
 * The facts the clock is derived from, and they are the facts as the database has them — the
 * derivation happens where it is rendered, so the column does not go stale on a screen somebody
 * left open (the same reason `Parado há` counts its days in the component).
 */
export interface TriageFacts {
  /** `partner.clients.approved_at` — the transition of BR-B2B-003, and nothing else. */
  approvedAt: string | null
  /** Every place of the partnership. A partnership with no place has no triage to run yet. */
  places: PlaceTriageOutcome[]
}

export function deriveTriageStatus(facts: TriageFacts, now: Date = new Date()): TriageStatus {
  const { approvedAt, places } = facts

  // Outcome first, clock second — a partnership whose places are all resolved is not late,
  // whatever the calendar says.
  if (places.length > 0) {
    const closed = places.every(
      (place) => place.published || place.refusal?.communicatedAt != null
    )
    if (closed) {
      return {
        kind: 'closed',
        by: places.every((place) => place.published) ? 'published' : 'refusal_communicated',
      }
    }
  }

  const deadline = triageDeadline(approvedAt)
  if (deadline === null) return { kind: 'not_started' }

  const remaining = new Date(deadline).getTime() - now.getTime()

  if (remaining < 0) {
    const late = -remaining
    // `daysUntil` cannot serve here: it parses a DATE-ONLY string in UTC, and this deadline is an
    // instant whose HOUR the copy shows.
    if (late < HOUR_MS) return { kind: 'overdue_first_hour', deadline }
    if (late < DAY_MS) return { kind: 'overdue_hours', deadline, hours: Math.floor(late / HOUR_MS) }
    return { kind: 'overdue_days', deadline, days: Math.floor(late / DAY_MS) }
  }

  if (remaining > TRIAGE_DUE_SOON_HOURS * HOUR_MS) return { kind: 'within', deadline }
  // The last hour before the deadline is not `faltam 0 h`, and the instant of the deadline itself
  // is still inside it: nothing has expired while `remaining` is zero.
  if (remaining < HOUR_MS) return { kind: 'due_last_hour', deadline }
  return { kind: 'due_soon', deadline, hours: Math.floor(remaining / HOUR_MS) }
}

/**
 * The three faces past the deadline. Listed once, because the queue counts the rows with it,
 * filters with it and sorts with it — and `{n} com a triagem vencida` counting one predicate
 * while the filter applies another is the defect DS-COPY-020, point 5, exists to forbid.
 */
const OVERDUE_KINDS: TriageStatus['kind'][] = [
  'overdue_first_hour',
  'overdue_hours',
  'overdue_days',
]

/** Whether the queue should count this row in `{n} com a triagem vencida`. */
export function isTriageOverdue(status: TriageStatus): boolean {
  return OVERDUE_KINDS.indexOf(status.kind) >= 0
}

/**
 * Whether this partnership owes the partner the communication of a refusal — the fact behind the
 * `Recusa não comunicada` state (DS-COPY-020, point 5).
 *
 * ANY place is enough: one address published does not answer for the refusal of another, so this
 * beats `published` in the pipeline's derivation. BR-B2B-010, item 4, promises the partner an
 * outcome he was TOLD about, and a decision nobody communicated is an act still owed to somebody
 * outside the company.
 *
 * IT IS THE SAME PREDICATE `deriveTriageStatus` CLOSES THE CLOCK WITH, negated — which is what
 * makes the counter of overdue rows and the queue's default filter unable to disagree. A place
 * that was refused, corrected and PUBLISHED does not count here for the same reason it closes
 * the clock and the same reason `isRefusedAtTriage` ignores it: the outcome the partner was
 * promised happened, and the screen offers no control to communicate the refusal of a published
 * place (`PlaceBand` renders the summary and `Registrar a comunicação` only for an unpublished
 * one). A next step with no control on the screen is a worse defect than the one this fixes.
 */
export function hasUncommunicatedRefusal(places: PlaceTriageOutcome[]): boolean {
  return places.some(
    (place) => !place.published && place.refusal !== null && place.refusal.communicatedAt === null
  )
}
