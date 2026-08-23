/**
 * GET /api/admin/users - List all CMS users with pagination and search
 * POST /api/admin/users - Create a new CMS user
 * 
 * Admin-only endpoints for managing CMS users
 */

import { NextRequest, NextResponse } from 'next/server'
import { getSupabaseRouteHandler } from '@/lib/core/supabase-client'
import { createClient } from '@supabase/supabase-js'
import { cookies } from 'next/headers'
import { randomUUID } from 'crypto'

import { getSupabaseService } from '@/lib/core/supabase-client'
import { nameMatchFilter } from '@/lib/shared/name-search'

export async function GET(request: NextRequest) {
  try {
    const cookieStore = await cookies()
    const supabaseAuth = getSupabaseRouteHandler(cookieStore)
    
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
      query = query.or(nameMatchFilter(['email', 'full_name'], search))
    }

    // Apply sorting and pagination
    const { data: users, error: usersError, count } = await query
      .order('created_at', { ascending: false })
      .range(offset, offset + limit - 1)

    if (usersError) {
      return NextResponse.json({ error: usersError.message }, { status: 500 })
    }

    // Use service-role client for admin-only reads (bypass RLS issues)
    const supabaseService = getSupabaseService()

    // Enrich users with linked clients (primary client_id + client_cms_users links)
    const pageUsers = (users || []) as any[]
    const userIds = pageUsers.map(u => u.id).filter(Boolean)
    const primaryClientIds = pageUsers.map(u => u.client_id).filter(Boolean)
    const allClientIdsSet = new Set<string>(primaryClientIds)

    // Fetch client_cms_users links for users on this page (service role)
    let links: any[] = []
    if (userIds.length > 0) {
      const { data: ldata, error: lerr } = await supabaseService
        .schema('partner')
        .from('client_cms_users')
        .select('cms_user_id, client_id, client_role')
        .in('cms_user_id', userIds)

      if (!lerr && ldata) {
        links = ldata
        ldata.forEach((r: any) => { if (r.client_id) allClientIdsSet.add(r.client_id) })
      } else if (lerr) {
        console.warn('GET /api/admin/users - failed to load client_cms_users links:', lerr)
      }
    }

    const allClientIds = Array.from(allClientIdsSet)
    const clientsMap: Record<string, { id: string; name?: string }> = {}
    if (allClientIds.length > 0) {
      const { data: cdata, error: cerr } = await supabaseService
        .schema('partner')
        .from('clients')
        .select('id, name')
        .in('id', allClientIds)

      if (!cerr && cdata) {
        cdata.forEach((c: any) => { clientsMap[c.id] = { id: c.id, name: c.name } })
      } else if (cerr) {
        console.warn('GET /api/admin/users - failed to load clients:', cerr)
      }
    }

    const linksByUser: Record<string, any[]> = {}
    links.forEach(l => {
      if (!linksByUser[l.cms_user_id]) linksByUser[l.cms_user_id] = []
      linksByUser[l.cms_user_id].push({ id: l.client_id, client_role: l.client_role })
    })

    const finalUsers = pageUsers.map(u => {
      const linked = linksByUser[u.id] || []
      const merged: Array<{ id: string; name?: string; client_role?: string }> = []

      // primary client_id (if present)
      if (u.client_id) {
        merged.push({ id: u.client_id, name: clientsMap[u.client_id]?.name || undefined, client_role: 'owner' })
      }

      // add linked clients
      linked.forEach((lc: any) => {
        if (!merged.find(m => m.id === lc.id)) merged.push({ id: lc.id, name: clientsMap[lc.id]?.name || undefined, client_role: lc.client_role })
      })

      return {
        ...u,
        clients: merged,
        client_name: merged.length > 0 ? (merged[0].name || merged[0].id) : null
      }
    })

    return NextResponse.json({
      success: true,
      users: finalUsers || [],
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
    const supabaseAuth = getSupabaseRouteHandler(cookieStore)
    
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
