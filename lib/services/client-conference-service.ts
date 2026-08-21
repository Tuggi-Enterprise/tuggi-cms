/**
 * The in-person conference of BR-B2B-022, item 3, keyed by the CLIENT.
 *
 * WHY THIS EXISTS. Until 2026-08-21 the evidence lived only inside the review annotation of a
 * promoted proposal, `partner.partner_form_submissions.review_note`, and the contract gate read
 * it there. A client registered directly has no submission, so the gate answered "nothing seen"
 * for a document nobody could ever record — and the CMS had no screen that wrote one. Measured
 * on that date: 10 of 12 clients could never produce a contract, with no way out.
 *
 * The conference is a fact about the ESTABLISHMENT, and in this system the establishment is the
 * client. The proposal annotation stays what it always was: what one reviewer wrote about one
 * proposal, under their own `reviewed_by`. Promotion is the explicit transfer, in
 * `promoteProposal`, and `20260821_01_client_conferences.sql` carries the same transfer once for
 * the rows that already existed. Nothing reads the evidence from two places.
 *
 * IT IS AN ASSERTION BY A NAMED PERSON, never a file this system holds. `reviewed_by` is the
 * point of the table, and the screen says so out loud so nobody reads a tick as "Tuggi verified
 * the document".
 */

import { getSupabaseService } from '@/lib/core/supabase-client'
import { PARTNER_DOCUMENT_KINDS, type PartnerDocumentKind } from '@/lib/partner-form/fields'
import { EMPTY_CONFERENCE, type ConferenceRecord } from '@/lib/partner-form/regularity'

const SCHEMA = 'partner'
const TABLE = 'client_conferences'

const COLUMNS = 'client_id, documents_seen, reviewed_by, reviewed_at'

function service() {
  return getSupabaseService().schema(SCHEMA)
}

export interface ClientConference {
  conference: ConferenceRecord
  /** Null when nobody has ever registered one for this client. */
  reviewedAt: string | null
  reviewedBy: string | null
}

export const NO_CONFERENCE: ClientConference = {
  conference: EMPTY_CONFERENCE,
  reviewedAt: null,
  reviewedBy: null,
}

/**
 * Normalizes a body into a record worth storing, or refuses it.
 *
 * The record is a list of ticks off a CLOSED list, so the whole of validation is that list. An
 * unknown kind is refused rather than dropped: a body naming a document this system does not
 * have is a caller that disagrees with us about what was conferred, and silently storing the
 * half it understood would record an assertion nobody made.
 */
export function normalizeClientConference(input: unknown): ConferenceRecord | null {
  if (!input || typeof input !== 'object') return null
  const body = input as Record<string, unknown>

  const rawSeen = Array.isArray(body.documentsSeen) ? body.documentsSeen : []
  const documentsSeen: PartnerDocumentKind[] = []
  for (const kind of rawSeen) {
    if (typeof kind !== 'string') return null
    const known = PARTNER_DOCUMENT_KINDS.find((candidate) => candidate === kind)
    if (!known) return null
    if (documentsSeen.indexOf(known) < 0) documentsSeen.push(known)
  }

  return { documentsSeen }
}

export async function getClientConference(clientId: string): Promise<ClientConference> {
  const { data, error } = await service()
    .from(TABLE)
    .select(COLUMNS)
    .eq('client_id', clientId)
    .maybeSingle()

  if (error || !data) return NO_CONFERENCE

  const row = data as unknown as {
    documents_seen: string[] | null
    reviewed_by: string | null
    reviewed_at: string | null
  }

  return {
    conference: { documentsSeen: knownKinds(row.documents_seen) },
    reviewedAt: row.reviewed_at,
    reviewedBy: row.reviewed_by,
  }
}

/**
 * The stored array filtered to the kinds this build knows.
 *
 * The column is `text[]` with a CHECK, not an enum, so the guard is cheap insurance rather than
 * paranoia: a kind retired from the code outlives the rows that carry it.
 */
function knownKinds(stored: string[] | null): PartnerDocumentKind[] {
  return (stored ?? []).filter((kind): kind is PartnerDocumentKind =>
    PARTNER_DOCUMENT_KINDS.some((candidate) => candidate === kind)
  )
}

/**
 * The same read for a whole screen, in one round trip.
 *
 * The queue derives a pipeline state per row, and the conference is one of its inputs. Reading
 * it per row would be N+1 over a list the operator reloads all day; reading it from the proposal
 * instead — which is what the queue did until 2026-08-21 — makes the list and the detail answer
 * differently about the same client.
 */
export async function getClientConferences(
  clientIds: string[]
): Promise<Map<string, ClientConference>> {
  const found = new Map<string, ClientConference>()
  if (clientIds.length === 0) return found

  const { data, error } = await service().from(TABLE).select(COLUMNS).in('client_id', clientIds)
  if (error || !data) return found

  for (const row of data as unknown as Record<string, unknown>[]) {
    found.set(String(row.client_id), {
      conference: { documentsSeen: knownKinds(row.documents_seen as string[] | null) },
      reviewedAt: (row.reviewed_at as string | null) ?? null,
      reviewedBy: (row.reviewed_by as string | null) ?? null,
    })
  }
  return found
}

/**
 * Writes the conference for a client, replacing whatever was there.
 *
 * IT OVERWRITES, AND `reviewed_by` MOVES WITH IT. A second operator rewriting the record means
 * the earlier assertion is gone from this table, which is why the route that calls this also
 * writes an audit row — that row is the only place the earlier assertion survives. Same shape,
 * and the same reason, as the review annotation of the proposal.
 */
export async function saveClientConference(
  clientId: string,
  conference: ConferenceRecord,
  reviewedBy: string
): Promise<boolean> {
  const { error } = await service()
    .from(TABLE)
    .upsert(
      {
        client_id: clientId,
        documents_seen: conference.documentsSeen,
        reviewed_by: reviewedBy,
        reviewed_at: new Date().toISOString(),
      },
      { onConflict: 'client_id' }
    )

  if (error) {
    console.error('[conference] save failed for client', clientId, error.message)
    return false
  }
  return true
}

/**
 * The transfer at promotion: what the reviewer recorded about the proposal becomes the
 * client's conference.
 *
 * `do nothing` on conflict, and that is deliberate. A client that already carries a conference
 * has one somebody registered against the client itself; a proposal promoted onto it afterwards
 * must not overwrite the newer assertion with the older one.
 */
export async function seedConferenceFromProposal(
  clientId: string,
  conference: ConferenceRecord,
  reviewedBy: string | null
): Promise<void> {
  if (conference.documentsSeen.length === 0) return

  const { error } = await service()
    .from(TABLE)
    .insert({
      client_id: clientId,
      documents_seen: conference.documentsSeen,
      reviewed_by: reviewedBy,
    })

  // A duplicate key is the expected outcome above, not a failure worth a line in the log.
  if (error && error.code !== '23505') {
    console.error('[conference] seed failed for client', clientId, error.message)
  }
}
