/**
 * The internal side of the partner proposal — the queue the Tuggi team works, and the
 * promotion into `partner.clients`.
 *
 * WHY NOTHING PUBLIC REACHES THIS MODULE, AND WHAT ACTUALLY GUARDS THAT:
 *
 * This module holds a `service_role` client and writes `partner.clients` by definition, so the
 * only thing standing between anonymous input and that table is that no public route reaches
 * here. Since #396 the form itself left the repository — it is served by `tuggi-enterprise` —
 * and with it went the public route, the component and the public write service that used to
 * hold the other half of this reasoning; `/parceria` is not a public prefix any more either
 * (`PUBLIC_PATH_PREFIXES` is `/contrato` and nothing else). Every function here is called from
 * a route wrapped in `withAuth({ roles: ['admin'] })`.
 *
 * What is asserted rather than claimed is the OLD door staying shut: `#396: no source file
 * still points at the form that left`, in `tests/api/partner-proposal.test.ts`, goes red if
 * `app/api/partner-form/route.ts`, `components/partner-form/PartnerForm.tsx` or
 * `lib/services/partner-proposal-service.ts` come back. It does NOT guard a NEW public route:
 * anything added to `PUBLIC_PATH_PREFIXES` that ends up calling into this file puts
 * `partner.clients` back within reach of unauthenticated input, and no test here would notice.
 *
 * Rows this module reads and writes are `partner.partner_form_submissions` and `partner.clients`.
 * The migration `20260814140000` IS applied — its CHECKs are live, and a statement that violates
 * one comes back as a Supabase error, which is what the routes already turn into a typed
 * response. `partner_form_submissions_promotion_ck` is the one that dictates the write order of
 * `promoteProposal`; the reasoning is on that function.
 */

import { getSupabaseService } from '@/lib/core/supabase-client'
import { operatorLabel } from '@/lib/services/operator-label'
import type { PartnerAnswers } from '@/lib/partner-form/schema'
import type { PromotableColumn } from '@/lib/partner-form/promotion'
import { MATERIAL_KINDS, materialFieldId } from '@/lib/partner-form/fields'
import {
  readReviewNote,
  type DiscardReasonId,
  type ReviewNote,
} from '@/lib/partner-form/proposal-review'
import type { ConferenceRecord } from '@/lib/partner-form/regularity'
import { seedConferenceFromProposal } from '@/lib/services/client-conference-service'
import { DEFAULT_COMMISSION_RATE } from '@/types/clients'
import { normalizedTaxId } from '@/lib/partner-form/tax-id-key'
import { cnpjLookupValues } from '@/lib/validation/cnpj'
import type { ClientType } from '@/types/clients'

const SCHEMA = 'partner'
const SUBMISSIONS = 'partner_form_submissions'
const CLIENTS = 'clients'

function service() {
  return getSupabaseService().schema(SCHEMA)
}

/**
 * THERE IS NO `draft`. A proposal exists when somebody presses send: with no credential there
 * is no session to resume, and the CHECK of `20260814140000` accepts these three and nothing
 * else. The value used to be in this union and produced a queue filter, a banner and a
 * disabled button for a state the database refuses.
 */
export type ProposalStatus = 'submitted' | 'promoted' | 'discarded'

export interface AdminSubmissionRow {
  id: string
  status: ProposalStatus
  answers: PartnerAnswers
  submitted_at: string | null
  updated_at: string | null
  created_at: string
  promoted_at: string | null
  promoted_by: string | null
  promoted_client_id: string | null
  /** The conference annotation, in the shape `normalizeReviewNote` writes. */
  review_note: unknown
  /** When the annotation above was last written, and by which auth user. */
  reviewed_at: string | null
  reviewed_by: string | null
}

const SUBMISSION_COLUMNS =
  'id, status, answers, submitted_at, updated_at, created_at, promoted_at, promoted_by, promoted_client_id, review_note, reviewed_at, reviewed_by'

