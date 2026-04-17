import { NextRequest, NextResponse } from 'next/server'
import { getSupabaseRouteHandler } from '@/lib/core/supabase-client'
import { cookies } from 'next/headers'
import { logAuditEvent, AuditAction } from '@/lib/services/audit-service'

interface AuthEventBody {
  action: AuditAction
  user_email?: string
  description?: string
}

export async function POST(request: NextRequest) {
  try {
    const body = (await request.json()) as AuthEventBody

    if (!body?.action) {
      return NextResponse.json({ error: 'Action is required' }, { status: 400 })
    }

    const allowed: AuditAction[] = [
      'LOGIN_SUCCESS',
      'LOGIN_FAILURE',
      'PASSWORD_RESET_REQUEST',
      'PASSWORD_CHANGE'
    ]

    if (!allowed.includes(body.action)) {
      return NextResponse.json({ error: 'Invalid action' }, { status: 400 })
    }

    const cookieStore = await cookies()
    const supabaseAuth = getSupabaseRouteHandler(cookieStore)
    const { data: { session } } = await supabaseAuth.auth.getSession()

    await logAuditEvent({
      request,
      action: body.action,
      entity: 'AUTH',
      entityId: session?.user?.id ?? null,
      userId: session?.user?.id ?? null,
      userEmail: session?.user?.email ?? body.user_email ?? null,
      description: body.description || 'Auth event'
    })

    return NextResponse.json({ success: true })
  } catch (error) {
    console.error('Auth event audit error:', error)
    return NextResponse.json({ success: false })
  }
}
