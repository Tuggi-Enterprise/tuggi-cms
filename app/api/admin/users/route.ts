/**
 * GET /api/admin/users - List all CMS users with pagination and search
 * POST /api/admin/users - Create a new CMS user
 * 
 * Admin-only endpoints for managing CMS users
 */

import { NextRequest, NextResponse } from 'next/server'
import { createRouteHandlerClient } from '@supabase/auth-helpers-nextjs'
import { createClient } from '@supabase/supabase-js'
import { cookies } from 'next/headers'
import { randomUUID } from 'crypto'

import { getSupabaseService } from '@/lib/core/supabase-client'

export async function GET(request: NextRequest) {
  try {
    const cookieStore = await cookies()
    const supabaseAuth = createRouteHandlerClient({ cookies: () => cookieStore as any })
    
    // Check authentication
    const { data: { session }, error: authError } = await supabaseAuth.auth.getSession()
    if (authError || !session) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    // Check admin role
    const { data: cmsUser, error: cmsError } = await supabaseAuth
      .schema('core')
      .from('cms_users')
      .select('id, role, is_active')
      .eq('email', session.user.email as string)
      .eq('is_active', true)
      .single()

    if (cmsError || !cmsUser || cmsUser.role !== 'admin') {
      return NextResponse.json({ error: 'Forbidden - Admin only' }, { status: 403 })
    }

    // Get query parameters
    const searchParams = request.nextUrl.searchParams
    const search = searchParams.get('search') || ''
    const role = searchParams.get('role') || 'all' // all, admin, client, editor, viewer
    const isActive = searchParams.get('is_active') || 'all' // all, true, false
    const page = parseInt(searchParams.get('page') || '1')
    const limit = parseInt(searchParams.get('limit') || '10')
    const offset = (page - 1) * limit

    // Build query
    let query = supabaseAuth
      .schema('core')
      .from('cms_users')
      .select('id, email, full_name, role, is_active, client_id, created_at', { count: 'exact' })

    // Filter by role
    if (role !== 'all') {
      query = query.eq('role', role)
    }

    // Filter by active status
    if (isActive === 'true') {
      query = query.eq('is_active', true)
    } else if (isActive === 'false') {
      query = query.eq('is_active', false)
    }

    // Filter by search (email or full_name)
    if (search) {
      query = query.or(`email.ilike.%${search}%,full_name.ilike.%${search}%`)
    }

    // Apply sorting and pagination
    const { data: users, error: usersError, count } = await query
      .order('created_at', { ascending: false })
      .range(offset, offset + limit - 1)

    if (usersError) {
      return NextResponse.json({ error: usersError.message }, { status: 500 })
    }

    return NextResponse.json({
      success: true,
      users: users || [],
      pagination: {
        page,
        limit,
        total: count || 0,
        pages: Math.ceil((count || 0) / limit)
      }
    })
  } catch (error) {
    console.error('❌ Error fetching users:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

export async function POST(request: NextRequest) {
  try {
    const cookieStore = await cookies()
    const supabaseAuth = createRouteHandlerClient({ cookies: () => cookieStore as any })
    
    // Check authentication
    const { data: { session }, error: authError } = await supabaseAuth.auth.getSession()
    if (authError || !session) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    // Check admin role
    const { data: adminUser, error: adminError } = await supabaseAuth
      .schema('core')
      .from('cms_users')
      .select('id, role, is_active')
      .eq('email', session.user.email as string)
      .eq('is_active', true)
      .single()

    if (adminError || !adminUser || adminUser.role !== 'admin') {
      return NextResponse.json({ error: 'Forbidden - Admin only' }, { status: 403 })
    }

    const body = await request.json()
    const { email, full_name, password, role, is_active, client_id } = body

    // Validation
    if (!email || !full_name) {
      return NextResponse.json({ error: 'Missing required fields: email, full_name' }, { status: 400 })
    }

    if (!['admin', 'client', 'editor', 'viewer'].includes(role)) {
      return NextResponse.json({ error: 'Invalid role' }, { status: 400 })
    }

    // If role is client, client_id is required
    if (role === 'client' && !client_id) {
      return NextResponse.json({ error: 'client_id is required for client role' }, { status: 400 })
    }

    // If role is not client, client_id must be null
    if (role !== 'client' && client_id) {
      return NextResponse.json({ error: `client_id should not be set for ${role} role` }, { status: 400 })
    }

    // Create user with auth if password provided
    let newUserId: string | null = null

    if (password) {
      // Use service role client to create auth user
      const supabaseService = getSupabaseService()

      const { data: authUser, error: authError } = await supabaseService.auth.admin.createUser({
        email,
        password,
        email_confirm: true
      })

      if (authError) {
        // Check if user already exists
        if (authError.message.includes('already registered')) {
          return NextResponse.json({ error: 'Email already registered' }, { status: 409 })
        }
        return NextResponse.json({ error: authError.message }, { status: 500 })
      }

      newUserId = authUser.user.id
    } else {
      // Generate a temporary UUID for cms_users
      newUserId = randomUUID()
    }

    // Create cms_user
    const { data: cmsUser, error: cmsError } = await supabaseAuth
      .schema('core')
      .from('cms_users')
      .insert([{
        id: newUserId,
        email,
        full_name,
        role,
        is_active: is_active !== false,
        client_id: role === 'client' ? client_id : null
      }])
      .select()
      .single()

    if (cmsError) {
      // If email conflict and we created auth user, try to delete it
      if (cmsError.code === '23505' && newUserId && password) {
        const supabaseService = getSupabaseService()
        try {
          await supabaseService.auth.admin.deleteUser(newUserId)
        } catch (e) {
          console.error('Failed to cleanup auth user:', e)
        }
      }

      if (cmsError.code === '23505') {
        return NextResponse.json({ error: 'Email already exists' }, { status: 409 })
      }
      return NextResponse.json({ error: cmsError.message }, { status: 500 })
    }

    return NextResponse.json({
      success: true,
      user: cmsUser,
      message: password ? 'User created with password' : 'User created (password can be set later)'
    }, { status: 201 })
  } catch (error) {
    console.error('❌ Error creating user:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
