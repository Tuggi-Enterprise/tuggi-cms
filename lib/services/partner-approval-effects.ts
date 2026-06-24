/**
 * Partner approval/rejection side-effects (app-originated partners).
 *
 * On approve: grant the Pro comp (90d) to the linked app user(s), push them, and
 * email them (real auth email). On reject: push + email with the reason.
 *
 * Additive + fully guarded — a failure here never breaks the approve/reject
 * response (the status change already happened). Uses the service-role client and
 * calls the firebase-push-notification + send-transactional Edge Functions.
 */

import { getSupabaseService } from '@/lib/core/supabase-client'

const PRO_DAYS = 90
const PAID_PROVIDERS = ['apple', 'google', 'stripe', 'revenuecat']

async function callEdgeFunction(path: string, body: unknown): Promise<void> {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !key) {
    console.warn('[partner-effects] missing SUPABASE_URL/SERVICE_ROLE_KEY')
    return
  }
  try {
    const res = await fetch(`${url}/functions/v1/${path}`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${key}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
    })
    if (!res.ok) {
      console.warn(`[partner-effects] ${path} failed:`, await res.text())
    }
  } catch (e) {
    console.warn(`[partner-effects] ${path} exception:`, e)
  }
}

async function linkedAppUserIds(clientId: string): Promise<string[]> {
  const svc = getSupabaseService()
  const { data } = await svc
    .schema('drive')
    .from('profiles')
    .select('id')
    .eq('client_id', clientId)
  return (data || []).map((r: { id: string }) => r.id)
}

async function userEmail(userId: string): Promise<string | null> {
  try {
    const svc = getSupabaseService()
    const { data } = await svc.auth.admin.getUserById(userId)
    return data?.user?.email ?? null
  } catch {
    return null
  }
}

export async function applyPartnerApprovalEffects(
  clientId: string,
  grantedByCmsUserId: string
): Promise<void> {
  try {
    const svc = getSupabaseService()
    const userIds = await linkedAppUserIds(clientId)
    if (!userIds.length) return

    const { data: tier } = await svc
      .schema('drive')
      .from('subscription_tiers')
      .select('id')
      .eq('name', 'pro')
      .single()
    const proTierId: string | undefined = tier?.id

    const { data: client } = await svc
      .schema('core')
      .from('clients')
      .select('name, client_type')
      .eq('id', clientId)
      .single()

    const endDate = new Date(Date.now() + PRO_DAYS * 86400000).toISOString()

    for (const userId of userIds) {
      // Guard: never clobber an active PAID subscription.
      const { data: prof } = await svc
        .schema('drive')
        .from('profiles')
        .select('subscription_provider, subscription_end_date')
        .eq('id', userId)
        .single()
      const isPaid =
        prof &&
        PAID_PROVIDERS.includes(prof.subscription_provider) &&
        (!prof.subscription_end_date ||
          new Date(prof.subscription_end_date) > new Date())

      if (proTierId && !isPaid) {
        await svc
          .schema('drive')
          .from('profiles')
          .update({
            subscription_tier_id: proTierId,
            subscription_provider: 'admin',
            subscription_provider_id: grantedByCmsUserId,
            subscription_start_date: new Date().toISOString(),
            subscription_end_date: endDate,
            subscription_granted_by: grantedByCmsUserId,
          })
          .eq('id', userId)
      }

      await callEdgeFunction('firebase-push-notification/send', {
        type: 'user',
        userIds: [userId],
        priority: 'high',
        notification: {
          title: 'Parceria aprovada! 🎉',
          body: 'Seu cadastro foi aprovado. Veja seu QR Code no app.',
          data: { deeplink: 'tuggi://partner-status', status: 'approved' },
        },
      })

      const email = await userEmail(userId)
      if (email) {
        await callEdgeFunction('send-transactional/send', {
          type: 'partner_approved',
          to: email,
          data: {
            partner_name: client?.name,
            client_type: client?.client_type,
            app_url: 'https://tuggi.app',
          },
        })
      }
    }
  } catch (e) {
    console.warn('[partner-effects] approval effects failed:', e)
  }
}

export async function applyPartnerRejectionEffects(
  clientId: string,
  reason: string
): Promise<void> {
  try {
    const svc = getSupabaseService()
    const userIds = await linkedAppUserIds(clientId)
    if (!userIds.length) return

    const { data: client } = await svc
      .schema('core')
      .from('clients')
      .select('name')
      .eq('id', clientId)
      .single()

    for (const userId of userIds) {
      await callEdgeFunction('firebase-push-notification/send', {
        type: 'user',
        userIds: [userId],
        priority: 'high',
        notification: {
          title: 'Sobre seu cadastro Tuggi',
          body: 'Houve uma atualização no seu cadastro de parceiro.',
          data: { deeplink: 'tuggi://partner-status', status: 'rejected' },
        },
      })

      const email = await userEmail(userId)
      if (email) {
        await callEdgeFunction('send-transactional/send', {
          type: 'partner_rejected',
          to: email,
          data: { partner_name: client?.name, reason },
        })
      }
    }
  } catch (e) {
    console.warn('[partner-effects] rejection effects failed:', e)
  }
}
