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
import { maskCpf, onlyDigits } from '@/lib/partnerships/portal-review'
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

  const [acceptanceRead, transitionsRead, messagesRead, duplicatesRead, nextRead] = await Promise.all([
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
  ])
  if (acceptanceRead.error) return failed('acceptance', acceptanceRead.error.code)
  if (transitionsRead.error) return failed('transitions', transitionsRead.error.code)
  if (messagesRead.error) return failed('messages', messagesRead.error.code)
  if (duplicatesRead.error) return failed('duplicates', duplicatesRead.error.code)
  if (nextRead.error) return failed('next', nextRead.error.code)

  const acceptanceRow = acceptanceRead.data as unknown as AcceptanceRow | null
  let payment: PortalReviewPayment | null = null
  if (acceptanceRow) {
    const { data: subscription, error: subscriptionError } = await partner()
      .from('place_subscriptions')
      .select('status, paid_at, refunded_at')
      .eq('acceptance_id', acceptanceRow.id)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle()
    if (subscriptionError) return failed('subscription', subscriptionError.code)
    const sub = subscription as { status: string; paid_at: string | null; refunded_at: string | null } | null
    if (sub) payment = { status: sub.status, paidAt: sub.paid_at, refundedAt: sub.refunded_at }
  }

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

  const acceptance: PortalReviewAcceptance | null = acceptanceRow
    ? {
        termsVersion: acceptanceRow.terms_version,
        termsHash: acceptanceRow.terms_sha256,
        acceptedAt: acceptanceRow.accepted_at,
        authMethod: acceptanceRow.auth_method,
        email: acceptanceRow.email,
        signerName: acceptanceRow.signer_name,
        signerRole: acceptanceRow.signer_role,
        signerCpfMasked: maskCpf(acceptanceRow.signer_cpf),
        cpfDiffers: answeredCpf !== undefined && onlyDigits(answeredCpf) !== onlyDigits(acceptanceRow.signer_cpf),
        legalStatusDeclared: acceptanceRow.legal_status_declared,
        activationCommitment: acceptanceRow.activation_commitment ?? {},
        marketingConsent: acceptanceRow.marketing_consent,
        planChoice: acceptanceRow.plan_choice,
        billingPeriod: acceptanceRow.billing_period,
        voucherCode: acceptanceRow.voucher_code,
        voucherDiscountCents: acceptanceRow.voucher_discount_cents,
        totalCents: acceptanceRow.total_cents,
      }
    : null

  return {
    ok: true,
    review: {
      id: submission.id,
      status: submission.status,
      answers,
      submittedAt: submission.submitted_at,
      statusChangedAt: submission.status_changed_at,
      attractionId: submission.attraction_id,
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
