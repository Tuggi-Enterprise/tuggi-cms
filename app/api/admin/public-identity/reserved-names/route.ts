/**
 * The reserved names (#1144, BR-USUARIO-050 item 7): no account takes them as @, and the ones
 * marked for it are refused as display name too. The list lives in one place, the database; the
 * CMS adds and removes. Contract `identidade-publica.md`, "Tabelas que o CMS lê e escreve direto".
 *
 * `POST`   `{ name, match?: 'exact' | 'contains', appliesToDisplayName?: boolean }`. 409 when the
 *          comparison key is already reserved.
 * `DELETE` `?key=<name_key>`. 404 when nothing was deleted: the deleted row is the proof.
 */

import { NextResponse, type NextRequest } from 'next/server'
import { withAuth, withRateLimit } from '@/lib/auth-middleware'
import { logAuditEvent } from '@/lib/services/audit-service'
import { addReservedName, removeReservedName, statusOf } from '@/lib/services/public-identity-moderation-service'
import { nameKeyOf, reservedNameInputOf } from '@/lib/public-identity/moderation'

export const dynamic = 'force-dynamic'

export const POST = withRateLimit(60, 60_000)(
  withAuth({ roles: ['admin'] }, async (req, _ctx, auth) => {
    let body: unknown
    try {
      body = await req.json()
    } catch {
      return NextResponse.json({ error: 'invalid_body' }, { status: 400 })
    }
    const input = reservedNameInputOf(body)
    if (!input) return NextResponse.json({ error: 'invalid' }, { status: 400 })

    const result = await addReservedName(input, auth.user.id)
    if (!result.ok) return NextResponse.json({ error: result.error }, { status: statusOf(result.error) })

    await logAuditEvent({
      userId: auth.user.id,
      userEmail: auth.user.email,
      action: 'ADD_RESERVED_PUBLIC_NAME',
      entity: 'USER',
      entityId: result.value.nameKey,
      description: `Nome reservado ${result.value.nameKey} acrescentado (${result.value.match})`,
      request: req,
    })
    return NextResponse.json({ reserved: result.value }, { status: 201 })
  })
)

export const DELETE = withRateLimit(60, 60_000)(
  withAuth({ roles: ['admin'] }, async (req: NextRequest, _ctx, auth) => {
    const key = nameKeyOf(new URL(req.url).searchParams.get('key'))
    if (!key) return NextResponse.json({ error: 'invalid_key' }, { status: 400 })

    const result = await removeReservedName(key)
    if (!result.ok) return NextResponse.json({ error: result.error }, { status: statusOf(result.error) })

    await logAuditEvent({
      userId: auth.user.id,
      userEmail: auth.user.email,
      action: 'REMOVE_RESERVED_PUBLIC_NAME',
      entity: 'USER',
      entityId: key,
      description: `Nome reservado ${key} retirado`,
      request: req,
    })
    return NextResponse.json({ removed: result.value })
  })
)
