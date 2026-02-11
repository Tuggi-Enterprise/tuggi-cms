import { NextRequest, NextResponse } from 'next/server'
import { createRouteHandlerClient } from '@supabase/auth-helpers-nextjs'
import { cookies } from 'next/headers'

export async function GET(request: NextRequest) {
  try {
    const cookieStore = await cookies()
    const supabaseAuth = createRouteHandlerClient({ cookies: () => cookieStore as any })

    const { data: { session }, error: authError } = await supabaseAuth.auth.getSession()
    if (authError || !session) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const { data: cmsUser, error: cmsError } = await supabaseAuth
      .schema('core')
      .from('cms_users')
      .select('id, role, is_active')
      .eq('email', session.user.email as string)
      .eq('is_active', true)
      .single()

    if (cmsError || !cmsUser || cmsUser.role !== 'admin') {
      return NextResponse.json({ error: 'Forbidden - Admin only' }, { status: 403 })
    }

    const searchParams = request.nextUrl.searchParams
    const userEmail = searchParams.get('user_email') || ''
    const action = searchParams.get('action') || ''
    const entity = searchParams.get('entity') || ''
    const from = searchParams.get('from') || ''
    const to = searchParams.get('to') || ''
    const page = Math.max(1, parseInt(searchParams.get('page') || '1', 10))
    const limit = Math.min(100, Math.max(1, parseInt(searchParams.get('limit') || '20', 10)))
    const offset = (page - 1) * limit

    let query = supabaseAuth
      .schema('core')
      .from('audit_logs')
      .select('*', { count: 'exact' })

    if (userEmail) {
      query = query.ilike('user_email', `%${userEmail}%`)
    }

    if (action) {
      query = query.eq('action', action)
    }

    if (entity) {
      query = query.eq('entity', entity)
    }

    if (from) {
      query = query.gte('created_at', from)
    }

    if (to) {
      query = query.lte('created_at', to)
    }

    const { data, error, count } = await query
      .order('created_at', { ascending: false })
      .range(offset, offset + limit - 1)

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 })
    }

    return NextResponse.json({
      success: true,
      logs: data || [],
      pagination: {
        page,
        limit,
        total: count || 0,
        pages: Math.ceil((count || 0) / limit)
      }
    })
  } catch (error) {
    console.error('Audit logs list error:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
