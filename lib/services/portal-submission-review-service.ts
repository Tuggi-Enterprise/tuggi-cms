/**
 * What the validation screen reads about ONE Portal Locais submission (#812, spec
 * `docs/design/spec-validacao-portal-locais-2026-10.md`). `service_role`, behind the admin gate
 * of `app/api/admin/partnerships/validation/[submissionId]/route.ts`.
 *
 * MINIMISATION IS DONE HERE, NOT IN THE SCREEN. The operator sees from the partner what the
 * decision needs (BR-B2B-048) and nothing that leaves this function can be "hidden by CSS":
 *  · the CPF leaves MASKED — `answers.representative_cpf` is replaced, and the acceptance's
 *    `signer_cpf` travels only as its mask; the whole number has its own call
 *    (`revealPortalSignerCpf`), audited, so it is not in the HTML before the click;
 *  · `ip`, `user_agent`, `session_id` and `session_ip` of the acceptance are never selected —
 *    they do not serve the decision (spec §2, Aceite) and stay in the database.
 * The partner's login e-mail does leave: it is a commercial relationship, not a tourist
 * (BR-USUARIO-042, item 4).
 */

import { getSupabaseService } from '@/lib/core/supabase-client'
import type { PartnerAnswers } from '@/lib/partner-form/schema'
import { asaasExternalReference, maskCpf, onlyDigits } from '@/lib/partnerships/portal-review'
import { portalSubmissionsOfClient } from '@/lib/services/portal-validation-service'
import { operatorLabel } from '@/lib/services/operator-label'
import {
  isPhotoSetFrozen,
  photoCutoff,
  readSubmissionPhotos,
  type SubmissionPhoto,
} from '@/lib/services/place-submission-photos'

function partner() {
  return getSupabaseService().schema('partner')
}

export interface PortalReviewAcceptance {
  termsVersion: string
  termsHash: string
  acceptedAt: string
  authMethod: string
  email: string
  signerName: string
  signerRole: string
  signerCpfMasked: string
  /** The CPF of the acceptance differs from the one in the answers. */
  cpfDiffers: boolean
  legalStatusDeclared: boolean
  activationCommitment: { sticker?: boolean; display?: boolean; social?: boolean }
  marketingConsent: boolean
  planChoice: string
  billingPeriod: number | null
  voucherCode: string | null
  voucherDiscountCents: number | null
  totalCents: number
}

export interface PortalReviewPayment {
  status: string
  paidAt: string | null
  refundedAt: string | null
  /** `card` or `pix_automatic`; null before the first checkout. */
  paymentMethod: string | null
  /** The renewal date (BR-B2B-046 item 1): null while in validation, set at approval. */
  paidThrough: string | null
  /** Renewal turned off — not a status: the paid period still runs (BR-B2B-055 item 8). */
  canceledAt: string | null
  renewalAmountCents: number | null
  /** `sub_…` at Asaas, once attached. */
  providerSubscriptionId: string | null
  /** What Asaas carries as `externalReference` — `asaasExternalReference`. */
  externalReference: string | null
}

/** One portal submission behind a client, as the client record shows it (#871). */
export interface ClientPortalRecord {
  submissionId: string
  status: string
  attractionId: string
  submittedAt: string | null
  acceptance: PortalReviewAcceptance | null
  payment: PortalReviewPayment | null
}

export type PortalHistoryEntry =
  | {
      kind: 'transition'
      at: string
      from: string
      to: string
      actorKind: string
      actorName: string | null
      note: string | null
    }
  | { kind: 'message'; at: string; authorKind: string; actorName: string | null; body: string }

export interface PortalSubmissionReview {
  id: string
  status: string
  answers: PartnerAnswers
  submittedAt: string | null
  statusChangedAt: string
  attractionId: string | null
  /** The client the POI is linked to (`core.attractions.partner_client_id`) — where the operator
   * goes after approving (#870). `null` before approval, on a partial approval, or when the read
   * failed: the screen then just does not offer the shortcut. */
  clientId: string | null
  acceptance: PortalReviewAcceptance | null
  payment: PortalReviewPayment | null
  history: PortalHistoryEntry[]
  /** Other submissions with the same CNPJ — the "cadastro duplicado" line. */
  sameTaxId: { id: string; tradeName: string | null; status: string }[]
  /** The oldest other submission in `in_review`, for "Próximo da fila". */
  nextInReviewId: string | null
  /** Facade first, then the gallery — already capped by plan and cutoff, with short-lived
   * signed URLs (#809, contract §8.5). Empty when there is none or Storage is unreachable. */
  photos: SubmissionPhoto[]
}

export type PortalReviewOutcome =
  | { ok: true; review: PortalSubmissionReview }
  | { ok: false; httpStatus: 404 | 503; error: 'not_found' | 'lookup_failed' }

