import { NextRequest, NextResponse } from 'next/server'
import { createRouteHandlerClient } from '@supabase/auth-helpers-nextjs'
import { cookies } from 'next/headers'

export const dynamic = 'force-dynamic'

export async function GET(request: NextRequest) {
  try {
    console.log('🔍 AUTH CHECK: Checking authentication status...')
    console.log('🔍 AUTH CHECK: Request URL:', request.url)
    console.log('🔍 AUTH CHECK: Request headers:', Object.fromEntries(request.headers.entries()))
    
    const supabase = createRouteHandlerClient({ cookies })
    
    console.log('🔍 AUTH CHECK: Supabase client created')
    console.log('🔍 AUTH CHECK: Cookies available:', Object.keys(cookies()))
    
    const { data: { session }, error } = await supabase.auth.getSession()
    
    console.log('🔍 AUTH CHECK: Session check result:', {
      hasSession: !!session,
      hasError: !!error,
      error: error?.message,
      userEmail: session?.user?.email,
      sessionData: session ? {
        access_token: !!session.access_token,
        refresh_token: !!session.refresh_token,
        expires_at: session.expires_at
      } : null
    })
    
    if (error) {
      console.error('❌ AUTH CHECK: Session error:', error)
      return NextResponse.json(
        { 
          authenticated: false, 
          error: 'Session error',
          details: error.message 
        },
        { status: 401 }
      )
    }
    
    if (!session) {
      console.log('❌ AUTH CHECK: No session found')
      return NextResponse.json(
        { 
          authenticated: false, 
          message: 'No active session found' 
        },
        { status: 401 }
      )
    }

    console.log('✅ Session found for user:', session.user.email)
    
    // Check CMS user status
    const { data: cmsUser, error: cmsError } = await supabase
      .schema('core')
      .from('cms_users')
      .select('role, is_active')
      .eq('email', session.user.email)
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

    if (!['admin', 'client', 'client'].includes(cmsUser.role)) {
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

    console.log('✅ User authenticated and authorized:', {
      email: session.user.email,
      role: cmsUser.role
    })

    return NextResponse.json({
      authenticated: true,
      user: {
        email: session.user.email,
        role: cmsUser.role,
        isActive: cmsUser.is_active
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
