import { NextRequest, NextResponse } from 'next/server'
import { withAuth } from '@/lib/auth-middleware'
import { getSupabase } from '@/lib/core/supabase-client'
import { logAuditEvent } from '@/lib/services/audit-service'

const supabaseService = getSupabase('service')

/**
 * POST /api/pois/[id]/garbage
 * Marks a POI as garbage (blacklisted) and deletes it from core.attractions.
 * Only system admins can perform this action — `withAuth({ roles: ['admin'] })` (#780). Before, the
 * route only checked `getSession()` and that the e-mail existed in `cms_users`, with no role and no
 * `is_active`. The screen already offers it to admin only (`app/[locale]/pois/page.tsx`, `canGarbage`).
 */
export const POST = withAuth<{ id: string }>({ roles: ['admin'] }, async (request: NextRequest, ctx, auth) => {
  try {
    const { id: poiId } = (await ctx.params) as { id: string }

    /**
     * A IDENTIDADE VEM DA SESSÃO; A CONSULTA VAI COM `service_role`, e a diferença é o que
     * permite fechar a função no banco.
     *
     * `core.get_cms_user_info(text)` é `SECURITY DEFINER` e não confere NADA sobre quem chama:
     * passa um e-mail, recebe `id`, `role`, `is_active` e `client_id` do `cms_user`. Enquanto
     * ela tiver `EXECUTE` para `authenticated`, qualquer conta do app descobre o `uuid` de um
     * admin — que é a chave que `core.delete_poi_as_garbage` aceita como autorização
     * (parecer de segurança de 2026-08-23). Lendo aqui com `service_role`, o `EXECUTE` de
     * `authenticated` pode ser revogado sem quebrar esta rota.
     *
     * O e-mail continua sendo o da sessão, não do corpo do pedido: quem decide quem é o
     * chamador é o cookie, e nunca um parâmetro.
     */
    const { data: userData, error: userErr } = await supabaseService
      .schema('core')
      .rpc('get_cms_user_info', { p_email: auth.cmsUser.email })
    
    const cmsUser = Array.isArray(userData) ? userData[0] : userData

    if (userErr || !cmsUser) return NextResponse.json({ error: 'Unauthorized - CMS access denied' }, { status: 403 })

    // Call RPC to delete as garbage and get name in one go
    const { data: deleteResult, error: rpcError } = await supabaseService
      .schema('core')
      .rpc('delete_poi_as_garbage', {
        p_poi_id: poiId,
        p_admin_id: cmsUser.id
      })

    if (rpcError) {
      console.error('Error calling delete_poi_as_garbage:', rpcError)
      return NextResponse.json({ error: rpcError.message || 'Failed to mark POI as garbage' }, { status: 500 })
    }

    const attractionName = Array.isArray(deleteResult) ? deleteResult[0]?.poi_name : (deleteResult as any)?.poi_name || 'POI'

    await logAuditEvent({
      request,
      action: 'DELETE_POI',
      entity: 'POI',
      entityId: poiId,
      userId: cmsUser.id,
      userEmail: auth.cmsUser.email || null,
      description: `POI "${attractionName}" marked as garbage and deleted.`
    })

    return NextResponse.json({ success: true, message: 'POI marked as garbage' })

  } catch (err) {
    console.error('Error in POI garbage delete:', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
})
