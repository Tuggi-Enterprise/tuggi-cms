'use client'

/**
 * ONE ORDER, as the person packing the box needs to read it: what goes in, whose it is, and
 * where it is going.
 *
 * WHO PAYS IS ON THE CARD, AS THE SYMBOL EVERY OTHER SURFACE USES (`PaymentStanceBadge`). The
 * box that leaves is the same for both tiers and the conversation around it is not — BR-B2B-021
 * gives the free tier its display for nothing —, so the person packing reads the side without
 * opening a second screen. The decision itself is not taken here: it arrives on the order.
 *
 * THE TWO LINKS GO TO THE TWO THINGS THE OPERATOR NEEDS NEXT, and they are different screens:
 * the partner's NAME opens the record on `tab=profile`, which is where `ClientQrCode` draws the
 * QR that goes on the material; `Contrato` opens `/admin/clients/{id}/contract`, the page with
 * the signed instrument and its trail. Both carry the way back (DS-LAYOUT-006, point 2), so the
 * operator returns to the queue instead of hunting for it.
 *
 * THE ADDRESS IS ON THE CARD AND NOT BEHIND A CLICK. An order without its destination is a
 * quantity, and a quantity does not ship. When no place answered, the card says so in the same
 * spot — `origin` is printed too, because `endereço do cadastro` and `local vinculado` are
 * different degrees of certainty and the operator is the one who decides whether to trust it.
 *
 * THE BUTTONS ARE THE OTHER WAY TO DO WHAT THE DRAG DOES (WCAG 2.2 SC 2.5.7): dragging is not a
 * requirement anywhere in this screen. Which buttons those are is derived from the graph by
 * `MaterialMoveButtons`, not decided here — the card would be the second place to write down
 * what may follow what.
 *
 * THE NAME OWNS THE TOP LINE, AND THE ORIGIN OF THE ORDER SITS WITH THE DATE. They shared the
 * first row until 2026-08-26, and in a board column that narrow `PEDIDO NA PROPOSTA` — which is
 * what nearly every card says — landed on top of `Borogodó Nordestino`: the name is the flex
 * child that must shrink (`min-w-0`), and the badge beside it never yielded. Same failure the
 * `PaymentStanceBadge` header describes, one card over. Moving the origin down is not only how
 * the collision ends: it is a metadata line, like the date, and it was competing with the one
 * string the operator scans the column for.
 */

import { useTranslations } from 'next-intl'
import Link from 'next/link'
import { FileText, MapPin } from 'lucide-react'
import { MaterialMoveButtons } from '@/components/admin/materials/MaterialMoveButtons'
import { PaymentStanceBadge } from '@/components/admin/clients/shared/PaymentStanceBadge'
import { returnParams } from '@/lib/navigation/return-to'
import type { MaterialMoveStatus, MaterialQueueOrder } from '@/lib/materials/order-queue'

interface MaterialCardProps {
  order: MaterialQueueOrder
  locale: string
  busy: boolean
  onMove: (order: MaterialQueueOrder, status: MaterialMoveStatus) => void
  dragHandleProps?: React.HTMLAttributes<HTMLElement>
  dragging?: boolean
  refusal?: string | null
}

export function MaterialCard({
  order,
  locale,
  busy,
  onMove,
  dragHandleProps,
  dragging,
  refusal,
}: MaterialCardProps) {
  const t = useTranslations('Materials')
  const m = useTranslations('Clients.profile.material')

  // The way back travels as a composed sentence, not as a key the other screen has to own.
  const back = new URLSearchParams(
    returnParams(`/${locale}/admin/materials`, t('card.backToQueue'))
  ).toString()

  return (
    <div>
      <article
        {...dragHandleProps}
        className={`rounded-2xl border bg-white p-4 dark:bg-gray-900 ${
          dragging ? 'border-primary-800 opacity-60 dark:border-tuggi-blue' : 'border-gray-200 dark:border-gray-800'
        }`}
      >
        <div className="flex items-start gap-2">
          <PaymentStanceBadge stance={order.stance} />
          <Link
            href={`/${locale}/admin/clients?clientId=${order.clientId}&tab=profile&${back}`}
            className="min-w-0 flex-1 break-words text-sm font-semibold text-gray-900 underline-offset-4 hover:underline dark:text-white"
          >
            {order.clientName}
          </Link>
        </div>

        <ul className="mt-2 space-y-0.5">
          {order.items.map((item) => (
            <li key={item.kind} className="text-sm text-gray-900 dark:text-gray-200">
              <span className="font-semibold tabular-nums">{item.quantity}×</span>{' '}
              {m(`kinds.${item.kind}`)}
            </li>
          ))}
        </ul>

        <p className="mt-2 flex items-start gap-1 text-[11px] leading-snug text-gray-500 dark:text-gray-400">
          <MapPin className="mt-0.5 h-3 w-3 shrink-0" aria-hidden="true" />
          <span>
            {order.destination.origin === 'none' ? (
              <span className="font-medium text-secondary-700">{t('card.noAddress')}</span>
            ) : (
              <>
                {order.destination.name}
                {order.destination.city ? ` · ${order.destination.city}` : ''}
                {order.destination.region ? `/${order.destination.region}` : ''}
                <span className="ml-1 text-gray-400">
                  ({t(`card.origin.${order.destination.origin}`)})
                </span>
              </>
            )}
          </span>
        </p>

        {order.notes && (
          <p className="mt-1 text-[11px] italic leading-snug text-gray-500 dark:text-gray-400">
            {order.notes}
          </p>
        )}

        <Link
          href={`/${locale}/admin/clients/${order.clientId}/contract?${back}`}
          className="mt-2 inline-flex min-h-[24px] items-center gap-1 text-[11px] font-semibold text-primary-800 underline-offset-4 hover:underline dark:text-tuggi-blue"
        >
          <FileText className="h-3 w-3" aria-hidden="true" />
          {t('card.contract')}
        </Link>

        <p className="mt-3 text-[11px] text-gray-500 dark:text-gray-400">
          {new Date(order.createdAt).toLocaleDateString('pt-BR')}
          <span aria-hidden="true"> · </span>
          {m(`sources.${order.source}`)}
        </p>

        <div className="mt-2">
          <MaterialMoveButtons
            status={order.status}
            busy={busy}
            onMove={(status) => onMove(order, status)}
          />
        </div>
      </article>

      {/* Why the card came back. `role="status"` so it is announced and not only seen. */}
      {refusal && (
        <p
          role="status"
          className="mt-1 rounded-xl border border-secondary-700 px-2 py-1 text-[11px] text-gray-900 dark:text-gray-200"
        >
          {refusal}
        </p>
      )}
    </div>
  )
}
