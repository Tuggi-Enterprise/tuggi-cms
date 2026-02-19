/**
 * GET /api/admin/clients - List all clients with pagination and search
 * POST /api/admin/clients - Create a new client
 * 
 * Admin-only endpoints for managing clients
 */

import { NextRequest, NextResponse } from 'next/server'
import { createRouteHandlerClient } from '@supabase/auth-helpers-nextjs'
import { createClient } from '@supabase/supabase-js'
import { cookies } from 'next/headers'

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
    const status = searchParams.get('status') || 'all' // all, pending, approved, rejected
    const page = parseInt(searchParams.get('page') || '1')
    const limit = parseInt(searchParams.get('limit') || '10')
    const offset = (page - 1) * limit

    // Use service-role for admin reads (bypass RLS)
    const supabaseService = getSupabaseService()

    // Build query (service role)
    let query = supabaseService
      .schema('core')
      .from('clients')
      .select('id, name, email, phone, status, cms_user_id, created_at, updated_at', { count: 'exact' })

    // Filter by status
    if (status !== 'all') {
      query = query.eq('status', status)
    }

    // Filter by search (name or email)
    if (search) {
      query = query.or(`name.ilike.%${search}%,email.ilike.%${search}%`)
    }

    // Apply sorting, pagination
    const { data: clients, error: clientsError, count } = await query
      .order('created_at', { ascending: false })
      .range(offset, offset + limit - 1)

    if (clientsError) {
      return NextResponse.json({ error: clientsError.message }, { status: 500 })
    }

    // Efficiently count linked users for all clients returned (single query)
    const clientIds = (clients || []).map((c: any) => c.id).filter(Boolean)
    const usersCountMap: Record<string, number> = {}

    if (clientIds.length > 0) {
      const { data: links, error: linksErr } = await supabaseService
        .schema('core')
        .from('client_cms_users')
        .select('client_id')
        .in('client_id', clientIds)

      if (linksErr) {
        console.warn('Failed to fetch client_cms_users for counts:', linksErr)
      } else if (links) {
        links.forEach((l: any) => {
          usersCountMap[l.client_id] = (usersCountMap[l.client_id] || 0) + 1
        })
      }
    }

    const clientsWithUserCount = (clients || []).map((client: any) => ({
      ...client,
      users_count: usersCountMap[client.id] || 0
    }))

    console.log(`GET /api/admin/clients -> returning ${clientsWithUserCount.length} clients (user counts computed)`)

    return NextResponse.json({
      success: true,
      clients: clientsWithUserCount,
      pagination: {
        page,
        limit,
        total: count || 0,
        pages: Math.ceil((count || 0) / limit)
      }
    })
  } catch (error) {
    console.error('❌ Error fetching clients:', error)
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

    const body = await request.json()
    const { name, email, phone, company_name, address, city, state, country, postal_code, industry, website, status } = body

    // Validation
    if (!name || !email) {
      return NextResponse.json({ error: 'Missing required fields: name, email' }, { status: 400 })
    }

    // Insert client
    const supabaseService = getSupabaseService()
    const { data: client, error: clientError } = await supabaseService
      .schema('core')
      .from('clients')
      .insert([{
        name,
        email,
        phone: phone || null,
        company_name: company_name || null,
        address: address || null,
        city: city || null,
        state: state || null,
        country: country || null,
        postal_code: postal_code || null,
        industry: industry || null,
        website: website || null,
        status: status || 'pending'
      }])
      .select()
      .single()

    if (clientError) {
      // Check if email already exists
      if (clientError.code === '23505') {
        return NextResponse.json({ error: 'Email already exists' }, { status: 409 })
      }
      return NextResponse.json({ error: clientError.message }, { status: 500 })
    }

    return NextResponse.json({
      success: true,
      client
    }, { status: 201 })
  } catch (error) {
    console.error('❌ Error creating client:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
