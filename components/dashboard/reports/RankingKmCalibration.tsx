'use client'

/**
 * THE KM AXIS, WEEK BY WEEK — the panel of spec §3.2 (#742, epic #737).
 *
 * WHY A SERIES AND NOT A NUMBER. Aggregated over the 13 weeks the kilometre is worth 25,6% of the
 * scoreboard and the ratio is 2,91 : 1, inside the band the operator calibrated **BR-RANKING-004**
 * with. But the WEEKLY slice runs from 4,5% to 44,8%, and in 2 of the 11 weeks with a winner the
 * kilometre handed first place to somebody who did not deliver the most history. **A mean that
 * hides both ends answers "is it calibrated?" with a number that happened in no week at all.**
 *
 * NOTHING IS BORN HERE. It is the THIRD instance of `components/ui/dense-table.tsx`
 * (`DS-COMPONENTE-081`) — no primitive of its own, no token of its own, no state of its own. No
 * `SortHead`: thirteen rows in chronological order, and sorting them answers no question the
 * panel asks. No sticky footer and no chevron either, for the same reason.
 *
 * AND IT COSTS NO SECOND READ. The series is aggregated in `app/api/dashboard/ranking/route.ts`
 * over the `week` rows the one read already brought, and travels in `ScoreboardPayload`. The view
 * costs ~2,8 s against an 8 s `statement_timeout` (contract `banco-para-cms.md`, Parte 7): one
 * read per screen load, never two, and never 350 rows for the browser to add up.
 *
 * THE FOOTER SUMS ONLY THE WEEKS WITH AN INSTRUMENT, AND SAYS HOW MANY. Eight of the 13 weeks are
 * below `ENTITLEMENT_LEDGER_START`, where the kilometre is a floor and not a measurement; a total
 * over all 13 would be the fraction `DS-COMPONENTE-084` item 2 forbids. **That total does not
 * match the 25,6% of the contract, and the mismatch is the correct behaviour** — the contract
 * measures the 13 weeks, this footer measures the measured ones (spec §9, critério 34).
 */

import { useLocale, useTranslations } from 'next-intl'
import { CELL, DIM, DenseTableScroller, GROUP, HEAD, HEAD_NUM, NUM } from '@/components/ui/dense-table'
import { UNKNOWN_VALUE } from '@/lib/format/unknown'
import { appUserLabel } from '@/lib/format/user-identity'
import {
  formatPoints,
  formatShare,
  periodBounds,
  type KmCalibrationSeries,
  type KmCalibrationWeek,
} from '@/lib/ranking/scoreboard'

export interface RankingKmCalibrationProps {
  series: KmCalibrationSeries
  /**
   * Selecting the week the operator clicked — the panel is a way INTO the scoreboard, not a
   * second scoreboard. It carries the `period_start` the view emitted, which is exactly what the
   * `<select>` and the URL already speak (spec §9, critério 36).
   */
  onSelectWeek: (start: string) => void
}

