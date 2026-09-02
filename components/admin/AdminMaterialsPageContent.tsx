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
import { ShipmentDialog } from '@/components/admin/materials/ShipmentDialog'
import { consumesCost } from '@/lib/finance/consumption'
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

  /**
   * O CUSTO DEPENDE DE QUANTO SAIU, e só aqui alguém sabe.
   *
   * `material_order_items.quantity` é o que o parceiro PEDIU. Custear por ele superestima todo
   * parceiro que recebeu menos — *"não é pq um parceiro pediu 40 displays, que enviamos os 40"*
   * (operador, 2026-09-01). Então os dois status que gastam dinheiro passam por um diálogo, e o
   * envio é gravado ANTES do PATCH, para já estar lá quando `setMaterialOrderStatus` calcular.
   *
   * O CATÁLOGO É CARREGADO EM SEGUNDO PLANO E A FALHA DELE NÃO TRAVA A ESTEIRA. Sem ele o
   * pedido anda como sempre andou e fica pendente no Financeiro, que é o conserto previsto —
   * parar de despachar material porque um relatório não carregou seria a troca errada.
   */
  const [productByKind, setProductByKind] = useState<Record<string, { id: string; name: string }>>({})
  const [pending, setPending] = useState<{ order: MaterialQueueOrder; status: MaterialMoveStatus } | null>(null)

  useEffect(() => {
    if (!authorized) return
    void (async () => {
      try {
        const response = await fetch('/api/finance/catalog')
        if (!response.ok) return
        const payload = (await response.json()) as {
          products: { id: string; name: string; materialKind: string | null }[]
        }
        const map: Record<string, { id: string; name: string }> = {}
        for (const product of payload.products ?? []) {
          if (product.materialKind) map[product.materialKind] = { id: product.id, name: product.name }
        }
        setProductByKind(map)
      } catch {
        // Silêncio deliberado: o financeiro é opcional para despachar material.
      }
    })()
  }, [authorized])

  const patch = useCallback(
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

  const move = useCallback(
    (order: MaterialQueueOrder, status: MaterialMoveStatus) => {
      // Quais status gastam dinheiro é decisão de `lib/finance/consumption.ts`, e esta linha
      // não repete os dois nomes. Sem produto no catálogo para nenhum item do pedido, não há o
      // que perguntar — o pedido anda e o Financeiro cobra o cadastro.
      const askable =
        consumesCost(status as never) &&
        order.items.some((item) => productByKind[item.kind] !== undefined)

      if (askable) {
        setPending({ order, status })
        return
      }
      void patch(order, status)
    },
    [patch, productByKind]
  )

  const confirmShipment = useCallback(
    async (lines: { productId: string; quantity: number; requestedQuantity: number }[]) => {
      if (!pending) return
      const { order, status } = pending
      setBusy(true)
      try {
        const response = await fetch('/api/finance/shipments', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ orderId: order.id, lines }),
        })
        // O envio não gravou: NÃO move o pedido. Mover agora produziria exatamente o pedido
        // custeado por ninguém que este diálogo existe para acabar, e sem nenhum aviso.
        if (!response.ok) return
      } catch {
        return
      } finally {
        setBusy(false)
      }

      setPending(null)
      await patch(order, status)
    },
    [pending, patch]
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
    // overlay `/admin/clients` applies. `Materials`, `Clients.profile.material` and
    // `Clients.stance` are the three namespaces this screen speaks, and all three belong to the
    // pipeline rather than to a client's record, so a seam in the middle of a card is not
    // possible here. `Clients.stance` joined when the card started drawing the payment symbol:
    // its accessible name is the only text `PaymentStanceBadge` has, and a badge announcing
    // `Not paying` in the middle of a Portuguese card is the seam this overlay exists to avoid.
    <NextIntlClientProvider
      locale={locale}
      messages={{
        ...messages,
        Materials: ptMessages.Materials,
        Clients: {
          ...(messages.Clients ?? {}),
          stance: ptMessages.Clients.stance,
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
        onMove={(order, status) => move(order, status)}
      />
      <ShipmentDialog
        order={pending?.order ?? null}
        status={pending?.status ?? null}
        productByKind={productByKind}
        busy={busy}
        onCancel={() => setPending(null)}
        onConfirm={(lines) => void confirmShipment(lines)}
      />
    </NextIntlClientProvider>
  )
}