export interface ProposalListItem extends AdminSubmissionRow {
  /** What the team registered having seen — the list badge answers "can this one already
   *  produce a contract?", and that question is `buildRegularityReport`. */
  conference: ConferenceRecord
  /**
   * Other proposals waiting with the SAME CNPJ. The form accepts a second proposal for a CNPJ
   * that already has one pending (refusing it would turn a public number into a lookup for who
   * is talking to the Tuggi), so the duplicate is resolved here, by a person.
   */
  duplicate_of: string[]
}

/** The proposal queue: everything a human has actually sent, newest first. */
export async function listProposals(
  options: { statuses?: ProposalStatus[]; limit?: number } = {}
): Promise<ProposalListItem[]> {
  const statuses = options.statuses ?? ['submitted', 'promoted', 'discarded']

  const { data, error } = await service()
    .from(SUBMISSIONS)
    .select(SUBMISSION_COLUMNS)
    .in('status', statuses)
    .order('submitted_at', { ascending: false })
    .limit(options.limit ?? 200)

  if (error || !data) return []

  const rows = data as AdminSubmissionRow[]
  // Grouped by the key of `tax_id_normalized` and not by what was typed: the same company
  // filling the form twice writes `12.ABC.345/01DE-35` once and `12abc34501de35` the next
  // time, and a duplicate the screen does not show is a duplicate nobody resolves.
  const pendingByTaxId = new Map<string, string[]>()
  for (const row of rows) {
    if (row.status !== 'submitted') continue
    const key = normalizedTaxId(row.answers.tax_id)
    if (!key) continue
    pendingByTaxId.set(key, (pendingByTaxId.get(key) ?? []).concat(row.id))
  }

  return rows.map((row) => ({
    ...row,
    conference: readReviewNote(row.review_note).conference,
    duplicate_of: (pendingByTaxId.get(normalizedTaxId(row.answers.tax_id)) ?? []).filter(
      (id) => id !== row.id
    ),
  }))
}

export interface ClientRecord {
  id: string
  name: string | null
  email: string | null
  [column: string]: unknown
}

export interface ProposalDetail {
  submission: AdminSubmissionRow
  /** What the team registered having seen of the two documents of BR-B2B-022. */
  conference: ConferenceRecord
  /** The reading of gate 2 already stored, so the screen opens on what was written. */
  note: ReviewNote
  /** The client this proposal was promoted into. Null until somebody promotes it. */
  client: ClientRecord | null
  /** Other proposals still waiting with the same CNPJ — resolved by a person, never merged. */
  duplicates: { id: string; submittedAt: string | null }[]
  /**
   * The two acts of the screen in words instead of uuids — BR-B2B-030 item 2 asks the trail
   * to say WHO conferred, and a uuid on screen says it to nobody. Null when the lookup does
   * not answer, and the copy then leaves the line out rather than printing a placeholder.
   */
  reviewedByLabel: string | null
  promotedByLabel: string | null
}

/** The columns the promotion panel compares against. An allowlist, like the write. */
const CLIENT_COMPARE_COLUMNS =
  'id, name, email, phone, company_name, address, city, state, country, postal_code, industry, website, social_handle, tax_id, tax_id_type, legal_representative_name, legal_representative_role, status, created_at'

export async function loadProposalDetail(submissionId: string): Promise<ProposalDetail | null> {
  const { data: submission, error } = await service()
    .from(SUBMISSIONS)
    .select(SUBMISSION_COLUMNS)
    .eq('id', submissionId)
    .maybeSingle()

  if (error || !submission) return null

  const row = submission as AdminSubmissionRow
  const note = readReviewNote(row.review_note)

  return {
    submission: row,
    conference: note.conference,
    note,
    client: row.promoted_client_id
      ? await loadClient(row.promoted_client_id)
      : await findClientByTaxId(row.answers.tax_id ?? ''),
    duplicates: await findPendingDuplicates(submissionId, row.answers.tax_id ?? ''),
    reviewedByLabel: await operatorLabel(row.reviewed_by),
    promotedByLabel: await operatorLabel(row.promoted_by),
  }
}


