import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { cookies } from 'next/headers'

export const dynamic = 'force-dynamic'

export async function GET(request: NextRequest) {
  try {
    console.log('🔍 AUTH CHECK: Checking authentication status...')
    console.log('🔍 AUTH CHECK: Request URL:', request.url)
    console.log('🔍 AUTH CHECK: Request headers:', Object.fromEntries(request.headers.entries()))
    
    const cookieStore = await cookies()
    
    // Get auth token from cookies
    const authToken = cookieStore.get('sb-tysnkzmljlmmqpbotkxv-auth-token')
    
    console.log('🔍 AUTH CHECK: Auth token present:', !!authToken)
    
    if (!authToken) {
      console.log('❌ AUTH CHECK: No auth token found')
      return NextResponse.json(
        { 
          authenticated: false, 
          message: 'No auth token found' 
        },
        { status: 401 }
      )
    }
    
    // Parse the token (it's stored as a JSON array)
    let parsedToken
    try {
      parsedToken = JSON.parse(authToken.value)
    } catch (e) {
      console.error('❌ AUTH CHECK: Failed to parse auth token:', e)
      return NextResponse.json(
        { 
          authenticated: false, 
          error: 'Invalid auth token format' 
        },
        { status: 401 }
      )
    }
    
    const accessToken = parsedToken[0]
    
    // Create Supabase client with the access token
    const supabase = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
      {
        global: {
          headers: {
            Authorization: `Bearer ${accessToken}`
          }
        }
      }
    )
    
    console.log('🔍 AUTH CHECK: Supabase client created')
    
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
      .select('role, is_active, client_id')
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
        clientId: cmsUser.client_id
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
