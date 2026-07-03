/**
 * Authentication Helpers - DRY Principle
 * Centralized authentication logic for API routes
 */

import { getSupabaseRouteHandler } from './supabase-client'
import { cookies } from 'next/headers'
import { NextRequest, NextResponse } from 'next/server'

export interface AuthResult {
  authenticated: boolean
  session?: any
  user_id?: string
  user_email?: string
  error?: string
}

/**
 * Require authentication for API route
 * Returns session data if authenticated, or error response if not
 */
export async function requireAuth(request: NextRequest): Promise<AuthResult | NextResponse> {
  try {
    const supabase = getSupabaseRouteHandler(await cookies())
    const { data: { user }, error: authError } = await supabase.auth.getUser()

    if (authError || !user) {
      console.log('❌ Authentication failed')
      return NextResponse.json(
        { error: 'Unauthorized - Authentication required' },
        { status: 401 }
      )
    }

    console.log('✅ User authenticated:', user.email)

    return {
      authenticated: true,
      session: { user },
      user_id: user.id,
      user_email: user.email
    }
  } catch (error: any) {
    console.error('❌ Auth error:', error)
    return NextResponse.json(
      { error: 'Authentication error' },
      { status: 500 }
    )
  }
}