/**
 * The client this proposal is ABOUT, found by CNPJ.
 *
 * THE PUBLIC FORM NO LONGER REFUSES ANYTHING, since 2026-08-19, so this is no longer an edge
 * case: any proposal may be about a company that is already a client. The refusal was a public
 * oracle of who is a client of the Tuggi, and the guarantee it was supposed to give — one record
 * per company — is now `clients_tax_id_normalized_uk`, a UNIQUE index on the normalised CNPJ
 * (migration `20260819190000`). The database refuses the second row on every write path, which
 * is four more than the form ever covered, and it does it without a race between read and insert.
 *
 * What this function does is therefore no longer a safety net: it is how the promotion knows to
 * UPDATE instead of INSERT, and how the screen knows to say so.
 *
 * When it does find one, the promotion becomes an UPDATE and DS-COMPONENTE-018 applies in
 * full: a divergent column is born unticked and stays that way until somebody says otherwise.
 * The same shapes count as the same CNPJ on both surfaces (`cnpjLookupValues`), and this is the
 * one lookup that still asks by SHAPE rather than by key: `partner.clients.tax_id` is a plain
 * column with no normalised twin, so there is nothing to compare `normalizedTaxId` against and
 * the expression index of `20260814170000` is the database's own, not PostgREST's.
 */
export async function findClientByTaxId(taxId: string): Promise<ClientRecord | null> {
  const candidates = cnpjLookupValues(taxId)
  if (candidates.length === 0) return null

  const { data, error } = await service()
    .from(CLIENTS)
    .select(CLIENT_COMPARE_COLUMNS)
    .in('tax_id', candidates)
    .limit(1)

  if (error || !data || data.length === 0) return null
  return data[0] as ClientRecord
}

/**
 * Proposals still waiting with the same CNPJ as this one.
 *
 * The public form lets a CNPJ that already has a pending proposal send another (the alternative
 * — telling the sender "this CNPJ already applied" — turns a public number into a lookup for
 * who is negotiating with the Tuggi). Nothing merges them: the screen shows the duplicate and a
 * person decides which one to promote and which one to discard, with `duplicate` on the closed
 * list of discard reasons.
 *
 * ONE SHAPE, AND THE DATABASE DECIDES IT. The filter is `tax_id_normalized=eq.<key>` against the
 * generated column of `20260814140000`, which is also the index behind it. What this used to do
 * — read the 50 newest proposals and compare the typed strings in JavaScript — missed the same
 * company that typed the mask on Monday and did not on Tuesday, and stopped looking at the 51st
 * row. `normalizedTaxId` is the mirror of that column's expression, and nothing else here
 * decides what "the same CNPJ" means.
 */
async function findPendingDuplicates(
  submissionId: string,
  taxId: string
): Promise<{ id: string; submittedAt: string | null }[]> {
  const key = normalizedTaxId(taxId)
  if (!key) return []

  const { data, error } = await service()
    .from(SUBMISSIONS)
    .select('id, submitted_at')
    .eq('status', 'submitted')
    .eq('tax_id_normalized', key)
    .order('submitted_at', { ascending: false })
    .limit(50)

  if (error || !data) return []

  return (data as { id: string; submitted_at: string | null }[])
    .filter((row) => row.id !== submissionId)
    .map((row) => ({ id: row.id, submittedAt: row.submitted_at }))
}

/**
 * The proposal a client was promoted FROM — the insumo the place prefill is built out of.
 *
 * The link is `promoted_client_id`, written by `promoteProposal` and by nothing else, so this
 * answers "what did this partner write about the place?" without the caller knowing anything
 * about the queue. It answers `null` for a client registered by hand, which is the ordinary
 * case for the 10 records that existed before the form.
 *
 * `limit(1)` and not `maybeSingle()`: `promoted_client_id` has no unique index, and one client
 * with two promoted proposals is a duplicate a person resolved by promoting both — a lookup
 * that errors there would break the approval over a row it does not even need to choose
 * between. Newest first, because the last thing the partner sent is the current one.
 */
