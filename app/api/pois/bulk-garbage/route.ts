import { NextResponse } from 'next/server'
import { getSupabase } from '@/lib/core/supabase-client'
import { withAuth } from '@/lib/auth-middleware'
import { logAuditEvent } from '@/lib/services/audit-service'

const supabaseService = getSupabase('service')

/**
 * POST /api/pois/bulk-garbage
 *
 * Marca vários POIs como lixo (blacklist) e os APAGA de `core.attractions`. Só admin.
 *
 * O PORTÃO ESTAVA ESCRITO NO DOCSTRING E NÃO NO CÓDIGO (corrigido em 2026-09-01). A rota exigia
 * sessão, buscava o `cms_user` e recusava quando ele não existia — mas NUNCA comparava
 * `cmsUser.role` com `'admin'`. Qualquer conta do CMS com sessão (um `client`, que é um
 * parceiro) apagava POIs em massa repetindo a chamada pelo DevTools. O botão só existia para
 * admin na tela (`app/[locale]/pois/page.tsx`, `canGarbage={isAdmin}`), e o proxy não cobre
 * `/api` — a UI era a única barreira, e UI não é barreira.
 *
 * Agravante que o `withAuth` também resolve: a identidade vinha de `getSession()`, que lê o
 * cookie sem falar com o servidor de Auth, e a consulta seguinte ia com `service_role` — então
 * o PostgREST nunca via o JWT e nunca o rejeitava. `getUser()`, dentro do `withAuth`, revalida.
 *
 * A LEITURA COM `service_role` FICA, e o motivo é o do parecer de 2026-08-23:
 * `core.get_cms_user_info(text)` é `SECURITY DEFINER` e não confere quem chama — enquanto ela
 * tiver `EXECUTE` para `authenticated`, qualquer conta do app descobre o `uuid` de um admin, que
 * é a chave que `core.delete_poi_as_garbage` aceita como autorização. Lendo aqui com
 * `service_role`, aquele `EXECUTE` pode ser revogado sem quebrar esta rota. O que mudou é que o
 * `role` agora é provado ANTES, pelo gate, e não inferido da existência da linha.
 */
export const POST = withAuth({ roles: ['admin'] }, async (request, _ctx, auth) => {
  try {
    const { poiIds } = await request.json()

    if (!poiIds || !Array.isArray(poiIds) || poiIds.length === 0) {
      return NextResponse.json({ error: 'POI IDs array is required' }, { status: 400 })
    }

    // O `id` do cms_user ainda vem daqui: `withAuth` prova email, role e is_active, mas
    // `bulk_delete_poi_as_garbage` quer o uuid, e é este RPC que sabe traduzir um pelo outro.
    const { data: userData, error: userErr } = await supabaseService
      .schema('core')
      .rpc('get_cms_user_info', { p_email: auth.cmsUser.email })

    const cmsUser = Array.isArray(userData) ? userData[0] : userData

    if (userErr || !cmsUser) {
      return NextResponse.json({ error: 'Unauthorized - CMS access denied' }, { status: 403 })
    }

    const { error: rpcError } = await supabaseService
      .schema('core')
      .rpc('bulk_delete_poi_as_garbage', {
        p_poi_ids: poiIds,
        p_admin_id: cmsUser.id,
      })

    if (rpcError) {
      console.error('Error calling bulk_delete_poi_as_garbage:', rpcError)
      return NextResponse.json({ error: 'Failed to mark POIs as garbage' }, { status: 500 })
    }

    await logAuditEvent({
      request,
      action: 'DELETE_POI',
      entity: 'POI',
      entityId: poiIds.join(', '),
      userId: cmsUser.id,
      userEmail: auth.cmsUser.email,
      description: `Bulk marked ${poiIds.length} POIs as garbage and deleted.`,
    })

    return NextResponse.json({ success: true, message: `${poiIds.length} POIs marked as garbage` })
  } catch (err) {
    console.error('Error in bulk POI garbage delete:', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
})
