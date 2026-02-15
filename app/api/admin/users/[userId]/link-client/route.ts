/**
 * POST /api/admin/users/[userId]/link-client - Link a user to a client
 * DELETE /api/admin/users/[userId]/unlink-client - Unlink a user from a client
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

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ userId: string }> }
) {
  try {
    const adminData = await getAdminUser(request)
    if (!adminData) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }

    const { supabaseAuth, cmsUser: adminUser } = adminData
    const { userId } = await params
    const body = await request.json()
    const { client_id, client_role = 'viewer' } = body

    if (!client_id) {
      return NextResponse.json({ error: 'Missing client_id' }, { status: 400 })
    }

    if (!['owner', 'manager', 'viewer'].includes(client_role)) {
      return NextResponse.json({ error: 'Invalid client_role' }, { status: 400 })
    }

    // Use service role client for admin operations (bypass RLS)
    const supabaseAdmin = getSupabaseService()

    // Verify user exists and has role='client'
    const { data: user, error: userError } = await supabaseAdmin
      .schema('core')
      .from('cms_users')
      .select('*')
      .eq('id', userId)
      .single()

    if (userError || !user) {
      return NextResponse.json({ error: 'User not found' }, { status: 404 })
    }

    // Verify client exists
    const { data: client, error: clientError } = await supabaseAdmin
      .schema('core')
      .from('clients')
      .select('id')
      .eq('id', client_id)
      .single()

    if (clientError || !client) {
      return NextResponse.json({ error: 'Client not found' }, { status: 404 })
    }

    // Link user to client (create entry in client_cms_users)
    const { data: link, error: linkError } = await supabaseAdmin
      .schema('core')
      .from('client_cms_users')
      .insert([{
        client_id,
        cms_user_id: userId,
        client_role,
        linked_by: adminUser.id
      }])
      .select()
      .single()

    if (linkError) {
      // Check if already linked
      if (linkError.code === '23505') {
        return NextResponse.json(
          { error: 'User is already linked to this client' },
          { status: 409 }
        )
      }
      return NextResponse.json({ error: linkError.message }, { status: 500 })
    }

    return NextResponse.json({
      success: true,
      link,
      message: `User linked to client with role: ${client_role}`
    })
  } catch (error) {
    console.error('❌ Error linking user to client:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ userId: string }> }
) {
  try {
    const adminData = await getAdminUser(request)
    if (!adminData) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }

    const { supabaseAuth } = adminData
    const { userId } = await params
    const { searchParams } = request.nextUrl
    const client_id = searchParams.get('client_id')

    if (!client_id) {
      return NextResponse.json({ error: 'Missing client_id query parameter' }, { status: 400 })
    }

    // Use service role client for admin operations (bypass RLS)
    const supabaseAdmin = getSupabaseService()

    // Delete link
    const { error: deleteError } = await supabaseAdmin
      .schema('core')
      .from('client_cms_users')
      .delete()
      .eq('cms_user_id', userId)
      .eq('client_id', client_id)

    if (deleteError) {
      return NextResponse.json({ error: deleteError.message }, { status: 500 })
    }

    return NextResponse.json({
      success: true,
      message: 'User unlinked from client successfully'
    })
  } catch (error) {
    console.error('❌ Error unlinking user from client:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
