/**
 * POST /api/admin/clients/[clientId]/approve
 * 
 * Admin-only endpoint to approve a client registration
 * Creates associated CMS user automatically
 */

import { NextRequest, NextResponse } from 'next/server'
import { getSupabaseRouteHandler } from '@/lib/core/supabase-client'
import { cookies } from 'next/headers'
import { ClientService } from '@/lib/services/client-service'
import { applyPartnerApprovalEffects } from '@/lib/services/partner-approval-effects'

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ clientId: string }> }
) {
  try {
    const { clientId } = await params
    // Require admin authentication
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

    if (cmsError || !cmsUser || cmsUser.role !== 'admin') {
      return NextResponse.json(
        { error: 'Unauthorized - Admin only' },
        { status: 403 }
      )
    }

    const body = await request.json()
    const { cmsUserEmail, cmsUserName } = body

    if (!cmsUserEmail || !cmsUserName) {
      return NextResponse.json(
        { error: 'CMS user email and name are required' },
        { status: 400 }
      )
    }

    console.log('✅ Approving client:', { clientId: clientId, email: cmsUserEmail })

    const approvedClient = await ClientService.approveClient(
      clientId,
      cmsUser.id,
      cmsUserEmail,
      cmsUserName
    )

    console.log('✅ Client approved successfully:', { clientId: approvedClient.id })

    // App-partner side-effects: grant the Pro comp + push + email the linked app
    // user(s). Guarded internally — never blocks the approval response.
    await applyPartnerApprovalEffects(clientId, cmsUser.id)

    return NextResponse.json({
      success: true,
      message: 'Client approved successfully. CMS user created.',
      client: approvedClient
    })

  } catch (error) {
    console.error('❌ Error approving client:', error)
    return NextResponse.json(
      {
        error: 'Failed to approve client',
        details: error instanceof Error ? error.message : 'Unknown error'
      },
      { status: 500 }
    )
  }
}
