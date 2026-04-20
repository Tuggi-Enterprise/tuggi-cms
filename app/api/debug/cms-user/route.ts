import { NextRequest, NextResponse } from 'next/server'
import { getSupabaseRouteHandler } from '@/lib/core/supabase-client'
import { cookies } from 'next/headers'

export async function GET(request: NextRequest) {
  try {
    const cookieStore = await cookies()
    const supabase = getSupabaseRouteHandler(cookieStore)

    const { data: { session }, error: sessionErr } = await supabase.auth.getSession()
    if (sessionErr) return NextResponse.json({ error: 'Auth session error', details: sessionErr.message }, { status: 500 })
    if (!session) return NextResponse.json({ error: 'No active session' }, { status: 401 })

    // Perform CMS lookup
    let cmsUser = null
    let cmsError = null
    try {
      const { data, error } = await supabase
        .schema('core')
        .from('cms_users')
        .select('id, email, full_name, role, is_active, created_at, updated_at')
        .eq('email', session.user.email)
        .maybeSingle()
      cmsUser = data
      cmsError = error
    } catch (err: any) {
      cmsError = { message: err.message, code: err.code }
    }

    return NextResponse.json({
      success: true,
      sessionUser: {
        id: session.user.id,
        email: session.user.email,
        app_metadata: session.user.app_metadata || null,
        user_metadata: session.user.user_metadata || null
      },
      cmsUser,
      cmsError
    })
  } catch (err) {
    console.error('Debug cms-user error:', err)
    return NextResponse.json({ error: 'Internal server error', details: err instanceof Error ? err.message : String(err) }, { status: 500 })
  }
}
