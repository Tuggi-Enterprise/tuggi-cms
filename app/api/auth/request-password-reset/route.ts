import { NextRequest, NextResponse } from 'next/server'
import { getSupabase } from '@/lib/core/supabase-client'
import { logAuditEvent } from '@/lib/services/audit-service'

export async function POST(request: NextRequest) {
  try {
    const { email } = await request.json()

    if (!email || typeof email !== 'string') {
      return NextResponse.json({ error: 'Email is required' }, { status: 400 })
    }

    const supabase = getSupabase('server')

    const { error } = await supabase.auth.resetPasswordForEmail(email.trim())

    if (error) {
      await logAuditEvent({
        request,
        action: 'PASSWORD_RESET_REQUEST',
        entity: 'AUTH',
        entityId: null,
        userId: null,
        userEmail: email.trim(),
        description: `Password reset request failed: ${error.message}`
      })

      return NextResponse.json({ error: error.message }, { status: 500 })
    }

    await logAuditEvent({
      request,
      action: 'PASSWORD_RESET_REQUEST',
      entity: 'AUTH',
      entityId: null,
      userId: null,
      userEmail: email.trim(),
      description: 'Password reset requested'
    })

    return NextResponse.json({ success: true })
  } catch (error) {
    console.error('Password reset request error:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
