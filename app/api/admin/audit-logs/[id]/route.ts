import { NextRequest, NextResponse } from 'next/server'
import { getSupabaseRouteHandler } from '@/lib/core/supabase-client'
import { cookies } from 'next/headers'

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params
    const cookieStore = await cookies()
    const supabaseAuth = getSupabaseRouteHandler(cookieStore)

    const { data: { session }, error: authError } = await supabaseAuth.auth.getSession()
    if (authError || !session) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const { data: cmsUser, error: cmsError } = await supabaseAuth
      .schema('core')
      .from('cms_users')
      .select('role, is_active')
      .eq('email', session.user.email as string)
      .eq('is_active', true)
      .single()

    if (cmsError || !cmsUser || cmsUser.role !== 'admin') {
      return NextResponse.json({ error: 'Forbidden - Admin only' }, { status: 403 })
    }

    const { data: log, error } = await supabaseAuth
      .schema('core')
      .from('audit_logs')
      .select('*')
      .eq('id', id)
      .single()

    if (error || !log) {
      return NextResponse.json({ error: 'Log not found' }, { status: 404 })
    }

    return NextResponse.json({ success: true, log })
  } catch (error) {
    console.error('Audit log detail error:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
