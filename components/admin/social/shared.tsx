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
import { SectionHeader, WidgetCard } from '@/components/dashboard/WidgetCard'
import type {
  AccountsPayload,
  CompetitorPostsPayload,
  OverviewPayload,
  PostsPayload,
  StoriesPayload,
} from '@/lib/social/repository'
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
  stories: () => ({
    queryKey: ['social', 'stories'] as const,
    queryFn: () => getJson<StoriesPayload>('/api/admin/social/stories?days=14'),
  }),
  /** `null` asks the server's default week (the last closed one). */
  competitorPosts: (week: string | null) => ({
    queryKey: ['social', 'competitor-posts', week] as const,
    queryFn: () =>
      getJson<CompetitorPostsPayload>(`/api/admin/social/competitor-posts${week ? `?week=${week}` : ''}`),
  }),
}

/**
 * A card of the page (#1061, R1 item 5): `WidgetCard` with its `SectionHeader`, the note in the
 * `right` slot. `h2` by default, because the page title is the `h1`; the four rankings sit under a
 * section `h2` and pass `h3` (axe `heading-order`).
 */
export function SocialCard({
  title,
  icon,
  note,
  children,
  className,
  as = 'h2',
}: {
  title: string
  icon?: LucideIcon
  note?: ReactNode
  children: ReactNode
  className?: string
  as?: 'h2' | 'h3'
}) {
  return (
    <WidgetCard className={className}>
      <SectionHeader
        as={as}
        title={title}
        icon={icon}
        iconColor="#6b7280"
        className="mb-3 flex-wrap gap-x-4 gap-y-1"
        right={note ? <p className={`text-[11px] ${DIM}`}>{note}</p> : undefined}
      />
      {children}
    </WidgetCard>
  )
}

/** Height of each card's pulse while it loads, so the card does not grow when the data lands (R1 item 10). */
export const LOADING_HEIGHT = { recs: 'h-24', growth: 'h-72', ranking: 'h-40', funnel: 'h-64' } as const

export function CardLoading({ height }: { height: string }) {
  const tc = useTranslations('Common.status')
  return (
    <div role="status" aria-label={tc('loading')} className={`animate-pulse rounded-lg bg-gray-100 dark:bg-gray-800 ${height}`} />
  )
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
