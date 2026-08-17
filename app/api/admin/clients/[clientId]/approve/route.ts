/**
 * POST /api/admin/clients/[clientId]/approve
 *
 * Admin-only endpoint to approve a client registration.
 * Creates the associated CMS user, and — since #360 — the partner's place, already linked and
 * prefilled with what the partner wrote in the form, in the curation state.
 *
 * THE PLACE NEVER FAILS THE APPROVAL. It is reported in `place` and logged; the approval is the
 * decision the operator made (BR-B2B-010, item 1) and it already happened by the time the
 * catalogue is touched. What the operator has to see is `failed`, and the screen of #359 is
 * where that becomes visible — until then it is in the response and in the audit trail.
 */

import { NextRequest, NextResponse } from 'next/server'
import { getSupabaseRouteHandler } from '@/lib/core/supabase-client'
import { cookies } from 'next/headers'
import { ClientService } from '@/lib/services/client-service'
import { applyPartnerApprovalEffects } from '@/lib/services/partner-approval-effects'
import { logAuditEvent } from '@/lib/services/audit-service'

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

    // The partner's place, out of the proposal this client was promoted from. The operator's
    // own client is handed over on purpose: `core.cms_create_place` is gated on the CMS
    // session's e-mail, and `service_role` does not satisfy that gate.
    const place = await applyPartnerApprovalEffects(clientId, supabaseAuth)

    if (place.status === 'created') {
      await logAuditEvent({
        request,
        action: 'CREATE_PARTNER_PLACE',
        // `POI` is what this vocabulary calls a `core.attractions` row (`CREATE_POI`), and a
        // place is one. A second name for the same entity would split the audit page's answer.
        entity: 'POI',
        entityId: place.attractionId,
        userId: session.user.id,
        userEmail: session.user.email ?? null,
        description: `Place ${place.attractionId} created in curation for client ${clientId} on approval (BR-B2B-033)`,
      })
    } else if (place.status === 'failed') {
      console.error('❌ Partner place not provisioned:', { clientId, ...place })
    }

    return NextResponse.json({
      success: true,
      message: 'Client approved successfully. CMS user created.',
      client: approvedClient,
      place
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
