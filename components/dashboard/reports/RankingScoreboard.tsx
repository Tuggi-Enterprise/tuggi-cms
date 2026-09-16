'use client'

/**
 * ONE ACCOUNT PER ROW — the scoring scoreboard of phase 1 (#741, epic #737).
 *
 * THE LINE CHECKS ITSELF BY EYE: `Pontos = (Disparos + Pts de km) × multiplicador` — the formula
 * of **BR-RANKING-004** since `20260916130000`. That is what makes the two facts that look like
 * defects visible without a word of text — the kilometre column a quarter of the scoreboard next
 * to the triggers column (25,6% measured over the 13 weeks: history leads, the road is
 * acknowledgement), and the streak column never multiplying anything (nobody reached 7 calendar
 * days in any of the 13 weeks). Neither is the screen's error, and the screen exists for the
 * operator to see them.
 *
 * THE MINUTE AXIS IS GONE FROM THE SCORE AND `Cobrado` STAYED. `points_from_minutes` is `0`
 * constant and no cell prints it; `charged_minutes` did not move and keeps its column in the
 * time group, because it is still the calibration instrument of BR-MONETIZACAO-049. **Numbers
 * from before 2026-09-16 are not comparable with numbers after it** — every point changed and so
 * did the order — which is why nothing on this screen puts two periods side by side.
 *
 * THE COMPARISON COLUMNS ARE NOT THE SCOREBOARD. `points_notable_weighted` is deferred by the
 * operator's own decision (#737, decision 2), so its group is grey while the official group
 * carries the ink, and it is never the default ordering — `DS-COMPONENTE-083` item 3. The delta
 * cell prints the REORDERING rather than two numbers to subtract, and its baseline is
 * `rank_official` and never the `#` column: `rank_notable_weighted` is computed over every
 * account, and subtracting it from a position that excludes internal accounts would compare two
 * populations (item 2).
 *
 * THREE TIME QUANTITIES, THREE NAMES, ONE GROUP — `DS-COPY-062` item 1. `Cobrado` is what the
 * meter debited, `Intervalo de sinal no período` is the part of each session's first-to-last
 * signal that fell INSIDE the selected period, and `Diferença` is the distance between them,
 * which IS the measure of the BR-MONETIZACAO-049 divergence and which can be negative. The two
 * parcels only subtract because the view clips the span to the period (contract
 * `banco-para-cms.md`, Parte 7) — before that they were allocated by different rulers and the
 * column measured the calendar boundary. A session left open with sparse signal still inflates
 * the span without consuming any balance — 4.022 minutes against 143 charged in one measured
 * account — so the readings a single column cannot sustain are declared ABOVE the scroller,
 * where they stay while the body scrolls, and repeated in an `sr-only` `<caption>` that a screen
 * reader gets before any cell.
 *
 * `#` IS A VALUE, NEVER THE INDEX OF THE ROW (`DS-COMPONENTE-082` item 3). Sorting by
 * `Diferença` puts somebody else on top and her `#` stays hers; renumbering would create a
 * second ruler of position on the same screen — and the sentence that says so is the fourth
 * line of the visible block, because it answers a click the operator has already made.
 */

import { Fragment, useMemo, useState, type ReactNode } from 'react'
import { useLocale, useTranslations } from 'next-intl'
import {
  AlertTriangle,
  ArrowDownRight,
  ArrowUpRight,
  ChevronDown,
  ChevronRight,
  Copy,
  Scale,
  Users,
} from 'lucide-react'
import {
  CELL,
  DIM,
  DenseTableScroller,
  EDGE,
  FilterChip,
  GROUP,
  HEAD,
  HEAD_NUM,
  NUM,
  SortHead,
  type SortState,
} from '@/components/ui/dense-table'
import { StatCard, StatCardRow } from '@/components/ui/StatCard'
import { cn } from '@/lib/utils'
import type { RpcError } from '@/lib/api/dashboard-fetch'
import { AppUserLink } from '@/components/dashboard/AppUserLink'
import { CountryFlag } from '@/components/ui/CountryFlag'
import { RankSeal } from '@/components/ui/RankSeal'
import { formatDuration, formatSignedDuration } from '@/lib/format/duration'
import { UNKNOWN_VALUE } from '@/lib/format/unknown'
import { appUserLabel } from '@/lib/format/user-identity'
import { ENTITLEMENT_LEDGER_START, kmCoverage, meteringCoverage } from '@/lib/ranking/metering'
import {
  PODIUM_POINTS_FLOOR,
  aggregateRows,
  compareNullable,
  formatKilometres,
  formatPoints,
  formatRatio,
  isComposedCycle,
  matchesPeriod,
  periodOfSelection,
  rankDelta,
  rankSeal,
  summarize,
  visibleRows,
  type PeriodOption,
  type PeriodSelection,
  type RankingRow,
} from '@/lib/ranking/scoreboard'

/** The two the two surviving cards paint with. The other three left with the four cards §11.2
 *  turned into label/value pairs — a pair has no icon and no colour. */
const TUGGI_COLORS = {
  blue: '#00A8E8',
  purple: '#8B5CF6',
}

/** The eight sortable columns of spec §4.3. `#` is not one of them: it is the default order. */
type SortKey =
  | 'points_official'
  | 'trigger_points_fired'
  | 'points_from_km'
  | 'story_days'
  | 'points_notable_weighted'
  | 'charged_minutes'
  | 'trail_span_minutes'
  | 'metering_gap_minutes'

/**
 * The four sortable columns that live behind the `Comparações` switch (§11.2). `points_from_km`
 * is NOT one of them: it is a parcel of `points_official` and stays in the primary group.
 */
const COMPARISON_SORT_KEYS: SortKey[] = [
  'points_notable_weighted',
  'charged_minutes',
  'trail_span_minutes',
  'metering_gap_minutes',
]

type ChipKey = 'all' | 'scored' | 'charged_without_trigger'

export interface RankingScoreboardProps {
  /** Rows of EXACTLY one period — the route filtered them, and nothing here re-filters by period. */
  rows: RankingRow[]
  period: PeriodOption | null
  /** The label of the selected period, as the `<select>` prints it. Used by empty and by banners. */
  periodLabel: string
  /**
   * WHAT THE OPERATOR ASKED FOR — `{ kind, start }`, which exists before any round trip.
   *
   * `period` is the matching option OUT OF THE READING, and it is `null` for a week older than
   * the 13-week horizon the view serves. The selection is not: a week is entirely described by
   * its start, which is what lets the meter and the empty state keep answering when the reading
   * brought back no period to hang them on (#741).
   */
  selection: PeriodSelection
  /**
   * WHAT THE QUERY ANSWERED, with the label it prints — `null` until the read lands.
   *
   * The route falls back on an unusable parameter, so the period served is not always the period
   * asked for, and every number on this screen belongs to the served one. Nothing on the screen
   * used to say which: the only place a period appeared was the `<select>` the operator had just
   * operated, and a control reads as *what I asked for*, never as *what I got*.
   */
  served: { period: PeriodSelection; label: string } | null
  includeInternal: boolean
  /** Accounts carrying the #740 mark. `0` is the state that must warn. */
  internalAccounts: number
  isLoading: boolean
  /**
   * The failure AS IT CAME, code included. It used to be the message alone, and the screen asked
   * `message.includes('42501')` — a question a `PostgrestError` never answers, because the
   * SQLSTATE lives in `code` (#755).
   */
  error: RpcError | null
  onRetry: () => void
  onOpenSessions: (row: RankingRow) => void
}

