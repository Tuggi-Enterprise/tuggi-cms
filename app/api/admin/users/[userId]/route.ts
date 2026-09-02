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
 * NADA DISSO ERA PEGO POR CI. `npm run check:routes` reporta rotas sem `withAuth`, mas não está
 * em `check-all`, nem em `pre-build`, nem em `.github/workflows/deploy-producao.yml` — 118 dos
 * 171 arquivos de rota ainda exportam função simples. Corrigir esta não corrige aquelas.
 */

import { NextResponse } from 'next/server'
import { withAuth } from '@/lib/auth-middleware'
import { logAuditEvent } from '@/lib/services/audit-service'
import { MODULE_MIN_ROLES, TOGGLEABLE_MODULES, type ModuleId } from '@/lib/modules'

/** Campos que o PATCH aceita. `role` e `client_id` são imutáveis após a criação. */
const ALLOWED_FIELDS = ['email', 'full_name', 'is_active', 'enabled_modules'] as const

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

    const { data: currentUser, error: fetchError } = await auth.supabase
      .schema('core')
      .from('cms_users')
      .select('*')
      .eq('id', userId)
      .single()

    if (fetchError || !currentUser) {
      return NextResponse.json({ error: 'User not found' }, { status: 404 })
    }

    // `role` e `client_id` são imutáveis após a criação — e a imutabilidade da role é o que
    // deixa a validação de módulos abaixo confiar em `currentUser.role` como a role do alvo.
    if ('role' in body || 'client_id' in body) {
      return NextResponse.json(
        { error: 'Cannot update role or client_id after user creation' },
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

    if ('enabled_modules' in updateData) {
      const checked = validateModules(updateData.enabled_modules, currentUser.role)
      if (!Array.isArray(checked)) {
        return NextResponse.json({ error: checked.error }, { status: 400 })
      }
      updateData.enabled_modules = checked
    }

    if ('email' in updateData && updateData.email !== currentUser.email) {
      const { count: emailCount } = await auth.supabase
        .schema('core')
        .from('cms_users')
        .select('id', { count: 'exact' })
        .eq('email', updateData.email)

      if (emailCount && emailCount > 0) {
        return NextResponse.json({ error: 'Email already exists' }, { status: 409 })
      }
    }

    const { data: user, error: updateError } = await auth.supabase
      .schema('core')
      .from('cms_users')
      .update({ ...updateData, updated_at: new Date().toISOString() })
      .eq('id', userId)
      .select()
      .single()

    if (updateError) {
      return NextResponse.json({ error: updateError.message }, { status: 500 })
    }

    // Os módulos concedidos entram na descrição: "campos alterados: enabled_modules" não diz se
    // alguém ganhou ou perdeu o Financeiro, que é a única coisa que se quer saber deste log.
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

    return NextResponse.json({ success: true, user })
  }
)

export const DELETE = withAuth<{ userId: string }>(
  { roles: ['admin'] },
  async (req, ctx, auth) => {
    const params = await ctx.params
    const userId = params?.userId
    if (!userId) {
      return NextResponse.json({ error: 'Missing userId' }, { status: 400 })
    }

    const { data: user, error: userError } = await auth.supabase
      .schema('core')
      .from('cms_users')
      .select('id, email')
      .eq('id', userId)
      .single()

    if (userError || !user) {
      return NextResponse.json({ error: 'User not found' }, { status: 404 })
    }

    const { error: deleteError } = await auth.supabase
      .schema('core')
      .from('cms_users')
      .delete()
      .eq('id', userId)

    if (deleteError) {
      return NextResponse.json({ error: deleteError.message }, { status: 500 })
    }

    // A conta de Auth NÃO é apagada aqui, e isso é de antes desta rodada: a linha de
    // `core.cms_users` é o que dá acesso ao CMS, e sem ela o login não leva a lugar nenhum.
    // Remover a conta de Auth é ato separado, feito no painel.
    //
    // ESTE ATO SEGUE SEM AUDITORIA, como já estava. `AuditAction` não tem valor para "apagou um
    // usuário do CMS", e inventar um aqui seria arriscar um `insert` recusado por constraint em
    // `core.audit_logs.action` — e `logAuditEvent` engole o erro. Um log que falha em silêncio é
    // pior que a ausência declarada dele. Auditar isto pede a ação nova E a migration, juntas.

    return NextResponse.json({ success: true, message: 'User deleted successfully' })
  }
)
