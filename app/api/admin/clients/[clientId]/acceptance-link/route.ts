/**
 * GET  /api/admin/clients/[clientId]/acceptance-link — the gate and the last link of a client.
 * POST /api/admin/clients/[clientId]/acceptance-link — issues a new link `{ send: boolean }`.
 *
 * BR-B2B-056 (#872). Issuing always mints a new token: the database keeps only its sha256, so
 * `Copiar o link` cannot recover the one that went by e-mail, and the old link dies when the new
 * one is born. Admin only; the raw token leaves only in the POST answer and in the e-mail.
 */

import { NextResponse } from 'next/server'
import { withAuth, withRateLimit } from '@/lib/auth-middleware'
import { logAuditEvent } from '@/lib/services/audit-service'
import { loadAcceptanceGate } from '@/lib/services/acceptance-gate-service'
import { issueAcceptanceLink, loadLinkStatus } from '@/lib/services/acceptance-link-service'
import { missingGateItems } from '@/lib/partnerships/acceptance-gate'

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export const GET = withAuth<{ clientId: string }>({ roles: ['admin'] }, async (_req, ctx) => {
  const clientId = (await ctx.params)?.clientId
  if (!clientId || !UUID_PATTERN.test(clientId)) {
    return NextResponse.json({ error: 'invalid_client_id' }, { status: 400 })
  }
  const [gate, link] = await Promise.all([loadAcceptanceGate([clientId]), loadLinkStatus(clientId)])
  if (!gate || link === null) return NextResponse.json({ error: 'lookup_failed' }, { status: 503 })
  const facts = gate.get(clientId) ?? null
  return NextResponse.json({
    acceptedAt: facts?.acceptedAt ?? null,
    acceptanceSource: facts?.acceptanceSource ?? null,
    missing: missingGateItems(facts),
    link: link === 'none' ? null : link,
  })
})

export const POST = withRateLimit(20, 60_000)(
  withAuth<{ clientId: string }>({ roles: ['admin'] }, async (req, ctx, auth) => {
    const clientId = (await ctx.params)?.clientId
    if (!clientId || !UUID_PATTERN.test(clientId)) {
      return NextResponse.json({ error: 'invalid_client_id' }, { status: 400 })
    }
    let body: Record<string, unknown>
    try {
      body = (await req.json()) as Record<string, unknown>
    } catch {
      return NextResponse.json({ error: 'invalid_body' }, { status: 400 })
    }
    if (typeof body.send !== 'boolean') return NextResponse.json({ error: 'invalid_body' }, { status: 400 })

    const outcome = await issueAcceptanceLink(clientId, auth.cmsUser.id, body.send)
    if (!outcome.ok) {
      const { httpStatus, ok: _ok, ...refusal } = outcome
      return NextResponse.json(refusal, { status: httpStatus })
    }

    await logAuditEvent({
      request: req,
      action: 'ISSUE_ACCEPTANCE_LINK',
      entity: 'CLIENT',
      entityId: clientId,
      userId: auth.user.id,
      userEmail: auth.user.email ?? null,
      // No token and no address here: the audit trail outlives the link.
      description: `Acceptance link issued for client ${clientId} (${body.send ? 'sent by e-mail' : 'copied'})`,
    })

    const { ok: _ok, ...issued } = outcome
    return NextResponse.json(issued)
  })
)
