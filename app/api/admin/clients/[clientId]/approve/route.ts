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

    /**
     * NO PLACE IS CREATED HERE, and the absence is the fix of 2026-08-23.
     *
     * Since #360 this route provisioned the place by itself and the catalogue paid for it:
     * every client it touched already had its establishment published and pinned, and approval
     * put an empty row beside it — `Faella Bistro` beside `Faella Bistrô`, `Tucas` beside
     * `Tucas Empório Bistrô`. An automatic act cannot search the catalogue first, and searching
     * first is the only thing that stops the duplicate.
     *
     * The act lives in the `Locais` tab now, behind the search that answers `este lugar já está
     * no catálogo?` — `provisionPartnerPlace`, reached by
     * `POST /api/admin/partnerships/clients/{id}/places`.
     */

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