export function RankingKmCalibration({ series, onSelectWeek }: RankingKmCalibrationProps) {
  const t = useTranslations('Pages.Dashboard.ranking')
  const locale = useLocale()

  // Nothing to calibrate with: the read failed, or the view served no week. An empty dense table
  // with a footer saying `0 semanas com instrumento` would assert a measurement nobody made.
  if (series.weeks.length === 0) return null

  /** `31/08 – 06/09`, and the second date is INCLUSIVE — `period_end` is exclusive (contract). */
  const weekLabel = (week: KmCalibrationWeek) => {
    const bounds = periodBounds(week)
    const date = new Intl.DateTimeFormat(locale, {
      day: '2-digit',
      month: '2-digit',
      timeZone: 'UTC',
    })
    return `${date.format(bounds.start)} – ${date.format(bounds.endInclusive)}`
  }

  return (
    <section
      data-testid="ranking-km-calibration"
      className="overflow-hidden rounded-3xl border border-gray-200 bg-white/70 shadow-2xl shadow-black/5 backdrop-blur-xl dark:border-gray-800 dark:bg-gray-900/70"
    >
      <header className="border-b border-gray-200 px-5 py-4 dark:border-gray-800">
        <h2 className="text-sm font-bold text-gray-900 dark:text-white">{t('calibration.title')}</h2>
        {/* The same sentence the `<caption>` carries below: the block is for the eye, the caption
            is what a screen reader gets before the first cell. */}
        <p className="mt-1 text-[11px] leading-snug text-gray-600 dark:text-gray-400">
          {t.rich('calibration.caption', { b: (chunks) => <strong>{chunks}</strong> })}
        </p>
      </header>

      <DenseTableScroller maxHeightClassName="max-h-[26rem]">
        <table className="w-full min-w-[620px] border-collapse">
          <caption className="sr-only">
            {t.rich('calibration.caption', { b: (chunks) => <strong>{chunks}</strong> })}
          </caption>
          <thead>
            <tr>
              <th className={`${GROUP} text-gray-500 dark:text-gray-400`} colSpan={5} />
            </tr>
            <tr>
              <th scope="col" className={HEAD}>
                {t('calibration.week')}
              </th>
              <th scope="col" className={HEAD_NUM}>
                {t('calibration.trigger_points')}
              </th>
              {/* ONE QUANTITY, ONE REDACTION — the same key the scoreboard column uses
                  (`DS-COPY-062` item 4). */}
              <th scope="col" className={HEAD_NUM}>
                {t('table.points_from_km')}
              </th>
              <th scope="col" className={HEAD_NUM}>
                {t('calibration.km_share')}
              </th>
              <th scope="col" className={HEAD}>
                {t('calibration.winner_without_km')}
              </th>
            </tr>
          </thead>

          <tbody>
            {series.weeks.map((week) => (
              <tr
                key={week.start}
                className="border-t border-gray-100 hover:bg-gray-50/70 dark:border-gray-800 dark:hover:bg-gray-800/40"
              >
                <th scope="row" className={`${CELL} text-left font-medium`}>
                  <button
                    type="button"
                    onClick={() => onSelectWeek(week.start)}
                    title={t('calibration.open_week', { week: weekLabel(week) })}
                    className="min-h-[24px] underline-offset-2 hover:underline focus-visible:underline"
                  >
                    {weekLabel(week)}
                  </button>
                </th>
                <td className={NUM}>{formatPoints(week.pointsFromTriggers, locale)}</td>
                {/* THE FLOOR IS MARKED ON THE VALUE, NOT INSTEAD OF IT — `DS-COMPONENTE-084`
                    item 1, cláusula de 2026-09-16. Before `ENTITLEMENT_LEDGER_START` the
                    instrument EXISTS and is incomplete: the number is positive and smaller than
                    the real one, so it prints, tagged. Blanking it would say *I do not know* where
                    the truth is *at least this*. */}
                <td className={NUM}>
                  {formatPoints(week.pointsFromKm, locale)}
                  {week.isFloor && (
                    <span className={`ml-1 text-[10px] uppercase tracking-widest ${DIM}`}>
                      {t('calibration.floor')}
                    </span>
                  )}
                </td>
                {/* The fraction is the one thing a floor week may NOT print: a share over partial
                    coverage is a number with no referent (`DS-COMPONENTE-084` item 2). */}
                <td className={NUM}>{formatShare(week.kmShare, locale)}</td>
                <td className={CELL}>
                  <WinnerCell week={week} />
                </td>
              </tr>
            ))}
          </tbody>

          <tfoot>
            <tr className="border-t-2 border-gray-200 bg-gray-50/95 dark:border-gray-700 dark:bg-gray-950/95">
              <th scope="row" className={`${CELL} text-left font-bold text-gray-900 dark:text-white`}>
                {t('calibration.totals', { count: series.measuredWeeks })}
              </th>
              <td className={`${NUM} font-bold`}>
                {formatPoints(series.pointsFromTriggers, locale)}
              </td>
              <td className={`${NUM} font-bold`}>{formatPoints(series.pointsFromKm, locale)}</td>
              <td className={`${NUM} font-bold`}>{formatShare(series.kmShare, locale)}</td>
              {/* A counterfactual winner does not add up: there is no "who would have won the 13
                  weeks", and a name here would invent a cycle the product does not have. */}
              <td className={CELL} />
            </tr>
          </tfoot>
        </table>
      </DenseTableScroller>
    </section>
  )
}

/**
 * `=`, a name, or `—` — and the em dash is an answer, not a gap.
 *
 * It says the week does not answer: a tie at the top of either order, nobody scoring, or an
 * instrument floor. The three collapse into one printing because the operator's question is
 * *did the km change the winner?*, and all three mean *this week cannot tell you*.
 */
function WinnerCell({ week }: { week: KmCalibrationWeek }) {
  const t = useTranslations('Pages.Dashboard.ranking')
  const winner = week.winnerWithoutKm

  if (winner.outcome === 'unknown') return <span className={DIM}>{UNKNOWN_VALUE}</span>

  if (winner.outcome === 'unchanged') {
    return (
      <span role="img" className={DIM} aria-label={t('calibration.winner_unchanged')}>
        =
      </span>
    )
  }

  return <span className="text-gray-800 dark:text-gray-200">{appUserLabel(winner)}</span>
}

export default RankingKmCalibration
