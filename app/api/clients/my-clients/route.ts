/**
 * GET /api/clients/my-clients
 * 
 * Endpoint for client role users to fetch their clients
 */

import { NextRequest, NextResponse } from 'next/server'
import { createRouteHandlerClient } from '@supabase/auth-helpers-nextjs'
import { cookies } from 'next/headers'
import { ClientService } from '@/lib/services/client-service'
import { getSupabaseService } from '@/lib/core/supabase-client'

export async function GET(request: NextRequest) {
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

    // Get clients linked to this user
    let clients = await ClientService.getClientsByUser(cmsUser.id)

    // Fallback: If no clients are linked and user is admin, show all (original behavior)
    if (clients.length === 0 && cmsUser.role === 'admin') {
      const supabaseService = getSupabaseService()
      const { data, error } = await supabaseService
        .schema('core')
        .from('clients')
        .select('*')
        .eq('status', 'approved')
        .order('created_at', { ascending: false })

      if (error) throw error
      clients = data || []
    } else {
      return NextResponse.json(
        { error: 'Access denied - client role required' },
        { status: 403 }
      )
    }

    console.log(`✅ Retrieved ${clients.length} clients for user ${cmsUser.id}`)

    return NextResponse.json({
      success: true,
      clients,
      total: clients.length
    })

  } catch (error) {
    console.error('❌ Error fetching clients:', error)
    return NextResponse.json(
      {
        error: 'Failed to fetch clients',
        details: error instanceof Error ? error.message : 'Unknown error'
      },
      { status: 500 }
    )
  }
}
