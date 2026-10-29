'use client'

/**
 * Pieces every view of `/admin/social` (#1059) shares: the card with its `h2` header (spec 1), the
 * loading and error states of a card (spec 5), the raw-value fallback of an enum (DS-COPY-021), and
 * the JSON fetch the queries run.
 */

import type { ReactNode } from 'react'
import type { LucideIcon } from 'lucide-react'
import { useTranslations } from 'next-intl'
import { Button } from '@/components/ui/button'
import { DIM } from '@/components/ui/dense-table'
import type { AccountsPayload, OverviewPayload, PostsPayload } from '@/lib/social/repository'
import type { SocialPeriod } from '@/lib/social/time'

export async function getJson<T>(url: string): Promise<T> {
  const res = await fetch(url, { cache: 'no-store' })
  if (!res.ok) throw new Error(`HTTP ${res.status}`)
  return (await res.json()) as T
}

export type SocialView = 'overview' | 'posts' | 'competitors'

/**
 * The one query of each view. The header reads the same key for the freshness line, so react-query
 * serves both from one request, and coming back to a tab shows the cached data (DS-COMPONENTE-002).
 */
export const socialQueries = {
  overview: (period: SocialPeriod) => ({
    queryKey: ['social', 'overview', period] as const,
    queryFn: () => getJson<OverviewPayload>(`/api/admin/social/overview?period=${period}`),
  }),
  posts: () => ({ queryKey: ['social', 'posts'] as const, queryFn: () => getJson<PostsPayload>('/api/admin/social/posts') }),
  accounts: () => ({
    queryKey: ['social', 'accounts'] as const,
    queryFn: () => getJson<AccountsPayload>('/api/admin/social/accounts'),
  }),
}

export function SocialCard({
  title,
  icon: Icon,
  note,
  children,
  className = '',
}: {
  title: string
  icon?: LucideIcon
  note?: ReactNode
  children: ReactNode
  className?: string
}) {
  return (
    <section className={`rounded-xl border border-gray-200 bg-white p-4 dark:border-gray-800 dark:bg-gray-900 ${className}`}>
      <div className="mb-3 flex flex-wrap items-center justify-between gap-x-4 gap-y-1">
        <h2 className="flex min-w-0 items-center gap-2 text-xs font-black uppercase tracking-widest text-gray-700 dark:text-gray-300">
          {Icon && <Icon className="h-4 w-4 shrink-0 text-gray-500" aria-hidden="true" />}
          <span className="truncate">{title}</span>
        </h2>
        {note && <p className={`text-[11px] ${DIM}`}>{note}</p>}
      </div>
      {children}
    </section>
  )
}

export function CardLoading() {
  const tc = useTranslations('Common.status')
  return <p className={`text-sm ${DIM}`}>{tc('loading')}</p>
}

export function CardError({ onRetry }: { onRetry: () => void }) {
  const t = useTranslations('Pages.Social')
  return (
    <div
      role="alert"
      className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800"
    >
      <span>{t('load_failed')}</span>
      <Button type="button" variant="outline" size="sm" onClick={onRetry}>
        {t('retry')}
      </Button>
    </div>
  )
}

/** An enum value the screen has no word for: printed raw, in mono, with a title that says so. */
export function RawValue({ value }: { value: string }) {
  const t = useTranslations('Pages.Social')
  return (
    <span className="font-mono text-xs" title={t('raw_value_hint', { value })}>
      {value}
    </span>
  )
}