const ACCEPTANCE_COLUMNS =
  'id, terms_version, terms_sha256, accepted_at, auth_method, email, signer_cpf, signer_name, ' +
  'signer_role, legal_status_declared, activation_commitment, marketing_consent, plan_choice, ' +
  'billing_period, voucher_code, voucher_discount_cents, total_cents'

interface AcceptanceRow {
  id: string
  terms_version: string
  terms_sha256: string
  accepted_at: string
  auth_method: string
  email: string
  signer_cpf: string
  signer_name: string
  signer_role: string
  legal_status_declared: boolean
  activation_commitment: PortalReviewAcceptance['activationCommitment'] | null
  marketing_consent: boolean
  plan_choice: string
  billing_period: number | null
  voucher_code: string | null
  voucher_discount_cents: number | null
  total_cents: number
}

const SUBSCRIPTION_COLUMNS =
  'id, acceptance_id, status, paid_at, refunded_at, payment_method, paid_through, canceled_at, ' +
  'renewal_amount_cents, provider_subscription_id, created_at'

interface SubscriptionRow {
  id: string
  acceptance_id: string
  status: string
  paid_at: string | null
  refunded_at: string | null
  payment_method: string | null
  paid_through: string | null
  canceled_at: string | null
  renewal_amount_cents: number | null
  provider_subscription_id: string | null
}

/** The latest subscription of each acceptance — the one read both screens share. */
async function readSubscriptions(
  acceptances: AcceptanceRow[]
): Promise<{ ok: true; byAcceptance: Map<string, PortalReviewPayment> } | { ok: false; code?: string }> {
  const byAcceptance = new Map<string, PortalReviewPayment>()
  if (acceptances.length === 0) return { ok: true, byAcceptance }
  const { data, error } = await partner()
    .from('place_subscriptions')
    .select(SUBSCRIPTION_COLUMNS)
    .in(
      'acceptance_id',
      acceptances.map((a) => a.id)
    )
    .order('created_at', { ascending: false })
  if (error) return { ok: false, code: error.code }
  const periodOf = new Map(acceptances.map((a) => [a.id, a.billing_period]))
  for (const row of (data ?? []) as unknown as SubscriptionRow[]) {
    if (byAcceptance.has(row.acceptance_id)) continue
    const period = periodOf.get(row.acceptance_id) ?? null
    byAcceptance.set(row.acceptance_id, {
      status: row.status,
      paidAt: row.paid_at,
      refundedAt: row.refunded_at,
      paymentMethod: row.payment_method,
      paidThrough: row.paid_through,
      canceledAt: row.canceled_at,
      renewalAmountCents: row.renewal_amount_cents,
      providerSubscriptionId: row.provider_subscription_id,
      externalReference: period ? asaasExternalReference(period, row.id) : null,
    })
  }
  return { ok: true, byAcceptance }
}

/** The acceptance as the operator may see it: CPF masked, never the whole number. */
function toReviewAcceptance(row: AcceptanceRow, answeredCpf: string | undefined): PortalReviewAcceptance {
  return {
    termsVersion: row.terms_version,
    termsHash: row.terms_sha256,
    acceptedAt: row.accepted_at,
    authMethod: row.auth_method,
    email: row.email,
    signerName: row.signer_name,
    signerRole: row.signer_role,
    signerCpfMasked: maskCpf(row.signer_cpf),
    cpfDiffers: answeredCpf !== undefined && onlyDigits(answeredCpf) !== onlyDigits(row.signer_cpf),
    legalStatusDeclared: row.legal_status_declared,
    activationCommitment: row.activation_commitment ?? {},
    marketingConsent: row.marketing_consent,
    planChoice: row.plan_choice,
    billingPeriod: row.billing_period,
    voucherCode: row.voucher_code,
    voucherDiscountCents: row.voucher_discount_cents,
    totalCents: row.total_cents,
  }
}

const failed = (what: string, code?: string): PortalReviewOutcome => {
  console.error('[portal-review] read failed', what, code ?? 'no_code')
  return { ok: false, httpStatus: 503, error: 'lookup_failed' }
}

