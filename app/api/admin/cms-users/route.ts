/**
 * POST /api/admin/cms-users — invites a person to the CMS team (#941).
 *
 * The "Enviar Convite" button of `app/[locale]/users/cms/page.tsx` used to call
 * `auth.admin.inviteUserByEmail` in the browser with the publishable key. GoTrue refuses
 * that without the service role, so nobody was ever invited. The invite and the insert
 * into `core.cms_users` now happen here, behind `withAuth({ roles: ['admin'] })`.
 *
 * Why the service client for the insert too: RLS on `core.cms_users` lets `authenticated`
 * read and only `service_role` insert. The gate above is the barrier that remains.
 *
 * Order matters and is idempotent on retry:
 *   1. the CMS row is checked first, so an e-mail already on the team gets 409 and no mail;
 *   2. the invite goes out; an address that already has an Auth account (an app user, a
 *      previous half-done invite) is not an error: GoTrue sends no invite to it, so it gets
 *      a password link to the same page instead, because an app account often has no
 *      password at all (OTP, Google) and the CMS signs in by password only;
 *   3. the row is written. A failure here leaves an Auth user with no CMS row, and
 *      repeating the request finishes the job through step 2's "already exists" branch.
 * The Auth user is never deleted on failure: it may be a tourist of the app.
 */

import { NextRequest, NextResponse } from 'next/server'
import { withAuth } from '@/lib/auth-middleware'
import { getSupabaseService } from '@/lib/core/supabase-client'
import { CMS_ROLES, type Role } from '@/lib/roles'
import { logAuditEvent } from '@/lib/services/audit-service'
import { sendSetPasswordLink, setPasswordRedirectTo } from '@/lib/services/cms-password-link'

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
const EMAIL_MAX = 254
const FULL_NAME_MAX = 200

const DUPLICATE_MESSAGE = 'Este email já está cadastrado no CMS'

interface InviteInput {
  email: string
  fullName: string | null
  role: Role
}

function parseInput(body: unknown): InviteInput | string {
  if (!body || typeof body !== 'object') return 'Corpo da requisição inválido'
  const { email, full_name, role } = body as Record<string, unknown>

  if (typeof email !== 'string') return 'Email é obrigatório'
  // GoTrue stores e-mail in lower case and the gate matches `cms_users.email` against it.
  const normalized = email.trim().toLowerCase()
  if (normalized.length > EMAIL_MAX || !EMAIL_PATTERN.test(normalized)) return 'Email inválido'

  if (full_name !== undefined && full_name !== null && typeof full_name !== 'string') {
    return 'Nome inválido'
  }
  const fullName = typeof full_name === 'string' ? full_name.trim() : ''
  if (fullName.length > FULL_NAME_MAX) return 'Nome muito longo'

  if (typeof role !== 'string' || !(CMS_ROLES as readonly string[]).includes(role)) {
    return 'Papel inválido'
  }

  return { email: normalized, fullName: fullName || null, role: role as Role }
}

export const POST = withAuth({ roles: ['admin'] }, async (req: NextRequest, _ctx, auth) => {
  let body: unknown
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'Corpo da requisição inválido' }, { status: 400 })
  }

  const input = parseInput(body)
  if (typeof input === 'string') {
    return NextResponse.json({ error: input }, { status: 400 })
  }

  const service = getSupabaseService()

  const { data: existing, error: lookupError } = await service
    .schema('core')
    .from('cms_users')
    .select('id')
    .eq('email', input.email)
    .maybeSingle()

  if (lookupError) {
    console.error('[cms-users invite] lookup failed:', lookupError.code)
    return NextResponse.json({ error: 'Erro ao consultar usuários do CMS' }, { status: 500 })
  }
  if (existing) {
    return NextResponse.json({ error: DUPLICATE_MESSAGE }, { status: 409 })
  }

  const redirectTo = setPasswordRedirectTo(req)
  const { data: invited, error: inviteError } = await service.auth.admin.inviteUserByEmail(input.email, {
    data: input.fullName ? { full_name: input.fullName } : undefined,
    redirectTo,
  })

  // `email_exists` is GoTrue's documented code for an address that already has an account.
  const alreadyInAuth = inviteError?.code === 'email_exists'
  if (inviteError && !alreadyInAuth) {
    console.error('[cms-users invite] invite failed:', inviteError.code ?? inviteError.status)
    return NextResponse.json({ error: 'Não foi possível enviar o convite' }, { status: 502 })
  }

  const { data: row, error: insertError } = await service
    .schema('core')
    .from('cms_users')
    .insert({
      // Same id as the Auth user when we just created it, like `POST /api/admin/users`.
      ...(invited?.user?.id ? { id: invited.user.id } : {}),
      email: input.email,
      full_name: input.fullName,
      role: input.role,
      is_active: true,
    })
    .select('id, email, full_name, role, is_active')
    .single()

  if (insertError) {
    if (insertError.code === '23505') {
      return NextResponse.json({ error: DUPLICATE_MESSAGE }, { status: 409 })
    }
    console.error('[cms-users invite] insert failed:', insertError.code)
    return NextResponse.json({ error: 'Erro ao cadastrar usuário no CMS' }, { status: 500 })
  }

  // Only after the row exists: a link to a CMS the person cannot enter is a dead end.
  let mail: 'invite' | 'password_link' | 'none' = 'invite'
  if (alreadyInAuth) {
    const linkError = await sendSetPasswordLink(service, input.email, redirectTo)
    mail = linkError ? 'none' : 'password_link'
  }

  await logAuditEvent({
    request: req,
    action: 'INVITE_CMS_USER',
    entity: 'USER',
    entityId: row.id,
    userId: auth.cmsUser.id,
    userEmail: auth.user.email ?? null,
    description: `Invited CMS user with role ${input.role}, mail: ${mail}`,
  })

  return NextResponse.json({ user: row, mail }, { status: 200 })
})
