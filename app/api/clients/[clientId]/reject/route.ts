/**
 * POST /api/clients/[clientId]/reject
 * 
 * Admin-only endpoint to reject a client registration
 */

import { NextRequest, NextResponse } from 'next/server'
import { createRouteHandlerClient } from '@supabase/auth-helpers-nextjs'
import { cookies } from 'next/headers'
import { ClientService } from '@/lib/services/client-service'

export async function POST(
  request: NextRequest,
  { params }: { params: { clientId: string } }
) {
  try {
    // Require admin authentication
    const cookieStore = await cookies()
    const supabaseAuth = createRouteHandlerClient({ cookies: () => cookieStore as any })
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

    if (cmsError || !cmsUser || cmsUser.role !== 'admin') {
      return NextResponse.json(
        { error: 'Unauthorized - Admin only' },
        { status: 403 }
      )
    }

    const body = await request.json()
    const { rejectionReason = 'No reason provided' } = body

    console.log('❌ Rejecting client:', { clientId: params.clientId })

    const rejectedClient = await ClientService.rejectClient(
      params.clientId,
      rejectionReason,
      cmsUser.id
    )

    console.log('✅ Client rejected:', { clientId: rejectedClient.id })

    return NextResponse.json({
      success: true,
      message: 'Client registration rejected.',
      client: rejectedClient
    })

  } catch (error) {
    console.error('❌ Error rejecting client:', error)
    return NextResponse.json(
      {
        error: 'Failed to reject client',
        details: error instanceof Error ? error.message : 'Unknown error'
      },
      { status: 500 }
    )
  }
}
