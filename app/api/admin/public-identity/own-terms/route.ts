/**
 * The own list of the filter (#1144, BR-USUARIO-051 items 2 and 2.d): `blocked` sums to the LDNOOBW
 * and follows the same match; `allowed` is the way out of a false positive (a surname that contains a
 * term), and the text still goes to the moderation. The database normalizes; one normalized term per
 * kind. Contract `identidade-publica.md`, "Tabelas que o CMS lê e escreve direto".
 *
 * `POST`   `{ kind: 'blocked' | 'allowed', term }`, 1 to 150 after trimming. 409 when it normalizes
 *          to a term already in that list; 400 when it normalizes to nothing.
 * `DELETE` `?id=<id>`. 404 when nothing was deleted.
 *
 * The term stays out of the audit trail: an allowed term is often somebody's surname.
 */

import { NextResponse, type NextRequest } from 'next/server'
import { withAuth, withRateLimit } from '@/lib/auth-middleware'
import { logAuditEvent } from '@/lib/services/audit-service'
import { addOwnTerm, removeOwnTerm, statusOf } from '@/lib/services/public-identity-moderation-service'
import { ownTermInputOf, positiveIdOf } from '@/lib/public-identity/moderation'

export const dynamic = 'force-dynamic'

export const POST = withRateLimit(60, 60_000)(
  withAuth({ roles: ['admin'] }, async (req, _ctx, auth) => {
    let body: unknown
    try {
      body = await req.json()
    } catch {
      return NextResponse.json({ error: 'invalid_body' }, { status: 400 })
    }
    const input = ownTermInputOf(body)
    if (!input) return NextResponse.json({ error: 'invalid' }, { status: 400 })

    const result = await addOwnTerm(input, auth.user.id)
    if (!result.ok) return NextResponse.json({ error: result.error }, { status: statusOf(result.error) })

    await logAuditEvent({
      userId: auth.user.id,
      userEmail: auth.user.email,
      action: 'ADD_TEXT_FILTER_TERM',
      entity: 'USER',
      entityId: String(result.value.id),
      description: `Termo ${result.value.id} acrescentado à lista ${result.value.kind}`,
      request: req,
    })
    return NextResponse.json({ term: result.value }, { status: 201 })
  })
)

export const DELETE = withRateLimit(60, 60_000)(
  withAuth({ roles: ['admin'] }, async (req: NextRequest, _ctx, auth) => {
    const id = positiveIdOf(new URL(req.url).searchParams.get('id'))
    if (id === null) return NextResponse.json({ error: 'invalid_id' }, { status: 400 })

    const result = await removeOwnTerm(id)
    if (!result.ok) return NextResponse.json({ error: result.error }, { status: statusOf(result.error) })

    await logAuditEvent({
      userId: auth.user.id,
      userEmail: auth.user.email,
      action: 'REMOVE_TEXT_FILTER_TERM',
      entity: 'USER',
      entityId: String(id),
      description: `Termo ${id} retirado da lista ${result.value.kind}`,
      request: req,
    })
    return NextResponse.json({ removed: result.value })
  })
)
