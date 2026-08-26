'use client'

/**
 * ONE ORDER, as the person packing the box needs to read it: what goes in, whose it is, and
 * where it is going.
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
 */

import { useTranslations } from 'next-intl'
import Link from 'next/link'
import { MapPin } from 'lucide-react'
import { MaterialMoveButtons } from '@/components/admin/materials/MaterialMoveButtons'
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

  return (
    <div>
      <article
        {...dragHandleProps}
        className={`rounded-2xl border bg-white p-4 dark:bg-gray-900 ${
          dragging ? 'border-primary-800 opacity-60 dark:border-tuggi-blue' : 'border-gray-200 dark:border-gray-800'
        }`}
      >
        <div className="flex items-start justify-between gap-2">
          <Link
            href={`/${locale}/admin/clients?clientId=${order.clientId}&tab=profile`}
            className="text-sm font-semibold text-gray-900 underline-offset-4 hover:underline dark:text-white"
          >
            {order.clientName}
          </Link>
          <span className="shrink-0 text-[10px] font-bold uppercase tracking-widest text-gray-400">
            {m(`sources.${order.source}`)}
          </span>
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

        <div className="mt-3 flex flex-wrap items-center justify-between gap-2">
          <span className="text-[11px] text-gray-400">
            {new Date(order.createdAt).toLocaleDateString('pt-BR')}
          </span>
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