export async function findPromotedSubmission(clientId: string): Promise<AdminSubmissionRow | null> {
  const { data, error } = await service()
    .from(SUBMISSIONS)
    .select(SUBMISSION_COLUMNS)
    .eq('promoted_client_id', clientId)
    .eq('status', 'promoted')
    .order('promoted_at', { ascending: false })
    .limit(1)

  if (error || !data || data.length === 0) return null
  return data[0] as AdminSubmissionRow
}

export async function loadClient(clientId: string): Promise<ClientRecord | null> {
  const { data, error } = await service()
    .from(CLIENTS)
    .select(CLIENT_COMPARE_COLUMNS)
    .eq('id', clientId)
    .maybeSingle()

  if (error || !data) return null
  return data as ClientRecord
}

/**
 * `partner.clients.email` IS NOT UNIQUE (operator, 2026-08-16): one owner has several places, and
 * each place is its own record with the same address on it. There used to be a panel here that
 * made the operator resolve an e-mail collision before the write button appeared — it existed
 * only because of the constraint, and it went with it. What keeps a company from being
 * registered twice is the CNPJ, refused at the form (`lookupTaxId`).
 *
 * Anything reintroduced here that reads a client BY E-MAIL has to expect several rows.
 * `maybeSingle()` is the trap: it errors when more than one row matches, and the error is not
 * "duplicate", it is a lookup that silently answers "nobody".
 */
/**
 * A FAILURE CARRIES THE CLIENT ID TOO, and that is the whole point of the field. With the
 * client written first, a failure of the claim leaves a live record in `partner.clients` with full
 * personal data on it and nothing anywhere saying who created it or which proposal it came from
 * — `partner.clients` has no authorship column and no audit trigger, and `tax_id` is not unique, so
 * there is nothing to disambiguate the row by afterwards. The caller is what writes that trail,
 * and it cannot write it without the id. `null` means the write itself failed and no row exists.
 */
export type PromotionOutcome =
  | {
      ok: true
      clientId: string
      created: boolean
      written: PromotableColumn[]
      /**
       * The material order this promotion materialized, or `null` when the proposal asked for
       * nothing — and `'failed'` when the order could not be written.
       *
       * A THIRD VALUE INSTEAD OF A THROW, deliberately. By the time the order is attempted the
       * client record is written and the submission is claimed; failing the whole promotion
       * there would report "nothing happened" about an act that already happened. But a silent
       * `null` would tell the operator the partner asked for no material, which is a different
       * fact — so the failure travels out and the route says so.
       */
      materialOrder: string | null | 'failed'
    }
  | { ok: false; reason: 'not_promotable' | 'write_failed'; clientId: string | null }

export interface PromotionCommand {
  submissionId: string
  /** Update this client, or create one when null. */
  clientId: string | null
  updates: Partial<Record<PromotableColumn, string>>
  written: PromotableColumn[]
  promotedBy: string
  /**
   * The proposal's answers, for the material order. Not for `partner.clients` — what lands
   * there is `updates`, and only `PROMOTION_MAP` decides that.
   */
  answers: PartnerAnswers
}

