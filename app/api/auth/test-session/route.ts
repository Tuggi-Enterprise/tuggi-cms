import { NextRequest, NextResponse } from 'next/server'
import { getSupabaseRouteHandler } from '@/lib/core/supabase-client'
import { cookies } from 'next/headers'

export const dynamic = 'force-dynamic'

export async function GET(request: NextRequest) {
  try {
    console.log('🧪 TEST SESSION: Testing session from API route...')
    
    const cookieStore = await cookies()
    const supabase = getSupabaseRouteHandler(cookieStore)
    
    console.log('🧪 TEST SESSION: Request URL:', request.url)
    console.log('🧪 TEST SESSION: Request method:', request.method)
    console.log('🧪 TEST SESSION: Request headers:', Object.fromEntries(request.headers.entries()))
    
    // Get all cookies
    console.log('🧪 TEST SESSION: Cookies store ready')
    
    const { data: { session }, error } = await supabase.auth.getSession()
    
    console.log('🧪 TEST SESSION: Session check result:', {
      hasSession: !!session,
      hasError: !!error,
      error: error?.message,
      userEmail: session?.user?.email,
      sessionData: session ? {
        access_token: !!session.access_token,
        refresh_token: !!session.refresh_token,
        expires_at: session.expires_at,
        user: {
          id: session.user.id,
          email: session.user.email
        }
      } : null
    })
    
    if (error) {
      console.error('❌ TEST SESSION: Session error:', error)
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
      console.log('❌ TEST SESSION: No session found')
      return NextResponse.json(
        { 
          authenticated: false, 
          message: 'No active session found'
        },
        { status: 401 }
      )
    }

    console.log('✅ TEST SESSION: Session found and valid')
    
    return NextResponse.json({
      authenticated: true,
      user: {
        email: session.user.email,
        id: session.user.id
      },
      session: {
        access_token: !!session.access_token,
        refresh_token: !!session.refresh_token,
        expires_at: session.expires_at
      }
    })

  } catch (error) {
    console.error('❌ TEST SESSION: Error:', error)
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
