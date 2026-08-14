/**
 * The internal half of the partnership contract (#342) — generate, send, verify.
 *
 * Authenticated and admin only, because BR-B2B-026, item 1 puts it there: the contract
 * lives inside the CMS and whoever makes it is logged in. Everything the partner does
 * happens on `app/api/contract/[token]`, which is the public half and cannot reach any of
 * these actions.
 *
 * The registration is read here, with the service client, and turned into a FROZEN
 * snapshot before it reaches `lib/services/partner-contract-service.ts`. That module never
 * touches `core.clients`, which is what keeps a signed contract from following an edit of
 * the fee field (BR-B2B-017, item 5).
 */

import { NextRequest, NextResponse } from 'next/server'
import { withAuth, withRateLimit } from '@/lib/auth-middleware'
import { getSupabaseService } from '@/lib/core/supabase-client'
import {
  buildSnapshot,
  contractChecklist,
  feeDivergence,
  readProviderParty,
  type ContractClient,
  type ContractTier,
  type GenerationChoices,
  type PaymentMethod,
  type RegularityEvidence,
} from '@/lib/contract/snapshot'
import { activeTemplate } from '@/lib/contract/template'
import { buildContractUrl } from '@/lib/contract/link'
import {
  createContract,
  getLiveContract,
  sendForSignature,
  supersedeContract,
  verifyStoredDocument,
} from '@/lib/services/partner-contract-service'

const CLIENT_COLUMNS =
  'id, name, company_name, email, billing_email, address, city, state, postal_code, tax_id, ' +
  'tax_id_type, legal_representative_name, legal_representative_role, commission_rate, ' +
  'monthly_fee_cents, is_courtesy, courtesy_reason'

interface ClientParams {
  clientId: string
  [key: string]: string | string[] | undefined
}

async function clientIdOf(ctx: { params?: Promise<ClientParams> }): Promise<string> {
  const params = ctx.params ? await ctx.params : undefined
  return typeof params?.clientId === 'string' ? params.clientId : ''
}

async function loadClient(clientId: string): Promise<ContractClient | null> {
  const { data, error } = await getSupabaseService()
    .schema('core')
    .from('clients')
    .select(CLIENT_COLUMNS)
    .eq('id', clientId)
    .maybeSingle()

  if (error || !data) return null
  return data as unknown as ContractClient
}

/**
 * The evidence of BR-B2B-022, item 3, read where it actually is: the files the partner
 * uploaded through the #341 form and the validity date they answered there. There is no
 * "documents are fine" flag on the client record, and inventing one would turn a gate into
 * somebody's memory.
 *
 * A client with no submission yet answers "nothing attached", which is the truth and blocks
 * generation with a checklist item that names the missing document.
 */
async function loadRegularity(clientId: string): Promise<RegularityEvidence> {
  const empty: RegularityEvidence = {
    businessLicenseDocument: false,
    incorporationDocument: false,
    businessLicenseValidUntil: null,
  }

  const supabase = getSupabaseService().schema('core')

  const { data: invites } = await supabase.from('partner_form_invites').select('id').eq('client_id', clientId)
  const inviteIds = (invites ?? []).map((invite: { id: string }) => invite.id)
  if (inviteIds.length === 0) return empty

  const { data: submissions } = await supabase
    .from('partner_form_submissions')
    .select('id, answers, submitted_at')
    .in('invite_id', inviteIds)
    .eq('status', 'submitted')
    .order('submitted_at', { ascending: false })
    .limit(1)

  const submission = (submissions ?? [])[0] as { id: string; answers?: Record<string, unknown> } | undefined
  if (!submission) return empty

  const { data: documents } = await supabase
    .from('partner_form_documents')
    .select('kind')
    .eq('submission_id', submission.id)

  const kinds = new Set((documents ?? []).map((document: { kind: string }) => document.kind))
  const validUntil = submission.answers?.business_license_valid_until

  return {
    businessLicenseDocument: kinds.has('business_license'),
    incorporationDocument: kinds.has('incorporation_document'),
    businessLicenseValidUntil: typeof validUntil === 'string' && validUntil.trim() ? validUntil.trim() : null,
  }
}

