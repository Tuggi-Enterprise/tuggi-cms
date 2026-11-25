/**
 * The partner's place suggestions in the CMS (#1261, epic #1249). Contract
 * `docs/contracts/tuggi-do-parceiro.md` §10.3.
 *
 * BR-B2B-073 item 3.b: the curation answers a pending suggestion in one of three ways. It links it
 * to a POI that exists, creates the POI by the common path of the curation, or refuses it with a
 * reason the partner reads in the portal, required, up to 1,000 characters (the same as
 * BR-ROTA-006 item 3, so the same check, `parseRejectReason`). Item 3.c: linked or created, the
 * pick lands at the end of the list in the same act, and that is the database's.
 * Item 3.d: no surface promises a time to answer.
 *
 * Pure: the route, the service and the screens read it.
 */

import { parseNewPoiFields, parseRejectReason, type NearbyPoi, type NewPoiFields } from '@/lib/routes/route-revisions'
import { isUuid, type Parse, type PartnerBrandErrorCode } from './brand'

/** One row of `partner.cms_list_partner_pick_suggestions`, as the CMS keeps it. */
export interface SuggestionRow {
  id: string
  client_id: string
  partner_handle: string | null
  partner_name: string | null
  client_type: string | null
  name: string
  latitude: number
  longitude: number
  note: string | null
  status: string
  created_at: string
  picks_count: number
  pending_count: number
}

/** A pending suggestion with the POIs around its pin, as the queue receives it. */
export interface PlaceSuggestion extends SuggestionRow {
  /** Same query and radius as "Virar POI" (`nearbyPois`, `NEARBY_POI_RADIUS_M`). */
  nearby: NearbyPoi[]
}

export type SuggestionDecision =
  | { decision: 'link'; suggestion_id: string; attraction_id: string }
  | { decision: 'created'; suggestion_id: string; poi: NewPoiFields }
  | { decision: 'refuse'; suggestion_id: string; reason: string }

const refuse = <T>(code: PartnerBrandErrorCode): Parse<T> => ({ ok: false, error: { code } })

/**
 * `{ suggestion_id, decision, attraction_id? , poi?, reason? }`:
 * - `link` needs the POI id;
 * - `created` needs the fields of the POI the CMS creates first (the same as "Virar POI");
 * - `refuse` needs the reason, 1 to 1,000 characters, sent as written.
 * The actor is never read from the body: the route passes the session's user.
 */
export function parseSuggestionDecision(body: unknown): Parse<SuggestionDecision> {
  if (!body || typeof body !== 'object' || Array.isArray(body)) return refuse('invalid_body')
  const b = body as Record<string, unknown>
  if (!isUuid(b.suggestion_id)) return refuse('invalid_suggestion')
  const suggestionId = b.suggestion_id.toLowerCase()
  switch (b.decision) {
    case 'link':
      if (!isUuid(b.attraction_id)) return refuse('invalid_poi')
      return { ok: true, value: { decision: 'link', suggestion_id: suggestionId, attraction_id: b.attraction_id.toLowerCase() } }
    case 'created': {
      const fields = parseNewPoiFields(b.poi)
      if (!fields.ok) return refuse('invalid_poi')
      return { ok: true, value: { decision: 'created', suggestion_id: suggestionId, poi: fields.fields } }
    }
    case 'refuse': {
      const reason = parseRejectReason(b.reason)
      if (!reason.ok) return refuse(reason.error === 'reason_required' ? 'reason_required' : 'suggestion_reason_too_long')
      return { ok: true, value: { decision: 'refuse', suggestion_id: suggestionId, reason: reason.reason } }
    }
    default:
      return refuse('invalid_body')
  }
}
