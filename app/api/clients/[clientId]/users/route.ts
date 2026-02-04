/**
 * GET /api/clients/[clientId]/users
 * 
 * Fetch CMS users linked to a client
 */

import { NextRequest, NextResponse } from 'next/server'
import { createRouteHandlerClient } from '@supabase/auth-helpers-nextjs'
import { createClient } from '@supabase/supabase-js'
import { cookies } from 'next/headers'

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ clientId: string }> }
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

    const { data: cmsUser, error: cmsError } = await supabaseAuth
      .schema('core')
      .from('cms_users')
      .select('id, role, is_active, client_id')
      .eq('email', session.user.email as string)
      .eq('is_active', true)
      .single()

    if (cmsError || !cmsUser) {
      return NextResponse.json(
        { error: 'Unauthorized' },
        { status: 403 }
      )
    }

    const { clientId } = await params

    if (cmsUser.role !== 'admin') {
      if (cmsUser.role !== 'client') {
        return NextResponse.json(
          { error: 'Forbidden' },
          { status: 403 }
        )
      }

      const hasDirectAccess = cmsUser.client_id === clientId

      if (!hasDirectAccess) {
        const { data: link, error: linkError } = await supabaseAuth
          .schema('core')
          .from('client_cms_users')
          .select('id')
          .eq('client_id', clientId)
          .eq('cms_user_id', cmsUser.id)
          .single()

        if (linkError || !link) {
          return NextResponse.json(
            { error: 'Forbidden' },
            { status: 403 }
          )
        }
      }
    }

    const supabaseQueryClient = cmsUser.role === 'admin'
      ? createClient(supabaseUrl, supabaseServiceKey)
      : supabaseAuth

    const { data, error } = await supabaseQueryClient
      .schema('core')
      .from('client_cms_users')
      .select('id, client_id, cms_user_id, client_role, created_at, cms_users:cms_user_id(id, email, full_name)')
      .eq('client_id', clientId)

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
