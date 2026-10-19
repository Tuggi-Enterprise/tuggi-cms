/**
 * POST /api/admin/users/{userId}/password-link: e-mails the "define your password" link to the
 * address on this `core.cms_users` row (#969).
 *
 * This replaces the admin setting the password directly. That path resolved the Auth account by
 * e-mail and called `auth.admin.updateUserById`, so pointing a row at any address (a tourist of
 * the app included) let an admin take that account over. A link sent to the address can only be
 * used by whoever reads that inbox.
 *
 * Nothing is written to `core.cms_users`. The audit carries no e-mail of the target.
 */

import { NextResponse } from 'next/server'
import { withAuth } from '@/lib/auth-middleware'
import { getSupabaseService } from '@/lib/core/supabase-client'
import { logAuditEvent } from '@/lib/services/audit-service'
import { sendSetPasswordLink, setPasswordRedirectTo } from '@/lib/services/cms-password-link'

export const POST = withAuth<{ userId: string }>(
  { roles: ['admin'] },
  async (req, ctx, auth) => {
    const params = await ctx.params
    const userId = params?.userId
    if (!userId) {
      return NextResponse.json({ error: 'Missing userId' }, { status: 400 })
    }

    const service = getSupabaseService()
    const { data: target, error: lookupError } = await service
      .schema('core')
      .from('cms_users')
      .select('id, email, is_active')
      .eq('id', userId)
      .maybeSingle()

    if (lookupError) {
      console.error('[admin users] password link lookup failed:', lookupError.code)
      return NextResponse.json({ error: 'Failed to read the CMS user' }, { status: 500 })
    }
    if (!target?.email) {
      return NextResponse.json({ error: 'User not found' }, { status: 404 })
    }

    const linkError = await sendSetPasswordLink(service, target.email, setPasswordRedirectTo(req))
    if (linkError) {
      return NextResponse.json({ error: 'The password link could not be sent' }, { status: 502 })
    }

    await logAuditEvent({
      request: req,
      action: 'PASSWORD_RESET_REQUEST',
      entity: 'USER',
      entityId: target.id,
      userId: auth.user.id,
      userEmail: auth.cmsUser.email ?? null,
      description: 'Admin sent a set-password link to a CMS user',
    })

    return NextResponse.json({ success: true, email: target.email })
  }
)
