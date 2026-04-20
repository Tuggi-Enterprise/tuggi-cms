/**
 * POST /api/admin/users/[userId]/reset-password - Reset user password
 */

import { NextRequest, NextResponse } from 'next/server'
import { getSupabaseRouteHandler } from '@/lib/core/supabase-client'
import { createClient } from '@supabase/supabase-js'
import { cookies } from 'next/headers'
import { logAuditEvent } from '@/lib/services/audit-service'

import { getSupabaseService } from '@/lib/core/supabase-client'

export async function POST(
  request: NextRequest,
  { params }: { params: { userId: string } }
) {
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
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }

    const body = await request.json()
    const { password } = body

    if (!password || password.length < 6) {
      return NextResponse.json({ error: 'Password required (min 6 characters)' }, { status: 400 })
    }

    // Verify user exists
    const { data: user, error: userError } = await supabaseAuth
      .schema('core')
      .from('cms_users')
      .select('*')
      .eq('id', params.userId)
      .single()

    if (userError || !user) {
      return NextResponse.json({ error: 'User not found' }, { status: 404 })
    }

    // Reset password using service role
    const supabaseService = getSupabaseService()
    const { error: resetError } = await supabaseService.auth.admin.updateUserById(
      params.userId,
      { password }
    )

    if (resetError) {
      return NextResponse.json({ error: resetError.message }, { status: 500 })
    }

    await logAuditEvent({
      request,
      action: 'PASSWORD_CHANGE',
      entity: 'USER',
      entityId: params.userId,
      userId: adminUser.id,
      userEmail: session.user.email || null,
      description: `Admin reset password for user ${user.email}`
    })

    return NextResponse.json({
      success: true,
      message: 'Password reset successfully'
    })
  } catch (error) {
    console.error('❌ Error resetting password:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
