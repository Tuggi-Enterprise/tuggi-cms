import { NextRequest, NextResponse } from 'next/server'
import { createRouteHandlerClient } from '@supabase/auth-helpers-nextjs'
import { cookies } from 'next/headers'

export async function GET(request: NextRequest) {
  try {
    const cookieStore = await cookies()
    const supabaseAuth = createRouteHandlerClient({ cookies: () => cookieStore as any })
    const { data: { session }, error: authError } = await supabaseAuth.auth.getSession()

    if (authError || !session) {
      return NextResponse.json({ error: 'Unauthorized - Authentication required' }, { status: 401 })
    }

    // Find CMS user record for role and id
    const { data: cmsUser, error: cmsErr } = await supabaseAuth
      .schema('core')
      .from('cms_users')
      .select('id, role, is_active')
      .eq('email', session.user.email as string)
      .eq('is_active', true)
      .single()

    if (cmsErr || !cmsUser) {
      return NextResponse.json({ error: 'Unauthorized - CMS access denied' }, { status: 403 })
    }

    // Only clients (and admins) can use this endpoint
    if (!['client', 'admin'].includes(cmsUser.role)) {
      return NextResponse.json({ error: 'Unauthorized - Insufficient privileges' }, { status: 403 })
    }

    // Query attractions created by this cms_user (service role is used internally via supabaseAuth)
    const { data: pois, error: poisErr } = await supabaseAuth
      .schema('core')
      .from('attractions')
      .select('id, name, city, state, country, approved, created_at, updated_at')
      .eq('created_by', cmsUser.id)
      .order('created_at', { ascending: false })

    if (poisErr) {
      return NextResponse.json({ error: 'Failed to fetch POIs', details: poisErr.message }, { status: 500 })
    }

    return NextResponse.json({ success: true, pois: pois || [] })
  } catch (err) {
    console.error('Error fetching client POIs:', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
