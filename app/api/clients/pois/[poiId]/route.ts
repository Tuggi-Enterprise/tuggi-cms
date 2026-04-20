import { NextRequest, NextResponse } from 'next/server'
import { getSupabaseRouteHandler } from '@/lib/core/supabase-client'
import { cookies } from 'next/headers'
import { getSupabase } from '@/lib/core/supabase-client'
import { logAuditEvent } from '@/lib/services/audit-service'

const supabaseService = getSupabase('service')

export async function DELETE(request: NextRequest, { params }: { params: { poiId: string } }) {
  try {
    const poiId = params.poiId
    const cookieStore = await cookies()
    const supabaseAuth = getSupabaseRouteHandler(cookieStore)
    const { data: { session }, error: authError } = await supabaseAuth.auth.getSession()
    if (authError || !session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const { data: cmsUser, error: cmsErr } = await supabaseAuth
      .schema('core')
      .from('cms_users')
      .select('id, role, client_id, is_active')
      .eq('email', session.user.email as string)
      .eq('is_active', true)
      .single()

    if (cmsErr || !cmsUser) return NextResponse.json({ error: 'Unauthorized - CMS access denied' }, { status: 403 })

    // Fetch attraction to check ownership
    const { data: attraction, error: attrErr } = await supabaseService
      .schema('core')
      .from('attractions')
      .select('id, name, created_by, owner_id')
      .eq('id', poiId)
      .single()

    if (attrErr || !attraction) return NextResponse.json({ error: 'POI not found' }, { status: 404 })

    const isAdmin = cmsUser.role === 'admin' || cmsUser.role === 'super_admin'
    const isCreator = attraction.created_by === cmsUser.id
    const isClientOwner = attraction.owner_id === cmsUser.client_id && cmsUser.client_id
    const hasClientOwnerAccess = isClientOwner || (
      await checkClientUserAccess(supabaseService, cmsUser.id, attraction.owner_id, ['owner', 'manager'])
    )

    if (!isAdmin && !isCreator && !hasClientOwnerAccess) {
      return NextResponse.json({ error: 'Unauthorized - insufficient permissions' }, { status: 403 })
    }

    // Perform deletion as service role
    const { data: deleted, error: delErr } = await supabaseService
      .schema('core')
      .from('attractions')
      .delete()
      .eq('id', poiId)
      .select('id, name')

    if (delErr) {
      console.error('Error deleting POI:', delErr)
      return NextResponse.json({ error: 'Failed to delete POI' }, { status: 500 })
    }

    await logAuditEvent({
      request,
      action: 'DELETE_POI',
      entity: 'POI',
      entityId: poiId,
      userId: cmsUser.id,
      userEmail: session.user.email || null,
      description: `Deleted POI "${attraction.name}"`
    })

    return NextResponse.json({ success: true, deleted: deleted })

  } catch (err) {
    console.error('Error in client POI delete:', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

export async function PATCH(request: NextRequest, { params }: { params: { poiId: string } }) {
  try {
    const poiId = params.poiId
    const body = await request.json()

    const cookieStore = await cookies()
    const supabaseAuth = getSupabaseRouteHandler(cookieStore)
    const { data: { session }, error: authError } = await supabaseAuth.auth.getSession()
    if (authError || !session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const { data: cmsUser, error: cmsErr } = await supabaseAuth
      .schema('core')
      .from('cms_users')
      .select('id, role, client_id, is_active')
      .eq('email', session.user.email as string)
      .eq('is_active', true)
      .single()

    if (cmsErr || !cmsUser) return NextResponse.json({ error: 'Unauthorized - CMS access denied' }, { status: 403 })

    // Fetch attraction to check ownership
    const { data: attraction, error: attrErr } = await supabaseService
      .schema('core')
      .from('attractions')
      .select('id, name, created_by, owner_id')
      .eq('id', poiId)
      .single()

    if (attrErr || !attraction) return NextResponse.json({ error: 'POI not found' }, { status: 404 })

    const isAdmin = cmsUser.role === 'admin' || cmsUser.role === 'super_admin'
    const isCreator = attraction.created_by === cmsUser.id
    const isClientOwner = attraction.owner_id === cmsUser.client_id && cmsUser.client_id
    const hasClientOwnerAccess = isClientOwner || (
      await checkClientUserAccess(supabaseService, cmsUser.id, attraction.owner_id, ['owner', 'manager'])
    )

    if (!isAdmin && !isCreator && !hasClientOwnerAccess) {
      return NextResponse.json({ error: 'Unauthorized - insufficient permissions' }, { status: 403 })
    }

    // Allow patching only certain fields from clients
    const allowed = ['name', 'city', 'state', 'formatted_address', 'website', 'contact_phone', 'description']
    const updatePayload: Record<string, any> = {}
    for (const k of allowed) {
      if (k in body) updatePayload[k] = body[k]
    }

    if (Object.keys(updatePayload).length === 0) {
      return NextResponse.json({ error: 'No updatable fields provided' }, { status: 400 })
    }

    const { data: updated, error: updErr } = await supabaseService
      .schema('core')
      .from('attractions')
      .update(updatePayload)
      .eq('id', poiId)
      .select('*')
      .single()

    if (updErr) {
      console.error('Error updating POI:', updErr)
      return NextResponse.json({ error: 'Failed to update POI' }, { status: 500 })
    }

    const updatedFields = Object.keys(updatePayload)
    await logAuditEvent({
      request,
      action: 'UPDATE_POI',
      entity: 'POI',
      entityId: poiId,
      userId: cmsUser.id,
      userEmail: session.user.email || null,
      description: `Updated POI fields: ${updatedFields.join(', ')}`
    })

    return NextResponse.json({ success: true, updated })

  } catch (err) {
    console.error('Error in client POI patch:', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

/**
 * Helper function to check if a CMS user has access to a client's POIs
 */
async function checkClientUserAccess(
  supabase: any,
  cmsUserId: string,
  clientId: string | null,
  requiredRoles: string[]
): Promise<boolean> {
  if (!clientId) return false

  const { data, error } = await supabase
    .schema('core')
    .from('client_cms_users')
    .select('client_role')
    .eq('cms_user_id', cmsUserId)
    .eq('client_id', clientId)
    .in('client_role', requiredRoles)
    .single()

  return !error && !!data
}
