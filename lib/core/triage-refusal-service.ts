/**
 * `core.partner_triage_refusals` — the refusal outcome of the partner-place triage, read and
 * written by the pipeline. THE only module that touches that table.
 *
 * BR-B2B-011: the triage applies three gates, stops at the first that refuses, and the refusal
 * says WHICH gate refused and WHAT WAS MISSING (item 4). Nothing here decides anything: the
 * rule's preamble is explicit that no software turns a partner's place down, so this module
 * writes what a person decided and never derives a refusal.
 *
 * WHY `service_role` AND NOT THE OPERATOR'S CLIENT. The table has RLS enabled with zero
 * policies and only `service_role` holds SELECT/INSERT/UPDATE (migration
 * `20260816180000`, section 3) — asking with the operator's client answers "permission denied"
 * for every row, always. The identity of the person is not lost by that: it travels in
 * `decided_by`, which the route fills from the authenticated session and never from the body.
 *
 * THREE THINGS THE DATABASE GUARANTEES AND THIS MODULE THEREFORE DOES NOT RE-IMPLEMENT
 * (`core.tg_partner_triage_refusal_guard`, SQLSTATE `TGB11`):
 *  · the row is append-only — a refusal is corrected by a new triage round, never by editing
 *    the old one (BR-B2B-011, item 5);
 *  · `decided_by` is write-once;
 *  · `communicated_at` is write-once — it is what stops the 72h clock of BR-B2B-010, item 4,
 *    and moving it would un-stop a clock a partner was already told about.
 * `markCommunicated` narrows its UPDATE to `communicated_at IS NULL` and decides by ROWS
 * AFFECTED rather than by an `if` in JavaScript: two operators clicking at the same time is a
 * race only the database can settle.
 *
 * NOTHING HERE WRITES TO `core.clients` OR `core.attractions`. Refusing a place does not end the
 * partnership (BR-B2B-010, 6th edge case) and takes no POI out of the catalogue (BR-B2B-027,
 * item 3); a module that could reach either of those tables would be one commit away from doing
 * it.
 */

import { getSupabaseService } from '@/lib/core/supabase-client'
import type { TriageGate } from '@/lib/partnerships/triage'

const TABLE = 'partner_triage_refusals'

function core() {
  return getSupabaseService().schema('core')
}

/** The seven columns, as the table has them. `id` last is not an accident: it reads in order. */
const REFUSAL_COLUMNS = 'id, attraction_id, gate, reason, decided_by, decided_at, communicated_at'

export interface TriageRefusalRow {
  id: string
  attraction_id: string
  gate: number
  reason: string
  decided_by: string | null
  decided_at: string
  communicated_at: string | null
}

export type MarkCommunicatedOutcome = 'ok' | 'not_found' | 'already_communicated'

export const triageRefusalService = {
  /**
   * Every refusal of the given places, newest first. Every round, not just the current one:
   * re-applying reopens the triage (BR-B2B-011, item 5) and which one is in force is
   * `currentRefusal`'s decision, in the pure module, where it is testable.
   */
  async listByAttractions(attractionIds: string[]): Promise<Map<string, TriageRefusalRow[]>> {
    const map = new Map<string, TriageRefusalRow[]>()
    if (attractionIds.length === 0) return map

    const { data, error } = await core()
      .from(TABLE)
      .select(REFUSAL_COLUMNS)
      .in('attraction_id', attractionIds)
      .order('decided_at', { ascending: false })
    if (error) throw new Error(error.message)

    for (const row of (data ?? []) as unknown as TriageRefusalRow[]) {
      map.set(row.attraction_id, (map.get(row.attraction_id) ?? []).concat(row))
    }
    return map
  },

  /**
   * Register what the triage decided. `decided_at` is left to the column default so that the
   * instant is the database's and not a browser's clock, and `communicated_at` is NOT written
   * here — telling the partner is a separate act, by requirement of BR-B2B-010, item 4, whose
   * clock stops at the communication and not at the decision.
   */
  async register(input: {
    attractionId: string
    gate: TriageGate
    reason: string
    decidedBy: string | null
  }): Promise<TriageRefusalRow> {
    const { data, error } = await core()
      .from(TABLE)
      .insert({
        attraction_id: input.attractionId,
        gate: input.gate,
        reason: input.reason,
        decided_by: input.decidedBy,
      })
      .select(REFUSAL_COLUMNS)
      .single()
    if (error) throw new Error(error.message)
    return data as unknown as TriageRefusalRow
  },

  /**
   * Stamp the communication — the act that stops the clock of BR-B2B-010, item 4.
   *
   * Scoped by `attraction_id` as well as by id: the route is about one place, and a refusal of
   * another place is not this screen's to close.
   */
  async markCommunicated(
    refusalId: string,
    attractionId: string
  ): Promise<{ outcome: MarkCommunicatedOutcome; row: TriageRefusalRow | null }> {
    const { data, error } = await core()
      .from(TABLE)
      .update({ communicated_at: new Date().toISOString() })
      .eq('id', refusalId)
      .eq('attraction_id', attractionId)
      .is('communicated_at', null)
      .select(REFUSAL_COLUMNS)
    if (error) throw new Error(error.message)

    const rows = (data ?? []) as unknown as TriageRefusalRow[]
    if (rows.length > 0) return { outcome: 'ok', row: rows[0] }

    // Zero rows updated says "not this one" and nothing about why. The distinction matters to
    // the operator — a refusal already communicated is a job DONE, and a missing one is a
    // mistake — so it costs one read, and only on the path that failed.
    const { data: existing } = await core()
      .from(TABLE)
      .select(REFUSAL_COLUMNS)
      .eq('id', refusalId)
      .eq('attraction_id', attractionId)
      .limit(1)

    const found = ((existing ?? []) as unknown as TriageRefusalRow[])[0] ?? null
    if (!found) return { outcome: 'not_found', row: null }
    return { outcome: 'already_communicated', row: found }
  },
}
