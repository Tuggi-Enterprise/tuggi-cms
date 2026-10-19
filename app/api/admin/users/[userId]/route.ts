/**
 * GET/PATCH/DELETE /api/admin/users/{userId} — a ficha de um usuário do CMS.
 *
 * ESTA É A ROTA QUE CONCEDE MÓDULO. `enabled_modules` sai daqui e de nenhum outro lugar: o POST
 * irmão nem sequer aceita o campo. Ela decide, portanto, quem entra em `/finance` — e por isso
 * precisa ser pelo menos tão forte quanto o portão que ela abre.
 *
 * POR QUE `withAuth` E NÃO `getSession()`: até 2026-09-01 a autorização daqui saía de
 * `supabaseAuth.auth.getSession()`, que lê o cookie da requisição sem falar com o servidor de
 * Auth. O cabeçalho de `lib/auth-middleware.ts` diz em palavras por que isso não pode embasar
 * autorização, e o efeito prático era concreto: uma sessão revogada no painel seguia concedendo
 * módulo até o cookie expirar. `withAuth` usa `getUser()`, que revalida a cada chamada.
 *
 * WHY THE SERVICE CLIENT FOR WRITES (#969): on `core.cms_users` the `authenticated` role only has
 * SELECT; UPDATE and DELETE belong to `service_role`. With the cookie client the PATCH wrote 0
 * rows and the screen showed "Cannot coerce the result to a single JSON object", and the DELETE
 * answered "deleted" without deleting anything. `withAuth({ roles: ['admin'] })` is the barrier
 * that remains, as in `POST /api/admin/cms-users` (#941). Every write checks the row it wrote:
 * 0 rows is an error.
 *
 * NO PASSWORD, NO E-MAIL (#969, security review): the PATCH used to set the password of the Auth
 * account found by the row's e-mail, and to let the admin change that e-mail. Together they let an
 * admin point a row at any address, a tourist of the app included, and take the account over. The
 * password now goes by link to the owner (`./password-link/route.ts`), and changing the e-mail is
 * inviting again.
 *
 * LOCKOUT GUARD: deactivating or deleting yourself, or the last active admin, gets 409. Without it
 * one click leaves the CMS with no one who can grant access back.
 *
 * NADA DISSO ERA PEGO POR CI. `npm run check:routes` reporta rotas sem `withAuth`, mas não está
 * em `check-all`, nem em `pre-build`, nem em `.github/workflows/deploy-producao.yml` — 118 dos
 * 171 arquivos de rota ainda exportam função simples. Corrigir esta não corrige aquelas.
 */

import { NextResponse } from 'next/server'
import { withAuth } from '@/lib/auth-middleware'
import { getSupabaseService } from '@/lib/core/supabase-client'
import { logAuditEvent } from '@/lib/services/audit-service'
import { MODULE_MIN_ROLES, TOGGLEABLE_MODULES, type ModuleId } from '@/lib/modules'

/**
 * Columns of `core.cms_users` the PATCH accepts. `role` and `client_id` are immutable after
 * creation; `email` and `password` are refused, see the header.
 */
const ALLOWED_FIELDS = ['full_name', 'is_active', 'enabled_modules'] as const

type ServiceClient = ReturnType<typeof getSupabaseService>

/**
 * `enabled_modules` é uma coluna de texto: sem isto, qualquer string entrava.
 *
 * Duas recusas, e a segunda é a que importa. A primeira barra o módulo que não existe —
 * `['finanace']` gravava em silêncio e a checkbox voltava desmarcada sem explicação. A segunda
 * barra o módulo que existe mas que a role do alvo não alcança: gravar `finance` num `client`
 * cria um entitlement que `isModuleEnabled` recusa em toda porta, ou seja, uma permissão que a
 * tela de admin mostra ligada e que não liga nada.
 *
 * O piso vem de `MODULE_MIN_ROLES`, e não de uma lista local, porque é o mesmo piso que o
 * middleware e o `requireModule` aplicam. Uma segunda cópia aqui seria a divergência de novo.
 */
