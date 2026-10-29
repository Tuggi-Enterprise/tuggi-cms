'use client'

/**
 * `/admin/social` (#1059): one route, three views by `ReportTabs` (spec 1). `?view=posts` and
 * `?view=competitors` live in the URL; the overview is the default and is never written. `?period=`
 * belongs to the overview only.
 *
 * The header carries the only freshness line of the page (copy `data_until`) and the collection
 * banner (copy section 5), which is the "collection error" state of all three views.
 */

import { CircleAlert, ImageIcon, LayoutDashboard, Users } from 'lucide-react'
import { useTranslations } from 'next-intl'
import { usePathname, useRouter, useSearchParams } from 'next/navigation'
import { useQuery } from '@tanstack/react-query'
import { Container } from '@/components/ui/Container'
import { ReportTabs } from '@/components/dashboard/ReportTabs'
import { Select } from '@/components/ui/select'
import { fmtDay } from '@/lib/social/format'
import {
  DEFAULT_SOCIAL_PERIOD,
  SOCIAL_PERIODS,
  collectState,
  isSocialPeriod,
  type SocialPeriod,
} from '@/lib/social/time'
import { SocialOverview } from './SocialOverview'
import { SocialPostsTable } from './SocialPostsTable'
import { SocialCompetitors } from './SocialCompetitors'
import { socialQueries, type SocialView } from './shared'

export function viewOf(raw: string | null): SocialView {
  return raw === 'posts' || raw === 'competitors' ? raw : 'overview'
}

function useCollection(view: SocialView, period: SocialPeriod) {
  const overview = useQuery({ ...socialQueries.overview(period), enabled: view === 'overview' })
  const posts = useQuery({ ...socialQueries.posts(), enabled: view === 'posts' })
  const accounts = useQuery({ ...socialQueries.accounts(), enabled: view === 'competitors' })
  const data = view === 'overview' ? overview.data : view === 'posts' ? posts.data : accounts.data
  return data?.collection ?? null
}

function CollectBanner({ collection }: { collection: { first_day: string | null; last_day: string | null } }) {
  const t = useTranslations('Pages.Social.collect')
  const state = collectState(collection, new Date())
  if (state === 'ok') return null
  const amber = state !== 'first_day'
  return (
    <div
      role="status"
      className={`mb-4 flex gap-2 rounded-xl border px-4 py-3 text-sm ${
        amber ? 'border-amber-200 bg-amber-50 text-amber-900' : 'border-gray-200 bg-white text-gray-800'
      }`}
    >
      <CircleAlert className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
      <div>
        {state === 'none' && (
          <>
            <p className="font-semibold">{t('none_title')}</p>
            <p>{t('none_body')}</p>
          </>
        )}
        {state === 'failed' && (
          <>
            <p className="font-semibold">{t('failed_title')}</p>
            <p>{t('failed_body', { date: fmtDay(collection.last_day as string) })}</p>
          </>
        )}
        {state === 'first_day' && <p>{t('first_day', { date: fmtDay(collection.last_day as string) })}</p>}
      </div>
    </div>
  )
}

export function SocialPageContent() {
  const t = useTranslations('Pages.Social')
  const router = useRouter()
  const pathname = usePathname()
  const params = useSearchParams()
  const view = viewOf(params?.get('view') ?? null)
  const rawPeriod = params?.get('period') ?? null
  const period: SocialPeriod = isSocialPeriod(rawPeriod) ? rawPeriod : DEFAULT_SOCIAL_PERIOD
  const collection = useCollection(view, period)

  const go = (next: { view?: SocialView; period?: SocialPeriod }) => {
    const q = new URLSearchParams(params?.toString() ?? '')
    const v = next.view ?? view
    if (v === 'overview') q.delete('view')
    else q.set('view', v)
    if (v !== 'overview') q.delete('period')
    else if (next.period) {
      if (next.period === DEFAULT_SOCIAL_PERIOD) q.delete('period')
      else q.set('period', next.period)
    }
    const s = q.toString()
    router.replace(s ? `${pathname}?${s}` : pathname, { scroll: false })
  }

  return (
    <div className="cms-width min-h-screen bg-gray-50/50">
      <Container className="py-8">
        <div className="mb-2 flex flex-wrap items-center justify-between gap-3">
          <h1 className="text-2xl font-bold text-gray-900 dark:text-gray-100">{t('title')}</h1>
          <div className="max-w-full overflow-x-auto">
            <ReportTabs
              iconClassName="hidden h-4 w-4 sm:block"
              tabs={[
                { key: 'overview', label: t('tabs.overview'), icon: LayoutDashboard },
                { key: 'posts', label: t('tabs.posts'), icon: ImageIcon },
                { key: 'competitors', label: t('tabs.competitors'), icon: Users },
              ]}
              active={view}
              onChange={(key) => go({ view: viewOf(key) })}
            />
          </div>
        </div>
        <div className="mb-4 flex flex-wrap items-end justify-between gap-3">
          <p className="max-w-3xl text-sm text-gray-600 dark:text-gray-400">
            {t('subtitle')}{' '}
            {collection?.last_day && <span className="font-medium text-gray-800">{t('data_until', { date: fmtDay(collection.last_day) })}.</span>}{' '}
            {t('tz_note')}
          </p>
          {view === 'overview' && (
            <label className="w-56">
              <span className="sr-only">{t('period_label')}</span>
              <Select value={period} onValueChange={(v) => isSocialPeriod(v) && go({ period: v })}>
                {(Object.keys(SOCIAL_PERIODS) as SocialPeriod[]).map((p) => (
                  <option key={p} value={p}>
                    {t(`period.${p}`)}
                  </option>
                ))}
              </Select>
            </label>
          )}
        </div>
        {collection && <CollectBanner collection={collection} />}
        {view === 'overview' && <SocialOverview period={period} />}
        {view === 'posts' && <SocialPostsTable />}
        {view === 'competitors' && <SocialCompetitors />}
      </Container>
    </div>
  )
}