export async function getPortalSubmissionReview(submissionId: string): Promise<PortalReviewOutcome> {
  const { data: row, error } = await partner()
    .from('place_submissions')
    .select('id, status, answers, tax_id_normalized, attraction_id, submitted_at, status_changed_at')
    .eq('id', submissionId)
    .maybeSingle()
  if (error) return failed('submission', error.code)
  // A draft is not the operator's work (spec §4): same screen as "does not exist".
  if (!row || row.status === 'draft') return { ok: false, httpStatus: 404, error: 'not_found' }

  const submission = row as {
    id: string
    status: string
    answers: PartnerAnswers | null
    tax_id_normalized: string | null
    attraction_id: string | null
    submitted_at: string | null
    status_changed_at: string
  }
  const answers: PartnerAnswers = { ...(submission.answers ?? {}) }
  const answeredCpf = answers.representative_cpf
  if (answeredCpf !== undefined) answers.representative_cpf = maskCpf(answeredCpf)

  const [acceptanceRead, transitionsRead, messagesRead, duplicatesRead, nextRead, clientRead] = await Promise.all([
    partner().from('place_acceptances').select(ACCEPTANCE_COLUMNS).eq('submission_id', submission.id).maybeSingle(),
    partner()
      .from('place_submission_transitions')
      .select('from_status, to_status, actor_kind, actor_user_id, note, created_at')
      .eq('submission_id', submission.id)
      .order('created_at', { ascending: true }),
    partner()
      .from('place_submission_messages')
      .select('author_kind, author_user_id, body, created_at')
      .eq('submission_id', submission.id)
      .order('created_at', { ascending: true }),
    submission.tax_id_normalized
      ? partner()
          .from('place_submissions')
          .select('id, status, answers->>trade_name')
          .eq('tax_id_normalized', submission.tax_id_normalized)
          .neq('id', submission.id)
          .neq('status', 'draft')
          .limit(5)
      : Promise.resolve({ data: [], error: null }),
    partner()
      .from('place_submissions')
      .select('id')
      .eq('status', 'in_review')
      .neq('id', submission.id)
      .order('submitted_at', { ascending: true })
      .limit(1),
    submission.attraction_id
      ? getSupabaseService()
          .schema('core')
          .from('attractions')
          .select('partner_client_id')
          .eq('id', submission.attraction_id)
          .maybeSingle()
      : Promise.resolve({ data: null, error: null }),
  ])
  if (acceptanceRead.error) return failed('acceptance', acceptanceRead.error.code)
  if (transitionsRead.error) return failed('transitions', transitionsRead.error.code)
  if (messagesRead.error) return failed('messages', messagesRead.error.code)
  if (duplicatesRead.error) return failed('duplicates', duplicatesRead.error.code)
  if (nextRead.error) return failed('next', nextRead.error.code)
  // Soft on purpose: the client is a shortcut out of the screen, not part of the decision, and a
  // failed read must not take the conference down with it.
  if (clientRead.error) console.error('[portal-review] client read failed', clientRead.error.code)
  const clientId = clientRead.error
    ? null
    : ((clientRead.data as { partner_client_id: string | null } | null)?.partner_client_id ?? null)

  const acceptanceRow = acceptanceRead.data as unknown as AcceptanceRow | null
  const subscriptions = await readSubscriptions(acceptanceRow ? [acceptanceRow] : [])
  if (!subscriptions.ok) return failed('subscription', subscriptions.code)
  const payment = acceptanceRow ? (subscriptions.byAcceptance.get(acceptanceRow.id) ?? null) : null

  const transitions = (transitionsRead.data ?? []) as {
    from_status: string
    to_status: string
    actor_kind: string
    actor_user_id: string | null
    note: string | null
    created_at: string
  }[]
  const messages = (messagesRead.data ?? []) as {
    author_kind: string
    author_user_id: string | null
    body: string
    created_at: string
  }[]

  const operatorIds = new Set<string>()
  for (const t of transitions) if (t.actor_kind === 'operator' && t.actor_user_id) operatorIds.add(t.actor_user_id)
  for (const m of messages) if (m.author_kind === 'operator' && m.author_user_id) operatorIds.add(m.author_user_id)
  const [names, photos] = await Promise.all([
    operatorNames([...operatorIds]),
    // The set the operator approves: frozen at the last submit while out of the editable statuses.
    readSubmissionPhotos(submission.id, {
      planChoice: acceptanceRow?.plan_choice ?? answers.plan_choice,
      cutoff: isPhotoSetFrozen(submission.status) ? photoCutoff(transitions) : null,
    }),
  ])

  const history: PortalHistoryEntry[] = [
    ...transitions.map((t) => ({
      kind: 'transition' as const,
      at: t.created_at,
      from: t.from_status,
      to: t.to_status,
      actorKind: t.actor_kind,
      actorName: t.actor_kind === 'operator' && t.actor_user_id ? (names.get(t.actor_user_id) ?? null) : null,
      note: t.note,
    })),
    ...messages.map((m) => ({
      kind: 'message' as const,
      at: m.created_at,
      authorKind: m.author_kind,
      actorName: m.author_kind === 'operator' && m.author_user_id ? (names.get(m.author_user_id) ?? null) : null,
      body: m.body,
    })),
  ].sort((a, b) => a.at.localeCompare(b.at))

  const acceptance = acceptanceRow ? toReviewAcceptance(acceptanceRow, answeredCpf) : null

  return {
    ok: true,
    review: {
      id: submission.id,
      status: submission.status,
      answers,
      submittedAt: submission.submitted_at,
      statusChangedAt: submission.status_changed_at,
      attractionId: submission.attraction_id,
      clientId,
      acceptance,
      payment,
      history,
      sameTaxId: ((duplicatesRead.data ?? []) as { id: string; status: string; trade_name: string | null }[]).map(
        (d) => ({ id: d.id, status: d.status, tradeName: d.trade_name })
      ),
      nextInReviewId: ((nextRead.data ?? []) as { id: string }[])[0]?.id ?? null,
      photos,
    },
  }
}

