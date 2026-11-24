'use client'

/**
 * The acquisition funnel of the Acquisition page (#1171, design spec `spec-cms-relatorio-aquisicao-funil-2026-11`):
 * A, the funnel of each store; B, where store visits come from; C, search; D, the website by channel.
 * One RPC feeds all four (`social.acquisition_funnel`); "entered" per store comes from the page's own
 * `core.dashboard_acquisition` read.
 *
 * Every number and rule is decided in `lib/acquisition/funnel.ts` (DS-COMPONENTE-084: coverage in three
 * states said once per card, a floor marked `≥`, no rate across sources); this only draws. The tables are
 * the dense table of `components/ui/dense-table` (DS-COMPONENTE-081).
 */

import { useMemo, type ReactNode } from 'react'
import dynamic from 'next/dynamic'
import { useLocale, useTranslations } from 'next-intl'
import { Globe, Search, Store } from 'lucide-react'

import { WidgetCard, SectionHeader } from '@/components/dashboard/WidgetCard'
import { CardError } from '@/components/admin/social/shared'
import { CAMPAIGNS_ANCHOR } from '@/components/admin/social/SocialCampaigns'
import { StatLine, STAT_BADGE } from '@/components/dashboard/reports/engagement/StatLine'
import { stepFunnelHeight, type StepFunnelRow } from '@/components/dashboard/reports/engagement/question-charts'
import { DIM, DenseTableScroller, HEAD_SOLO, HEAD_SOLO_NUM, NUM, ROW_HEAD } from '@/components/ui/dense-table'
import { UNKNOWN_VALUE } from '@/lib/format/unknown'
import { cn } from '@/lib/utils'
import { useAcquisitionFunnel } from '@/lib/hooks/use-acquisition'
import type { StepFunnelView } from '@/lib/conversion/funnel'
import {
  STORES,
  STORE_JOB,
  enteredByStore,
  funnelCoverage,
  originTable,
  showsStoreLag,
  siteTable,
  storeFunnel,
  type AcquisitionFunnel as FunnelData,
  type FunnelSource,
  type SourceCoverage,
  type StoreKey,
} from '@/lib/acquisition/funnel'

const StepFunnel = dynamic(() => import('@/components/dashboard/reports/engagement/StepFunnel').then((m) => m.StepFunnel), {
  ssr: false,
  loading: () => <div className="animate-pulse rounded-lg bg-gray-100 dark:bg-gray-800" style={{ height: stepFunnelHeight(5) }} />,
})

type T = (key: string, values?: Record<string, string | number>) => string

const PULSE = 'animate-pulse rounded-lg bg-gray-100 dark:bg-gray-800'
const ROW_LINE = 'border-t border-gray-100 dark:border-gray-800'
const TOTAL_LINE = 'border-t border-gray-200 dark:border-gray-700 font-semibold'
const EMPTY = cn('py-8 text-center text-xs', DIM)
/** The channels whose name has a hint in the copy. */
const CHANNEL_HINTS = new Set(['Direct', 'Organic_Search', 'Organic_Social', 'Referral', 'Unassigned', 'other'])

interface Fmt {
  int: (v: number) => string
  pct: (v: number) => string
  dec: (v: number) => string
  day: (iso: string) => string
}

/** A count of a source: `UNKNOWN_VALUE` when unknown, `≥ n` when the source covers part of the month. */
function Count({ v, floor, fmt, title }: { v: number | null; floor: boolean; fmt: Fmt; title?: string }) {
  if (v === null) return <span className={DIM} title={title}>{UNKNOWN_VALUE}</span>
  return <>{`${floor ? '≥ ' : ''}${fmt.int(v)}`}</>
}