function validateModules(value: unknown, targetRole: string): string[] | { error: string } {
  if (!Array.isArray(value) || value.some((m) => typeof m !== 'string')) {
    return { error: 'enabled_modules must be an array of strings' }
  }

  const mods = Array.from(new Set(value as string[]))

  const unknown = mods.filter((m) => !TOGGLEABLE_MODULES.includes(m as ModuleId))
  if (unknown.length > 0) {
    return { error: `Unknown module(s): ${unknown.join(', ')}` }
  }

  // Admin ignora o array por código, então o piso não se aplica a ele.
  if (targetRole !== 'admin') {
    const outOfReach = mods.filter((m) => {
      const minRoles: readonly string[] | undefined = MODULE_MIN_ROLES[m as ModuleId]
      return !!minRoles && !minRoles.includes(targetRole)
    })
    if (outOfReach.length > 0) {
      return {
        error: `Module(s) not available to role '${targetRole}': ${outOfReach.join(', ')}`,
      }
    }
  }

  return mods
}

/**
 * Why removing `target` from the active team is refused, or `null` when it is allowed. `callerEmail`
 * is the e-mail the gate matched; the comparison is case-insensitive like GoTrue's.
 */
async function lockoutReason(
  service: ServiceClient,
  target: { id: string; email: string; role: string; is_active: boolean },
  callerEmail: string | null | undefined
): Promise<{ error: string; status: number } | null> {
  if (callerEmail && target.email.toLowerCase() === callerEmail.toLowerCase()) {
    return { error: 'You cannot deactivate or delete your own account', status: 409 }
  }
  if (target.role !== 'admin' || !target.is_active) return null

  const { data: admins, error } = await service
    .schema('core')
    .from('cms_users')
    .select('id')
    .eq('role', 'admin')
    .eq('is_active', true)

  if (error) {
    console.error('[admin users] admin count failed:', error.code)
    return { error: 'Failed to check the remaining admins', status: 500 }
  }
  const others = (admins ?? []).filter((a: { id: string }) => a.id !== target.id)
  if (others.length === 0) {
    return { error: 'This is the last active admin of the CMS', status: 409 }
  }
  return null
}

export const GET = withAuth<{ userId: string }>(
  { roles: ['admin'] },
  async (_req, ctx, auth) => {
    const params = await ctx.params
    const userId = params?.userId
    if (!userId) {
      return NextResponse.json({ error: 'Missing userId' }, { status: 400 })
    }

    const { data: user, error } = await auth.supabase
      .schema('core')
      .from('cms_users')
      .select('id, email, full_name, role, is_active, client_id, enabled_modules, created_at')
      .eq('id', userId)
      .single()

    if (error || !user) {
      return NextResponse.json({ error: 'User not found' }, { status: 404 })
    }

    return NextResponse.json({ success: true, user })
  }
)