function choicesOf(body: Record<string, unknown>): GenerationChoices {
  const tier: ContractTier = body.tier === 'paid' ? 'paid' : 'free'
  const paymentMethod: PaymentMethod | null =
    body.paymentMethod === 'boleto' || body.paymentMethod === 'pix' ? body.paymentMethod : null
  const days = Number(body.qrDeliveryDays)
  return {
    tier,
    paymentMethod,
    qrDeliveryDays: Number.isInteger(days) && days > 0 && days <= 180 ? days : null,
  }
}

/** The state of the contract, the checklist, and the trail. Everything the page shows. */
export const GET = withRateLimit(60, 60_000)(
  withAuth<ClientParams>({ roles: ['admin'] }, async (req: NextRequest, ctx) => {
    const clientId = await clientIdOf(ctx ?? {})
    const client = await loadClient(clientId)
    if (!client) return NextResponse.json({ error: 'client_not_found' }, { status: 404 })

    const template = activeTemplate()
    const { contract, acceptance } = await getLiveContract(clientId)

    const choices = choicesOf({
      tier: req.nextUrl.searchParams.get('tier') ?? contract?.tier ?? 'free',
      paymentMethod: req.nextUrl.searchParams.get('paymentMethod') ?? contract?.snapshot.paymentMethod,
      qrDeliveryDays:
        req.nextUrl.searchParams.get('qrDeliveryDays') ?? contract?.snapshot.qrDeliveryDays ?? null,
    })

    const provider = readProviderParty()
    const regularity = await loadRegularity(clientId)
    const checklist = contractChecklist(client, choices, { provider, regularity })

    return NextResponse.json({
      template: {
        version: template.version,
        title: template.title,
        legalReview: template.legalReview,
      },
      checklist,
      registration: {
        legalName: client.company_name ?? client.name,
        recipientEmail: client.billing_email ?? client.email,
        monthlyFeeCents: client.monthly_fee_cents ?? null,
        isCourtesy: client.is_courtesy === true,
        commissionRate: client.commission_rate ?? null,
      },
      contract: contract
        ? {
            id: contract.id,
            status: contract.status,
            tier: contract.tier,
            templateVersion: contract.template_version,
            snapshot: contract.snapshot,
            documentHash: contract.document_hash,
            createdAt: contract.created_at,
            sentAt: contract.sent_at,
            sentToEmail: contract.sent_to_email,
            openedAt: contract.opened_at,
            tokenExpiresAt: contract.token_expires_at,
            supersededBy: contract.superseded_by,
            terminatedAt: contract.terminated_at,
            feeDivergence: feeDivergence(contract.snapshot, client),
          }
        : null,
      acceptance: acceptance
        ? {
            signerName: acceptance.signer_name,
            signerRole: acceptance.signer_role,
            acceptedAt: acceptance.accepted_at,
            ipAddress: acceptance.ip_address,
            userAgent: acceptance.user_agent,
            recipientEmail: acceptance.recipient_email,
            templateVersion: acceptance.template_version,
            documentHash: acceptance.document_hash,
            signedDocumentHash: acceptance.signed_document_hash,
          }
        : null,
    })
  })
)

export const POST = withRateLimit(20, 60_000)(
  withAuth<ClientParams>({ roles: ['admin'] }, async (req: NextRequest, ctx, auth) => {
    const clientId = await clientIdOf(ctx ?? {})

    let body: Record<string, unknown>
    try {
      body = (await req.json()) as Record<string, unknown>
    } catch {
      return NextResponse.json({ error: 'invalid_body' }, { status: 400 })
    }

    const action = body.action
    if (action === 'generate') return generate(clientId, body, auth.user.id)
    if (action === 'send') return send(clientId, auth.user.id, req)
    if (action === 'verify') return verify(clientId)

    return NextResponse.json({ error: 'unknown_action' }, { status: 400 })
  })
)