export function RankingScoreboard({
  rows,
  period,
  periodLabel,
  selection,
  served,
  includeInternal,
  internalAccounts,
  isLoading,
  error,
  onRetry,
  onOpenSessions,
}: RankingScoreboardProps) {
  const t = useTranslations('Pages.Dashboard.ranking')
  const locale = useLocale()

  const [sort, setSort] = useState<SortState<SortKey> | null>(null)
  /**
   * THE TABLE IS BORN FILTERED — §11.2.
   *
   * Eleven of sixteen accounts are zero in every cell, and with `Todas` as the default they were
   * the first eleven lines of the scoreboard: the five rows that ARE the scoreboard started below
   * the fold. Nothing is lost by it — the whole population goes on being printed in the chip
   * beside this one, `Todas 16`, and one click brings it back.
   */
  const [chip, setChip] = useState<ChipKey>('scored')
  /**
   * THE FIVE COMPARISON COLUMNS ARE BORN COLLAPSED — §11.2, `DS-COMPONENTE-083` item 3.
   *
   * They exist to CHECK a number, not to be read every day: `Pts peso 2` is deferred by the
   * operator's own decision (#737, decision 2) and the three time columns qualify an axis that
   * stopped scoring in #749. Twelve columns never fitted 1280 px; seven do.
   */
  const [showComparisons, setShowComparisons] = useState(false)
  const [expanded, setExpanded] = useState<string | null>(null)

  /**
   * DID THE READ HAPPEN? Everything on this screen that quantifies the read hangs on this one
   * answer, and nothing else can answer it: `rows` arrives EMPTY in BOTH cases — the page hands
   * down `payload?.rows ?? []`, so a failure and a period where nobody scored produce the same
   * array. The failure survives only in `error`, which is why the distinction is made here, once,
   * and named — not rediscovered as `rows.length === 0` further down, where it is already lost.
   *
   * Zero is a measurement; a read that failed made none. This is `DS-COMPONENTE-084` item 1 read
   * at the level of the whole screen instead of one column: the six indicators printing `0` over
   * a red band that says the scoreboard could not be loaded is the screen asserting *nobody
   * scored* when the truth is *I do not know* — spec §7.3, and the field defect of #741.
   */
  const didRead = error === null

  /** The streak belongs to the weekly cycle; in a rolling window it is `1.0` by construction. */
  const isWeek = period?.kind === 'week'

  /**
   * A COMPOSED CYCLE IS A DIFFERENT QUANTITY UNDER THE SAME COLUMN NAME — **BR-RANKING-005**,
   * spec §4.8, `DS-COMPONENTE-089` item 3.
   *
   * In `month` and `year`, `Pontos` is the SUM of the points of the weeks (or months) the account
   * finished on the podium of — not the formula of **BR-RANKING-004** over the period. So the
   * columns that make up the level below LEAVE THE TABLE there: `Disparos` summed over the whole
   * month next to `Pontos` drawn only from the podium weeks are two populations on one line, and
   * the fraction and the subtraction the operator would do in his head would both be wrong.
   */
  const isComposed = period !== null && isComposedCycle(period.kind)

  /**
   * NO PERIOD IS NOT "THE METER WAS THERE". `coverage` used to fall back on `'full'` whenever the
   * reading had no option to match the selection — which is exactly the case of a week older than
   * the 13-week horizon, the case of a pasted link months old. The screen then printed minutes
   * for a window it could not place in time.
   *
   * The selection describes the anchored window on its own (`periodOfSelection`), so the
   * instruments have an answer without the round trip. For a rolling window there is nothing to
   * derive — its boundary is "now minus N days" and only the view knows it — and re-deriving it
   * here would be a second owner of a window the view defines (CLAUDE.md §6); that case only
   * exists while the read is in flight, where the table is a skeleton anyway.
   */
  const meteredPeriod = period ?? periodOfSelection(selection)
  const coverage = meteredPeriod
    ? meteringCoverage(meteredPeriod.start, meteredPeriod.end)
    : 'full'
  const hasMeter = coverage !== 'none'

  /**
   * THE SECOND BOUNDARY, AND IT IS OLDER THAN THE FIRST — spec §7.7, `DS-COMPONENTE-084` item 1.
   *
   * The kilometre hangs on the balance-grant ledger (13/08), the minute on the consumption ledger
   * (18/08). **A period between the two has the kilometre `full` and the minute `none` at the same
   * time**, so reusing `coverage` above for anything made of kilometres is the defect of
   * 2026-09-13 with another name — and it passes every test that does not look at the date.
   *
   * The two states of absence do not print alike either: `none` here is INCOMPLETENESS, not
   * absence — the entitlement of the past is still readable from `subscription_end_date` for
   * 12,8% of the profiles — so the values print, MARKED AS A FLOOR, and it is the band that
   * declares it for the whole reading. Only the RATIO is withheld, because a fraction over partial
   * coverage is a number with no referent (item 2).
   */
  const kmCov = meteredPeriod ? kmCoverage(meteredPeriod.start, meteredPeriod.end) : 'full'

  /**
   * The query answered a period other than the one asked for — the route falls back on an
   * unusable parameter, and the fallback is silent by design (`parsePeriodParam`).
   */
  const servedDiffers =
    served !== null && !matchesPeriod(served.period.kind, served.period.start ?? '', selection)

  const shown = useMemo(() => visibleRows(rows, includeInternal), [rows, includeInternal])

  /**
   * The indicators do NOT follow the switch — contract, Parte 7: every average, ratio and
   * concentration diagnosis is computed over the accounts that are not marked. With the switch
   * off this is the same population the table shows; with it on, the rows come back and the
   * indicators stay honest, which is why the band says so in one line.
   */
  const summary = useMemo(() => summarize(aggregateRows(rows)), [rows])

  /**
   * A HIDDEN CHIP THAT KEEPS FILTERING IS A TABLE NOBODY CAN UNFILTER. `Cobrado sem disparo` is a
   * diagnosis of the minute and does not appear in a composed cycle (spec §4.8); switching to
   * `month` with it active used to leave an empty table whose only way out was a control that was
   * no longer on screen.
   */
  const activeChip: ChipKey =
    isComposed && chip === 'charged_without_trigger' ? 'all' : chip

  /**
   * COLLAPSING THE COMPARISONS DROPS AN ORDERING THAT CAME FROM THEM. A table ordered by a column
   * nobody can see is the `#` column lying by omission — and `caption.sorting`, which renders
   * exactly while an ordering is active, would be answering a click about a column that is gone.
   */
  function toggleComparisons(open: boolean) {
    setShowComparisons(open)
    if (!open && sort !== null && COMPARISON_SORT_KEYS.includes(sort.key)) setSort(null)
  }

  const counts = useMemo(
    () => ({
      all: shown.length,
      scored: shown.filter((row) => row.points_official > 0).length,
      charged_without_trigger: shown.filter(
        (row) => row.charged_minutes > 0 && row.trigger_points_fired === 0
      ).length,
    }),
    [shown]
  )

  const rankOf = (row: RankingRow) =>
    includeInternal ? row.rank_official : row.rank_excluding_internal

  const tableRows = useMemo(() => {
    const kept = shown.filter((row) => {
      if (activeChip === 'scored') return row.points_official > 0
      if (activeChip === 'charged_without_trigger')
        return row.charged_minutes > 0 && row.trigger_points_fired === 0
      return true
    })

    if (!sort) {
      // The default is the `#` column ascending, with the null positions last: `null` is "does
      // not rank", not "ranks worst", and the operator asked for the top when he arrived.
      return [...kept].sort((a, b) => compareNullable(rankOf(a), rankOf(b), 1))
    }

    return [...kept].sort((a, b) => compareNullable(a[sort.key], b[sort.key], sort.dir))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [shown, activeChip, sort, includeInternal])

  const totals = useMemo(() => summarize(tableRows), [tableRows])

  /**
   * THE FOOTER SUMS THE VISIBLE ROWS, AND SAYS HOW MANY OF HOW MANY — §11.2.
   *
   * With the table born on `Pontuaram`, a footer claiming `5 linhas` would assert a total that is
   * not the read's: it is 5 of 16, and the difference is exactly what the chip hid. With no filter
   * the two counts coincide and the sentence goes back to the one it always was.
   */
  const footerLabel =
    activeChip === 'all'
      ? t('table.totals', { count: totals.rowCount })
      : t('table.totals_filtered', { count: totals.rowCount, total: counts.all })

  function toggle(key: SortKey) {
    setSort((current) =>
      current?.key === key ? { key, dir: current.dir === 1 ? -1 : 1 } : { key, dir: -1 }
    )
  }

  const head = (column: SortKey, label: string, className: string) => (
    <SortHead
      column={column}
      label={label}
      className={className}
      sort={sort}
      onToggle={toggle}
      title={t('table.sort_by', { column: label })}
    />
  )

  /** A minute quantity in a period with no meter is UNKNOWN, never `0` — `DS-COMPONENTE-084`. */
  const minutes = (value: number) => (hasMeter ? formatDuration(value) : UNKNOWN_VALUE)
  const points = (value: number | null | undefined) => formatPoints(value, locale)

  /**
   * The same absence the no-meter period already prints, for the same reason and with the same
   * character: a quantity the read did not produce is `—`. One treatment, not two.
   */
  const measured = (value: string | number) => (didRead ? value : UNKNOWN_VALUE)

  /**
   * A `subtitle` explains a number, so with no number it has nothing to explain — and every one
   * of them here is itself a reading (`0 pts · 0 pts`, the platform split). The em dash goes
   * alone: no phrase exists yet for *why* it is a dash on failure, and inventing one is the
   * `design`'s call, not this component's.
   */
  const note = (text: string) => (didRead ? text : undefined)

  /**
   * `#`, `Pessoa`, `País explorado`, and the nine or ten value columns. `Plataforma` is NOT among
   * them: it spent ~110px on the width of its own header — the data is `android`/`ios` — and at
   * 1152px it was pushing `Diferença`, and with it the whole `Comparação · tempo` group, off the
   * screen (#741). The fact keeps two homes on this screen: the `Contas que pontuaram` card and
   * the expanded row.
   *
   * The country column took part of that slot and not all of it: its header wraps in two lines,
   * so the width it imposes is `explorado` / `Explored`, and its cell is a single glyph
   * (spec §4.7, critério 24 — the natural width stays under 1131px in the three languages).
   */
  const columnCount = isComposed
    ? 4 + (includeInternal ? 1 : 0)
    : 6 + (isWeek ? 1 : 0) + (includeInternal ? 1 : 0) + (showComparisons ? 5 : 0)

  /**
   * THE HEADER OF THE COMPOSITION COLUMN IS A DIFFERENT UNIT IN EACH CYCLE — contract, Parte 7:
   * in `month` the counter counts WEEKS of podium, in `year` it counts MONTHS. Summing the
   * monthly counters would give the year's podium weeks, which is another quantity with the same
   * name, so the two headers are two keys and never one with a parameter.
   */
  const podiumColumnLabel =
    period?.kind === 'year' ? t('table.podium_months') : t('table.podium_weeks')

  /** `13/08/2026` — the km boundary as the two bands print it, from the constant and never typed. */
  const entitlementLedgerDate = new Intl.DateTimeFormat(locale, {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    timeZone: 'UTC',
  }).format(new Date(ENTITLEMENT_LEDGER_START))

  /**
   * WITH ONE GROUP LEFT, THE BAND OF GROUPS DOES NOT RENDER — §11.2, and that is 28 px and one
   * sticky layer less. `PLACAR OFICIAL` written over the only thing on the screen is a tautology,
   * and the geometry that broke in `es` (§7.5, #752) leaves the default state with it.
   *
   * `HEAD` sticks at `top-7` because `GROUP` is `h-7` — two numbers that are only right together
   * (`DS-COMPONENTE-081`), and `dense-table.tsx` is not touched here because the financial table
   * owns it too. With no band above it the offset has to be `top-0`, and `cn` is what makes that
   * a real override: two `top-*` utilities in one class list are resolved by Tailwind's own file
   * order, not by which one was written last, so `top-7` would win a plain concatenation.
   */
  const headClass = showComparisons ? HEAD : cn(HEAD, 'top-0')
  const headNumClass = showComparisons ? HEAD_NUM : cn(HEAD_NUM, 'top-0')

  /**
   * AT MOST ONE WARNING, AND IT IS THE FIRST ONE THAT HOLDS — §11.2. The order is the damage's:
   *
   * 1. the failed read wipes out the whole screen; 2. the km instrument changes how `Pontos` is
   * read, because the kilometre is a parcel of `points_official` (**BR-RANKING-004**); 3. the
   * internal filter changes WHO is on the list; 4. the minute meter qualifies three columns that
   * now start collapsed.
   *
   * `internal.none_marked` goes on NOT saying "nobody is marked" — only that no marked account
   * appeared in THIS read (§2.2, criterion 20). And it goes on needing a read to be a condition
   * of: `internalAccounts` also arrives `0` when the request failed, and a `0` from a read that
   * never happened is not a finding.
   */
  const diagnostic: { kind: 'error' | 'warning'; text: string } | null = error
    ? { kind: 'error', text: error.code === '42501' ? t('error.forbidden') : t('error.title') }
    : kmCov !== 'full'
      ? {
          kind: 'warning',
          text: t(kmCov === 'none' ? 'meter.km_floor' : 'meter.km_partial', {
            date: entitlementLedgerDate,
          }),
        }
      : didRead && !includeInternal && internalAccounts === 0
        ? { kind: 'warning', text: t('internal.none_marked') }
        : coverage !== 'full'
          ? { kind: 'warning', text: coverage === 'none' ? t('meter.none') : t('meter.partial') }
          : null

  return (
    <div className="space-y-4">
      {/* THE QUERY ANSWERED SOMETHING ELSE, AND IT IS A CONDITION OF EVERY NUMBER BELOW — so it
          comes before all of them, and not next to the one it happens to contradict. It is not in
          the priority of §11.2 because it does not qualify the TABLE: it says the whole page is
          about another period, and it costs nothing in the default reading, where the query
          answers what the control asked. */}
      {didRead && servedDiffers && !isLoading && served && (
        <p className="flex items-start gap-2 rounded-xl border border-amber-200 bg-amber-50 px-4 py-2 text-xs text-amber-700 dark:border-amber-900/50 dark:bg-amber-900/20 dark:text-amber-300">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
          {t('period.served_differs', { pedido: periodLabel, servido: served.label })}
        </p>
      )}

      <div className="space-y-1.5">
        {/* THE RULER OF THE NUMBERS BELOW, AND IT LIVES GLUED TO THEM — `DS-COPY-062` item 3,
            spec §9 critério 20. With the switch OFF it does not exist: the two populations
            coincide and the line would be noise in every normal reading of the screen. */}
        {didRead && includeInternal && (
          <p className="text-[11px] text-gray-500 dark:text-gray-400">
            {t('internal.aggregates_note')}
          </p>
        )}
        {/* TWO CARDS, AND THE OTHER FOUR BECOME PAIRS — §11.2.
            Six `StatCard`s spent 150 px saying four things that fit in four 13 px lines, three of
            them marking zero. The two the operator reads first keep their card: `Contas que
            pontuaram`, which is the number he checks against, and `Disparo ÷ km`, which is the
            metric of the epic. In a composed cycle only the first survives — the other five divide
            rulers §4.8 does not let anyone add up. */}
        <StatCardRow columns={isComposed ? 2 : 4}>
          <StatCard
            icon={Users}
            size="compact"
            isLoading={isLoading}
            color={TUGGI_COLORS.blue}
            label={t('kpi.accounts_scored')}
            value={measured(summary.accountsScored)}
            /* THE SPLIT IS A SUM, SO IT HAS TO CLOSE — `33 android · 31 ios` under a card saying
               `82` reads as 18 accounts lost somewhere. They are the accounts that entered the
               period only by charge, which carry no platform (contract, Parte 7). It is omitted
               at zero, where the two terms already add up and the word would be noise. */
            subtitle={note(
              [
                ...summary.byPlatform.map((entry) => `${entry.accounts} ${entry.platform}`),
                ...(summary.platformUnknown > 0
                  ? [t('kpi.platform_unknown', { count: summary.platformUnknown })]
                  : []),
              ].join(' · ')
            )}
          />
          {!isComposed && (
            <StatCard
              icon={Scale}
              size="compact"
              isLoading={isLoading}
              color={TUGGI_COLORS.purple}
              label={t('kpi.ratio')}
              /* THE TWO PARCELS OF THE SCORE, AND THE METER IS NEITHER OF THEM. The minute axis no
                 longer scores (**BR-RANKING-004** item 2), so the meter stopped being a condition
                 of this number: both sides are the two parcels the view adds up into
                 `points_official`, and it computes them for every period it serves.

                 A zero denominator stays UNKNOWN (`DS-COMPONENTE-084` item 2): a period where
                 nobody drove with entitlement divides by nothing, and `∞` is not a reading. */
              value={measured(
                kmCov === 'full' ? formatRatio(summary.triggerToKmRatio, locale) : UNKNOWN_VALUE
              )}
              /* THE TWO TOTALS ALWAYS PRINT; THE FRACTION DOES NOT — `DS-COMPONENTE-084` item 2
                 forbids the fraction, never the totals. Under partial or floor coverage the km
                 side carries the floor word — `calibration.floor`, whose only consumer this became
                 when the panel of §3.2 left the screen (§11.1). */
              subtitle={note(
                t('kpi.ratio_subtitle', {
                  triggers: points(summary.pointsFromTriggers),
                  km:
                    kmCov === 'full'
                      ? points(summary.pointsFromKm)
                      : `${points(summary.pointsFromKm)} (${t('calibration.floor')})`,
                })
              )}
            />
          )}
          {/* THE FLAT BLOCK — four quantities, no icon, no `subtitle`: the label already says what
              the quantity counts (`DS-COPY-062` item 3). **Zero stays, and it stays in `DIM`** —
              zero is the answer, and omitting it confuses *it is zero* with *I did not measure*
              (`DS-COMPONENTE-084` item 1). The exception is the streak, which carries its maximum
              inside the value: `0 (máx. 4/7)` is what stops the zero reading as a broken
              instrument. */}
          {!isComposed && (
            <div className="col-span-2 h-full rounded-xl border border-gray-200 bg-white p-3 dark:border-gray-800 dark:bg-gray-900">
              <dl className="grid grid-cols-2 gap-x-6 gap-y-1.5">
                {isWeek && (
                  <Term
                    label={t('kpi.streak')}
                    value={measured(
                      t('kpi.streak_value', {
                        count: summary.streakAccounts,
                        days: summary.maxStoryDays,
                      })
                    )}
                    isZero={summary.streakAccounts === 0}
                  />
                )}
                <Term
                  label={t('kpi.charged_without_trigger')}
                  value={measured(
                    hasMeter
                      ? t('kpi.accounts', { count: summary.chargedWithoutTrigger })
                      : UNKNOWN_VALUE
                  )}
                  isZero={hasMeter && summary.chargedWithoutTrigger === 0}
                />
                {/* The caveat is PART OF THE LABEL and comes from the same key the expanded row
                    reads — `DS-COPY-062` items 3 and 4. */}
                <Term
                  label={t('kpi.manual_listens')}
                  value={measured(summary.manualListens)}
                  isZero={summary.manualListens === 0}
                />
                {/* No percentage here, ever: `trigger_points_fired` is deduplicated by (session,
                    POI) and this count is not, so the two do not form a fraction
                    (`DS-COMPONENTE-084` item 2). */}
                <Term
                  label={t('kpi.indeterminate')}
                  value={measured(summary.visitsIndeterminate)}
                  isZero={summary.visitsIndeterminate === 0}
                />
              </dl>
            </div>
          )}
        </StatCardRow>
      </div>

      <section className="overflow-hidden rounded-3xl border border-gray-200 bg-white/70 shadow-2xl shadow-black/5 backdrop-blur-xl dark:border-gray-800 dark:bg-gray-900/70">
        {/* ONE WARNING AT A TIME, ALWAYS ONE LINE, AND INSIDE THE TABLE'S OWN CARD — §11.2.
            Four 58 px bands stacked above the numbers were up to 232 px spent qualifying a table
            nobody reached. The order is the order of the DAMAGE, not of the code: the error wipes
            out the whole reading, the kilometre changes how `Pontos` is read, the internal filter
            changes WHO is on the list, and the minute qualifies three columns that now start
            collapsed. The suppressed one does not leave the product — the km floor goes on marked
            in card 2's `subtitle`, and the minute meter goes on printing `—` in its own cells. */}
        {diagnostic && (
          <div
            data-testid="ranking-diagnostic"
            className={`flex items-center gap-2 border-b px-5 py-2 text-xs ${
              diagnostic.kind === 'error'
                ? 'border-red-200 bg-red-50 text-red-700 dark:border-red-900/50 dark:bg-red-900/20 dark:text-red-300'
                : 'border-amber-200 bg-amber-50 text-amber-700 dark:border-amber-900/50 dark:bg-amber-900/20 dark:text-amber-300'
            }`}
          >
            <AlertTriangle className="h-4 w-4 shrink-0" aria-hidden="true" />
            {/* `truncate` is what makes "one line" structural rather than the discipline of
                whoever writes the sentence: `meter.km_floor` measures ~1.500 px at 12 px and would
                wrap in two at 1280. The whole text stays in the DOM — a screen reader gets it
                entire — and in the `title`. */}
            <span className="truncate" title={diagnostic.text}>
              {diagnostic.text}
            </span>
            {diagnostic.kind === 'error' && (
              <button
                type="button"
                onClick={onRetry}
                className="ml-1 min-h-[24px] shrink-0 rounded-lg border border-red-300 px-2 py-0.5 font-semibold hover:bg-red-100 dark:border-red-800 dark:hover:bg-red-900/40"
              >
                {t('error.retry')}
              </button>
            )}
          </div>
        )}

        {/* A CHIP WITH A NUMBER IS AN ASSERTION, and the number is a count of the read. With no
            read the chips stay — they are the filter, and the filter is the operator's, not the
            server's — but they count nothing. `Todas: 0` under a red band is the same lie the
            indicators were telling. */}
        <header className="flex flex-wrap items-center gap-2 border-b border-gray-200 px-5 py-4 dark:border-gray-800">
          <FilterChip
            active={activeChip === 'all'}
            onClick={() => setChip('all')}
            count={didRead && !isLoading ? counts.all : undefined}
          >
            {t('filters.all')}
          </FilterChip>
          <FilterChip
            active={activeChip === 'scored'}
            onClick={() => setChip('scored')}
            count={didRead && !isLoading ? counts.scored : undefined}
          >
            {t('filters.scored')}
          </FilterChip>
          {/* `Todas` and `Pontuaram` in all five periods; the third one is a diagnosis of the
              minute axis and has no column to stand next to in a composed cycle (spec §4.8). */}
          {!isComposed && (
            <FilterChip
              active={activeChip === 'charged_without_trigger'}
              onClick={() => setChip('charged_without_trigger')}
              count={didRead && !isLoading ? counts.charged_without_trigger : undefined}
            >
              {t('filters.charged_without_trigger')}
            </FilterChip>
          )}
          {/* THE SWITCH OF THE FIVE COMPARISON COLUMNS — §11.2. It has the shape of `Incluir
              contas internas` and not of a chip, because it filters no row: it changes HOW MANY
              COLUMNS the table has. It does not exist in a composed cycle, where the comparison
              columns render in no state at all (§4.8). */}
          {!isComposed && (
            <label className="ml-auto flex items-center gap-2 text-[11px] font-medium text-gray-600 dark:text-gray-400">
              <input
                type="checkbox"
                data-testid="ranking-comparisons"
                checked={showComparisons}
                onChange={(event) => toggleComparisons(event.target.checked)}
                className="h-4 w-4 rounded border-gray-300 text-tuggi-blue focus:ring-tuggi-blue dark:border-gray-700"
              />
              {t('filters.comparisons')}
            </label>
          )}
        </header>

        {/* NO DECLARATION COMES BACK AS A FIXED LINE; ONE COMES BACK CONDITIONAL — §11.1.
            The block of six grey paragraphs measured 152 px and denied readings the column label
            already denies. This sentence is the exception because it defines no column: it answers
            a click the operator has JUST made — `#` is a value and sorting does not renumber it
            (`DS-COMPONENTE-082` item 3) — and the question only exists after the click. With the
            ordering on `#`, it costs zero pixels.

            All six stay whole in the `<caption className="sr-only">` below: it costs no pixel at
            all and it is what a screen reader gets before the first cell. */}
        {sort !== null && (
          <p className="border-b border-gray-200 px-5 py-1.5 text-[11px] leading-snug text-gray-600 dark:border-gray-800 dark:text-gray-400">
            {t('caption.sorting')}
          </p>
        )}

        <DenseTableScroller>
          {/* THE WIDTH FLOOR APPLIES ONLY WITH THE COMPARISONS OPEN — §11.2. It is a floor for a
              narrow window, not the natural width; with seven columns the table fits 1280 px with
              no sideways scroll, and imposing a minimum there would create the very scroll §11
              takes away. */}
          <table
            className={`w-full border-collapse ${showComparisons ? 'min-w-[1040px]' : ''}`}
          >
            {/* Same five declarations, same order, for whoever does not see the block above —
                a `<caption>` is what a screen reader announces before the first cell. */}
            <caption className="sr-only">
              {isComposed ? (
                t.rich(period?.kind === 'year' ? 'caption.cycle_year' : 'caption.cycle_month', {
                  b: (chunks) => <strong>{chunks}</strong>,
                  floor: PODIUM_POINTS_FLOOR,
                })
              ) : (
                <>
                  {t.rich('caption.span_in_period', { b: (chunks) => <strong>{chunks}</strong> })}{' '}
                  {t.rich('caption.platform', { b: (chunks) => <strong>{chunks}</strong> })}{' '}
                  {t.rich('caption.country', { b: (chunks) => <strong>{chunks}</strong> })}{' '}
                  {t.rich('caption.km', { b: (chunks) => <strong>{chunks}</strong> })}{' '}
                  {t.rich('caption.notable', { b: (chunks) => <strong>{chunks}</strong> })}{' '}
                </>
              )}{' '}
              {t('caption.sorting')}
            </caption>
            <thead>
              {isComposed ? (
                <>
                  {/* THE BAND STAYS EVEN WITH NO GROUP TO NAME, and that is geometry, not decor:
                      `HEAD` sticks at `top-7` precisely because `GROUP` is `h-7`
                      (`DS-COMPONENTE-081`). Dropping the band would leave the column names glued
                      28px below a top that no longer exists. There is no group LABEL because in a
                      composed cycle there are no groups — four columns, one population. */}
                  <tr>
                    <th
                      className={`${GROUP} text-gray-500 dark:text-gray-400`}
                      colSpan={columnCount}
                    />
                  </tr>
                  <tr>
                    <th scope="col" className={`${HEAD} text-right`}>
                      {t('table.rank')}
                    </th>
                    {includeInternal && (
                      <th scope="col" className={`${HEAD} text-right`}>
                        {t('table.rank_excluding_internal')}
                      </th>
                    )}
                    <th scope="col" className={HEAD}>
                      {t('table.person')}
                    </th>
                    {head('points_official', t('table.points'), `${HEAD_NUM} ${EDGE}`)}
                    {/* NOT SORTABLE: the composition is the provenance of the number beside it,
                        and ordering thirteen rows by it answers no question §4.8 asks. */}
                    <th scope="col" className={HEAD_NUM}>
                      {podiumColumnLabel}
                    </th>
                  </tr>
                </>
              ) : (
                <>
              {/* WITH ONE GROUP LEFT, THE BAND DOES NOT RENDER — §11.2. It exists to NAME groups,
                  and with the comparisons collapsed there is one: `PLACAR OFICIAL` over the only
                  thing on the screen is a tautology. That is 28 px and one sticky layer less, and
                  the geometry that breaks in `es` (§7.5, #752) leaves the default state. The
                  offset of `HEAD` follows, through `headClass`. */}
              {showComparisons && (
              <tr>
                {/* The block with no group: `#`, optionally `sem internas`, `Pessoa` and
                    `País explorado` — identity, never score. */}
                <th
                  className={`${GROUP} text-gray-500 dark:text-gray-400`}
                  colSpan={includeInternal ? 4 : 3}
                />
                <th
                  className={`${GROUP} ${EDGE} text-primary-800 dark:text-tuggi-blue`}
                  colSpan={isWeek ? 4 : 3}
                  scope="colgroup"
                >
                  {t('group.official')}
                </th>
                {/* Grey, and the label starts with the word `Comparação`: emphasis belongs to the
                    result, and colour on a comparison is the shortest path to somebody reading
                    the weight-2 column as the score (`DS-COMPONENTE-083` item 3). */}
                <th
                  className={`${GROUP} ${EDGE} text-gray-500 dark:text-gray-400`}
                  colSpan={2}
                  scope="colgroup"
                >
                  {t('group.notable')}
                </th>
                <th
                  className={`${GROUP} ${EDGE} text-gray-500 dark:text-gray-400`}
                  colSpan={3}
                  scope="colgroup"
                >
                  {t('group.time')}
                </th>
              </tr>
              )}
              <tr>
                <th scope="col" className={`${headClass} text-right`}>
                  {t('table.rank')}
                </th>
                {includeInternal && (
                  <th scope="col" className={`${headClass} text-right`}>
                    {t('table.rank_excluding_internal')}
                  </th>
                )}
                <th scope="col" className={headClass}>
                  {t('table.person')}
                </th>
                {/* NOT SORTABLE, and the omission is the same one `Plataforma` had: categorical
                    over 13 rows, and §4.3 does not list it. The header is allowed to wrap — that
                    is what keeps the width at `explorado` and not at `País explorado`. */}
                <th scope="col" className={headClass}>
                  {t('table.country')}
                </th>
                {head('points_official', t('table.points'), `${headNumClass} ${EDGE}`)}
                {head('trigger_points_fired', t('table.triggers'), headNumClass)}
                {head('points_from_km', t('table.points_from_km'), headNumClass)}
                {isWeek && head('story_days', t('table.streak'), headNumClass)}
                {showComparisons && (
                  <>
                    {head(
                      'points_notable_weighted',
                      t('table.notable_points'),
                      `${headNumClass} ${EDGE}`
                    )}
                    <th scope="col" className={headNumClass}>
                      {t('table.rank_delta')}
                    </th>
                    {head('charged_minutes', t('table.charged'), `${headNumClass} ${EDGE}`)}
                    {head(
                      'trail_span_minutes',
                      t('table.trail_span_in_period'),
                      headNumClass
                    )}
                    {head('metering_gap_minutes', t('table.gap'), headNumClass)}
                  </>
                )}
              </tr>
                </>
              )}
            </thead>

            <tbody>
              {isLoading && <SkeletonRows columns={columnCount} />}

              {!isLoading && tableRows.length === 0 && (
                <tr>
                  <td
                    colSpan={columnCount}
                    className="px-5 py-8 text-center text-sm text-gray-600 dark:text-gray-400"
                  >
                    {/* A WEEK OUTSIDE THE HORIZON IS NOT AN EMPTY WEEK. The view serves the 13
                        most recent weeks and rolls every Monday, and the URL of this screen is
                        made to be pasted — a link saved months ago lands exactly here. Answering
                        `Ninguém pontuou em Semana de X a Y` asserts a measurement over a period
                        the query never looked at, and sends the operator to read a scoring
                        design that was never served to him (#741). */}
                    {/* THE CHIP ONLY GETS THE BLAME WHEN IT TOOK SOMETHING — §11.2 made
                        `Pontuaram` the default, and with it `activeChip !== 'all'` stopped meaning
                        "the operator filtered". A period the query answered with no row at all
                        would have read as *nobody matched your filter*, which is a measurement
                        over a filter that removed nothing, on top of the week-outside-the-horizon
                        answer this block exists for. `shown.length` is what tells the two apart. */}
                    {activeChip !== 'all' && shown.length > 0
                      ? t('empty.filtered', { period: periodLabel })
                      : didRead && period === null && selection.kind === 'week'
                        ? t('empty.out_of_horizon')
                        : t('empty.period', { period: periodLabel })}
                    {activeChip !== 'all' && shown.length > 0 && (
                      <button
                        type="button"
                        onClick={() => setChip('all')}
                        className="ml-2 min-h-[24px] underline underline-offset-2 hover:text-gray-900 dark:hover:text-white"
                      >
                        {t('empty.clear')}
                      </button>
                    )}
                  </td>
                </tr>
              )}

              {!isLoading &&
                tableRows.map((row) => {
                  const isOpen = expanded === row.user_id
                  const person = appUserLabel(row)
                  /**
                   * THE SEAL REPLACES THE DIGIT ON THE PODIUM, and only there — spec §4.3.
                   *
                   * The ruler is the one the `#` column already uses (`rankOf`), so the seal
                   * follows the internal-account switch instead of inventing a second position;
                   * and it TRAVELS WITH THE ROW — sorting by another column carries the podium
                   * into the middle of the table, because `#` is a value and never the index of
                   * the rendered line (`DS-COMPONENTE-082` item 3).
                   */
                  const rank = rankOf(row)
                  const seal = rankSeal(rank, row, meteredPeriod)

                  /**
                   * FOUR COLUMNS, NO SEAL, NO CHEVRON — spec §4.8.
                   *
                   * No seal because a seal asserts a PODIUM, a podium has a floor, and the only
                   * floor written down is the weekly one (**BR-RANKING-003**, which names itself
                   * so). `RankSeal` already draws the three cycles and `sealCycle` still answers
                   * only `week`: the gate has one owner (`DS-COMPONENTE-088`), and a component
                   * knowing how to draw a crown is not authorisation to draw it
                   * (`DS-COMPONENTE-089` item 4). **The `#` keeps printing the ordinal**, because
                   * the ordinal is the view's datum and not our arithmetic.
                   *
                   * No chevron because the expanded row is made of the quantities the composed
                   * cycle does not declare — platform, country, sessions, kilometres. An opener
                   * onto columns that have no meaning here would put back, one click away,
                   * exactly the two populations §4.8 takes out of the line.
                   */
                  if (isComposed) {
                    return (
                      <tr
                        key={row.user_id}
                        className="border-t border-gray-100 hover:bg-gray-50/70 dark:border-gray-800 dark:hover:bg-gray-800/40"
                      >
                        <td className={NUM}>{rank ?? UNKNOWN_VALUE}</td>
                        {includeInternal && (
                          <td className={`${NUM} ${DIM}`}>
                            {row.rank_excluding_internal ?? UNKNOWN_VALUE}
                          </td>
                        )}
                        <th
                          scope="row"
                          className={`${CELL} min-w-[11rem] max-w-[16rem] truncate text-left font-medium text-gray-900 dark:text-white`}
                          title={person}
                        >
                          <AppUserLink user={row} />
                          {row.excluded_from_metrics && (
                            <span className="ml-2 rounded border border-gray-300 px-1 text-[10px] font-bold uppercase tracking-widest text-gray-500 dark:border-gray-700 dark:text-gray-400">
                              {t('internal.badge')}
                            </span>
                          )}
                        </th>
                        <td
                          className={`${NUM} ${EDGE} font-semibold text-gray-900 dark:text-white`}
                        >
                          {points(row.points_official)}
                        </td>
                        {/* `null` PRINTS THE EM DASH AND NEVER `0` — in the three older cycles
                            there is no composition at all, and `0` would read as "no podium",
                            which is false: an account with no podium week has no `month` row
                            (contract, Parte 7). */}
                        <td className={NUM}>
                          {row.podium_components ?? UNKNOWN_VALUE}
                        </td>
                      </tr>
                    )
                  }

                  /**
                   * THE ZEROED ROW RECEDES, AND THAT IS ALL — §11.2. A background or a border in a
                   * dense table becomes a stripe; receded ink is the step that lets the five rows
                   * that scored stand out of a column of zeros. **It never disappears**: zero is an
                   * answer, and the chip `Pontuaram` is what takes it off the screen, by the
                   * operator's own choice.
                   *
                   * The `&` variants are what make the recess reach the cell: `CELL` and `NUM`
                   * declare their own colour, so inheritance from `<tr>` would reach neither.
                   */
                  const dimmed = activeChip === 'all' && row.points_official <= 0

                  return (
                    <Fragment key={row.user_id}>
                      <tr
                        className={`border-t border-gray-100 hover:bg-gray-50/70 dark:border-gray-800 dark:hover:bg-gray-800/40 ${
                          dimmed
                            ? '[&_td]:text-gray-500 [&_th]:text-gray-500 dark:[&_td]:text-gray-400 dark:[&_th]:text-gray-400'
                            : ''
                        }`}
                      >
                        <td className={`${NUM} pr-0`}>
                          {/* THE SEAL PAYS FOR ITS OWN WIDTH, and the gap is where it finds it.
                              A 20 px seal where a digit was is 12 px more of `#` column, and the
                              table has a ceiling it inherited when `Plataforma` left: the natural
                              width may not pass what that column used to cost
                              (`DS-COMPONENTE-086` critério 24, measured in
                              `tests/ct/ranking-scoreboard.spec.tsx`). The chevron is a 24 px
                              target around a 14 px glyph, so it already carries ~5 px of its own
                              whitespace on the seal's side — dropping the 4 px flex gap on the
                              podium rows keeps the two apart and puts the table back at the
                              ceiling. The digit rows keep the gap they had. */}
                          <span
                            className={`inline-flex items-center ${seal === null ? 'gap-1' : ''}`}
                          >
                            <button
                              type="button"
                              aria-expanded={isOpen}
                              aria-label={
                                isOpen
                                  ? t('table.collapse', { person })
                                  : t('table.expand', { person })
                              }
                              onClick={() => setExpanded(isOpen ? null : row.user_id)}
                              className="inline-flex h-6 w-6 min-h-[24px] min-w-[24px] items-center justify-center rounded text-gray-500 hover:text-gray-900 dark:hover:text-white"
                            >
                              {isOpen ? (
                                <ChevronDown className="h-3.5 w-3.5" aria-hidden="true" />
                              ) : (
                                <ChevronRight className="h-3.5 w-3.5" aria-hidden="true" />
                              )}
                            </button>
                            {/* 20 px of seal adds NOT ONE PIXEL to the row: the chevron next to
                                it is already `h-6 w-6 min-h-[24px]`, so 24 px governs the height
                                of the line with or without it (spec §4.3 and §9 item 10). */}
                            {seal !== null ? (
                              <RankSeal
                                position={seal.position}
                                cycle={seal.cycle}
                                label={t('table.seal', { rank: seal.position })}
                              />
                            ) : (
                              (rank ?? UNKNOWN_VALUE)
                            )}
                          </span>
                        </td>
                        {includeInternal && (
                          <td className={`${NUM} ${DIM}`}>
                            {row.rank_excluding_internal ?? UNKNOWN_VALUE}
                          </td>
                        )}
                        <th
                          scope="row"
                          className={`${CELL} min-w-[11rem] max-w-[16rem] truncate text-left font-medium text-gray-900 dark:text-white`}
                          title={person}
                        >
                          <AppUserLink user={row} />
                          {row.excluded_from_metrics && (
                            <span className="ml-2 rounded border border-gray-300 px-1 text-[10px] font-bold uppercase tracking-widest text-gray-500 dark:border-gray-700 dark:text-gray-400">
                              {t('internal.badge')}
                            </span>
                          )}
                        </th>

                        {/* One glyph, and the name as text under it — `DS-COMPONENTE-086`. No
                            `tabindex`: the name that a keyboard reaches is the one in the expanded
                            row, through the chevron that is already a tab stop (item 3). */}
                        <td className={`${CELL} whitespace-nowrap`}>
                          <CountryFlag code={row.top_country_code} />
                        </td>

                        {/* The only column carrying typographic weight: it is the scoreboard. */}
                        <td className={`${NUM} ${EDGE} font-semibold text-gray-900 dark:text-white`}>
                          {points(row.points_official)}
                        </td>
                        <td className={NUM}>{points(row.trigger_points_fired)}</td>
                        {/* THE COLUMN PRINTS POINTS, AND ONLY POINTS. It used to carry
                            `charged_minutes` on a second line — the same value the `Cobrado`
                            column prints two columns to the right, with no label of its own and
                            inside the `Placar oficial` group instead of the time one. Two
                            printings of one fact, and at zero the cell read `0` over `0 min`
                            (#741, CLAUDE.md §6).

                            NO `hasMeter` HERE, AND THAT IS THE POINT OF THE SWAP. The meter is
                            `drive.time_credit_consumption`, which stopped touching the score
                            (**BR-RANKING-004** item 2); the kilometre comes from the trail and
                            from the entitlement window, and the view computes it for every period
                            it serves. Gating it on the meter would print `—` over a measured
                            number. The kilometres themselves are in the expanded row. */}
                        <td className={NUM}>{points(row.points_from_km)}</td>
                        {isWeek && (
                          <td className={NUM}>
                            {`${row.story_days} / 7`}
                            {row.has_full_week_streak && (
                              <span className={`block text-[11px] ${DIM}`}>
                                {`×${formatPoints(row.streak_multiplier, locale)}`}
                              </span>
                            )}
                          </td>
                        )}

                        {showComparisons && (
                          <>
                            <td className={`${NUM} ${EDGE} ${DIM}`}>
                              {points(row.points_notable_weighted)}
                            </td>
                            <td className={NUM}>
                              <RankDeltaCell row={row} />
                            </td>

                            <td className={`${NUM} ${EDGE}`}>{minutes(row.charged_minutes)}</td>
                            <td className={NUM}>{formatDuration(row.trail_span_minutes)}</td>
                            {/* The difference is signed in both directions and the cell is the
                                door to tab 2, where the tail of the divergence actually lives. */}
                            <td className={NUM}>
                              {hasMeter ? (
                                <button
                                  type="button"
                                  onClick={() => onOpenSessions(row)}
                                  title={t('table.open_sessions', { person })}
                                  className="min-h-[24px] underline-offset-2 hover:underline focus-visible:underline"
                                >
                                  {formatSignedDuration(row.metering_gap_minutes)}
                                </button>
                              ) : (
                                UNKNOWN_VALUE
                              )}
                            </td>
                          </>
                        )}
                      </tr>

                      {isOpen && (
                        <tr className="bg-tuggi-blue/[.04]">
                          <td colSpan={columnCount} className="px-5 py-4">
                            <dl className="grid grid-cols-1 gap-x-8 gap-y-2 text-xs sm:grid-cols-2 lg:grid-cols-3">
                              {/* The column left the table for the width of the time group; the
                                  fact did not leave the screen. Empty here means what the block
                                  above already says it means: the account entered the period only
                                  by charge or by trail. */}
                              <Detail
                                label={t('table.platform')}
                                value={row.platform ?? UNKNOWN_VALUE}
                              />
                              {/* THE NAME IN FULL, and it is not redundancy with the cell above:
                                  it is the third of the three routes to the name — the one for
                                  whoever navigates by keyboard without a screen reader, and the
                                  only one that does not depend on the font painting the flag
                                  (`DS-COMPONENTE-086` items 2 and 3). Same key as the column
                                  header: one quantity, one redaction (`DS-COPY-062` item 4). */}
                              <Detail
                                label={t('table.country')}
                                value={<CountryFlag code={row.top_country_code} withName />}
                              />
                              <Detail
                                label={t('row.notable_triggers')}
                                value={t('row.of_total', {
                                  count: row.trigger_points_notable,
                                  total: row.trigger_points_fired,
                                })}
                              />
                              <Detail
                                label={t('kpi.indeterminate')}
                                value={String(row.visits_indeterminate)}
                              />
                              {/* Same key as the indicator: one caveat, one redaction. */}
                              <Detail
                                label={t('kpi.manual_listens')}
                                value={String(row.visits_manual)}
                              />
                              {/* THE GRANDEZA THE POINTS COLUMN MULTIPLIES, and it stays out of
                                  the table on purpose: the width of the row is a ceiling this
                                  screen inherited (`DS-COMPONENTE-086` critério 24), and the
                                  operator who is calibrating 0,11 needs the kilometre once, not
                                  in every line. The LABEL is the whole caveat — guide on and
                                  entitled — because a `Detail` has no caption above it. */}
                              <Detail
                                label={t('row.km_with_entitlement')}
                                value={formatKilometres(row.km_with_entitlement, locale)}
                              />
                              {/* `0` here is not "did not move": `server_received_at` is 100% null
                                  in 37,5% of the sessions, and 23 (account, period) pairs have
                                  kilometres with this counter at zero (contract, Parte 7). */}
                              <Detail
                                label={t('row.sessions_with_trail')}
                                value={String(row.sessions_with_trail)}
                              />
                              <Detail
                                label={t('row.sessions_charged')}
                                value={hasMeter ? String(row.sessions_charged) : UNKNOWN_VALUE}
                              />
                              <Detail
                                label={t('row.rank_official')}
                                value={row.rank_official == null ? UNKNOWN_VALUE : String(row.rank_official)}
                              />
                              <Detail
                                label={t('row.rank_notable')}
                                value={
                                  row.rank_notable_weighted == null
                                    ? UNKNOWN_VALUE
                                    : String(row.rank_notable_weighted)
                                }
                              />
                              <div>
                                <dt className="font-semibold text-gray-500 dark:text-gray-400">
                                  {t('row.user_id')}
                                </dt>
                                <dd className="flex items-center gap-2 font-mono text-[11px] text-gray-800 dark:text-gray-200">
                                  {row.user_id}
                                  <button
                                    type="button"
                                    onClick={() => navigator.clipboard?.writeText(row.user_id)}
                                    title={t('row.copy')}
                                    className="inline-flex h-6 w-6 min-h-[24px] min-w-[24px] items-center justify-center rounded text-gray-500 hover:text-gray-900 dark:hover:text-white"
                                  >
                                    <Copy className="h-3 w-3" aria-hidden="true" />
                                    <span className="sr-only">{t('row.copy')}</span>
                                  </button>
                                </dd>
                              </div>
                            </dl>
                            <button
                              type="button"
                              onClick={() => onOpenSessions(row)}
                              className="mt-3 min-h-[24px] text-xs font-semibold text-primary-800 underline underline-offset-2 dark:text-tuggi-blue"
                            >
                              {t('row.see_sessions')}
                            </button>
                          </td>
                        </tr>
                      )}
                    </Fragment>
                  )
                })}
            </tbody>

            {!isLoading && tableRows.length > 0 && isComposed && (
              <tfoot className="sticky bottom-0 z-10">
                <tr className="border-t-2 border-gray-200 bg-gray-50/95 backdrop-blur dark:border-gray-700 dark:bg-gray-950/95">
                  <th
                    scope="row"
                    className={`${CELL} text-left font-bold text-gray-900 dark:text-white`}
                    colSpan={includeInternal ? 3 : 2}
                  >
                    {footerLabel}
                  </th>
                  <td className={`${NUM} ${EDGE} font-bold text-gray-900 dark:text-white`}>
                    {points(totals.pointsOfficial)}
                  </td>
                  {/* THE COMPOSITION DOES NOT ADD UP ACROSS ACCOUNTS: one podium week is counted
                      once per account that stood on it, so a total would be neither weeks nor
                      accounts. Empty, like the delta column, and for the same reason. */}
                  <td className={NUM} />
                </tr>
              </tfoot>
            )}

            {!isLoading && tableRows.length > 0 && !isComposed && (
              <tfoot className="sticky bottom-0 z-10">
                <tr className="border-t-2 border-gray-200 bg-gray-50/95 backdrop-blur dark:border-gray-700 dark:bg-gray-950/95">
                  <th
                    scope="row"
                    className={`${CELL} text-left font-bold text-gray-900 dark:text-white`}
                    colSpan={includeInternal ? 4 : 3}
                  >
                    {footerLabel}
                  </th>
                  {/* THE FOOTER TOTALS THE COLUMN THE SCREEN IS ABOUT. It used to leave `Pontos`
                      and `Pts peso 2` EMPTY between five bold totals, so the comparison this
                      screen exists to make — does the weight 2 change the total? — had no answer
                      on it; and an empty cell under the column carrying the ink reads as zero on
                      a table that spells absence `—` everywhere else (#741). The comparison keeps
                      its grey: the total of a deferred weight is not the score
                      (`DS-COMPONENTE-083` item 3). */}
                  <td className={`${NUM} ${EDGE} font-bold text-gray-900 dark:text-white`}>
                    {points(totals.pointsOfficial)}
                  </td>
                  <td className={`${NUM} font-bold`}>{points(totals.triggerPointsFired)}</td>
                  <td className={`${NUM} font-bold`}>{points(totals.pointsFromKm)}</td>
                  {/* The streak is a multiplier and a fraction of seven days: neither sums. */}
                  {isWeek && <td className={NUM} />}
                  {showComparisons && (
                    <>
                      <td className={`${NUM} ${EDGE} ${DIM}`}>
                        {points(totals.pointsNotableWeighted)}
                      </td>
                      {/* A permutation does not add up either: the deltas of a table sum to zero
                          by construction, and a `0` there would look like a finding. */}
                      <td className={NUM} />
                      <td className={`${NUM} ${EDGE} font-bold`}>
                        {minutes(totals.chargedMinutes)}
                      </td>
                      <td className={`${NUM} font-bold`}>
                        {formatDuration(totals.trailSpanMinutes)}
                      </td>
                      <td className={`${NUM} font-bold`}>
                        {hasMeter
                          ? formatSignedDuration(totals.meteringGapMinutes)
                          : UNKNOWN_VALUE}
                      </td>
                    </>
                  )}
                </tr>
              </tfoot>
            )}
          </table>
        </DenseTableScroller>
      </section>
    </div>
  )
}

/**
 * THE REORDERING IS THE DATUM, not the two numbers — `DS-COMPONENTE-083` item 1.
 *
 * Glyph, sign and magnitude, never colour alone, and an `aria-label` saying the same thing in
 * words. With either position null there is nothing to compare and the cell is an em dash.
 */
function RankDeltaCell({ row }: { row: RankingRow }) {
  const t = useTranslations('Pages.Dashboard.ranking')
  const delta = rankDelta(row)

  if (delta === null) {
    return (
      <span role="img" className={DIM} aria-label={t('table.delta_unknown')}>
        {UNKNOWN_VALUE}
      </span>
    )
  }

  if (delta === 0) {
    return (
      <span role="img" className={DIM} aria-label={t('table.delta_same')}>
        =
      </span>
    )
  }

  const up = delta > 0
  const Icon = up ? ArrowUpRight : ArrowDownRight

  /* NO VALENCE, IN EITHER DIRECTION — the delta is a permutation of sum zero: every `↗` in the
     table implies a `↘` somewhere else in it, by construction. Green for one and red for the
     other turns the reordering into a verdict on the weight 2, on the very screen where the
     operator is deciding whether to adopt the weight 2 (#741, `DS-COMPONENTE-083` item 1). The
     glyph, the magnitude and the `aria-label` still carry the direction. */
  return (
    <span
      role="img"
      className="inline-flex items-center gap-0.5 text-gray-700 dark:text-gray-300"
      aria-label={
        up
          ? t('table.delta_up', { count: delta })
          : t('table.delta_down', { count: Math.abs(delta) })
      }
    >
      <Icon className="h-3 w-3" aria-hidden="true" />
      {Math.abs(delta)}
    </span>
  )
}

/**
 * ONE LABEL/VALUE PAIR OF THE FLAT BLOCK — §11.2, what is left of the four `StatCard`s that went.
 *
 * No icon, no `subtitle` and no box of its own: the label already says what the quantity counts
 * (`DS-COPY-062` item 3), and four boxes for four numbers were 150 px saying what fits in four
 * lines. **`isZero` recedes the ink and never hides the pair** — zero is the answer, and omitting
 * it confuses *it is zero* with *I did not measure* (`DS-COMPONENTE-084` item 1).
 */
function Term({ label, value, isZero }: { label: string; value: ReactNode; isZero: boolean }) {
  return (
    <div>
      <dt className="text-[11px] font-bold uppercase leading-[1.15] tracking-widest text-gray-500 dark:text-gray-400">
        {label}
      </dt>
      <dd
        className={`text-sm font-semibold tabular-nums ${
          isZero ? DIM : 'text-gray-900 dark:text-white'
        }`}
      >
        {value}
      </dd>
    </div>
  )
}

function Detail({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div>
      <dt className="font-semibold text-gray-500 dark:text-gray-400">{label}</dt>
      <dd className="tabular-nums text-gray-800 dark:text-gray-200">{value}</dd>
    </div>
  )
}

/** Five rows at the height of the loaded ones: a skeleton one size short is a table that jumps. */
function SkeletonRows({ columns }: { columns: number }) {
  return (
    <>
      {Array.from({ length: 5 }).map((_, index) => (
        <tr key={index} className="border-t border-gray-100 dark:border-gray-800">
          {Array.from({ length: columns }).map((__, cell) => (
            <td key={cell} className={CELL}>
              <div className="h-4 w-full animate-pulse rounded bg-gray-200 dark:bg-gray-700" />
            </td>
          ))}
        </tr>
      ))}
    </>
  )
}

export default RankingScoreboard
