'use client'

/**
 * THE NUMBERS OVER THE QUEUE — how much is owed, of what, and to which towns.
 *
 * FIVE NUMBERS AND A LIST, and the shape follows the question the operator arrived with: what do
 * we print (quantity per kind), how many acts is that (orders), what already left (in transit),
 * where does it go (towns), and what cannot be shipped at all (orders with no address). Anything
 * else here is a number nobody spends money on.
 *
 * `dispatched` IS COUNTED APART FROM `pending`, and that is the line the esteira bought. An
 * order with the carrier was already produced; folding it into `A produzir` would put it on the
 * next print run a second time, which is the one mistake this dashboard exists to prevent.
 *
 * IT IS COMPUTED FROM THE CARDS BELOW IT — `summarizeMaterialQueue` over the same array — so the
 * figure and the column can never disagree. A `count()` per tile is how a board ends up printing
 * `17 abertos` over sixteen cards.
 *
 * ── WHY TWO COMPONENTS AND NOT ONE ─────────────────────────────────────────────────────────
 *
 * The screen now sits in the same grid as `/admin/clients`, `/places` and `/events`: an 18% rail
 * and 82% of content. The FIGURES are what a rail is for — a stack of one-line answers, read
 * without moving the eye off the board — and the TOWN TABLE is not: it has a column per kind and
 * would be unreadable at 18%. So they render in the two places the grid actually has, from ONE
 * `MaterialQueueSummary`. Splitting the object would have been the defect; splitting the
 * rendering is the layout.
 */

import { useTranslations } from 'next-intl'
import { AlertTriangle, Boxes, MapPin, Package, Truck } from 'lucide-react'
import { MATERIAL_KINDS } from '@/lib/partner-form/fields'
import type { MaterialQueueSummary } from '@/lib/materials/order-queue'

interface FiguresProps {
  summary: MaterialQueueSummary
  /** Whether the read hit its cap — every count becomes a floor rather than a fact. */
  truncated: boolean
}

/** The rail panel: the five answers, one per line. */
export function MaterialFigures({ summary, truncated }: FiguresProps) {
  const t = useTranslations('Materials')
  const k = useTranslations('Clients.profile.material.kinds')
  const floor = (value: number) => (truncated ? t('atLeast', { count: value }) : String(value))

  return (
    <section
      aria-labelledby="materials-summary"
      className="rounded-3xl border border-gray-200 bg-white/70 p-5 shadow-2xl shadow-black/5 backdrop-blur-xl dark:border-gray-800 dark:bg-gray-900/70"
    >
      <h2
        id="materials-summary"
        className="mb-4 text-[10px] font-bold uppercase tracking-widest text-gray-400"
      >
        {t('summary.title')}
      </h2>

      <div className="space-y-4">
        <Figure
          icon={<Package className="h-4 w-4 text-amber-500" aria-hidden="true" />}
          label={t('summary.pendingOrders')}
          value={floor(summary.pendingOrders)}
          hint={t('summary.pendingUnits', { count: summary.pendingUnits })}
        />

        {/* The three quantities in ONE block and not three: they are printed together, and the
            operator reads them as one line on a purchase order. */}
        <Figure
          icon={<Boxes className="h-4 w-4 text-primary-800 dark:text-tuggi-blue" aria-hidden="true" />}
          label={t('summary.toPrint')}
          value={
            <span className="flex flex-col gap-0.5">
              {MATERIAL_KINDS.map((kind) => (
                <span key={kind} className="text-base font-semibold text-gray-900 dark:text-white">
                  {summary.pendingByKind[kind]}
                  <span className="ml-1 text-[11px] font-medium text-gray-500 dark:text-gray-400">
                    {k(kind)}
                  </span>
                </span>
              ))}
            </span>
          }
        />

        {/* Already produced and on the road. Its own line so it is never added to the print run. */}
        <Figure
          icon={<Truck className="h-4 w-4 text-primary-800 dark:text-tuggi-blue" aria-hidden="true" />}
          label={t('summary.inTransit')}
          value={floor(summary.dispatchedOrders)}
          hint={t('summary.inTransitUnits', { count: summary.dispatchedUnits })}
        />

        <Figure
          icon={<MapPin className="h-4 w-4 text-green-600" aria-hidden="true" />}
          label={t('summary.towns')}
          value={String(summary.destinations.length)}
          hint={t('summary.fulfilled', { count: summary.fulfilledOrders })}
        />

        {/* A pendency, not a quantity — it is the only line here that can be a problem. */}
        <Figure
          icon={
            summary.pendingWithoutDestination > 0 ? (
              <AlertTriangle className="h-4 w-4 text-secondary-700" aria-hidden="true" />
            ) : (
              <MapPin className="h-4 w-4 text-gray-400" aria-hidden="true" />
            )
          }
          label={t('summary.noAddress')}
          value={String(summary.pendingWithoutDestination)}
          hint={summary.pendingWithoutDestination > 0 ? t('summary.noAddressHint') : undefined}
        />
      </div>
    </section>
  )
}

/** The shipping list, by town. Wide by nature, so it lives in the content column. */
export function MaterialDestinations({ summary }: { summary: MaterialQueueSummary }) {
  const t = useTranslations('Materials')
  const k = useTranslations('Clients.profile.material.kinds')

  if (summary.destinations.length === 0) return null

  return (
    <div className="mb-6 overflow-x-auto rounded-3xl border border-gray-200 bg-white dark:border-gray-800 dark:bg-gray-900">
      <table className="w-full min-w-[520px] text-left text-sm">
        <caption className="px-5 pt-4 text-left text-xs text-gray-500 dark:text-gray-400">
          {t('summary.tableCaption')}
        </caption>
        <thead>
          <tr className="text-[10px] uppercase tracking-widest text-gray-400">
            <th scope="col" className="px-5 py-3 font-bold">{t('summary.town')}</th>
            {MATERIAL_KINDS.map((kind) => (
              <th key={kind} scope="col" className="px-3 py-3 text-right font-bold">
                {k(kind)}
              </th>
            ))}
            <th scope="col" className="px-5 py-3 text-right font-bold">{t('summary.orders')}</th>
          </tr>
        </thead>
        <tbody>
          {summary.destinations.map((line) => (
            <tr key={line.key} className="border-t border-gray-100 dark:border-gray-800">
              <th scope="row" className="px-5 py-3 font-medium text-gray-900 dark:text-white">
                {line.city}
                {line.region ? (
                  <span className="text-gray-500 dark:text-gray-400">/{line.region}</span>
                ) : null}
              </th>
              {MATERIAL_KINDS.map((kind) => (
                <td key={kind} className="px-3 py-3 text-right tabular-nums text-gray-900 dark:text-gray-200">
                  {line.byKind[kind] || '—'}
                </td>
              ))}
              <td className="px-5 py-3 text-right tabular-nums text-gray-500 dark:text-gray-400">
                {line.orders}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

function Figure({
  icon,
  label,
  value,
  hint,
}: {
  icon: React.ReactNode
  label: string
  value: React.ReactNode
  hint?: string
}) {
  return (
    <div>
      <div className="flex items-center gap-2">
        {icon}
        <span className="text-[10px] font-bold uppercase tracking-widest text-gray-400">{label}</span>
      </div>
      <div className="mt-1 text-2xl font-semibold tracking-tight text-gray-900 dark:text-white">
        {value}
      </div>
      {hint && <p className="mt-1 text-[11px] leading-snug text-gray-500 dark:text-gray-400">{hint}</p>}
    </div>
  )
}
