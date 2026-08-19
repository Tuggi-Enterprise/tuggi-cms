import type { SupabaseClient } from '@supabase/supabase-js'

/**
 * Resolve os `client_id`(s) vinculados ao usuário autenticado na sessão
 * Recebe um Supabase client criado via `createRouteHandlerClient` (tem acesso a cookies/session)
 */
export async function resolveClientIds(supabaseAuth: any): Promise<string[]> {
  try {
    const { data: { session } } = await supabaseAuth.auth.getSession()
    if (!session) return []

    const { data: cmsUser } = await supabaseAuth
      .schema('core')
      .from('cms_users')
      .select('id, client_id, role, is_active')
      .eq('email', session.user.email)
      .eq('is_active', true)
      .maybeSingle()

    if (!cmsUser) return []

    const clientIds: string[] = []
    if (cmsUser.client_id) clientIds.push(cmsUser.client_id)

    // Fetch linked clients
    const { data: links } = await supabaseAuth
      .schema('partner')
      .from('client_cms_users')
      .select('client_id')
      .eq('cms_user_id', cmsUser.id)

    if (links && Array.isArray(links)) {
      links.forEach((l: any) => {
        if (l.client_id && !clientIds.includes(l.client_id)) clientIds.push(l.client_id)
      })
    }

    return clientIds
  } catch (err) {
    // Non-fatal: log and return empty array to preserve existing behaviour
    // eslint-disable-next-line no-console
    console.warn('resolveClientIds error', err)
    return []
  }
}
