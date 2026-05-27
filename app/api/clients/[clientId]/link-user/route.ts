/**
 * POST /api/clients/[clientId]/link-user
 * 
 * Client role endpoint to link a CMS user to their client
 */

import { NextRequest, NextResponse } from 'next/server'
import { getSupabaseRouteHandler } from '@/lib/core/supabase-client'
import { cookies } from 'next/headers'
import { ClientService } from '@/lib/services/client-service'

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ clientId: string }> }
) {
  try {
    const { clientId } = await params
    // Require authentication
    const cookieStore = await cookies()
    const supabaseAuth = getSupabaseRouteHandler(cookieStore)
    const { data: { session }, error: authError } = await supabaseAuth.auth.getSession()

    if (authError || !session) {
      return NextResponse.json(
        { error: 'Unauthorized - Authentication required' },
        { status: 401 }
      )
    }

    const { data: cmsUser, error: cmsError } = await supabaseAuth
      .schema('core')
      .from('cms_users')
      .select('id, role, is_active')
      .eq('email', session.user.email as string)
      .eq('is_active', true)
      .single()

    if (cmsError || !cmsUser) {
      return NextResponse.json(
        { error: 'Unauthorized' },
        { status: 403 }
      )
    }

    // Check if user is admin or client owner of this client
    if (cmsUser.role !== 'admin') {
      const { data: client, error: clientError } = await supabaseAuth
        .schema('core')
        .from('clients')
        .select('id')
        .eq('id', clientId)
        .eq('cms_user_id', cmsUser.id)
        .single()

      if (clientError || !client) {
        return NextResponse.json(
          { error: 'Access denied - must be client owner' },
          { status: 403 }
        )
      }
    }

    const body = await request.json()
    const { cmsUserId, clientRole = 'viewer' } = body

    if (!cmsUserId) {
      return NextResponse.json(
        { error: 'CMS user ID is required' },
        { status: 400 }
      )
    }

    console.log('🔗 Linking CMS user to client:', { clientId: clientId, cmsUserId })

    const link = await ClientService.linkCmsUser(
      clientId,
      cmsUserId,
      cmsUser.id,
      clientRole
    )

    console.log('✅ CMS user linked successfully')

    return NextResponse.json({
      success: true,
      message: 'CMS user linked to client successfully',
      link
    })

  } catch (error) {
    console.error('❌ Error linking CMS user:', error)
    return NextResponse.json(
      {
        error: 'Failed to link CMS user',
        details: error instanceof Error ? error.message : 'Unknown error'
      },
      { status: 500 }
    )
  }
}
