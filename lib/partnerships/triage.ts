/**
 * The 72-hour clock of the partner-place triage, and the refusal that stops it — BR-B2B-010,
 * item 4, and BR-B2B-011.
 *
 * WHAT THE RULE PROMISES, literally: in up to **72 straight hours** counted from the APPROVAL
 * OF THE PARTNERSHIP (`core.clients.approved_at`), either the place is published or the refusal
 * was COMMUNICATED to the partner. Holidays and weekends do not stop it (BR-B2B-010, 5th edge
 * case). It is a promise published to the partner, which is why the queue shows it in TEXT and
 * never in colour alone (DS-A11Y-003).
 *
 * THE ORDER OF READING IS PART OF THE RULE, not a rendering preference: published first
 * (`core.attractions.approved`), then the COMMUNICATED refusal, then the running clock. Reading
 * `decided_at` instead of `communicated_at` is the one mistake this module exists to prevent —
 * it would read "on time" for a partner nobody has told, and the `data` wrote that warning into
 * `COMMENT ON COLUMN core.partner_triage_refusals.communicated_at` on purpose.
 *
 * PURE, in the mould of `place-readiness.ts` and for the same reason: the queue column, the
 * detail header and the terminal state all call this, so the three cannot disagree about
 * whether a partnership is late (DS-COMPONENTE-020, point 4).
 *
 * A REGISTERED REFUSAL AND A COMMUNICATED ONE ARE DIFFERENT FACTS, and they answer different
 * questions:
 *  · the terminal state `Recusado na triagem` follows the REGISTERED refusal — that is what the
 *    triage decided, and BR-B2B-011's preamble is explicit that the decision is human;
 *  · the CLOCK only stops on the COMMUNICATED one — BR-B2B-010, item 4, says "or the refusal
 *    was communicated", and BR-B2B-011, item 5, repeats it ("a recusa comunicada encerra o
 *    prazo").
 * So a partnership can be in the terminal state AND still show a running or overdue clock: the
 * decision was taken and the partner has not been told. That is the design, not a broken row,
 * and it is exactly the state the operator has to see in order to close it. Spec §3.1 lists
 * `encerrado` as `—` "a linha já está em Publicado ou Recusado na triagem"; where the spec and
 * the rule differ, the rule wins (CLAUDE.md §1), and the divergence went back to `design` on
 * card #377.
 */

/** BR-B2B-010, item 4. The only place this number exists in the CMS. */
export const TRIAGE_DEADLINE_HOURS = 72

/**
 * How close to the deadline `vence hoje` replaces `até …` — spec §3.1, and it is the `design`'s
 * threshold, not a rule. Named here because a literal `12` inside a comparison is the kind of
 * number that gets a second value somewhere else.
 */
export const TRIAGE_DUE_SOON_HOURS = 12

const HOUR_MS = 3_600_000
const DAY_MS = 86_400_000

/**
 * Which of the three gates of BR-B2B-011 refused, in the order the rule numbers them. A number
 * and not a vocabulary, because the taxonomy belongs to the rule — the same decision
 * `core.partner_triage_refusals.gate` is documented with.
 */
export type TriageGate = 1 | 2 | 3

export const TRIAGE_GATES: TriageGate[] = [1, 2, 3]

export function isTriageGate(value: unknown): value is TriageGate {
  return value === 1 || value === 2 || value === 3
}

/**
 * One row of `core.partner_triage_refusals`, as a screen may see it.
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

export type TriageStatus =
  /** No `approved_at` on the client: the clock has not started (spec §3.1, 4th row). */
  | { kind: 'not_started' }
  /** Both outcomes of BR-B2B-010, item 4, are outcomes — and both stop the clock. */
  | { kind: 'closed'; by: 'published' | 'refusal_communicated' }
  | { kind: 'within'; deadline: string }
  | { kind: 'due_today'; deadline: string }
  | { kind: 'overdue'; deadline: string; days: number }

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
  /** `core.clients.approved_at` — the transition of BR-B2B-003, and nothing else. */
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
    // Whole 24-hour periods past the deadline, the same convention `Parado há` uses in the
    // column next door. `daysUntil` cannot serve here: it parses a DATE-ONLY string in UTC, and
    // this deadline is an instant whose HOUR the copy shows.
    return { kind: 'overdue', deadline, days: Math.floor(-remaining / DAY_MS) }
  }
  if (remaining <= TRIAGE_DUE_SOON_HOURS * HOUR_MS) return { kind: 'due_today', deadline }
  return { kind: 'within', deadline }
}

/** Whether the queue should count this row in `{n} com a triagem vencida`. */
export function isTriageOverdue(status: TriageStatus): boolean {
  return status.kind === 'overdue'
}
