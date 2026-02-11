import { NextRequest, NextResponse } from 'next/server'
import { createRouteHandlerClient } from '@supabase/auth-helpers-nextjs'
import { cookies } from 'next/headers'
import { logAuditEvent } from '@/lib/services/audit-service'

export async function POST(request: NextRequest) {
  try {
    const cookieStore = await cookies()
    const supabaseAuth = createRouteHandlerClient({ cookies: () => cookieStore as any })

    const { data: { session }, error: sessionError } = await supabaseAuth.auth.getSession()
    if (sessionError || !session) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const { password } = await request.json()
    if (!password || typeof password !== 'string' || password.length < 6) {
      return NextResponse.json({ error: 'Password required (min 6 characters)' }, { status: 400 })
    }

    const { error } = await supabaseAuth.auth.updateUser({ password })
    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 })
    }

    await logAuditEvent({
      request,
      action: 'PASSWORD_CHANGE',
      entity: 'AUTH',
      entityId: session.user.id,
      userId: session.user.id,
      userEmail: session.user.email || null,
      description: 'Password changed by user'
    })

    return NextResponse.json({ success: true })
  } catch (error) {
    console.error('Update password error:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
