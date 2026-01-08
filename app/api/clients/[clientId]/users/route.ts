/**
 * GET /api/clients/[clientId]/users
 * 
 * Fetch CMS users linked to a client
 */

import { NextRequest, NextResponse } from 'next/server'
import { createRouteHandlerClient } from '@supabase/auth-helpers-nextjs'
import { cookies } from 'next/headers'

export async function GET(
  request: NextRequest,
  { params }: { params: { clientId: string } }
) {
  try {
    const cookieStore = await cookies()
    const supabaseAuth = createRouteHandlerClient({ cookies: () => cookieStore as any })
    const { data: { session }, error: authError } = await supabaseAuth.auth.getSession()

    if (authError || !session) {
      return NextResponse.json(
        { error: 'Unauthorized' },
        { status: 401 }
      )
    }

    const { data, error } = await supabaseAuth
      .schema('core')
      .from('client_cms_users')
      .select('id, client_id, cms_user_id, client_role, created_at, cms_users:cms_user_id(id, email, name)')
      .eq('client_id', params.clientId)

    if (error) throw error

    return NextResponse.json({
      success: true,
      users: data || []
    })

  } catch (error) {
    console.error('Error fetching linked users:', error)
    return NextResponse.json(
      { error: 'Failed to fetch linked users' },
      { status: 500 }
    )
  }
}
