/**
 * PATCH /api/admin/users/[userId]/subscription - Update app user subscription
 * 
 * Admin-only endpoint to update drive.profiles subscription fields.
 * Uses service role to bypass RLS on drive.profiles.
 */

import { NextRequest, NextResponse } from 'next/server'
import { getSupabaseRouteHandler } from '@/lib/core/supabase-client'
import { cookies } from 'next/headers'
import { getSupabaseService } from '@/lib/core/supabase-client'
import { logAuditEvent } from '@/lib/services/audit-service'

async function getAdminUser(request: NextRequest) {
  const cookieStore = await cookies()
  const supabaseAuth = getSupabaseRouteHandler(cookieStore)
  
  const { data: { session }, error: authError } = await supabaseAuth.auth.getSession()
  if (authError || !session) {
    return null
  }

  const { data: cmsUser, error: cmsError } = await supabaseAuth
    .schema('core')
    .from('cms_users')
    .select('id, email, role, is_active')
    .eq('email', session.user.email as string)
    .eq('is_active', true)
    .single()

  if (cmsError || !cmsUser || cmsUser.role !== 'admin') {
    return null
  }

  return { cmsUser, supabaseAuth }
}

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ userId: string }> }
) {
  try {
    const adminData = await getAdminUser(request)
    if (!adminData) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }

    const { userId } = await params
    const body = await request.json()

    const { subscription_tier_id, subscription_end_date } = body

    // Validate: at least one field must be provided
    if (subscription_tier_id === undefined && subscription_end_date === undefined) {
      return NextResponse.json(
        { error: 'No subscription fields to update' },
        { status: 400 }
      )
    }

    // Use service role to update drive.profiles (bypasses RLS)
    const supabaseService = getSupabaseService()

    // Verify the profile exists
    const { data: profile, error: profileError } = await supabaseService
      .schema('drive')
      .from('profiles')
      .select('id, subscription_tier_id, subscription_end_date, subscription_provider')
      .eq('id', userId)
      .single()

    if (profileError || !profile) {
      return NextResponse.json({ error: 'App user profile not found' }, { status: 404 })
    }

    // Build update payload
    const updatePayload: Record<string, any> = {
      subscription_provider: 'admin',
      subscription_provider_id: adminData.cmsUser.id,
      subscription_start_date: new Date().toISOString(),
      subscription_granted_by: adminData.cmsUser.id,
    }

    if (subscription_tier_id !== undefined) {
      updatePayload.subscription_tier_id = subscription_tier_id || null
    }

    if (subscription_end_date !== undefined) {
      updatePayload.subscription_end_date = subscription_end_date || null
    }

    // Perform the update
    const { error: updateError } = await supabaseService
      .schema('drive')
      .from('profiles')
      .update(updatePayload)
      .eq('id', userId)

    if (updateError) {
      console.error('❌ Error updating subscription:', updateError)
      return NextResponse.json({ error: updateError.message }, { status: 500 })
    }

    // Audit log
    await logAuditEvent({
      request,
      action: 'UPDATE_PROFILE',
      entity: 'USER',
      entityId: userId,
      userId: adminData.cmsUser.id,
      userEmail: adminData.cmsUser.email ?? null,
      description: `Admin updated subscription for app user ${userId}. Tier: ${subscription_tier_id || 'cleared'}, End: ${subscription_end_date || 'cleared'}`
    })

    return NextResponse.json({
      success: true,
      message: 'Subscription updated'
    })
  } catch (error) {
    console.error('❌ Error updating subscription:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