/** The coverage of the card's sources, one line per source, under the header (#1051: never in the cell). */
function CoverageLines({ items, t, fmt, extra }: { items: { source: FunnelSource; c: SourceCoverage }[]; t: T; fmt: Fmt; extra?: ReactNode }) {
  const lines: ReactNode[] = []
  for (const { source, c } of items) {
    const name = t(`coverage.source.${source}`)
    const badge = (text: string) => <span className={cn(STAT_BADGE, 'mr-1.5')}>{text}</span>
    if (c.state === 'none') {
      lines.push(
        <p key={source} data-testid={`coverage-${source}`} data-state="none">
          {badge(t('coverage.no_data_badge'))}
          {c.none === 'before_start' ? t('coverage.none_before_start', { source: name, date: fmt.day(c.from as string) }) : t('coverage.none_not_configured', { source: name })}
        </p>
      )
      continue
    }
    if (c.state === 'full') continue
    const sentences = [
      c.from ? t('coverage.partial', { source: name, date: fmt.day(c.from) }) : null,
      c.through ? t('coverage.through', { source: name, date: fmt.day(c.through) }) : null,
      c.noRows ? t('coverage.no_rows', { source: name }) : null,
    ].filter(Boolean)
    lines.push(
      <p key={source} data-testid={`coverage-${source}`} data-state="partial">
        {c.from && badge(t('coverage.since_badge', { date: fmt.day(c.from) }))}
        {badge(t('coverage.floor_badge'))}
        {sentences.join(' ')}
      </p>
    )
  }
  if (lines.length === 0 && !extra) return null
  return (
    <div className={cn('-mt-2 mb-3 space-y-1 text-[11px] leading-4', DIM)}>
      {extra}
      {lines}
    </div>
  )
}

/** The rows `StepFunnel` draws, from the resolved view. The first step the store measures is the base: no 100 %. */
function funnelRows(view: StepFunnelView, t: T, fmt: Fmt, ga4: string): StepFunnelRow[] {
  const first = view.steps.find((x) => !x.hollow && x.value !== null && x.reason !== 'not_measured')?.key
  const LABEL: Record<string, string> = {
    impressions: 'stores.impressions',
    page_views: 'stores.page_views',
    downloads: 'stores.downloads',
    installs_ga4: 'stores.installs',
    entered: 'stores.entered',
  }
  return view.steps.map((st) => {
    const label = t(LABEL[st.key])
    const known = st.value !== null
    const text = known ? `${st.state === 'floor' ? '≥ ' : ''}${fmt.int(st.value as number)}` : UNKNOWN_VALUE
    const withRate = known && st.rate !== null && !st.hollow && st.key !== first ? `${text} · ${fmt.pct(st.rate)}` : text
    // Apple counts a "Get" from the search result with no page view: the excess prints as a gain, never as a rate over the step above.
    const display = st.gain ? `${withRate} (+${fmt.int(st.gain)})` : withRate
    const hint = st.reason === 'not_measured' ? t('stores.play_no_impressions') : t(`${LABEL[st.key]}_hint`)
    return {
      key: st.key,
      label,
      hollow: st.hollow,
      kept: st.value ?? 0,
      lost: st.lost ?? 0,
      highlight: false,
      display,
      muted: !known,
      title: `${label}: ${display}. ${hint}`,
      badge: st.key === 'installs_ga4' ? ga4 : st.key === 'entered' ? t('stores.badge_bank') : undefined,
    }
  })
}

