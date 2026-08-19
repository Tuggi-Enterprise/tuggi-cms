/**
 * PATCH /api/admin/users/[userId]/client - Set or clear an app user's linked client.
 *
 * The link is the column drive.profiles.client_id (FK -> partner.clients,
 * ON DELETE SET NULL). Once populated, the app surfaces that client's partner QR
 * (https://tuggi.app/d/<slug>) in the user's Passaporte via drive.get_user_profile_v1.
 *
 * The current link is read through the core.dashboard_user_detail RPC (linked_client
 * field) — there is no GET here. Writes go through the core.admin_set_app_user_client
 * RPC, called with the service role. This route owns the admin gate and audit log.
 *
 * NOTE: this is the APP user <-> client link (drive.profiles / auth.users identity),
 * unrelated to the CMS user <-> client link (partner.client_cms_users / "Team" tab).
 */

import { NextRequest, NextResponse } from 'next/server'
import { cookies } from 'next/headers'
import { getSupabaseRouteHandler, getSupabaseService } from '@/lib/core/supabase-client'
import { logAuditEvent } from '@/lib/services/audit-service'

async function getAdminUser(request: NextRequest) {
  const cookieStore = await cookies()
  const supabaseAuth = getSupabaseRouteHandler(cookieStore)

  const { data: { session }, error: authError } = await supabaseAuth.auth.getSession()
  if (authError || !session) {
    return { error: 'unauthorized' as const, status: 401 }
  }

  const { data: cmsUser, error: cmsError } = await supabaseAuth
    .schema('core')
    .from('cms_users')
    .select('id, email, role, is_active')
    .eq('email', session.user.email as string)
    .eq('is_active', true)
    .single()

  if (cmsError || !cmsUser || cmsUser.role !== 'admin') {
    return { error: 'forbidden' as const, status: 403 }
  }

  return { cmsUser }
}

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ userId: string }> }
) {
  try {
    const admin = await getAdminUser(request)
    if ('error' in admin) {
      return NextResponse.json({ error: admin.error }, { status: admin.status })
    }

    const { userId } = await params
    const body = await request.json()

    if (!('client_id' in body)) {
      return NextResponse.json({ error: 'client_id is required (uuid or null)' }, { status: 400 })
    }

    const clientId: string | null = body.client_id || null

    // Validation + write happen inside the RPC (service role bypasses RLS on drive.profiles).
    const { error: rpcError } = await getSupabaseService()
      .schema('partner')
      .rpc('admin_set_app_user_client', {
        target_user_id: userId,
        target_client_id: clientId,
      })

    if (rpcError) {
      if (rpcError.message?.includes('client_not_found')) {
        return NextResponse.json({ error: 'client_not_found' }, { status: 400 })
      }
      if (rpcError.message?.includes('app_user_not_found')) {
        return NextResponse.json({ error: 'app_user_not_found' }, { status: 404 })
      }
      console.error('❌ admin_set_app_user_client failed:', rpcError)
      return NextResponse.json({ error: rpcError.message }, { status: 500 })
    }

    await logAuditEvent({
      request,
      action: 'UPDATE_PROFILE',
      entity: 'USER',
      entityId: userId,
      userId: admin.cmsUser.id,
      userEmail: admin.cmsUser.email ?? null,
      description: clientId
        ? `Admin linked app user ${userId} to client ${clientId}`
        : `Admin unlinked app user ${userId} from its client`
    })

    return NextResponse.json({ success: true, client_id: clientId })
  } catch (error) {
    console.error('❌ Error updating app user client link:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
