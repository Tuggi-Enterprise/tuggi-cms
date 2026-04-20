import { NextRequest, NextResponse } from 'next/server'
import { getSupabaseRouteHandler } from '@/lib/core/supabase-client'
import { cookies } from 'next/headers'

interface RouteParams {
  params: { id: string }
}

/**
 * GET /api/routes/[id]/audit
 * Get audit logs for a single route
 */
export async function GET(
  request: NextRequest,
  context: RouteParams
) {
  try {
    const cookieStore = await cookies()
    const supabaseAuth = getSupabaseRouteHandler(cookieStore)
    const { data: { session }, error: authError } = await supabaseAuth.auth.getSession()

    if (authError || !session) {
      return NextResponse.json(
        { error: 'Unauthorized' },
        { status: 401 }
      )
    }

    const { id } = await context.params

    const { data, error } = await supabaseAuth
      .schema('drive')
      .from('custom_route_audit_logs')
      .select(`
        *,
        performer:performer_id(id, email, full_name)
      `)
      .eq('route_id', id)
      .order('created_at', { ascending: false })

    if (error) {
      throw error
    }

    return NextResponse.json({ logs: data })
  } catch (error) {
    console.error('GET /api/routes/[id]/audit error:', error)
    return NextResponse.json(
      { error: (error as Error).message },
      { status: 500 }
    )
  }
}
