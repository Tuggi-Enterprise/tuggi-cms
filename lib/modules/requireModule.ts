/**
 * requireModule — guard de módulo para API routes.
 *
 * O middleware NÃO cobre /api/*, então cada route de /api/events/* e
 * /api/places/* chama isto no topo. Usa getUser() (revalida o JWT), lê role +
 * enabled_modules de core.cms_users e aplica o SSOT isModuleEnabled().
 *
 * Uso:
 *   const gate = await requireModule(MODULES.EVENTS, await cookies())
 *   if (!gate.ok) return gate.response
 *   // gate.user.{email,role,enabledModules} disponíveis
 */
import { NextResponse } from 'next/server'
import type { cookies } from 'next/headers'
import { getSupabaseRouteHandler } from '@/lib/core/supabase-client'
import { isModuleEnabled, type ModuleId } from './index'

type CookieStore = Awaited<ReturnType<typeof cookies>>

export type ModuleGateResult =
  | { ok: true; user: { email: string; role: string; enabledModules: string[] } }
  | { ok: false; response: NextResponse }

export async function requireModule(
  mod: ModuleId,
  cookieStore: CookieStore
): Promise<ModuleGateResult> {
  const supabase = getSupabaseRouteHandler(cookieStore)

  const {
    data: { user },
    error,
  } = await supabase.auth.getUser()
  if (error || !user?.email) {
    return { ok: false, response: NextResponse.json({ error: 'Unauthorized' }, { status: 401 }) }
  }

  const { data: cmsUser } = await supabase
    .schema('core')
    .from('cms_users')
    .select('role, is_active, enabled_modules')
    .eq('email', user.email)
    .single()

  if (!cmsUser || cmsUser.is_active === false) {
    return { ok: false, response: NextResponse.json({ error: 'Forbidden' }, { status: 403 }) }
  }

  const enabledModules = (cmsUser.enabled_modules ?? []) as string[]
  if (!isModuleEnabled(mod, { role: cmsUser.role, enabledModules })) {
    return {
      ok: false,
      response: NextResponse.json({ error: `Module '${mod}' not enabled` }, { status: 403 }),
    }
  }

  return { ok: true, user: { email: user.email, role: cmsUser.role, enabledModules } }
}
