import { NextRequest, NextResponse } from 'next/server'
import { createRouteHandlerClient } from '@supabase/auth-helpers-nextjs'
import { cookies } from 'next/headers'

export async function POST(request: NextRequest) {
  try {
    console.log('🚀 Testing session...')
    
    const supabase = createRouteHandlerClient({ cookies })
    
    console.log('📦 Getting session...')
    const { data: { session }, error } = await supabase.auth.getSession()
    
    console.log('🔍 Session check:', { 
      hasSession: !!session, 
      hasError: !!error, 
      error: error?.message,
      userEmail: session?.user?.email 
    })
    
    if (error || !session) {
      console.error('❌ No session found:', error)
      return NextResponse.json(
        { error: 'No authenticated user', details: error?.message },
        { status: 401 }
      )
    }

    console.log('✅ Session found, checking CMS user...')
    
    // Check if user exists in cms_users table and is authorized
    const { data: cmsUser, error: cmsError } = await supabase
      .schema('core')
      .from('cms_users')
      .select('role, is_active')
      .eq('email', session.user.email)
      .eq('is_active', true)
      .single()

    console.log('🔍 CMS user check:', { 
      hasCmsUser: !!cmsUser, 
      hasError: !!cmsError, 
      error: cmsError?.message,
      role: cmsUser?.role,
      isActive: cmsUser?.is_active
    })

    if (cmsError || !cmsUser) {
      console.error('❌ CMS access denied:', cmsError)
      return NextResponse.json(
        { error: 'CMS access denied', details: cmsError?.message },
        { status: 403 }
      )
    }

    // Check if user has admin or editor role
    if (!['admin', 'editor'].includes(cmsUser.role)) {
      console.error('❌ Insufficient privileges:', cmsUser.role)
      return NextResponse.json(
        { error: 'Insufficient privileges', role: cmsUser.role },
        { status: 403 }
      )
    }

    console.log('✅ Authentication successful!')

    return NextResponse.json({
      success: true,
      message: 'Authentication working correctly',
      user: session.user.email,
      cmsUser: {
        role: cmsUser.role,
        isActive: cmsUser.is_active
      }
    })

  } catch (error) {
    console.error('❌ Session test error:', error)
    console.error('❌ Error stack:', error instanceof Error ? error.stack : 'No stack trace')
    return NextResponse.json(
      { error: 'Session test failed', details: error instanceof Error ? error.message : 'Unknown error' },
      { status: 500 }
    )
  }
}
