'use client'

/**
 * PUSH REPORT — `/dashboard/reports/push` (BR-COMUNICACAO-019 3.m.9, #1051; spec
 * docs/design/spec-cms-relatorio-de-push-2026-10.md).
 *
 * Funnel and base on top, one row per send below, the people of a send under the table. Every
 * number comes from `drive.cms_get_push_report` and `drive.cms_get_push_send_people` through
 * `app/api/dashboard/push` (admin gate + service_role). DS-COMPONENTE-084: a measured zero prints
 * "0" dim, a NULL prints `UNKNOWN_VALUE` with "sem dado", never 0. Broadcast has no per person
 * measure: its received, opened, rate and revenue split print "sem dado", it stays out of the
 * open rate, and its date is not a button. The person is `AppUserLink` (BR-USUARIO-042: nickname,
 * never the e-mail). No export.
 */

import { Suspense, useCallback, useEffect, useMemo, useState } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { useLocale, useTranslations } from 'next-intl'
import { Bell, BellRing, CheckCheck, CircleDollarSign, MailOpen, Percent, Send, Smartphone, UserMinus, XCircle } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Select } from '@/components/ui/select'
import { StatCard, StatCardRow } from '@/components/ui/StatCard'
import { ReportTabs } from '@/components/dashboard/ReportTabs'
import { AppUserLink } from '@/components/dashboard/AppUserLink'
import {
  CELL,
  DIM,
  DenseTableScroller,
  EDGE,
  FilterChip,
  GROUP,
  HEAD,
  HEAD_SOLO,
  NUM,
  SortHead,
  type SortState,
} from '@/components/ui/dense-table'
import { fetchDashboardRoute, type RpcError } from '@/lib/api/dashboard-fetch'
import { CHART_COLORS } from '@/lib/constants/chart-colors'
import { UNKNOWN_VALUE } from '@/lib/format/unknown'
import { calendarDate } from '@/lib/notifications/weekly-push'
import {
  PUSH_PEOPLE_PAGE_SIZE,
  PUSH_REPORT_DEFAULT_PERIOD,
  PUSH_REPORT_PERIODS,
  hasPersonMeasure,
  presetRange,
  pushFunnel,
  pushTypeCounts,
  sourcesSinceDay,
  type PushPeoplePage,
  type PushReport,
  type PushReportPeriod,
  type PushReportSend,
} from '@/lib/notifications/push-report'

const CARD =
  'overflow-hidden rounded-3xl border border-gray-200 bg-white/70 shadow-2xl shadow-black/5 backdrop-blur-xl dark:border-gray-800 dark:bg-gray-900/70'

type Translate = ReturnType<typeof useTranslations>

type SortKey =
  | 'sent'
  | 'delivered'
  | 'opened'
  | 'not_delivered'
  | 'open_rate'
  | 'influenced'
  | 'action'
  | 'revenue_opened'
  | 'revenue_not_opened'
  | 'push_off'
  | 'uninstalled'

/** What a row prints: broadcast loses every per person number (spec 1.4 and 3). */
function measures(send: PushReportSend): Record<SortKey, number | null> {
  const perPerson = hasPersonMeasure(send)
  return {
    sent: send.sent,
    delivered: perPerson ? send.delivered : null,
    opened: perPerson ? send.opened : null,
    not_delivered: send.not_delivered,
    open_rate: perPerson ? send.open_rate : null,
    influenced: send.influenced_opens,
    action: send.action_pushes,
    revenue_opened: perPerson ? send.revenue.opened_revenue_usd : null,
    revenue_not_opened: perPerson ? send.revenue.not_opened_revenue_usd : null,
    push_off: send.base_cost.push_off,
    uninstalled: send.base_cost.uninstalled,
  }
}

function ErrorLine({ error, t }: { error: RpcError; t: Translate }) {
  const forbidden = error.status === 403 || error.code === '42501'
  return (
    <p role="alert" className="px-5 py-4 text-sm text-red-700 dark:text-red-400">
      {forbidden ? t('error_forbidden') : `${t('error_generic')}: ${error.message}`}
    </p>
  )
}

