import { NextRequest, NextResponse } from 'next/server'
import { cookies } from 'next/headers'
import { getSupabaseRouteHandler } from '@/lib/core/supabase-client'
import { getCallerRootClientIds, filterCoordinatorClientIds } from '@/lib/services/coordinator-service'

export const dynamic = 'force-dynamic'

export async function GET(request: NextRequest) {
  try {
    console.log('🔍 AUTH CHECK: Checking authentication status...')
    
    const cookieStore = await cookies()
    const supabase = getSupabaseRouteHandler(cookieStore)
    
    console.log('🔍 AUTH CHECK: Supabase client created using SSOT')
    
    const { data: { user }, error } = await supabase.auth.getUser()
    
    console.log('🔍 AUTH CHECK: User check result:', {
      hasUser: !!user,
      hasError: !!error,
      error: error?.message,
      userEmail: user?.email
    })
    
    if (error) {
      console.error('❌ AUTH CHECK: User error:', error)
      return NextResponse.json(
        { 
          authenticated: false, 
          error: 'User error',
          details: error.message 
        },
        { status: 401 }
      )
    }
    
    if (!user) {
      console.log('❌ AUTH CHECK: No user found')
      return NextResponse.json(
        { 
          authenticated: false, 
          message: 'No active user found' 
        },
        { status: 401 }
      )
    }

    console.log('✅ User found:', user.email)
    
    // Check CMS user status
    const { data: cmsUser, error: cmsError } = await supabase
      .schema('core')
      .from('cms_users')
      .select('id, role, is_active, client_id, enabled_modules')
      .eq('email', user.email)
      .eq('is_active', true)
      .single()

    if (cmsError || !cmsUser) {
      console.error('❌ CMS user not found or inactive:', cmsError)
      return NextResponse.json(
        { 
          authenticated: false, 
          error: 'CMS access denied',
          details: cmsError?.message 
        },
        { status: 403 }
      )
    }

    if (!['admin', 'client', 'editor'].includes(cmsUser.role)) {
      console.error('❌ Insufficient privileges:', cmsUser.role)
      return NextResponse.json(
        { 
          authenticated: false, 
          error: 'Insufficient privileges',
          role: cmsUser.role 
        },
        { status: 403 }
      )
    }

    // Vínculo REAL usuário→client + capacidade de coordenador. Resolvido pelo SSOT em
    // coordinator-service (client_cms_users + clients.cms_user_id, NUNCA o cms_users.client_id
    // morto). Coordenador = capacidade explícita is_coordinator, setada por admin — NÃO
    // derivada de "ter filhas" (um coordenador novo tem zero e nunca criaria a primeira).
    const clientIds = await getCallerRootClientIds(cmsUser.id)
    const coordinatorClientIds = await filterCoordinatorClientIds(clientIds)

    console.log('✅ User authenticated and authorized:', {
      email: user.email,
      role: cmsUser.role
    })

    return NextResponse.json({
      authenticated: true,
      user: {
        email: user.email,
        role: cmsUser.role,
        isActive: cmsUser.is_active,
        // Mantido por compatibilidade (useCmsUser e chamadas antigas leem isto),
        // mas é NULL para todo client — prefira clientIds.
        clientId: cmsUser.client_id,
        clientIds,
        isCoordinator: coordinatorClientIds.length > 0,
        coordinatorClientId: coordinatorClientIds[0] ?? null,
        enabledModules: cmsUser.enabled_modules || []
      }
    })

  } catch (error) {
    console.error('❌ Auth check error:', error)
    return NextResponse.json(
      { 
        authenticated: false, 
        error: 'Internal server error',
        details: error instanceof Error ? error.message : 'Unknown error'
      },
      { status: 500 }
    )
  }
}
