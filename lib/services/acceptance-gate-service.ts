/**
 * The server side of the BR-B2B-057 gate: one read of `partner.client_acceptance_gate`
 * (service_role only, `docs/contracts/aceite-por-link.md` §6) for the board, the record and the
 * routes that create or publish a place.
 */

import { getSupabaseService } from '@/lib/core/supabase-client'
import {
  missingGateItems,
  type AcceptanceSource,
  type GateFacts,
  type GateItem,
} from '@/lib/partnerships/acceptance-gate'

interface GateRow {
  client_id: string
  slug: string | null
  partner_code: string | null
  accepted_at: string | null
  acceptance_source: string | null
}

const SOURCES: readonly AcceptanceSource[] = ['link', 'portal', 'signed_contract']

function toFacts(row: GateRow): GateFacts {
  const source = SOURCES.find((value) => value === row.acceptance_source) ?? null
  return {
    slug: row.slug,
    partnerCode: row.partner_code,
    acceptedAt: row.accepted_at,
    acceptanceSource: source,
  }
}

/** The gate of each client asked, or `null` when the read failed — the caller decides. */
export async function loadAcceptanceGate(clientIds: string[]): Promise<Map<string, GateFacts> | null> {
  const gate = new Map<string, GateFacts>()
  if (clientIds.length === 0) return gate
  const { data, error } = await getSupabaseService()
    .schema('partner')
    .rpc('client_acceptance_gate', { p_client_ids: clientIds })
  if (error) {
    console.error('[acceptance-gate] read failed', error.code)
    return null
  }
  for (const row of (data ?? []) as GateRow[]) gate.set(row.client_id, toFacts(row))
  return gate
}

export type GateCheck =
  | { ok: true }
  | { ok: false; httpStatus: 409; error: 'gate_missing'; missing: GateItem[] }
  | { ok: false; httpStatus: 503; error: 'gate_lookup_failed' }

/**
 * BR-B2B-057, item 3: the server refuses the transition, it does not only warn. Fails closed —
 * a read that did not answer is a refusal, never a pass.
 */
export async function checkAcceptanceGate(clientId: string): Promise<GateCheck> {
  const gate = await loadAcceptanceGate([clientId])
  if (!gate) return { ok: false, httpStatus: 503, error: 'gate_lookup_failed' }
  const missing = missingGateItems(gate.get(clientId))
  return missing.length === 0 ? { ok: true } : { ok: false, httpStatus: 409, error: 'gate_missing', missing }
}

/** The JSON body of a refusal — `{ error, missing? }`, the shape `use-board-acts` reads. */
export function gateRefusalBody(check: Exclude<GateCheck, { ok: true }>): { error: string; missing?: GateItem[] } {
  return check.error === 'gate_missing' ? { error: check.error, missing: check.missing } : { error: check.error }
}
