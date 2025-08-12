import { NextRequest, NextResponse } from 'next/server'
import { withAuth, withRateLimit } from '@/lib/auth-middleware'

export const POST = withAuth(withRateLimit(10, 60000)(async function(request: NextRequest) {
  try {
    console.log('🚀 Test auth endpoint - starting...')
    const body = await request.json()
    console.log('📦 Request body received:', JSON.stringify(body, null, 2))
    
    // Just return success to test if auth is working
    return NextResponse.json({
      success: true,
      message: 'Authentication working correctly',
      user: (request as any).user?.email,
      cmsUser: (request as any).cmsUser?.role
    })

  } catch (error) {
    console.error('❌ Test auth endpoint error:', error)
    console.error('❌ Error stack:', error instanceof Error ? error.stack : 'No stack trace')
    return NextResponse.json(
      { error: 'Test auth failed', details: error instanceof Error ? error.message : 'Unknown error' },
      { status: 500 }
    )
  }
}))