function StoreCard({
  store,
  data,
  coverage,
  entered,
  month,
  t,
  fmt,
  ga4,
}: {
  store: StoreKey
  data: FunnelData | undefined
  coverage: Record<FunnelSource, SourceCoverage> | undefined
  entered: number | null
  month: string
  t: T
  fmt: Fmt
  ga4: string
}) {
  const name = t(`store_names.${store}`)
  const job = STORE_JOB[store]
  const c = coverage?.[job]
  const view = data && coverage ? storeFunnel(store, data, coverage, entered) : undefined
  const installs = data?.installs[store]
  const footer = (key: 'installsStore' | 'uninstalls', label: string, hint?: string) => {
    const v = installs ? installs[key] : null
    const muted = !c || c.state === 'none' || v === null
    return (
      <StatLine
        testId={`funnel-${store}-${key}`}
        label={label}
        hint={hint}
        loading={!data}
        value={muted ? UNKNOWN_VALUE : `${c?.state === 'partial' ? '≥ ' : ''}${fmt.int(v as number)}`}
        valueMuted={muted}
      />
    )
  }
  return (
    <WidgetCard>
      <SectionHeader title={name} icon={Store} />
      {coverage && c && (
        <CoverageLines
          items={[
            { source: job, c },
            { source: 'ga4', c: coverage.ga4 },
          ]}
          t={t}
          fmt={fmt}
          extra={store === 'play_store' ? <p data-testid="play-no-impressions">{t('stores.play_no_impressions')}</p> : undefined}
        />
      )}
      {view ? (
        <StepFunnel label={`${t('stores.title')} · ${name}`} ga4={ga4} max={view.max} rows={funnelRows(view, t, fmt, ga4)} />
      ) : (
        <div className={PULSE} style={{ height: stepFunnelHeight(5) }} />
      )}
      <p className={cn('mt-1 text-[11px] leading-4', DIM)} title={t('stores.ruler_break_hint')}>
        {t('stores.ruler_break')}
      </p>
      {c && c.state !== 'none' && showsStoreLag(month, new Date()) && <p className={cn('mt-1 text-[11px] leading-4', DIM)}>{t('coverage.lag')}</p>}
      <div className="mt-3 grid grid-cols-2 gap-4 border-t border-dashed border-gray-200 pt-3 dark:border-gray-800">
        {footer('installsStore', t('uninstalls.col_installs_store'), t('uninstalls.installs_store_hint'))}
        {footer('uninstalls', t('uninstalls.col_uninstalls'))}
      </div>
    </WidgetCard>
  )
}

function SkeletonRows({ n }: { n: number }) {
  return (
    <div className="space-y-1" aria-busy="true">
      {Array.from({ length: n }, (_, i) => (
        <div key={i} className={cn(PULSE, 'h-10')} />
      ))}
    </div>
  )
}

