/**
 * POST /api/clients/register
 * 
 * Public endpoint for client registration
 * Creates a pending client registration awaiting admin approval
 */

import { NextRequest, NextResponse } from 'next/server'
import { createRouteHandlerClient } from '@supabase/auth-helpers-nextjs'
import { cookies } from 'next/headers'
import { ClientService } from '@/lib/services/client-service'
import { RegisterClientRequest } from '@/types/clients'

export async function POST(request: NextRequest) {
  try {
    // Require authentication
    const cookieStore = await cookies()
    const supabaseAuth = createRouteHandlerClient({ cookies: () => cookieStore as any })
    const { data: { session }, error: authError } = await supabaseAuth.auth.getSession()

    if (authError || !session) {
      return NextResponse.json(
        { error: 'Unauthorized - Authentication required' },
        { status: 401 }
      )
    }

    const body: RegisterClientRequest = await request.json()

    // Validate required fields (support either name or full_name)
    const clientName = (body.full_name || body.name || '').trim()
    if (!clientName || !body.email) {
      return NextResponse.json(
        { error: 'Name (or full_name) and email are required' },
        { status: 400 }
      )
    }

    // Validate email format
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
    if (!emailRegex.test(body.email)) {
      return NextResponse.json(
        { error: 'Invalid email format' },
        { status: 400 }
      )
    }

    console.log('📝 Registering new cms_user:', { full_name: clientName, email: body.email })

    // Create the cms_user registration
    const cmsUser = await ClientService.registerClient({ ...body, full_name: clientName })

    console.log('✅ CMS user registration submitted:', { id: cmsUser.id, email: cmsUser.email })

    return NextResponse.json({
      success: true,
      message: 'Client registration submitted successfully. Awaiting admin approval.',
      client: {
        id: cmsUser.id,
        name: clientName,
        email: cmsUser.email,
        status: 'pending'
      }
    }, { status: 201 })

  } catch (error) {
    console.error('❌ Error registering client:', error)
    return NextResponse.json(
      {
        error: 'Failed to register client',
        details: error instanceof Error ? error.message : 'Unknown error'
      },
      { status: 500 }
    )
  }
}
