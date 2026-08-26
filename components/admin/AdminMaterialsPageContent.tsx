'use client'

/**
 * Client-side content of `/admin/materials`. Lives in `components/` for the same reason
 * `AdminClientsPageContent` does: the non-locale route stays a Server Component redirect, so the
 * build never prerenders a tree that calls `useTranslations()` without a request-time provider.
 *
 * ONE READ FEEDS THE WHOLE SCREEN. The board renders it, the dashboard counts it and the filter
 * narrows it — there is no second query anywhere on this page, which is why no two numbers on it
 * can disagree.
 *
 * MOVING AN ORDER CALLS THE ROUTE THAT ALREADY EXISTED, keyed by the partner on the card:
 * `PATCH /api/admin/clients/{clientId}/material-orders`. A write of its own here would be a
 * second place for `an order does not go back` to be forgotten.
 */

import { useCallback, useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { NextIntlClientProvider, useLocale, useMessages } from 'next-intl'
import { useSessionContext, useSupabaseClient } from '@supabase/auth-helpers-react'
import ptMessages from '@/messages/pt.json'
import { MaterialBoard } from '@/components/admin/materials/MaterialBoard'
import type { MaterialMoveStatus, MaterialQueueOrder } from '@/lib/materials/order-queue'

export function AdminMaterialsPageContent() {
  const router = useRouter()
  const locale = useLocale()
  const messages = useMessages()
  const supabase = useSupabaseClient()
  const { session, isLoading: sessionLoading } = useSessionContext()

  const [authorized, setAuthorized] = useState(false)
  const [checking, setChecking] = useState(true)
  const [orders, setOrders] = useState<MaterialQueueOrder[]>([])
  const [truncated, setTruncated] = useState(false)
  const [loading, setLoading] = useState(true)
  const [failed, setFailed] = useState(false)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    const check = async () => {
      if (sessionLoading) return
      if (!session) {
        router.push('/login')
        return
      }
      try {
        const { data: cmsUser } = await supabase
          .schema('core')
          .from('cms_users')
          .select('role')
          .eq('email', session.user.email)
          .single()

        if (cmsUser?.role !== 'admin') {
          router.push('/unauthorized')
          return
        }
        setAuthorized(true)
      } catch {
        router.push('/unauthorized')
      } finally {
        setChecking(false)
      }
    }
    void check()
  }, [router, session, sessionLoading, supabase])

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const response = await fetch('/api/admin/materials')
      if (!response.ok) {
        setFailed(true)
        return
      }
      const payload = (await response.json()) as {
        orders: MaterialQueueOrder[]
        truncated: boolean
      }
      setOrders(payload.orders ?? [])
      setTruncated(payload.truncated === true)
      setFailed(false)
    } catch {
      setFailed(true)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    if (authorized) void load()
  }, [authorized, load])

  const move = useCallback(
    async (order: MaterialQueueOrder, status: MaterialMoveStatus) => {
      setBusy(true)
      try {
        await fetch(`/api/admin/clients/${order.clientId}/material-orders`, {
          method: 'PATCH',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ orderId: order.id, status }),
        })
      } finally {
        setBusy(false)
      }
      // Re-read whatever the write did, including a 409 — somebody else advancing the order
      // while this screen was open is not an error the operator can act on, and showing what
      // they did is more useful than a message about a race.
      await load()
    },
    [load]
  )

  if (checking) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <div className="h-12 w-12 animate-spin rounded-full border-b-2 border-tuggi-blue" />
      </div>
    )
  }

  if (!authorized) return null

  return (
    // THE ESTEIRA IS PORTUGUESE WHATEVER LOCALE THE OPERATOR IS ON — decision #408, the same
    // overlay `/admin/clients` applies. `Materials` and `Clients.profile.material` are the two
    // namespaces this screen speaks, and both belong to the pipeline rather than to a client's
    // record, so a seam in the middle of a card is not possible here.
    <NextIntlClientProvider
      locale={locale}
      messages={{
        ...messages,
        Materials: ptMessages.Materials,
        Clients: {
          ...(messages.Clients ?? {}),
          profile: {
            ...((messages.Clients as Record<string, unknown> | undefined)?.profile ?? {}),
            material: ptMessages.Clients.profile.material,
          },
        },
      }}
    >
      <MaterialBoard
        locale={locale}
        orders={orders}
        loading={loading}
        failed={failed}
        truncated={truncated}
        busy={busy}
        onReload={() => void load()}
        onMove={(order, status) => void move(order, status)}
      />
    </NextIntlClientProvider>
  )
}