function OriginCard({ store, data, coverage, month, t, fmt }: { store: StoreKey; data: FunnelData | undefined; coverage: Record<FunnelSource, SourceCoverage> | undefined; month: string; t: T; fmt: Fmt }) {
  const name = t(`store_names.${store}`)
  const c = coverage?.[STORE_JOB[store]]
  const floor = c?.state === 'partial'
  const rows = data && c && c.state !== 'none' ? originTable(store, data.stores, c) : undefined
  const apple = store === 'app_store'
  // the block intro already says "where store visits come from": the card is named by its store, which fits at 390
  const label = `${t('sources.title')} · ${name}`
  return (
    <WidgetCard>
      <SectionHeader title={name} icon={Store} />
      {c && <CoverageLines items={[{ source: STORE_JOB[store], c }]} t={t} fmt={fmt} />}
      {!data ? (
        <SkeletonRows n={5} />
      ) : rows ? (
        <DenseTableScroller label={label} maxHeightClassName="">
          <table className="w-full border-collapse" data-testid={`origin-${store}`}>
            <thead>
              <tr>
                <th scope="col" className={cn(HEAD_SOLO, 'left-0 z-20')}>{t('sources.col_source')}</th>
                {apple && <th scope="col" className={HEAD_SOLO_NUM}>{t('stores.impressions')}</th>}
                <th scope="col" className={HEAD_SOLO_NUM}>{t('stores.page_views')}</th>
                <th scope="col" className={HEAD_SOLO_NUM}>{t('stores.downloads')}</th>
                <th scope="col" className={HEAD_SOLO_NUM}>{t('sources.col_conversion')}</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => {
                const total = r.source === 'total'
                return (
                  <tr key={r.source} className={total ? TOTAL_LINE : ROW_LINE}>
                    <th scope="row" className={cn(ROW_HEAD, 'text-sm text-gray-800 dark:text-gray-200', total ? 'font-semibold' : 'font-normal')} title={total ? undefined : t(`sources.${r.source}_hint`)}>
                      {t(`sources.${r.source}`)}
                    </th>
                    {apple && <td className={NUM}><Count v={r.impressions} floor={floor} fmt={fmt} /></td>}
                    <td className={NUM}><Count v={r.pageViews} floor={floor} fmt={fmt} /></td>
                    <td className={NUM}><Count v={r.downloads} floor={floor} fmt={fmt} /></td>
                    <td className={NUM}>{r.conversion === null ? <span className={DIM}>{UNKNOWN_VALUE}</span> : fmt.pct(r.conversion)}</td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </DenseTableScroller>
      ) : null}
      {c && c.state !== 'none' && showsStoreLag(month, new Date()) && <p className={cn('mt-2 text-[11px] leading-4', DIM)}>{t('coverage.lag')}</p>}
    </WidgetCard>
  )
}

function TermsCard({ data, coverage, t, fmt }: { data: FunnelData | undefined; coverage: Record<FunnelSource, SourceCoverage> | undefined; t: T; fmt: Fmt }) {
  const c = coverage?.play
  const floor = c?.state === 'partial'
  const terms = (data?.terms ?? []).filter((x) => x.store === 'play_store')
  return (
    <WidgetCard>
      <SectionHeader title={t('search.play_title')} icon={Search} />
      <p className={cn('-mt-2 mb-3 text-[11px] leading-4', DIM)}>{t('search.play_caption')}</p>
      {c && <CoverageLines items={[{ source: 'play', c }]} t={t} fmt={fmt} />}
      {!data ? (
        <SkeletonRows n={5} />
      ) : c && c.state !== 'none' ? (
        terms.length === 0 ? (
          <p className={EMPTY}>{t('search.empty_terms')}</p>
        ) : (
          <DenseTableScroller label={t('search.play_title')} maxHeightClassName="">
            <table className="w-full border-collapse" data-testid="terms-play">
              <thead>
                <tr>
                  <th scope="col" className={cn(HEAD_SOLO, 'left-0 z-20')}>{t('search.col_term')}</th>
                  <th scope="col" className={HEAD_SOLO_NUM}>{t('stores.page_views')}</th>
                  <th scope="col" className={HEAD_SOLO_NUM}>{t('stores.downloads')}</th>
                </tr>
              </thead>
              <tbody>
                {terms.map((r) => (
                  <tr key={r.term} className={ROW_LINE}>
                    <th scope="row" className={cn(ROW_HEAD, 'max-w-[180px] truncate text-sm font-normal text-gray-800 dark:text-gray-200')} title={r.term}>
                      {r.term}
                    </th>
                    <td className={NUM}><Count v={r.pageViews} floor={floor} fmt={fmt} /></td>
                    <td className={NUM}><Count v={r.downloads} floor={floor} fmt={fmt} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </DenseTableScroller>
        )
      ) : null}
    </WidgetCard>
  )
}

function QueriesCard({ data, coverage, t, fmt }: { data: FunnelData | undefined; coverage: Record<FunnelSource, SourceCoverage> | undefined; t: T; fmt: Fmt }) {
  const c = coverage?.search_console
  const floor = c?.state === 'partial'
  const queries = data?.queries ?? []
  return (
    <WidgetCard>
      <SectionHeader title={t('search.google_title')} icon={Search} />
      <p className={cn('-mt-2 mb-3 text-[11px] leading-4', DIM)}>{t('search.google_caption')}</p>
      {c && <CoverageLines items={[{ source: 'search_console', c }]} t={t} fmt={fmt} />}
      {!data ? (
        <SkeletonRows n={5} />
      ) : c && c.state !== 'none' ? (
        queries.length === 0 ? (
          <p className={EMPTY}>{t('search.empty_queries')}</p>
        ) : (
          <DenseTableScroller label={t('search.google_title')} maxHeightClassName="">
            <table className="w-full border-collapse" data-testid="queries-google">
              <thead>
                <tr>
                  <th scope="col" className={cn(HEAD_SOLO, 'left-0 z-20')}>{t('search.col_query')}</th>
                  <th scope="col" className={HEAD_SOLO_NUM}>{t('search.col_clicks')}</th>
                  <th scope="col" className={HEAD_SOLO_NUM}>{t('search.col_impressions')}</th>
                  <th scope="col" className={HEAD_SOLO_NUM} title={t('search.position_hint')}>{t('search.col_position')}</th>
                </tr>
              </thead>
              <tbody>
                {queries.map((r) => (
                  <tr key={r.query} className={ROW_LINE}>
                    <th scope="row" className={cn(ROW_HEAD, 'max-w-[200px] truncate text-sm font-normal text-gray-800 dark:text-gray-200')} title={r.query}>
                      {r.query}
                    </th>
                    <td className={NUM}><Count v={r.clicks} floor={floor} fmt={fmt} /></td>
                    <td className={NUM}><Count v={r.impressions} floor={floor} fmt={fmt} /></td>
                    {/* a mean is not a floor */}
                    <td className={NUM}>{r.position === null ? <span className={DIM}>{UNKNOWN_VALUE}</span> : fmt.dec(r.position)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </DenseTableScroller>
        )
      ) : null}
    </WidgetCard>
  )
}

function SiteCard({ data, coverage, t, fmt }: { data: FunnelData | undefined; coverage: Record<FunnelSource, SourceCoverage> | undefined; t: T; fmt: Fmt }) {
  const c = coverage?.site_channels
  const floor = c?.state === 'partial'
  const table = data && c && c.state !== 'none' ? siteTable(data.site) : undefined
  const usersHint = t('site.col_users_hint')
  const clicksHint = t('site.clicks_hint')
  return (
    <WidgetCard>
      <SectionHeader title={t('site.title')} icon={Globe} href={`/admin/social#${CAMPAIGNS_ANCHOR}`} linkLabel={t('site.campaigns_link')} className="flex-wrap gap-x-4 gap-y-1" />
      <p className={cn('-mt-2 mb-3 text-[11px] leading-4', DIM)}>{t('site.subtitle')}</p>
      {c && <CoverageLines items={[{ source: 'site_channels', c }]} t={t} fmt={fmt} />}
      {!data ? (
        <SkeletonRows n={5} />
      ) : table ? (
        <DenseTableScroller label={t('site.title')} maxHeightClassName="">
          <table className="w-full border-collapse" data-testid="site-channels">
            <thead>
              <tr>
                <th scope="col" className={cn(HEAD_SOLO, 'left-0 z-20')}>{t('site.col_channel')}</th>
                <th scope="col" className={HEAD_SOLO_NUM}>{t('site.col_sessions')}</th>
                <th scope="col" className={HEAD_SOLO_NUM} title={usersHint}>{t('site.col_users')}</th>
                <th scope="col" className={HEAD_SOLO_NUM} title={clicksHint}>{t('site.col_clicks_app_store')}</th>
                <th scope="col" className={HEAD_SOLO_NUM} title={clicksHint}>{t('site.col_clicks_play_store')}</th>
              </tr>
            </thead>
            <tbody>
              {table.rows.map((r) => (
                <tr key={r.key} className={ROW_LINE}>
                  <th
                    scope="row"
                    className={cn(ROW_HEAD, 'text-sm font-normal text-gray-800 dark:text-gray-200')}
                    title={CHANNEL_HINTS.has(r.key) ? t(`site.channels.${r.key}_hint`, { channels: r.channels.join(', ') }) : undefined}
                  >
                    {t(`site.channels.${r.key}`)}
                  </th>
                  <td className={NUM}><Count v={r.sessions} floor={floor} fmt={fmt} /></td>
                  <td className={NUM}><Count v={r.users} floor={floor} fmt={fmt} /></td>
                  <td className={NUM}><Count v={r.clicksAppStore} floor={floor} fmt={fmt} /></td>
                  <td className={NUM}><Count v={r.clicksPlayStore} floor={floor} fmt={fmt} /></td>
                </tr>
              ))}
              <tr className={TOTAL_LINE}>
                <th scope="row" className={cn(ROW_HEAD, 'text-sm font-semibold text-gray-800 dark:text-gray-200')}>{t('sources.total')}</th>
                <td className={NUM}><Count v={table.total.sessions} floor={floor} fmt={fmt} /></td>
                {/* the same person arrives by two channels and on two days: users do not add up */}
                <td className={NUM} data-testid="site-total-users"><Count v={table.total.users} floor={false} fmt={fmt} title={usersHint} /></td>
                <td className={NUM}><Count v={table.total.clicksAppStore} floor={floor} fmt={fmt} /></td>
                <td className={NUM}><Count v={table.total.clicksPlayStore} floor={floor} fmt={fmt} /></td>
              </tr>
            </tbody>
          </table>
        </DenseTableScroller>
      ) : null}
    </WidgetCard>
  )
}

function BlockIntro({ title, subtitle }: { title: string; subtitle: string }) {
  return (
    <p className="text-sm">
      <span className="font-semibold text-gray-900 dark:text-white">{title}.</span> <span className={DIM}>{subtitle}</span>
    </p>
  )
}

export function AcquisitionFunnel({ month, platforms }: { month: string; platforms: { platform: string; total: number }[] | undefined }) {
  const tr = useTranslations('Pages.Dashboard.reports')
  const t: T = (key, values) => tr(`acquisition.${key}`, values)
  const locale = useLocale()
  const query = useAcquisitionFunnel(month)

  const fmt = useMemo<Fmt>(() => {
    const int = new Intl.NumberFormat(locale)
    const pct = new Intl.NumberFormat(locale, { style: 'percent', maximumFractionDigits: 1 })
    const dec = new Intl.NumberFormat(locale, { minimumFractionDigits: 1, maximumFractionDigits: 1 })
    const day = new Intl.DateTimeFormat(locale, { day: '2-digit', month: '2-digit', timeZone: 'UTC' })
    return {
      int: (v) => int.format(v),
      pct: (v) => pct.format(v),
      dec: (v) => dec.format(v),
      day: (iso) => day.format(new Date(`${iso}T12:00:00Z`)),
    }
  }, [locale])

  const data = query.data
  const coverage = useMemo(() => (data ? funnelCoverage(data, month) : undefined), [data, month])
  const entered = platforms ? enteredByStore(platforms) : undefined
  const ga4 = tr('engagement.ga4_badge')
  const shared = { data, coverage, t, fmt }

  return (
    <section aria-labelledby="acquisition-funnel-title" className="space-y-5 border-t border-gray-200 pt-6 dark:border-gray-800" data-testid="acquisition-funnel">
      <div>
        <h2 id="acquisition-funnel-title" className="text-lg font-bold text-gray-900 dark:text-white">
          {t('funnel_section.title')}
        </h2>
        <p className={cn('text-xs', DIM)}>{t('funnel_section.subtitle')}</p>
      </div>

      {query.isError ? (
        <CardError onRetry={() => void query.refetch()} message={t('funnel_failed')} />
      ) : (
        <>
          <BlockIntro title={t('stores.title')} subtitle={t('stores.subtitle')} />
          <div className="grid grid-cols-1 gap-5 lg:grid-cols-2">
            {STORES.map((store) => (
              <StoreCard key={store} store={store} {...shared} entered={entered ? entered[store] : null} month={month} ga4={ga4} />
            ))}
          </div>
          {entered && entered.unassigned > 0 && (
            <p className={cn('-mt-2 text-[11px] leading-4', DIM)} title={t('stores.entered_hint')}>
              {t('stores.entered_unassigned', { count: fmt.int(entered.unassigned) })}
            </p>
          )}

          <BlockIntro title={t('sources.title')} subtitle={t('sources.subtitle')} />
          <div className="grid grid-cols-1 gap-5 lg:grid-cols-2">
            {STORES.map((store) => (
              <OriginCard key={store} store={store} {...shared} month={month} />
            ))}
          </div>

          <BlockIntro title={t('search.title')} subtitle={t('search.subtitle')} />
          <div className="grid grid-cols-1 gap-5 lg:grid-cols-2">
            <TermsCard {...shared} />
            <QueriesCard {...shared} />
          </div>

          <SiteCard {...shared} />
        </>
      )}
    </section>
  )
}

export default AcquisitionFunnel