async function generate(clientId: string, body: Record<string, unknown>, operatorId: string) {
  const client = await loadClient(clientId)
  if (!client) return NextResponse.json({ error: 'client_not_found' }, { status: 404 })

  const provider = readProviderParty()
  const regularity = await loadRegularity(clientId)
  const choices = choicesOf(body)
  const checklist = contractChecklist(client, choices, { provider, regularity })

  // The block is the point: a missing item produces a signed PDF with a hole in it, and a
  // signed PDF is the one artefact here that cannot be corrected afterwards.
  if (!checklist.ready || !provider) {
    return NextResponse.json({ error: 'checklist_incomplete', missing: checklist.missing }, { status: 409 })
  }

  const snapshot = buildSnapshot(client, choices, {
    provider,
    regularity,
    templateVersion: activeTemplate().version,
  })

  const previous = await getLiveContract(clientId)
  const created = await createContract({ clientId, snapshot, createdBy: operatorId })

  if (!created.ok || !created.contractId) {
    return NextResponse.json({ error: created.reason ?? 'generate_failed' }, { status: 503 })
  }

  if (previous.contract) {
    await supersedeContract(previous.contract.id, created.contractId)
  }

  return NextResponse.json({ contractId: created.contractId, documentHash: created.documentHash })
}

async function send(clientId: string, operatorId: string, req: NextRequest) {
  const client = await loadClient(clientId)
  if (!client) return NextResponse.json({ error: 'client_not_found' }, { status: 404 })

  const { contract } = await getLiveContract(clientId)
  if (!contract) return NextResponse.json({ error: 'contract_not_found' }, { status: 404 })

  // The address is derived from the registration, never taken from the request body: the
  // signing link is a credential, and letting the caller name its destination is how a
  // credential ends up somewhere nobody chose.
  const recipientEmail = (client.billing_email ?? client.email ?? '').trim()
  if (!recipientEmail) {
    return NextResponse.json({ error: 'client_without_email' }, { status: 409 })
  }

  const outcome = await sendForSignature(contract.id, { recipientEmail, sentBy: operatorId })
  if (!outcome.ok) {
    const status = outcome.reason === 'legal_review_pending' ? 409 : 503
    return NextResponse.json({ error: outcome.reason }, { status })
  }

  const origin = process.env.NEXT_PUBLIC_APP_URL?.trim() || req.nextUrl.origin
  const emailed = await sendSigningEmail({
    to: recipientEmail,
    name: client.legal_representative_name ?? '',
    legalName: client.company_name ?? client.name,
    token: outcome.token,
  })

  // The link comes back either way: an e-mail that did not go out must not cost the
  // operator the token they just minted — there is no second chance at the raw value.
  return NextResponse.json({
    url: buildContractUrl(origin, outcome.token),
    expiresAt: outcome.expiresAt,
    recipientEmail,
    emailed,
  })
}

async function verify(clientId: string) {
  const { contract, acceptance } = await getLiveContract(clientId)
  if (!contract) return NextResponse.json({ error: 'contract_not_found' }, { status: 404 })

  const target = acceptance?.signed_document_hash
    ? { path: acceptance.signed_document_path, hash: acceptance.signed_document_hash }
    : { path: contract.document_path, hash: contract.document_hash }

  const result = await verifyStoredDocument(target.path, target.hash)
  return NextResponse.json(result)
}

/**
 * The e-mail gets the TOKEN, never an assembled URL. `send-transactional` is reachable
 * without authorization until #346, and a function that renders whatever href its body
 * asks for is a phishing kit with our DKIM on it — the correction the #341 gate made, and
 * the reason the origin is composed inside the function from `PARTNER_FORM_ORIGIN`.
 */
async function sendSigningEmail(input: {
  to: string
  name: string
  legalName: string
  token: string
}): Promise<boolean> {
  try {
    // `functions.invoke` resolves for any HTTP answer and only fills `error` on a non-2xx,
    // so the envelope has to be read too — a 200 with `{ error }` is a failure that looks
    // like success.
    const { data, error } = await getSupabaseService().functions.invoke('send-transactional', {
      body: {
        type: 'partner_contract_sign',
        to: input.to,
        lang: 'pt',
        data: { name: input.name, legal_name: input.legalName, token: input.token },
      },
    })

    if (error || (data && typeof data === 'object' && 'error' in data)) {
      console.error('[contract] signing e-mail refused by send-transactional')
      return false
    }
    return true
  } catch (err) {
    console.error('[contract] signing e-mail failed:', err instanceof Error ? err.message : err)
    return false
  }
}
