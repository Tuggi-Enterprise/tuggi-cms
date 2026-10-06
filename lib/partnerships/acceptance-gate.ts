/**
 * The gate of the Studio pipeline — BR-B2B-057, item 3.
 *
 * Entering `Local em curadoria` or `Publicado` needs the slug, the partner code (BR-B2B-058) and
 * the acceptance (BR-B2B-047 or 056, or a legacy contract already signed). The FACTS come from
 * one read, `partner.client_acceptance_gate` (`docs/contracts/aceite-por-link.md` §6), and this
 * module only names which of them are absent: the predicate itself is not recomputed here.
 *
 * Pure, so the board, the card and the server's refusal read the same list in the same order —
 * the order the copy prints them in (`o aceite`, `o código do parceiro`, `o slug`).
 */

export type GateItem = 'acceptance' | 'partner_code' | 'slug'

export const GATE_ITEMS: readonly GateItem[] = ['acceptance', 'partner_code', 'slug']

export type AcceptanceSource = 'link' | 'portal' | 'signed_contract'

/** One row of `partner.client_acceptance_gate`. */
export interface GateFacts {
  slug: string | null
  partnerCode: string | null
  acceptedAt: string | null
  acceptanceSource: AcceptanceSource | null
}

/**
 * What the gate lacks, in copy order. A client the read did not return is missing everything:
 * the gate is closed until the database says otherwise (fails closed).
 */
export function missingGateItems(facts: GateFacts | null | undefined): GateItem[] {
  if (!facts) return [...GATE_ITEMS]
  const missing: GateItem[] = []
  if (!facts.acceptanceSource) missing.push('acceptance')
  if (!facts.partnerCode) missing.push('partner_code')
  if (!facts.slug) missing.push('slug')
  return missing
}

/** The body of a server refusal, and of a refused drag: one shape, one sentence. */
export interface GateRefusal {
  error: 'gate_missing'
  missing: GateItem[]
}

/** `missing` read back from a route's JSON answer, keeping only the items this module knows. */
export function readGateMissing(value: unknown): GateItem[] {
  if (!Array.isArray(value)) return []
  return GATE_ITEMS.filter((item) => value.includes(item))
}