/**
 * Writes the promotion. One statement against `partner.clients`, which is what makes "either
 * everything you ticked, or nothing" literally true for the record the copy is about.
 *
 * ORDER, AND WHY IT IS THIS ONE — THE CLIENT FIRST, AND IT IS THE DATABASE THAT DECIDES IT.
 * `partner_form_submissions_promotion_ck` (decision 6 of `20260814140000`, BR-B2B-026: promotion
 * is an act WITH a destination) is `status <> 'promoted' OR (promoted_at IS NOT NULL AND
 * promoted_client_id IS NOT NULL)`. There is no state in which the row is `promoted` and the
 * destination is not yet known, so `promoted_client_id` has to be in the SAME statement that
 * writes `status` — and the client id only exists after `partner.clients` is written. Taking the
 * claim first, in the hope of filling the destination in a second statement, is not a slower
 * promotion: it is a promotion the database refuses with 23514, and it refused every one of
 * them in production.
 *
 * The single winner survives the inversion, because it never depended on the order: the claim is
 * still ONE UPDATE on ONE row with `status = 'submitted'` as a predicate, so two operators
 * clicking together produce exactly one match, and a proposal already promoted or discarded
 * matches none.
 *
 * THE RESIDUE, NAMED: PostgREST has no transaction across statements, so a claim that fails
 * after the client write leaves the client row written and the proposal still `submitted`. That
 * is the honest failure — the operator's record exists, the queue still offers the act — and it
 * is why the failure copy does not offer "try again" and tells the operator to open the client
 * record first. Nothing here deletes the client it just wrote — what the caller does instead is
 * record it, and `PromotionOutcome` carries the id out of the failure branch for that.
 */
export async function promoteProposal(command: PromotionCommand): Promise<PromotionOutcome> {
  const written = await writeClient(command)
  if (!written.ok) return { ok: false, reason: written.reason, clientId: null }

  const promotedAt = new Date().toISOString()

  const { data: claimed, error: claimError } = await service()
    .from(SUBMISSIONS)
    .update({
      status: 'promoted',
      promoted_at: promotedAt,
      promoted_by: command.promotedBy,
      promoted_client_id: written.clientId,
      updated_at: promotedAt,
    })
    .eq('id', command.submissionId)
    .eq('status', 'submitted')
    .select('id')

  if (claimError) return { ok: false, reason: 'write_failed', clientId: written.clientId }
  if (!claimed || claimed.length === 0) {
    return { ok: false, reason: 'not_promotable', clientId: written.clientId }
  }

  // THE CONFERENCE TRAVELS WITH THE PROMOTION, and this is the only moment it can. What the
  // reviewer recorded about the PROPOSAL is what the contract gate needs about the CLIENT, and
  // since 2026-08-21 the gate reads `partner.client_conferences` and nothing else — the
  // annotation stayed the reviewer's own record, keyed by the proposal, with its own
  // `reviewed_by`. Without this line a proposal promoted after that date would arrive at the
  // contract with the documents unrecorded, and the operator would have to type them again.
  await transferConference(command.submissionId, written.clientId)

  return {
    ok: true,
    clientId: written.clientId,
    created: written.created,
    written: command.written,
    materialOrder: await createMaterialOrder(command, written.clientId),
  }
}

/**
 * Copies the proposal's conference onto the client it became.
 *
 * A failure here never undoes the promotion: the client is written, the submission is claimed,
 * and what is lost is a form the operator can fill in on the contract page. It is reported.
 */
async function transferConference(submissionId: string, clientId: string): Promise<void> {
  const { data, error } = await service()
    .from(SUBMISSIONS)
    .select('review_note, reviewed_by')
    .eq('id', submissionId)
    .maybeSingle()

  if (error || !data) return

  const row = data as unknown as { review_note: unknown; reviewed_by: string | null }
  const { conference } = readReviewNote(row.review_note)
  await seedConferenceFromProposal(clientId, conference, row.reviewed_by)
}

/**
 * Turns what the partner asked for into a row somebody can act on.
 *
 * WHY HERE AND NOT IN `PROMOTION_MAP`: the map writes COLUMNS of `partner.clients`, and the
 * material is not a column — it is `partner.material_orders` plus one line per kind. The map
 * stays an allowlist of columns, which is what keeps `commission_rate` and `slug` out of reach.
 *
 * IDEMPOTENT BY THE DATABASE, not by a check here. `material_orders_submission_uk` is unique on
 * `submission_id`, and `partner.create_material_order` returns the existing order instead of
 * raising when the proposal already produced one. Promotion is re-runnable, and without that
 * the second attempt would leave the partner with two identical orders.
 *
 * A FAILURE HERE DOES NOT UNDO THE PROMOTION. The client is written and the submission is
 * claimed; the order is the one thing a person can redo from the client's record. It is
 * reported, never swallowed.
 */
