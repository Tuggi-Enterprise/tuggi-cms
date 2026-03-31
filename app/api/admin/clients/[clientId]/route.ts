/**
 * GET /api/admin/clients/[clientId] - Get client details
 * PATCH /api/admin/clients/[clientId] - Update client
 * DELETE /api/admin/clients/[clientId] - Delete client
 */

import { NextRequest, NextResponse } from 'next/server'
import { createRouteHandlerClient } from '@supabase/auth-helpers-nextjs'
import { createClient } from '@supabase/supabase-js'
import { cookies } from 'next/headers'

import { getSupabaseService } from '@/lib/core/supabase-client'

async function getAdminUser(request: NextRequest) {
  const cookieStore = await cookies()
  const supabaseAuth = createRouteHandlerClient({ cookies: () => cookieStore as any })
  
  const { data: { session }, error: authError } = await supabaseAuth.auth.getSession()
  if (authError || !session) {
    return null
  }

  const { data: cmsUser, error: cmsError } = await supabaseAuth
    .schema('core')
    .from('cms_users')
    .select('id, role, is_active')
    .eq('email', session.user.email as string)
    .eq('is_active', true)
    .single()

  if (cmsError || !cmsUser || cmsUser.role !== 'admin') {
    return null
  }

  return { cmsUser, supabaseAuth }
}

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ clientId: string }> }
) {
  try {
    const adminData = await getAdminUser(request)
    if (!adminData) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }

    const { clientId } = await params
    const supabaseService = getSupabaseService()

    // Get client
    const { data: client, error: clientError } = await supabaseService
      .schema('core')
      .from('clients')
      .select('*')
      .eq('id', clientId)
      .single()

    if (clientError || !client) {
      return NextResponse.json({ error: 'Client not found' }, { status: 404 })
    }

    // Get linked users count
    const { count: usersCount } = await supabaseService
      .schema('core')
      .from('client_cms_users')
      .select('id', { count: 'exact' })
      .eq('client_id', clientId)

    return NextResponse.json({
      success: true,
      client: {
        ...client,
        users_count: usersCount || 0
      }
    })
  } catch (error) {
    console.error('❌ Error fetching client:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ clientId: string }> }
) {
  try {
    const adminData = await getAdminUser(request)
    if (!adminData) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }

    const { clientId } = await params
    const supabaseService = getSupabaseService()
    const body = await request.json()

    // Get current client
    const { data: currentClient, error: fetchError } = await supabaseService
      .schema('core')
      .from('clients')
      .select('*')
      .eq('id', clientId)
      .single()

    if (fetchError || !currentClient) {
      return NextResponse.json({ error: 'Client not found' }, { status: 404 })
    }

    const allowedFields = [
      'name', 'email', 'phone', 'company_name', 'address', 'city', 'state', 'country', 'postal_code', 'industry', 'website', 'status', 'rejection_reason', 'notes',
      'tax_id', 'tax_id_type', 'legal_representative_name', 'legal_representative_role',
      'billing_email', 'iban', 'bic_swift', 'bank_account_number', 'bank_routing_number', 'bank_name',
      'commission_rate', 'is_platform_owner', 'welcome_poi_id'
    ]
    const updateData: any = {}

    for (const field of allowedFields) {
      if (field in body) {
        updateData[field] = body[field]
      }
    }

    if (Object.keys(updateData).length === 0) {
      return NextResponse.json({ error: 'No fields to update' }, { status: 400 })
    }

    // Update client
    const { data: client, error: updateError } = await supabaseService
      .schema('core')
      .from('clients')
      .update({
        ...updateData,
        updated_at: new Date().toISOString()
      })
      .eq('id', clientId)
      .select()
      .single()

    if (updateError) {
      // Check if email conflict
      if (updateError.code === '23505') {
        return NextResponse.json({ error: 'Email already exists' }, { status: 409 })
      }
      return NextResponse.json({ error: updateError.message }, { status: 500 })
    }

    return NextResponse.json({
      success: true,
      client
    })
  } catch (error) {
    console.error('❌ Error updating client:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: { clientId: string } }
) {
  try {
    const adminData = await getAdminUser(request)
    if (!adminData) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }

    const { supabaseAuth } = adminData
    const { clientId } = params

    // Check if client has linked users
    const { count: usersCount, error: countError } = await supabaseAuth
      .schema('core')
      .from('client_cms_users')
      .select('id', { count: 'exact' })
      .eq('client_id', clientId)

    if (!countError && usersCount && usersCount > 0) {
      return NextResponse.json(
        { error: `Cannot delete client with ${usersCount} linked user(s)` },
        { status: 409 }
      )
    }

    // Delete client
    const { error: deleteError } = await supabaseAuth
      .schema('core')
      .from('clients')
      .delete()
      .eq('id', clientId)

    if (deleteError) {
      return NextResponse.json({ error: deleteError.message }, { status: 500 })
    }

    return NextResponse.json({
      success: true,
      message: 'Client deleted successfully'
    })
  } catch (error) {
    console.error('❌ Error deleting client:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
