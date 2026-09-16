'use client'

/**
 * ONE ACCOUNT PER ROW — the scoring scoreboard of phase 1 (#741, epic #737).
 *
 * THE LINE CHECKS ITSELF BY EYE: `Pontos = (Disparos + Pts por minuto) × multiplicador`. That is
 * what makes the two facts that look like defects visible without a word of text — the minutes
 * column almost always tiny next to the triggers column (the minute axis is 8% of the
 * scoreboard), and the streak column never multiplying anything (nobody reached 7 calendar days
 * in any of the 13 weeks). Neither is the screen's error, and the screen exists for the operator
 * to see them.
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
  Clock,
  Copy,
  Flame,
  Headphones,
  MapPin,
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
import type { RpcError } from '@/lib/api/dashboard-fetch'
import { AppUserLink } from '@/components/dashboard/AppUserLink'
import { CountryFlag } from '@/components/ui/CountryFlag'
import { RankSeal } from '@/components/ui/RankSeal'
import { formatDuration, formatSignedDuration } from '@/lib/format/duration'
import { UNKNOWN_VALUE } from '@/lib/format/unknown'
import { appUserLabel } from '@/lib/format/user-identity'
import { meteringCoverage } from '@/lib/ranking/metering'
import {
  aggregateRows,
  compareNullable,
  formatPoints,
  formatRatio,
  matchesPeriod,
  rankDelta,
  rankSeal,
  summarize,
  visibleRows,
  weekOfSelection,
  type PeriodOption,
  type PeriodSelection,
  type RankingRow,
} from '@/lib/ranking/scoreboard'

const TUGGI_COLORS = {
  blue: '#00A8E8',
  purple: '#8B5CF6',
  orange: '#FF6F00',
  green: '#10B981',
  red: '#EF4444',
}

/** The eight sortable columns of spec §4.3. `#` is not one of them: it is the default order. */
type SortKey =
  | 'points_official'
  | 'trigger_points_fired'
  | 'points_from_minutes'
  | 'story_days'
  | 'points_notable_weighted'
  | 'charged_minutes'
  | 'trail_span_minutes'
  | 'metering_gap_minutes'

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
  const [chip, setChip] = useState<ChipKey>('all')
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
   * NO PERIOD IS NOT "THE METER WAS THERE". `coverage` used to fall back on `'full'` whenever the
   * reading had no option to match the selection — which is exactly the case of a week older than
   * the 13-week horizon, the case of a pasted link months old. The screen then printed minutes
   * for a window it could not place in time.
   *
   * The selection describes the week on its own (`weekOfSelection`), so the meter has an answer
   * without the round trip. For a rolling window there is nothing to derive — its boundary is
   * "now minus N days" and only the view knows it — and re-deriving it here would be a second
   * owner of a window the view defines (CLAUDE.md §6); that case only exists while the read is in
   * flight, where the table is a skeleton anyway.
   */
  const meteredPeriod = period ?? weekOfSelection(selection)
  const coverage = meteredPeriod
    ? meteringCoverage(meteredPeriod.start, meteredPeriod.end)
    : 'full'
  const hasMeter = coverage !== 'none'

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
      if (chip === 'scored') return row.points_official > 0
      if (chip === 'charged_without_trigger')
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
  }, [shown, chip, sort, includeInternal])

  const totals = useMemo(() => summarize(tableRows), [tableRows])

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
  const columnCount = 12 + (isWeek ? 0 : -1) + (includeInternal ? 1 : 0)

  return (
    <div className="space-y-6">
      {/* THE RULER OF THE SIX NUMBERS BELOW, AND IT LIVES GLUED TO THEM — `DS-COPY-062` item 3.
          It used to sit inside the switch block, ~200px away in the top-right corner, while the
          contradiction it explains (`Contas que pontuaram: 2` against the chip `Todas: 3`) was
          down here. A population restriction is part of the label, which means next to the
          quantity and not once somewhere on the screen.

          With the switch off it does not exist: the two populations coincide and the line would
          be noise in every normal reading of the screen. It is not a warning either — no icon,
          no coloured band, so it does not compete with the two amber ones this screen can
          raise. */}
      {/* THE QUERY ANSWERED SOMETHING ELSE, AND IT IS A CONDITION OF EVERY NUMBER BELOW — so it
          comes before all of them, and not next to the one it happens to contradict. */}
      {didRead && servedDiffers && !isLoading && served && (
        <p className="flex items-start gap-2 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-xs text-amber-700 dark:border-amber-900/50 dark:bg-amber-900/20 dark:text-amber-300">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
          {t('period.served_differs', { pedido: periodLabel, servido: served.label })}
        </p>
      )}

      <div className="space-y-1.5">
        {/* THE PERIOD THE NUMBERS BELONG TO, PRINTED WHERE THEY ARE — and it is the period the
            QUERY SERVED, not the one the `<select>` shows. The control is the operator's own
            gesture and reads as "what I asked for"; nothing on the screen said what came back,
            which is how three different weeks could be read one after another showing the same
            numbers with nothing to denounce it (#741, fixed in 53d674a).

            It needs a read to stamp: with none served, or with another one in flight, the period
            and the count would be the previous answer wearing the face of the new one — the same
            defect the chips below had. */}
        {didRead && served && !isLoading && (
          <p className="text-[11px] font-medium text-gray-600 dark:text-gray-300">
            {t('period.stamp', { period: served.label, count: rows.length })}
          </p>
        )}
        {didRead && includeInternal && (
          <p className="text-[11px] text-gray-500 dark:text-gray-400">
            {t('internal.aggregates_note')}
          </p>
        )}
        <StatCardRow columns={6}>
          <StatCard
            icon={Users}
            size="compact"
            isLoading={isLoading}
            color={TUGGI_COLORS.blue}
            label={t('kpi.accounts_scored')}
            value={measured(summary.accountsScored)}
            /* THE SPLIT IS A SUM, SO IT HAS TO CLOSE — `33 android · 31 ios` under a card saying
               `82` reads as 18 accounts lost somewhere. They are the accounts that entered the
               period only by charge, which carry no platform (contract, Parte 7), and
               `caption.platform` already says what an empty platform means: the third term needs
               no second explanation, only a number. It is omitted at zero, where the two terms
               already add up and the word would be noise. */
            subtitle={note(
              [
                ...summary.byPlatform.map((entry) => `${entry.accounts} ${entry.platform}`),
                ...(summary.platformUnknown > 0
                  ? [t('kpi.platform_unknown', { count: summary.platformUnknown })]
                  : []),
              ].join(' · ')
            )}
          />
          <StatCard
            icon={Scale}
            size="compact"
            isLoading={isLoading}
            color={TUGGI_COLORS.purple}
            label={t('kpi.ratio')}
            /* PARTIAL COVERAGE IS NOT A FRACTION. The numerator is measured over the whole
               window and the denominator only from the ledger's first row onwards (the date has
               one owner, `lib/ranking/metering.ts`), so the ratio would divide two windows of
               different length — today `rolling_30d`, the DEFAULT period of this screen, has
               16,2% of its window with no instrument and `rolling_90d` has 72%, which comes out
               ~3,5× high. The screen used to flatten `partial` into `full` in every number and
               keep the distinction only in the amber band, on the one number the operator uses
               to decide the weight of `0,03/min`.

               What replaces the fraction is not silence: the two totals it would have divided
               are named, which is the reading he can still make. */
            value={measured(
              coverage === 'full' ? formatRatio(summary.triggerToMinuteRatio, locale) : UNKNOWN_VALUE
            )}
            subtitle={note(
              coverage === 'full'
                ? t('kpi.ratio_subtitle', {
                    triggers: points(summary.pointsFromTriggers),
                    minutes: points(summary.pointsFromMinutes),
                  })
                : coverage === 'partial'
                  ? t('kpi.ratio_partial', {
                      triggers: points(summary.pointsFromTriggers),
                      minutes: points(summary.pointsFromMinutes),
                    })
                  : t('kpi.no_meter')
            )}
          />
          {isWeek && (
            <StatCard
              icon={Flame}
              size="compact"
              isLoading={isLoading}
              color={TUGGI_COLORS.orange}
              label={t('kpi.streak')}
              value={measured(t('kpi.accounts', { count: summary.streakAccounts }))}
              subtitle={note(t('kpi.streak_subtitle', { days: summary.maxStoryDays }))}
            />
          )}
          <StatCard
            icon={Clock}
            size="compact"
            isLoading={isLoading}
            color={TUGGI_COLORS.red}
            label={t('kpi.charged_without_trigger')}
            value={measured(
              hasMeter ? t('kpi.accounts', { count: summary.chargedWithoutTrigger }) : UNKNOWN_VALUE
            )}
            subtitle={note(
              hasMeter ? t('kpi.charged_without_trigger_subtitle') : t('kpi.no_meter')
            )}
          />
          {/* The caveat is PART OF THE LABEL and comes from the same key the expanded row reads —
              `DS-COPY-062` items 3 and 4. Manual listening by a paying account records no visit at
              all (two independent gates in the app), so this number measures one tier. */}
          <StatCard
            icon={Headphones}
            size="compact"
            isLoading={isLoading}
            color={TUGGI_COLORS.green}
            label={t('kpi.manual_listens')}
            value={measured(summary.manualListens)}
            subtitle={note(t('kpi.manual_listens_subtitle'))}
          />
          {/* No percentage here, ever: `trigger_points_fired` is deduplicated by (session, POI) and
              this count is not, so the two do not form a fraction (`DS-COMPONENTE-084` item 2). */}
          <StatCard
            icon={MapPin}
            size="compact"
            isLoading={isLoading}
            color={TUGGI_COLORS.blue}
            label={t('kpi.indeterminate')}
            value={measured(summary.visitsIndeterminate)}
            subtitle={note(t('kpi.indeterminate_subtitle'))}
          />
        </StatCardRow>
      </div>

      {/* THE STATE THAT MUST NOT PASS IN SILENCE. The switch is off and it is removing nobody:
          without this band the screen shows an unfiltered scoreboard wearing the face of a
          filtered one. A band and not a tooltip — it is a condition of the whole reading.

          IT NEEDS A READING TO BE A CONDITION OF. `internalAccounts` also arrives `0` when the
          request failed, and the sentence — *no marked account appears in THIS READ* — then
          describes a read that never happened; the two above it do the same. Both say `0` for
          the same reason the indicators did, and `0` from a failed read is not a finding. */}
      {didRead && !includeInternal && internalAccounts === 0 && (
        <p className="flex items-start gap-2 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-xs text-amber-700 dark:border-amber-900/50 dark:bg-amber-900/20 dark:text-amber-300">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
          {t('internal.none_marked')}
        </p>
      )}

      {coverage !== 'full' && (
        <p className="flex items-start gap-2 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-xs text-amber-700 dark:border-amber-900/50 dark:bg-amber-900/20 dark:text-amber-300">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
          {coverage === 'none' ? t('meter.none') : t('meter.partial')}
        </p>
      )}

      {/* Error is NOT empty, and never looks like it: an empty table after a failed request is
          the screen asserting "nobody scored" when the truth is "I do not know". */}
      {error && (
        <div className="flex flex-wrap items-center gap-3 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-xs text-red-700 dark:border-red-900/50 dark:bg-red-900/20 dark:text-red-300">
          <span>{error.code === '42501' ? t('error.forbidden') : t('error.title')}</span>
          <button
            type="button"
            onClick={onRetry}
            className="min-h-[24px] rounded-lg border border-red-300 px-2 py-0.5 font-semibold hover:bg-red-100 dark:border-red-800 dark:hover:bg-red-900/40"
          >
            {t('error.retry')}
          </button>
        </div>
      )}

      <section className="overflow-hidden rounded-3xl border border-gray-200 bg-white/70 shadow-2xl shadow-black/5 backdrop-blur-xl dark:border-gray-800 dark:bg-gray-900/70">
        {/* A CHIP WITH A NUMBER IS AN ASSERTION, and the number is a count of the read. With no
            read the chips stay — they are the filter, and the filter is the operator's, not the
            server's — but they count nothing. `Todas: 0` under a red band is the same lie the
            indicators were telling. */}
        <header className="flex flex-wrap items-center gap-2 border-b border-gray-200 px-5 py-4 dark:border-gray-800">
          <FilterChip
            active={chip === 'all'}
            onClick={() => setChip('all')}
            count={didRead && !isLoading ? counts.all : undefined}
          >
            {t('filters.all')}
          </FilterChip>
          <FilterChip
            active={chip === 'scored'}
            onClick={() => setChip('scored')}
            count={didRead && !isLoading ? counts.scored : undefined}
          >
            {t('filters.scored')}
          </FilterChip>
          <FilterChip
            active={chip === 'charged_without_trigger'}
            onClick={() => setChip('charged_without_trigger')}
            count={didRead && !isLoading ? counts.charged_without_trigger : undefined}
          >
            {t('filters.charged_without_trigger')}
          </FilterChip>
        </header>

        {/* THE DECLARATION IS READ WHERE THE CELLS ARE — `DS-COMPONENTE-083` item 3, amended
            2026-09-13, plus the measurement of #741: the same readings inside the `<caption>` sat
            INSIDE the scroller, 66px tall up to a 1280px viewport, and left the screen on the
            first vertical scroll while the two header bands stayed glued. The one that costs money
            is `Intervalo de sinal no período`: sorting by `Diferença` — the sortable column of the
            biggest numbers — puts `+67 h` rows on top, and without the sentence that says an open
            session with sparse signal inflates the span without consuming balance, the operator
            reads a revenue leak that does not exist.

            FIVE declarations: `caption.country` is the third, and it is the one that keeps a
            column of countries next to a column of people from being read as an attribute of the
            person (§6.7). `caption.sorting` is the fifth and answers the wrong conclusion a click on
            a column head invites — `#` is a value and sorting does not renumber it
            (`DS-COMPONENTE-082` item 3) — so leaving it only in the `sr-only` caption put the one
            sentence about the interaction out of reach of whoever performs the interaction.

            One `<p>` per fact, the term in bold opening the line, and the SAME keys the caption
            below carries, in the same order. The repetition is deliberate: the block is for the
            eye and the `sr-only` caption is for the screen reader, which gets it before any cell —
            deleting either half to "clean up the duplication" brings back one of the defects. */}
        <div
          data-testid="ranking-legend"
          className="space-y-0.5 border-b border-gray-200 px-5 py-2.5 text-[11px] leading-snug text-gray-600 dark:border-gray-800 dark:text-gray-400"
        >
          {/* NOT `caption.span`: since the trail span is CLIPPED to the period (contract
              `banco-para-cms.md`, Parte 7), what the column sums is the part of each session's
              interval that fell inside the selected period — and overlapping sessions of one
              account can push the total past the period's own duration. `caption.span` keeps its
              consumer in `RankingSessionMetering`, where the row IS the session and there is no
              period boundary in the middle. */}
          <p>{t.rich('caption.span_in_period', { b: (chunks) => <strong>{chunks}</strong> })}</p>
          <p>{t.rich('caption.platform', { b: (chunks) => <strong>{chunks}</strong> })}</p>
          {/* THE COLUMN THAT ANSWERS NEXT TO A QUESTION THE PRODUCT CANNOT ANSWER — the label
              already says `País explorado` and never `País`, and this is where the denial lives:
              it is not residence and it is not nationality (`DS-COMPONENTE-086` item 5,
              BR-USUARIO-043 item 9). The two words appear here to be REFUSED, which is the only
              place on the screen they may appear (spec §9, critério 24). The sentence also says
              what empty means, because `null` is "does not resolve" and this table spells "zero"
              a different way everywhere else. */}
          <p>{t.rich('caption.country', { b: (chunks) => <strong>{chunks}</strong> })}</p>
          {/* THE POPULATION OF THE COMPARISON LIVES HERE, and not in the group label — the band
              of groups has a fixed 28px and the band of column names sticks 28px below it, so a
              label carrying `(posição entre todas as contas)` wrapped and hid the thirteen column
              names (#752). Without this line the delta has a baseline nobody stated (item 2). */}
          <p>{t.rich('caption.notable', { b: (chunks) => <strong>{chunks}</strong> })}</p>
          {/* No `<b>`: the sentence has no term to define, it denies a consequence. */}
          <p>{t('caption.sorting')}</p>
        </div>

        <DenseTableScroller>
          {/* The floor dropped with the `Plataforma` column: the width is a floor for narrow
              viewports, not the natural width, and keeping the old one would spend on nothing the
              ~110px the column gave back. */}
          <table className="w-full min-w-[930px] border-collapse">
            {/* Same five declarations, same order, for whoever does not see the block above —
                a `<caption>` is what a screen reader announces before the first cell. */}
            <caption className="sr-only">
              {t.rich('caption.span_in_period', { b: (chunks) => <strong>{chunks}</strong> })}{' '}
              {t.rich('caption.platform', { b: (chunks) => <strong>{chunks}</strong> })}{' '}
              {t.rich('caption.country', { b: (chunks) => <strong>{chunks}</strong> })}{' '}
              {t.rich('caption.notable', { b: (chunks) => <strong>{chunks}</strong> })}{' '}
              {t('caption.sorting')}
            </caption>
            <thead>
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
                {/* NOT SORTABLE, and the omission is the same one `Plataforma` had: categorical
                    over 13 rows, and §4.3 does not list it. The header is allowed to wrap — that
                    is what keeps the width at `explorado` and not at `País explorado`. */}
                <th scope="col" className={HEAD}>
                  {t('table.country')}
                </th>
                {head('points_official', t('table.points'), `${HEAD_NUM} ${EDGE}`)}
                {head('trigger_points_fired', t('table.triggers'), HEAD_NUM)}
                {head('points_from_minutes', t('table.points_from_minutes'), HEAD_NUM)}
                {isWeek && head('story_days', t('table.streak'), HEAD_NUM)}
                {head('points_notable_weighted', t('table.notable_points'), `${HEAD_NUM} ${EDGE}`)}
                <th scope="col" className={HEAD_NUM}>
                  {t('table.rank_delta')}
                </th>
                {head('charged_minutes', t('table.charged'), `${HEAD_NUM} ${EDGE}`)}
                {head('trail_span_minutes', t('table.trail_span_in_period'), HEAD_NUM)}
                {head('metering_gap_minutes', t('table.gap'), HEAD_NUM)}
              </tr>
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
                    {chip !== 'all'
                      ? t('empty.filtered', { period: periodLabel })
                      : didRead && period === null && selection.kind === 'week'
                        ? t('empty.out_of_horizon')
                        : t('empty.period', { period: periodLabel })}
                    {chip !== 'all' && (
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
                  const seal = rankSeal(rank, meteredPeriod)

                  return (
                    <Fragment key={row.user_id}>
                      <tr
                        className="border-t border-gray-100 hover:bg-gray-50/70 dark:border-gray-800 dark:hover:bg-gray-800/40"
                      >
                        <td className={`${NUM} pr-0`}>
                          <span className="inline-flex items-center gap-1">
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
                            (#741, CLAUDE.md §6). */}
                        <td className={NUM}>
                          {hasMeter ? points(row.points_from_minutes) : UNKNOWN_VALUE}
                        </td>
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

                        <td className={`${NUM} ${EDGE} ${DIM}`}>
                          {points(row.points_notable_weighted)}
                        </td>
                        <td className={NUM}>
                          <RankDeltaCell row={row} />
                        </td>

                        <td className={`${NUM} ${EDGE}`}>{minutes(row.charged_minutes)}</td>
                        <td className={NUM}>{formatDuration(row.trail_span_minutes)}</td>
                        {/* The difference is signed in both directions and the cell is the door
                            to tab 2, where the tail of the divergence actually lives. */}
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

            {!isLoading && tableRows.length > 0 && (
              <tfoot className="sticky bottom-0 z-10">
                <tr className="border-t-2 border-gray-200 bg-gray-50/95 backdrop-blur dark:border-gray-700 dark:bg-gray-950/95">
                  <th
                    scope="row"
                    className={`${CELL} text-left font-bold text-gray-900 dark:text-white`}
                    colSpan={includeInternal ? 4 : 3}
                  >
                    {t('table.totals', { count: totals.rowCount })}
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
                  <td className={`${NUM} font-bold`}>
                    {hasMeter ? points(totals.pointsFromMinutes) : UNKNOWN_VALUE}
                  </td>
                  {/* The streak is a multiplier and a fraction of seven days: neither sums. */}
                  {isWeek && <td className={NUM} />}
                  <td className={`${NUM} ${EDGE} ${DIM}`}>
                    {points(totals.pointsNotableWeighted)}
                  </td>
                  {/* A permutation does not add up either: the deltas of a table sum to zero by
                      construction, and a `0` there would look like a finding. */}
                  <td className={NUM} />
                  <td className={`${NUM} ${EDGE} font-bold`}>{minutes(totals.chargedMinutes)}</td>
                  <td className={`${NUM} font-bold`}>
                    {formatDuration(totals.trailSpanMinutes)}
                  </td>
                  <td className={`${NUM} font-bold`}>
                    {hasMeter ? formatSignedDuration(totals.meteringGapMinutes) : UNKNOWN_VALUE}
                  </td>
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