/** A number cell: NULL is "sem dado", zero is dim. */
function Measure({ value, format, noData }: { value: number | null; format: (n: number) => string; noData: string }) {
  if (value == null) {
    return (
      <span className={DIM} title={noData}>
        {UNKNOWN_VALUE}
      </span>
    )
  }
  return <span className={value === 0 ? DIM : undefined}>{format(value)}</span>
}

function TypeLabel({ type, t }: { type: string; t: Translate }) {
  if (t.has(`types.${type}`)) return <>{t(`types.${type}`)}</>
  return (
    <span className="font-mono text-xs" title={t('filters.type_hint')}>
      {type}
    </span>
  )
}

function PushReportPage() {
  const t = useTranslations('Pages.Dashboard.push')
  const tWeekly = useTranslations('Pages.WeeklyPush')
  const tHistory = useTranslations('Pages.Notifications.history')
  const locale = useLocale()
  const router = useRouter()
  const params = useSearchParams()

  const initial = useMemo(() => {
    const from = params.get('from')
    const to = params.get('to')
    if (from && to) return { from, to }
    const period = params.get('period') as PushReportPeriod | null
    return presetRange(period && period in PUSH_REPORT_PERIODS ? period : PUSH_REPORT_DEFAULT_PERIOD)
    // the URL is read once; later changes are written by this screen
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])
  const [range, setRange] = useState(initial)
  const [type, setType] = useState<string | null>(null)
  const [sort, setSort] = useState<SortState<SortKey> | null>(null)

  const [report, setReport] = useState<PushReport | null>(null)
  const [reportError, setReportError] = useState<RpcError | null>(null)
  const [isLoading, setIsLoading] = useState(true)
  const [reload, setReload] = useState(0)

  const [selected, setSelected] = useState<PushReportSend | null>(null)
  const [tab, setTab] = useState<'opened' | 'not_opened'>('opened')
  const [page, setPage] = useState(0)
  const [people, setPeople] = useState<PushPeoplePage | null>(null)
  const [peopleError, setPeopleError] = useState<RpcError | null>(null)
  const [isLoadingPeople, setIsLoadingPeople] = useState(false)

  useEffect(() => {
    let cancelled = false
    fetchDashboardRoute<PushReport>(
      `/api/dashboard/push?from=${encodeURIComponent(range.from)}&to=${encodeURIComponent(range.to)}`
    ).then(({ data, error }) => {
      if (cancelled) return
      setReport(data)
      setReportError(error)
      setIsLoading(false)
    })
    return () => {
      cancelled = true
    }
  }, [range, reload])

  useEffect(() => {
    if (!selected) return
    let cancelled = false
    fetchDashboardRoute<PushPeoplePage>(
      `/api/dashboard/push/people?send_key=${encodeURIComponent(selected.send_key)}&opened=${tab === 'opened'}&page=${page}`
    ).then(({ data, error }) => {
      if (cancelled) return
      setPeople(data)
      setPeopleError(error)
      setIsLoadingPeople(false)
    })
    return () => {
      cancelled = true
    }
  }, [selected, tab, page])

  const changeRange = useCallback(
    (next: { from: string; to: string }, period?: PushReportPeriod) => {
      if (!next.from || !next.to || next.from > next.to) return
      setIsLoading(true)
      setSelected(null)
      setType(null)
      setRange(next)
      const query = period ? `period=${period}` : `from=${next.from}&to=${next.to}`
      router.replace(`?${query}`, { scroll: false })
    },
    [router]
  )

  const allSends = useMemo(() => report?.sends ?? [], [report])
  const chips = useMemo(() => pushTypeCounts(allSends), [allSends])
  const sends = useMemo(() => {
    const filtered = type ? allSends.filter((s) => s.type === type) : allSends
    if (!sort) return filtered
    return [...filtered].sort((a, b) => {
      const x = measures(a)[sort.key]
      const y = measures(b)[sort.key]
      if (x == null) return y == null ? 0 : 1
      if (y == null) return -1
      return (x - y) * sort.dir
    })
  }, [allSends, type, sort])
  const funnel = useMemo(() => pushFunnel(sends), [sends])

  const integer = useMemo(() => new Intl.NumberFormat(locale), [locale])
  const percent = useMemo(() => new Intl.NumberFormat(locale, { style: 'percent', maximumFractionDigits: 1 }), [locale])
  const usd = useMemo(() => new Intl.NumberFormat(locale, { style: 'currency', currency: 'USD' }), [locale])
  const day = useMemo(() => new Intl.DateTimeFormat(locale, { dateStyle: 'short' }), [locale])
  const stamp = useMemo(() => new Intl.DateTimeFormat(locale, { dateStyle: 'short', timeStyle: 'short' }), [locale])
  const n = (v: number) => integer.format(v)
  const noData = t('no_data')
  /** Influenced, push off, uninstalled and not delivered have a source only from this day (contract §13.1). */
  const measuredSince = sourcesSinceDay(report?.windows.sources_since, report?.period.time_zone)

  const toggleSort = (key: SortKey) =>
    setSort((s) => (s?.key !== key ? { key, dir: -1 } : s.dir === -1 ? { key, dir: 1 } : null))

  const presetValue =
    (Object.keys(PUSH_REPORT_PERIODS) as PushReportPeriod[]).find((p) => {
      const r = presetRange(p)
      return r.from === range.from && r.to === range.to
    }) ?? ''

  /** Tile value and subtitle: the subtitle says "sem dado" whenever the value has no source. */
  const tile = (value: number | null, format: (v: number) => string, subtitle?: string) =>
    reportError || value == null
      ? { value: UNKNOWN_VALUE, subtitle: noData }
      : { value: format(value), subtitle }

  const funnelTiles = [
    { key: 'sent', icon: Send, color: CHART_COLORS.blue, label: t('funnel.sent'), hint: t('funnel.sent_hint'), ...tile(funnel.sent, n) },
    { key: 'delivered', icon: CheckCheck, color: CHART_COLORS.green, label: t('funnel.delivered'), hint: t('funnel.delivered_hint'), ...tile(funnel.delivered, n) },
    { key: 'opened', icon: MailOpen, color: CHART_COLORS.purple, label: t('funnel.opened'), hint: t('funnel.opened_hint'), ...tile(funnel.opened, n) },
    { key: 'not_delivered', icon: XCircle, color: CHART_COLORS.red, label: t('funnel.not_delivered'), hint: t('funnel.not_delivered_hint'), ...tile(funnel.not_delivered, n) },
    { key: 'open_rate', icon: Percent, color: CHART_COLORS.purple, label: t('funnel.open_rate'), hint: t('performance.direct_hint'), ...tile(funnel.open_rate, (v) => percent.format(v), t('funnel.open_rate_sub')) },
    { key: 'revenue', icon: CircleDollarSign, color: CHART_COLORS.green, label: t('performance.revenue'), hint: t('performance.revenue_hint'), ...tile(funnel.opened_revenue_usd, (v) => usd.format(v), t('performance.revenue_sub')) },
  ]
  /** A snapshot of today, apart from the period above (BR-COMUNICACAO-019 3.m.1 for push_enabled). */
  const baseTiles = [
    { key: 'push_enabled', icon: BellRing, color: CHART_COLORS.green, label: t('base.push_enabled'), hint: t('base.push_enabled_hint'), ...tile(report?.devices.push_enabled_people ?? null, n, t('base.push_enabled_sub')) },
    { key: 'installed', icon: Smartphone, color: CHART_COLORS.blue, label: t('base.installed'), hint: t('base.installed_hint'), ...tile(report?.devices.active_tokens ?? null, n, t('base.installed_sub')) },
    { key: 'uninstalled', icon: UserMinus, color: CHART_COLORS.orange, label: t('base.uninstalled'), hint: t('base.uninstalled_hint'), ...tile(report?.devices.uninstalls ?? null, n, t('base.uninstalled_sub')) },
  ]

  const numHead = (key: SortKey, label: string, title: string, edge = false) => (
    <SortHead
      key={key}
      column={key}
      label={label}
      title={title}
      sort={sort}
      onToggle={toggleSort}
      className={`${HEAD} text-right ${edge ? EDGE : ''}`}
    />
  )

  const variantsOf = (send: PushReportSend) =>
    (send.variants ?? [])
      .map((v) => v.variant)
      .filter((v): v is string => !!v)
      .map((v) => (tWeekly.has(`texts.variant.${v}`) ? tWeekly(`texts.variant.${v}`) : v))
      .join(', ')

  const pick = (send: PushReportSend) => {
    if (selected?.send_key === send.send_key) return
    setIsLoadingPeople(true)
    setPeople(null)
    setTab('opened')
    setPage(0)
    setSelected(send)
  }

  const COLUMNS = 13

  return (
    <div className="cms-width p-6 space-y-4 min-h-screen bg-gray-50 dark:bg-gray-950">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="flex items-center text-lg font-semibold text-gray-900 dark:text-white">
          <Bell className="mr-2 h-5 w-5 text-tuggi-purple" />
          {t('title')}
        </h1>
        <div className="flex flex-wrap items-center gap-2">
          <Select
            aria-label={t('filters.period')}
            value={presetValue}
            onValueChange={(value) => {
              const p = value as PushReportPeriod
              if (p in PUSH_REPORT_PERIODS) changeRange(presetRange(p), p)
            }}
            className="w-auto"
          >
            {presetValue === '' && <option value="">{t('filters.period')}</option>}
            {(Object.keys(PUSH_REPORT_PERIODS) as PushReportPeriod[]).map((p) => (
              <option key={p} value={p}>
                {t(`filters.period_${p}`)}
              </option>
            ))}
          </Select>
          <label className={`flex items-center gap-1 text-xs ${DIM}`}>
            {t('filters.from')}
            <Input
              type="date"
              value={range.from}
              max={range.to}
              onChange={(e) => changeRange({ from: e.target.value, to: range.to })}
              className="w-auto"
            />
          </label>
          <label className={`flex items-center gap-1 text-xs ${DIM}`}>
            {t('filters.to')}
            <Input
              type="date"
              value={range.to}
              min={range.from}
              onChange={(e) => changeRange({ from: range.from, to: e.target.value })}
              className="w-auto"
            />
          </label>
        </div>
      </div>
      <p className={`text-[11px] ${DIM}`}>{t('caption')}</p>

      <div className="flex flex-wrap gap-2" role="group" aria-label={t('filters.type')}>
        <FilterChip active={type === null} onClick={() => setType(null)} count={report ? allSends.length : undefined}>
          {t('filters.type_all')}
        </FilterChip>
        {chips.map((chip) => (
          <FilterChip key={chip.type} active={type === chip.type} count={chip.sends} onClick={() => setType(chip.type)}>
            <TypeLabel type={chip.type} t={t} />
          </FilterChip>
        ))}
      </div>

      {([[funnelTiles, 6], [baseTiles, 3]] as const).map(([row, columns], i) => (
        <StatCardRow key={i} columns={columns}>
          {row.map((card) => (
            <div key={card.key} title={card.hint}>
              <StatCard
                size="compact"
                icon={card.icon}
                color={card.color}
                label={card.label}
                value={card.value}
                subtitle={card.subtitle}
                isLoading={isLoading}
              />
            </div>
          ))}
        </StatCardRow>
      ))}
      <p className={`text-[11px] ${DIM}`}>
        {t('funnel.delivered_hint')} {t('no_data_hint')}
      </p>

      <section className={CARD} aria-label={t('sends.title')}>
        {reportError ? (
          <div className="flex items-center gap-3">
            <ErrorLine error={reportError} t={t} />
            {reportError.status !== 403 && (
              <Button
                variant="outline"
                size="sm"
                onClick={() => {
                  setIsLoading(true)
                  setReload((r) => r + 1)
                }}
              >
                {t('retry')}
              </Button>
            )}
          </div>
        ) : (
          <>
            {measuredSince && (
              <p className={`mb-2 text-[11px] ${DIM}`}>
                {t('measured_since', { date: day.format(calendarDate(measuredSince)) })}
              </p>
            )}
            <DenseTableScroller>
              <table className="w-max min-w-full border-collapse">
                <thead>
                  <tr>
                    <th className={GROUP} colSpan={2} />
                    <th scope="colgroup" colSpan={4} className={`${GROUP} ${EDGE}`}>{t('funnel.title')}</th>
                    <th scope="colgroup" colSpan={2} className={`${GROUP} ${EDGE}`}>{t('performance.opens_title')}</th>
                    <th scope="colgroup" className={`${GROUP} ${EDGE}`} />
                    <th scope="colgroup" colSpan={2} className={`${GROUP} ${EDGE}`}>
                      {t('performance.revenue')} {t('performance.revenue_sub')}
                    </th>
                    <th scope="colgroup" colSpan={2} className={`${GROUP} ${EDGE}`}>{t('performance.base_cost')}</th>
                  </tr>
                  <tr>
                    <th scope="col" className={HEAD}>{t('sends.date')}</th>
                    <th scope="col" className={HEAD}>{t('sends.type')}</th>
                    {numHead('sent', t('funnel.sent'), t('funnel.sent_hint'), true)}
                    {numHead('delivered', t('funnel.delivered'), t('funnel.delivered_hint'))}
                    {numHead('opened', t('funnel.opened'), t('funnel.opened_hint'))}
                    {numHead('not_delivered', t('funnel.not_delivered'), t('funnel.not_delivered_hint'))}
                    {numHead('open_rate', t('performance.direct'), t('performance.direct_hint'), true)}
                    {numHead('influenced', t('performance.influenced'), t('performance.influenced_hint'))}
                    {numHead('action', t('performance.action'), t('performance.action_hint'), true)}
                    {numHead('revenue_opened', t('performance.revenue_opened'), t('performance.revenue_hint'), true)}
                    {numHead('revenue_not_opened', t('performance.revenue_not_opened'), t('performance.revenue_hint'))}
                    {numHead('push_off', t('performance.base_cost_push_off'), t('performance.base_cost_hint'), true)}
                    {numHead('uninstalled', t('performance.base_cost_uninstalled'), t('performance.base_cost_hint'))}
                  </tr>
                </thead>
                <tbody>
                  {isLoading ? (
                    <tr><td colSpan={COLUMNS} className={`${CELL} ${DIM}`}>{t('loading')}</td></tr>
                  ) : sends.length === 0 ? (
                    <tr><td colSpan={COLUMNS} className={`${CELL} ${DIM}`}>{t('empty_title')}. {t('empty_body')}</td></tr>
                  ) : (
                    sends.map((send) => {
                      const m = measures(send)
                      const isSelected = selected?.send_key === send.send_key
                      const variants = variantsOf(send)
                      const date = day.format(calendarDate(send.day))
                      const cell = (key: SortKey, format: (v: number) => string = n, extra = '') => (
                        <td className={`${NUM} ${extra}`}>
                          <Measure value={m[key]} format={format} noData={noData} />
                        </td>
                      )
                      return (
                        <tr
                          key={send.send_key}
                          className={`border-t border-gray-100 dark:border-gray-800 ${
                            isSelected ? 'bg-tuggi-blue/10' : 'hover:bg-gray-50 dark:hover:bg-gray-800/50'
                          }`}
                        >
                          <td className={`${CELL} whitespace-nowrap`}>
                            {hasPersonMeasure(send) ? (
                              <button
                                type="button"
                                onClick={() => pick(send)}
                                aria-pressed={isSelected}
                                title={t('sends.people')}
                                className="min-h-[24px] text-left font-medium underline-offset-2 hover:underline"
                              >
                                {date}
                              </button>
                            ) : (
                              date
                            )}
                          </td>
                          <td className={CELL}>
                            <TypeLabel type={send.type} t={t} />
                            {variants && <div className={`text-xs ${DIM}`}>{variants}</div>}
                          </td>
                          {cell('sent', n, `font-semibold ${EDGE}`)}
                          {cell('delivered')}
                          {cell('opened')}
                          {cell('not_delivered', n, DIM)}
                          {cell('open_rate', (v) => percent.format(v), EDGE)}
                          {cell('influenced')}
                          {cell('action', n, EDGE)}
                          {cell('revenue_opened', (v) => usd.format(v), EDGE)}
                          {cell('revenue_not_opened', (v) => usd.format(v))}
                          {cell('push_off', n, EDGE)}
                          {cell('uninstalled')}
                        </tr>
                      )
                    })
                  )}
                </tbody>
              </table>
            </DenseTableScroller>
          </>
        )}
      </section>

      {selected && (
        <section className={CARD}>
          <header className="flex flex-wrap items-center justify-between gap-3 border-b border-gray-200 px-5 py-3 dark:border-gray-800">
            <span className="text-sm font-semibold text-gray-900 dark:text-white">
              {t('people.title', { date: day.format(calendarDate(selected.day)) })}{' '}
              <span className={`font-normal ${DIM}`}>
                <TypeLabel type={selected.type} t={t} />
              </span>
            </span>
            <ReportTabs
              tabs={[
                { key: 'opened', label: t('people.opened') },
                { key: 'not_opened', label: t('people.not_opened') },
              ]}
              active={tab}
              onChange={(key) => {
                if (key === tab) return
                setIsLoadingPeople(true)
                setPage(0)
                setTab(key as 'opened' | 'not_opened')
              }}
            />
          </header>
          {peopleError ? (
            <ErrorLine error={peopleError} t={t} />
          ) : (
            <>
              <DenseTableScroller>
                <table className="w-full border-collapse">
                  <thead>
                    <tr>
                      <th scope="col" className={HEAD_SOLO}>{t('people.person')}</th>
                      <th scope="col" className={HEAD_SOLO}>{t('people.delivered_at')}</th>
                      {tab === 'opened' && <th scope="col" className={HEAD_SOLO}>{t('people.read_at')}</th>}
                    </tr>
                  </thead>
                  <tbody>
                    {isLoadingPeople ? (
                      <tr><td colSpan={3} className={`${CELL} ${DIM}`}>{t('loading')}</td></tr>
                    ) : !people || people.people.length === 0 ? (
                      <tr>
                        <td colSpan={3} className={`${CELL} ${DIM}`}>
                          {tab === 'opened' ? t('people.empty_opened') : t('people.empty_not_opened')}
                        </td>
                      </tr>
                    ) : (
                      people.people.map((person) => (
                        <tr key={person.user_id} className="border-t border-gray-100 dark:border-gray-800">
                          <td className={CELL}>
                            <AppUserLink user={person} />
                          </td>
                          <td className={`${CELL} whitespace-nowrap`}>
                            {person.delivered_at ? stamp.format(new Date(person.delivered_at)) : (
                              <span className={DIM} title={noData}>{UNKNOWN_VALUE}</span>
                            )}
                          </td>
                          {tab === 'opened' && (
                            <td className={`${CELL} whitespace-nowrap`}>
                              {person.read_at ? stamp.format(new Date(person.read_at)) : UNKNOWN_VALUE}
                            </td>
                          )}
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </DenseTableScroller>
              <div className="flex items-center justify-between gap-3 border-t border-gray-200 px-5 py-2 dark:border-gray-800">
                <span aria-live="polite" className={`text-xs ${DIM}`}>
                  {tHistory('page', { page: page + 1 })}
                </span>
                <div className="flex gap-2">
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={page === 0 || isLoadingPeople}
                    onClick={() => {
                      setIsLoadingPeople(true)
                      setPage((p) => p - 1)
                    }}
                  >
                    {tHistory('prev')}
                  </Button>
                  {people && people.people.length === PUSH_PEOPLE_PAGE_SIZE &&
                    (page + 1) * PUSH_PEOPLE_PAGE_SIZE < people.total && (
                    <Button
                      variant="outline"
                      size="sm"
                      disabled={isLoadingPeople}
                      onClick={() => {
                        setIsLoadingPeople(true)
                        setPage((p) => p + 1)
                      }}
                    >
                      {tHistory('next')}
                    </Button>
                  )}
                </div>
              </div>
            </>
          )}
        </section>
      )}
    </div>
  )
}

export default function PushReportRoute() {
  return (
    <Suspense>
      <PushReportPage />
    </Suspense>
  )
}