/**
 * The portal side of a client record (#871): every submission behind the client's places, with
 * its acceptance — the contract of the portal (BR-B2B-047) — and its subscription at Asaas
 * (BR-B2B-046). Same reads and same minimisation as the validation screen: CPF masked, no IP,
 * no user agent. `[]` for a client that never came through the portal; `null` when a read failed.
 */
export async function getClientPortalRecords(clientId: string): Promise<ClientPortalRecord[] | null> {
  const submissions = await portalSubmissionsOfClient(clientId)
  if (submissions === null) return null
  const visible = submissions.filter((s) => s.status !== 'draft')
  if (visible.length === 0) return []
  const ids = visible.map((s) => s.id)

  const [acceptancesRead, cpfsRead] = await Promise.all([
    partner().from('place_acceptances').select(`submission_id, ${ACCEPTANCE_COLUMNS}`).in('submission_id', ids),
    partner().from('place_submissions').select('id, representative_cpf:answers->>representative_cpf').in('id', ids),
  ])
  if (acceptancesRead.error || cpfsRead.error) {
    console.error('[portal-review] client record read failed', acceptancesRead.error?.code ?? cpfsRead.error?.code)
    return null
  }
  const acceptances = (acceptancesRead.data ?? []) as unknown as (AcceptanceRow & { submission_id: string })[]
  const subscriptions = await readSubscriptions(acceptances)
  if (!subscriptions.ok) {
    console.error('[portal-review] client record subscription read failed', subscriptions.code ?? 'no_code')
    return null
  }
  const answeredCpf = new Map(
    ((cpfsRead.data ?? []) as unknown as { id: string; representative_cpf: string | null }[]).map((r) => [
      r.id,
      r.representative_cpf ?? undefined,
    ])
  )

  return visible.map((submission) => {
    const row = acceptances.find((a) => a.submission_id === submission.id) ?? null
    return {
      submissionId: submission.id,
      status: submission.status,
      attractionId: submission.attraction_id,
      submittedAt: submission.submitted_at,
      acceptance: row ? toReviewAcceptance(row, answeredCpf.get(submission.id)) : null,
      payment: row ? (subscriptions.byAcceptance.get(row.id) ?? null) : null,
    }
  })
}

/** The label of each operator (`operatorLabel`, the CMS's one resolver). CMS staff, never a
 * tourist (BR-USUARIO-042, item 4); a failed lookup degrades to "Operador" without a name. */
async function operatorNames(ids: string[]): Promise<Map<string, string>> {
  const names = new Map<string, string>()
  await Promise.all(
    ids.map(async (id) => {
      const label = await operatorLabel(id)
      if (label) names.set(id, label)
    })
  )
  return names
}

/** The signer's whole CPF, for the explicit "Mostrar CPF". The route audits the call. */
export async function revealPortalSignerCpf(
  submissionId: string
): Promise<{ ok: true; cpf: string } | { ok: false; httpStatus: 404 | 503; error: string }> {
  // Same 404 as the screen read: a draft is not reviewable, so its CPF is not revealable either.
  const { data: submission, error: statusError } = await partner()
    .from('place_submissions')
    .select('status')
    .eq('id', submissionId)
    .maybeSingle()
  if (statusError) {
    console.error('[portal-review] status read failed', statusError.code)
    return { ok: false, httpStatus: 503, error: 'lookup_failed' }
  }
  const status = (submission as { status: string } | null)?.status
  if (!status || status === 'draft') return { ok: false, httpStatus: 404, error: 'not_found' }

  const { data, error } = await partner()
    .from('place_acceptances')
    .select('signer_cpf')
    .eq('submission_id', submissionId)
    .maybeSingle()
  if (error) {
    console.error('[portal-review] cpf read failed', error.code)
    return { ok: false, httpStatus: 503, error: 'lookup_failed' }
  }
  const cpf = (data as { signer_cpf: string } | null)?.signer_cpf
  return cpf ? { ok: true, cpf } : { ok: false, httpStatus: 404, error: 'not_found' }
}
