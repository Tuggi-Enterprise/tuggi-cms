import { NextRequest, NextResponse } from 'next/server'
import { createRouteHandlerClient } from '@supabase/auth-helpers-nextjs'
import { cookies } from 'next/headers'
import { getSupabase } from '@/lib/core/supabase-client'

const supabaseService = getSupabase('service')

export async function DELETE(request: NextRequest, { params }: { params: { poiId: string } }) {
  try {
    const poiId = params.poiId
    const cookieStore = await cookies()
    const supabaseAuth = createRouteHandlerClient({ cookies: () => cookieStore as any })
    const { data: { session }, error: authError } = await supabaseAuth.auth.getSession()
    if (authError || !session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const { data: cmsUser, error: cmsErr } = await supabaseAuth
      .schema('core')
      .from('cms_users')
      .select('id, role, is_active')
      .eq('email', session.user.email as string)
      .eq('is_active', true)
      .single()

    if (cmsErr || !cmsUser) return NextResponse.json({ error: 'Unauthorized - CMS access denied' }, { status: 403 })

    // Fetch attraction to check ownership
    const { data: attraction, error: attrErr } = await supabaseService
      .schema('core')
      .from('attractions')
      .select('id, name, created_by')
      .eq('id', poiId)
      .single()

    if (attrErr || !attraction) return NextResponse.json({ error: 'POI not found' }, { status: 404 })

    const isAdmin = cmsUser.role === 'admin' || cmsUser.role === 'super_admin'
    const isOwner = attraction.created_by === cmsUser.id

    if (!isAdmin && !isOwner) {
      return NextResponse.json({ error: 'Unauthorized - can only delete your own POIs' }, { status: 403 })
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
    const supabaseAuth = createRouteHandlerClient({ cookies: () => cookieStore as any })
    const { data: { session }, error: authError } = await supabaseAuth.auth.getSession()
    if (authError || !session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const { data: cmsUser, error: cmsErr } = await supabaseAuth
      .schema('core')
      .from('cms_users')
      .select('id, role, is_active')
      .eq('email', session.user.email as string)
      .eq('is_active', true)
      .single()

    if (cmsErr || !cmsUser) return NextResponse.json({ error: 'Unauthorized - CMS access denied' }, { status: 403 })

    // Fetch attraction to check ownership
    const { data: attraction, error: attrErr } = await supabaseService
      .schema('core')
      .from('attractions')
      .select('id, name, created_by')
      .eq('id', poiId)
      .single()

    if (attrErr || !attraction) return NextResponse.json({ error: 'POI not found' }, { status: 404 })

    const isAdmin = cmsUser.role === 'admin' || cmsUser.role === 'super_admin'
    const isOwner = attraction.created_by === cmsUser.id

    if (!isAdmin && !isOwner) {
      return NextResponse.json({ error: 'Unauthorized - can only update your own POIs' }, { status: 403 })
    }

    // Allow patching only certain fields from clients
    const allowed = ['name', 'city', 'state', 'formatted_address', 'website', 'contact_phone']
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

    return NextResponse.json({ success: true, updated })

  } catch (err) {
    console.error('Error in client POI patch:', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