async function createMaterialOrder(
  command: PromotionCommand,
  clientId: string
): Promise<string | null | 'failed'> {
  const items: Record<string, number> = {}
  for (const kind of MATERIAL_KINDS) {
    const raw = (command.answers[materialFieldId(kind)] ?? '').trim()
    const quantity = Number.parseInt(raw, 10)
    if (Number.isFinite(quantity) && quantity > 0) items[kind] = quantity
  }

  // Nothing asked for is not a failure. The writing side requires at least one, but a row
  // written before that rule existed carries none, and refusing to promote it would strand a
  // partner over a question they were never asked.
  if (Object.keys(items).length === 0) return null

  const { data, error } = await service().rpc('create_material_order', {
    p_client_id: clientId,
    p_items: items,
    p_source: 'proposal',
    p_submission_id: command.submissionId,
    p_created_by: command.promotedBy,
  })

  if (error) {
    console.error('[promotion] material order failed', {
      submissionId: command.submissionId,
      clientId,
      error: error.message,
    })
    return 'failed'
  }
  return typeof data === 'string' ? data : null
}

/**
 * What a promoted proposal becomes: `venue`, the merchant with an address.
 *
 * BR-B2B-020, item 5 — declared by the operator on 2026-08-14 (*"será tipo locais"*), which
 * fixes that the establishment enters as a type OF ITS OWN and not as `business`, `partner` or
 * `hotel`. It used to write `partner`, a generic that names no public and that made the seven
 * values of `clients_client_type_check` indistinguishable from one another for the whole
 * merchant funnel — this form is the merchant's channel (BR-B2B-026, items 1 to 3), so every
 * record it creates is one.
 *
 * The value is only ever written on CREATE. A promotion that lands on a record that already
 * exists does not touch `client_type`: the type of a client the team already registered is the
 * team's, and an external form does not re-classify it (the same reasoning as
 * DS-COMPONENTE-018, and the reason this is not in `PROMOTION_MAP`).
 */
export const PROMOTED_CLIENT_TYPE: ClientType = 'venue'

type ClientWriteOutcome =
  | { ok: true; clientId: string; created: boolean }
  | { ok: false; reason: 'write_failed' }

/**
 * THE TIER THE ESTABLISHMENT CHOSE IS A DECISION, NOT A REQUEST — and this is where it stops
 * being typed a second time, AND where the promoted client stops entering through a different
 * door than the one the admin form uses.
 *
 * `plan_choice = map_only` is the free tier of BR-B2B-016, item 1: the app says the name and
 * nothing else, and nobody is charged. There is nothing left to price, so a promotion that
 * leaves `commission_rate` to the column default (`0.200`) and `monthly_fee_cents` to whoever
 * remembers is asking the operator to answer a question the establishment already answered.
 *
 * MEASURED on 2026-08-23: of the 9 clients promoted from a `map_only` proposal, ALL 9 carry
 * `commission_rate = 0.000` and a `free` contract. The operator has been re-typing it every
 * time, in three places, and one of the three had already drifted — the column default is
 * `0.200` while `DEFAULT_COMMISSION_RATE` in `types/clients.ts` is `0.1`, so a client born from
 * a proposal and a client born from the admin form did not get the same percentage.
 *
 * `map_and_description` gets the STARTING percentage and nothing else: the monthly value is per
 * client (BR-B2B-017, items 2 and 4) and really is the operator's, cliente a cliente — but the
 * percentage a registration starts at was decided once, on 2026-08-18, and lives in
 * `DEFAULT_COMMISSION_RATE`. Sending it here is what lets `partner.clients.commission_rate` drop
 * its own `DEFAULT 0.200` (migration `20260823180000`): a column default is a second home for a
 * number that has one, and it was already disagreeing — 9 of 28 clients carry `0.200` that
 * nobody chose, all of them promoted from a proposal.
 */
