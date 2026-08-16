/**
 * The public partner form (#341) — one address, one method: send the proposal.
 *
 * Public on purpose: the person filling this in is a restaurant owner who has no CMS login and
 * never will (BR-B2B-026, item 2). And since 2026-08-16 there is no invite token either — the
 * same link goes to every partner, so this route has NO CREDENTIAL OF ANY KIND. It is a door
 * on the internet in front of a `service_role` write, and that changes what has to be true
 * here rather than what the route does:
 *
 *   1. A durable per-IP limit, counted by the database, decides before anything else. The
 *      in-memory `withRateLimit` above it is the cheap first line and is not the barrier —
 *      see `registerSubmissionAttempt`.
 *   2. The body is validated against the field allowlist before anything is persisted —
 *      unknown keys are stripped, so `commission_rate` posted by hand goes nowhere.
 *   3. A CNPJ that already exists in `core.clients` is refused. That read is the only thing
 *      this surface asks of the client table, and it answers `registered`/`free`/`unknown` —
 *      never a column.
 *   4. Nothing here writes `core.clients`. The submission is a proposal, and the promotion
 *      into the live registration is an authenticated act of the team (BR-B2B-026, item 4).
 *
 * A CNPJ that already has a PENDING PROPOSAL is accepted and becomes a second proposal: the
 * conference screen shows the duplicate and a person decides. Answering "you already sent
 * this" would turn a public number into a lookup for who is talking to the Tuggi.
 *
 * Logs carry the outcome and nothing else — no e-mail, no CNPJ, no answers, no address.
 */

import { NextRequest, NextResponse } from 'next/server'
import { withPublicRoute, withRateLimit } from '@/lib/auth-middleware'
import {
  clientAddressOf,
  createProposal,
  lookupTaxId,
  registerSubmissionAttempt,
} from '@/lib/services/partner-proposal-service'
import { normalizeAnswers, validateAnswers } from '@/lib/partner-form/schema'

const PUBLIC_REASON =
  'Partner fills this form without a CMS login and without an invite; the CNPJ is the key and the per-IP limit is the barrier (BR-B2B-026, item 2)'

/**
 * The composition is written out at the export on purpose: `scripts/check-route-policies.ts`
 * only accepts `withRateLimit(...)(gate(...))` literally, so that "who may call this route,
 * and how often" is answerable without following a constant.
 */
const BURST_PER_MINUTE = 12
const MINUTE = 60_000

export const POST = withRateLimit(BURST_PER_MINUTE, MINUTE)(
  withPublicRoute({ reason: PUBLIC_REASON }, async (req: NextRequest) => {
    const limit = await registerSubmissionAttempt(clientAddressOf(req.headers))
    if (!limit.allowed) {
      return NextResponse.json(
        { error: 'too_many_submissions', retryAfterSeconds: limit.retryAfterSeconds },
        { status: 429, headers: { 'retry-after': String(limit.retryAfterSeconds) } }
      )
    }

    const body = await readJson(req)
    if (!body) return NextResponse.json({ error: 'invalid_body' }, { status: 400 })

    const answers = normalizeAnswers((body as { answers?: unknown }).answers)
    if (!answers) return NextResponse.json({ error: 'invalid_body' }, { status: 400 })

    const problems = validateAnswers(answers)
    if (problems.length > 0) {
      return NextResponse.json({ error: 'invalid_answers', problems }, { status: 400 })
    }

    const taxId = await lookupTaxId(answers.tax_id ?? '')
    if (taxId === 'registered') {
      // 409 and not 400: nothing the person typed is wrong. The field is named so the form
      // can put the message beside the CNPJ instead of at the top of a page they already left.
      return NextResponse.json(
        { error: 'tax_id_registered', field: 'tax_id' },
        { status: 409 }
      )
    }
    if (taxId === 'unknown') {
      return NextResponse.json({ error: 'submit_failed' }, { status: 503 })
    }

    const outcome = await createProposal(answers)
    if (!outcome.ok) {
      console.error('[partner-form] proposal insert failed')
      return NextResponse.json({ error: 'submit_failed' }, { status: 503 })
    }

    return NextResponse.json({
      state: 'submitted',
      // Echoed from what was just accepted, so the confirmation names the address the team
      // will write to and the person can see a typo while it still costs nothing.
      contactEmail: answers.representative_email ?? null,
    })
  })
)

async function readJson(req: NextRequest): Promise<unknown | null> {
  try {
    return await req.json()
  } catch {
    return null
  }
}