export const PATCH = withAuth<{ userId: string }>(
  { roles: ['admin'] },
  async (req, ctx, auth) => {
    const params = await ctx.params
    const userId = params?.userId
    if (!userId) {
      return NextResponse.json({ error: 'Missing userId' }, { status: 400 })
    }

    let body: Record<string, unknown>
    try {
      body = await req.json()
    } catch {
      return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
    }
    if (!body || typeof body !== 'object' || Array.isArray(body)) {
      return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
    }

    // `role` and `client_id` are immutable after creation, and the immutable role is what lets
    // the module check below trust `currentUser.role` as the target's role.
    if ('role' in body || 'client_id' in body) {
      return NextResponse.json(
        { error: 'Cannot update role or client_id after user creation' },
        { status: 400 }
      )
    }
    if ('email' in body) {
      return NextResponse.json(
        { error: 'The e-mail cannot be changed. Invite the new address instead' },
        { status: 400 }
      )
    }
    if ('password' in body) {
      return NextResponse.json(
        { error: 'The password is not set here. Send the password link instead' },
        { status: 400 }
      )
    }

    const updateData: Record<string, unknown> = {}
    for (const field of ALLOWED_FIELDS) {
      if (field in body) {
        updateData[field] = body[field]
      }
    }

    if (Object.keys(updateData).length === 0) {
      return NextResponse.json({ error: 'No fields to update' }, { status: 400 })
    }

    if ('is_active' in updateData && typeof updateData.is_active !== 'boolean') {
      return NextResponse.json({ error: 'is_active must be a boolean' }, { status: 400 })
    }

    const service = getSupabaseService()

    const { data: currentUser, error: fetchError } = await service
      .schema('core')
      .from('cms_users')
      .select('*')
      .eq('id', userId)
      .maybeSingle()

    if (fetchError) {
      console.error('[admin users] lookup failed:', fetchError.code)
      return NextResponse.json({ error: 'Failed to read the CMS user' }, { status: 500 })
    }
    if (!currentUser) {
      return NextResponse.json({ error: 'User not found' }, { status: 404 })
    }

    if ('enabled_modules' in updateData) {
      const checked = validateModules(updateData.enabled_modules, currentUser.role)
      if (!Array.isArray(checked)) {
        return NextResponse.json({ error: checked.error }, { status: 400 })
      }
      updateData.enabled_modules = checked
    }

    if (updateData.is_active === false) {
      const refused = await lockoutReason(service, currentUser, auth.cmsUser.email)
      if (refused) {
        return NextResponse.json({ error: refused.error }, { status: refused.status })
      }
    }

    const { data: updated, error: updateError } = await service
      .schema('core')
      .from('cms_users')
      .update({ ...updateData, updated_at: new Date().toISOString() })
      .eq('id', userId)
      .select()

    if (updateError) {
      console.error('[admin users] update failed:', updateError.code)
      return NextResponse.json({ error: 'Failed to save the CMS user' }, { status: 500 })
    }
    if (!updated || updated.length !== 1) {
      return NextResponse.json(
        { error: 'The CMS user was not saved: no row was updated' },
        { status: 500 }
      )
    }

    // The granted modules go into the description: "fields changed: enabled_modules" does not
    // say whether someone gained or lost Finance, which is all anyone wants from this log.
    const updatedFields = Object.keys(updateData)
    const modulesNote =
      'enabled_modules' in updateData
        ? ` (modules: ${(updateData.enabled_modules as string[]).join('+') || 'none'})`
        : ''

    await logAuditEvent({
      request: req,
      action: 'UPDATE_PROFILE',
      entity: 'USER',
      entityId: userId,
      userId: auth.user.id,
      userEmail: auth.cmsUser.email ?? null,
      description: `Updated CMS user fields: ${updatedFields.join(', ')}${modulesNote}`,
    })

    return NextResponse.json({ success: true, user: updated[0] })
  }
)

export const DELETE = withAuth<{ userId: string }>(
  { roles: ['admin'] },
  async (_req, ctx, auth) => {
    const params = await ctx.params
    const userId = params?.userId
    if (!userId) {
      return NextResponse.json({ error: 'Missing userId' }, { status: 400 })
    }

    const service = getSupabaseService()

    const { data: target, error: fetchError } = await service
      .schema('core')
      .from('cms_users')
      .select('id, email, role, is_active')
      .eq('id', userId)
      .maybeSingle()

    if (fetchError) {
      console.error('[admin users] lookup failed:', fetchError.code)
      return NextResponse.json({ error: 'Failed to read the CMS user' }, { status: 500 })
    }
    if (!target) {
      return NextResponse.json({ error: 'User not found' }, { status: 404 })
    }

    const refused = await lockoutReason(service, target, auth.cmsUser.email)
    if (refused) {
      return NextResponse.json({ error: refused.error }, { status: refused.status })
    }

    const { data: deleted, error: deleteError } = await service
      .schema('core')
      .from('cms_users')
      .delete()
      .eq('id', userId)
      .select('id')

    if (deleteError) {
      console.error('[admin users] delete failed:', deleteError.code)
      return NextResponse.json({ error: 'Failed to delete the CMS user' }, { status: 500 })
    }
    if (!deleted || deleted.length === 0) {
      return NextResponse.json({ error: 'User not found' }, { status: 404 })
    }

    // The Auth account is NOT deleted here, as before: the `core.cms_users` row is what grants
    // access to the CMS, and without it the login leads nowhere. Removing the Auth account is a
    // separate act, done in the dashboard.
    //
    // THIS ACT IS STILL NOT AUDITED. `AuditAction` has no value for "deleted a CMS user", and
    // inventing one here would risk an insert refused by the constraint on
    // `core.audit_logs.action`, which `logAuditEvent` swallows. A log that fails silently is
    // worse than its declared absence. Auditing this needs the new action AND the migration.

    return NextResponse.json({ success: true, message: 'User deleted successfully' })
  }
)