function commercialTermsOfChoice(answers: PartnerAnswers): Record<string, unknown> {
  return answers.plan_choice === 'map_only'
    ? { commission_rate: 0, monthly_fee_cents: null }
    : { commission_rate: DEFAULT_COMMISSION_RATE }
}

async function writeClient(command: PromotionCommand): Promise<ClientWriteOutcome> {
  if (command.clientId) {
    const { data, error } = await service()
      .from(CLIENTS)
      .update({ ...command.updates, updated_at: new Date().toISOString() })
      .eq('id', command.clientId)
      .select('id')

    if (error) return { ok: false, reason: 'write_failed' }
    if (!data || data.length === 0) return { ok: false, reason: 'write_failed' }
    return { ok: true, clientId: command.clientId, created: false }
  }

  const { data, error } = await service()
    .from(CLIENTS)
    // `status` is NOT part of the promotion (it is on the never-written list): a new record is
    // born pending because that is what `partner.clients` does with a new record, and approving
    // the partnership is another decision on the client's own page (BR-B2B-010, item 1).
    .insert({
      ...command.updates,
      client_type: PROMOTED_CLIENT_TYPE,
      ...commercialTermsOfChoice(command.answers),
    })
    .select('id')
    .single()

  if (error || !data) return { ok: false, reason: 'write_failed' }
  return { ok: true, clientId: (data as { id: string }).id, created: true }
}

export type DiscardOutcome = { ok: true } | { ok: false; reason: 'not_discardable' | 'write_failed' }

/**
 * Discarding is reversible while nobody has promoted, and the screen says so before the click:
 * an irreversible discard makes the operator hesitate to use the right reason.
 *
 * It is NOT a triage rejection. A place turned down at triage is still a partner
 * (BR-B2B-011), and no reason on the closed list is a gate.
 */
export async function discardProposal(
  submissionId: string,
  reason: DiscardReasonId,
  discardedBy: string
): Promise<DiscardOutcome> {
  const { data, error } = await service()
    .from(SUBMISSIONS)
    .update({
      status: 'discarded',
      discarded_at: new Date().toISOString(),
      discarded_by: discardedBy,
      discard_reason: reason,
    })
    .eq('id', submissionId)
    .eq('status', 'submitted')
    .select('id')

  if (error) return { ok: false, reason: 'write_failed' }
  if (!data || data.length === 0) return { ok: false, reason: 'not_discardable' }
  return { ok: true }
}

export async function restoreProposal(submissionId: string): Promise<DiscardOutcome> {
  const { data, error } = await service()
    .from(SUBMISSIONS)
    .update({ status: 'submitted', discarded_at: null, discarded_by: null, discard_reason: null })
    .eq('id', submissionId)
    .eq('status', 'discarded')
    .select('id')

  if (error) return { ok: false, reason: 'write_failed' }
  if (!data || data.length === 0) return { ok: false, reason: 'not_discardable' }
  return { ok: true }
}

/**
 * Stores the reviewer's reading of gate 2 as an ANNOTATION — never a verdict. It writes no
 * `status`, touches no column of `partner.clients`, and the proposal is exactly as promotable
 * after it as before.
 */
export async function saveReviewNote(
  submissionId: string,
  note: ReviewNote,
  reviewedBy: string
): Promise<boolean> {
  const { data, error } = await service()
    .from(SUBMISSIONS)
    .update({
      review_note: note,
      reviewed_at: new Date().toISOString(),
      reviewed_by: reviewedBy,
    })
    .eq('id', submissionId)
    .select('id')

  return !error && Array.isArray(data) && data.length > 0
}
