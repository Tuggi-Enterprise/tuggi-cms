/**
 * GET /api/admin/clients - List all clients with pagination and search
 * POST /api/admin/clients - Create a new client
 * 
 * Admin-only endpoints for managing clients
 */

import { NextRequest, NextResponse } from 'next/server'
import { getSupabaseRouteHandler } from '@/lib/core/supabase-client'
import { createClient } from '@supabase/supabase-js'
import { cookies } from 'next/headers'

import { getSupabaseService } from '@/lib/core/supabase-client'
import { validateAvatarUrl } from '@/lib/services/client-editable-fields'
import { describeClientUniqueViolation } from '@/lib/services/client-unique-conflicts'
import { DEFAULT_CLIENT_TYPE, isRegistrableClientType } from '@/types/clients'

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
      .select('id, name, email, phone, company_name, status, client_type, slug, cms_user_id, created_at, updated_at', { count: 'exact' })

    // Filter by status
    if (status !== 'all') {
      query = query.eq('status', status)
    }

    // Filter by search (name or email)
    if (search) {
      query = query.or(`name.ilike.%${search}%,email.ilike.%${search}%,company_name.ilike.%${search}%`)
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

    const body = await request.json()
    const { 
      name, email, phone, company_name, address, city, state, country, postal_code, industry, website, status,
      tax_id, tax_id_type, legal_representative_name, legal_representative_role,
      billing_email, iban, bic_swift, bank_account_number, bank_routing_number, bank_name,
      commission_rate, is_platform_owner, welcome_poi_id, is_coordinator,
      client_type, avatar_url, social_handle, bio_one_line
    } = body

    // Validation
    if (!name || !email) {
      return NextResponse.json({ error: 'Missing required fields: name, email' }, { status: 400 })
    }

    const avatarUrl = validateAvatarUrl(avatar_url)
    if (!avatarUrl.ok) {
      return NextResponse.json({ error: avatarUrl.error }, { status: 400 })
    }

    // A registration that is being born picks from the four the rule offers — BR-B2B-020,
    // item 8. Stricter than the CHECK on purpose: the CHECK still accepts `business`,
    // `partner` and `hotel` (rows already written stay valid and nothing is reclassified),
    // so it cannot answer for this route, which holds `service_role` and is the only barrier
    // left. Editing an existing client goes through PATCH and is NOT narrowed.
    if (client_type != null && client_type !== '' && !isRegistrableClientType(client_type)) {
      return NextResponse.json({ error: 'Invalid client_type' }, { status: 400 })
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
        status: status || 'pending',
        tax_id: tax_id || null,
        tax_id_type: tax_id_type || null,
        legal_representative_name: legal_representative_name || null,
        legal_representative_role: legal_representative_role || null,
        billing_email: billing_email || null,
        iban: iban || null,
        bic_swift: bic_swift || null,
        bank_account_number: bank_account_number || null,
        bank_routing_number: bank_routing_number || null,
        bank_name: bank_name || null,
        commission_rate: commission_rate ?? 0.200,
        is_platform_owner: is_platform_owner ?? false,
        is_coordinator: is_coordinator ?? false,
        welcome_poi_id: welcome_poi_id || null,
        // Partner attribution (20260528125114_clients_supports_partners).
        // client_type is NOT NULL in the database, hence the explicit default — which is
        // declared once, in `types/clients.ts`, and read here.
        client_type: client_type || DEFAULT_CLIENT_TYPE,
        avatar_url: avatarUrl.value,
        social_handle: social_handle || null,
        bio_one_line: bio_one_line || null
      }])
      .select()
      .single()

    if (clientError) {
      // Which unique field collided, said by the database and not guessed here.
      const conflict = describeClientUniqueViolation(clientError)
      if (conflict) {
        return NextResponse.json({ error: conflict }, { status: 409 })
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
