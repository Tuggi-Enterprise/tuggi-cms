/**
 * #741 — what the scoreboard screen is allowed to say, and in which words.
 *
 * The rendering of the table is proved in `tests/ct/ranking-scoreboard.spec.tsx`, which has a
 * DOM. What is proved here is everything that can be answered without one: the arithmetic the
 * screen adds up, the boundary of the meter, and the copy — because three of this screen's
 * labels are fragile in a specific way, and a label that lies costs more than a number that is
 * missing (`DS-COPY-062`).
 *
 * Run with: npm run test:api
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

import { formatDuration, formatSignedDuration } from '../../lib/format/duration'
import { UNKNOWN_VALUE } from '../../lib/format/unknown'
import { METERING_LEDGER_START, meteringCoverage } from '../../lib/ranking/metering'
import {
  aggregateRows,
  formatRatio,
  matchesPeriod,
  parsePeriodParam,
  periodBounds,
  periodOptions,
  rankDelta,
  rowsForPeriod,
  summarize,
  visibleRows,
  type RankingRow,
} from '../../lib/ranking/scoreboard'

const REPO_ROOT = resolve(import.meta.dirname, '../..')
const source = (path: string) => readFileSync(resolve(REPO_ROOT, path), 'utf8')
const messages = (locale: string) =>
  JSON.parse(source(`messages/${locale}.json`)) as Record<string, any>

const LOCALES = ['pt', 'en', 'es'] as const

function row(overrides: Partial<RankingRow> = {}): RankingRow {
  return {
    period_kind: 'week',
    period_start: '2026-08-31T00:00:00+00:00',
    period_end: '2026-09-07T00:00:00+00:00',
    user_id: '11111111-1111-4111-8111-111111111111',
    nickname: 'hoppy-otter',
    platform: 'ios',
    excluded_from_metrics: false,
    trigger_points_fired: 10,
    trigger_points_notable: 3,
    visits_indeterminate: 2,
    visits_manual: 1,
    charged_minutes: 30,
    story_days: 4,
    has_full_week_streak: false,
    streak_multiplier: 1,
    points_from_triggers: 10,
    points_from_minutes: 0.9,
    points_official: 10.9,
    rank_official: 2,
    rank_excluding_internal: 1,
    points_notable_weighted: 13,
    rank_notable_weighted: 1,
    trail_span_minutes: 90,
    metering_gap_minutes: 60,
    sessions_with_trail: 2,
    sessions_charged: 1,
    ...overrides,
  }
}

// ── The signed difference ─────────────────────────────────────────────────────────────────

test('DS-COMPONENTE-084 item 3: a difference prints its sign in both directions', () => {
  assert.equal(formatSignedDuration(-12), '−12 min')
  assert.equal(formatSignedDuration(125), '+2 h 5 min')
  assert.equal(formatSignedDuration(0), '0 min')

  // U+2212 MINUS SIGN, not the hyphen: at 11px in a tabular column the hyphen reads as a dash,
  // and the dash already means "I do not have this" in the same column.
  assert.equal(formatSignedDuration(-12).charCodeAt(0), 0x2212)
  assert.equal(formatSignedDuration(null), UNKNOWN_VALUE)
})

test('DS-COMPONENTE-084 item 3: `formatDuration` is the reason the signed one had to exist', () => {
  // Not a defect of `formatDuration`: its callers look at a balance, and a balance below zero is
  // not a thing the tourist can hold. Used on `metering_gap_minutes` it would erase the sign.
  assert.equal(formatDuration(-12), '0 min')
})

// ── The meter, and the zero that is not a zero ────────────────────────────────────────────

test('BR-MONETIZACAO-049: the meter ledger starts on 2026-08-18 20:41 UTC, in one place', () => {
  assert.equal(new Date(METERING_LEDGER_START).toISOString(), '2026-08-18T20:41:00.000Z')

  // The date lives in `lib/ranking/metering.ts` and nowhere else: a literal inside a component
  // is a second owner of a temporal boundary (`DS-COMPONENTE-084` item 1).
  for (const file of [
    'components/dashboard/reports/RankingScoreboard.tsx',
    'components/dashboard/reports/RankingSessionMetering.tsx',
    'app/[locale]/dashboard/reports/ranking/page.tsx',
  ]) {
    assert.equal(
      /2026-08-18|Date\.UTC\(2026/.test(source(file)),
      false,
      `${file} must ask \`meteringCoverage\`, never carry the date`
    )
  }
})

test('DS-COMPONENTE-084 item 1: a period before the meter is unknown, not zero', () => {
  // Entirely before the first charge: the minute axis was never measured.
  assert.equal(
    meteringCoverage('2026-07-06T00:00:00Z', '2026-07-13T00:00:00Z'),
    'none',
    'no instrument in the window'
  )

  // The 90-day window CROSSES the boundary, and the band says so with its own wording.
  assert.equal(meteringCoverage('2026-06-15T00:00:00Z', '2026-09-13T00:00:00Z'), 'partial')
  assert.equal(meteringCoverage('2026-08-31T00:00:00Z', '2026-09-07T00:00:00Z'), 'full')

  // `period_end` is EXCLUSIVE: a window ending exactly at the first charge contains none of it.
  assert.equal(meteringCoverage('2026-08-11T00:00:00Z', '2026-08-18T20:41:00Z'), 'none')
})

// ── One period, one ruler ─────────────────────────────────────────────────────────────────

test('DS-COMPONENTE-082 item 1: rows of one period only, and no aggregating fallback', () => {
  const rows = [
    row({ period_kind: 'week' }),
    row({ period_kind: 'rolling_30d', user_id: 'a' }),
    row({ period_kind: 'rolling_90d', user_id: 'b' }),
  ]

  assert.equal(rowsForPeriod(rows, { kind: 'rolling_30d', start: null }).length, 1)
  assert.equal(
    rowsForPeriod(rows, { kind: 'week', start: '2026-08-31T00:00:00+00:00' }).length,
    1
  )

  // A pasted URL is the point of carrying the period there: `?start=2026-08-31` is the same
  // Monday as the timestamp the view returned.
  assert.equal(matchesPeriod('week', '2026-08-31T00:00:00+00:00', { kind: 'week', start: '2026-08-31' }), true)

  // `week` with no start does not guess a week; the parser falls back to the 30-day window.
  assert.deepEqual(parsePeriodParam('week', null), { kind: 'rolling_30d', start: null })
  assert.deepEqual(parsePeriodParam('all', null), { kind: 'rolling_30d', start: null })
  assert.deepEqual(parsePeriodParam(null, null), { kind: 'rolling_30d', start: null })
})

test('DS-COMPONENTE-082 item 2: the week label prints both boundaries, and the end is inclusive', () => {
  const { start, endInclusive } = periodBounds({
    start: '2026-08-31T00:00:00+00:00',
    end: '2026-09-07T00:00:00+00:00',
  })

  assert.equal(start.toISOString(), '2026-08-31T00:00:00.000Z')
  // `period_end` is exclusive: a label reading `31/08 – 07/09` would claim a day the period
  // does not contain.
  assert.equal(endInclusive.toISOString(), '2026-09-06T00:00:00.000Z')
})

test('#741: the `<select>` offers the two rolling windows then the weeks, newest first', () => {
  const options = periodOptions([
    row({ period_kind: 'week', period_start: '2026-08-24T00:00:00+00:00' }),
    row({ period_kind: 'rolling_90d' }),
    row({ period_kind: 'week', period_start: '2026-08-31T00:00:00+00:00' }),
    row({ period_kind: 'rolling_30d' }),
    row({ period_kind: 'week', period_start: '2026-08-31T00:00:00+00:00', user_id: 'z' }),
  ])

  assert.deepEqual(
    options.map((option) => `${option.kind}:${option.start.slice(0, 10)}`),
    [
      'rolling_30d:2026-08-31',
      'rolling_90d:2026-08-31',
      'week:2026-08-31',
      'week:2026-08-24',
    ]
  )
})

// ── The internal-account mark ─────────────────────────────────────────────────────────────

test('#740: the mark hides the ROW only when asked, and never leaves the aggregates', () => {
  const rows = [row(), row({ user_id: 'internal', excluded_from_metrics: true })]

  // The table's default: the marked account does not render at all. Without it the first thing
  // the operator sees is himself in first place with 22,1% of the points.
  assert.equal(visibleRows(rows, false).length, 1)
  assert.equal(visibleRows(rows, true).length, 2)

  // The switch shows rows; it does not put the marked account back into any average or ratio
  // (contract, Parte 7). Aggregates have one population, and it is this one.
  assert.equal(aggregateRows(rows).length, 1)
})

test('#741: the frame is born with the filter ON — the switch defaults to unchecked', () => {
  const page = source('app/[locale]/dashboard/reports/ranking/page.tsx')

  assert.match(page, /useState\(false\)/, 'includeInternal starts false')
  assert.match(page, /internal\.none_marked|internalAccounts/, 'the zero-marked state is handled')
  // Never by e-mail, by domain or by a list of ids — #740: "filtrar IDs é um erro".
  assert.equal(/@tuggi\.app|\.eq\('id',|EMAIL/.test(page), false)
})

// ── The six indicators ────────────────────────────────────────────────────────────────────

test('#741: the indicators count what the contract says they count', () => {
  const rows = [
    row({ user_id: 'a', platform: 'ios', points_official: 45, trigger_points_fired: 45, points_from_triggers: 45, points_from_minutes: 0, charged_minutes: 0 }),
    row({ user_id: 'b', platform: 'android', points_official: 7, trigger_points_fired: 7, points_from_triggers: 7, points_from_minutes: 3, charged_minutes: 100 }),
    // Charged and fired nothing: the #743 population seen from the revenue side.
    row({ user_id: 'c', platform: 'ios', points_official: 1.5, trigger_points_fired: 0, points_from_triggers: 0, points_from_minutes: 1.5, charged_minutes: 50 }),
    // Nobody: zero points does not count as an account that scored.
    row({ user_id: 'd', platform: null, points_official: 0, trigger_points_fired: 0, points_from_triggers: 0, points_from_minutes: 0, charged_minutes: 0 }),
  ]

  const summary = summarize(rows)

  assert.equal(summary.accountsScored, 3)
  assert.deepEqual(summary.byPlatform, [
    { platform: 'ios', accounts: 2 },
    { platform: 'android', accounts: 1 },
  ])
  assert.equal(summary.chargedWithoutTrigger, 1)
  // Both sides of the ratio are POINTS — one ruler (`DS-COMPONENTE-084` item 2).
  assert.equal(summary.pointsFromTriggers, 52)
  assert.equal(summary.pointsFromMinutes, 4.5)
  assert.equal(Math.round((summary.triggerToMinuteRatio ?? 0) * 10) / 10, 11.6)
})

test('DS-COMPONENTE-084 item 2: a zero denominator is unknown, never `∞`, `0` or `100 %`', () => {
  const summary = summarize([row({ points_from_minutes: 0, charged_minutes: 0 })])

  assert.equal(summary.triggerToMinuteRatio, null)
  assert.equal(formatRatio(null, 'pt'), UNKNOWN_VALUE)
  assert.equal(formatRatio(11.62, 'pt'), '11,6 : 1')
})

test('DS-COMPONENTE-083 item 2: the delta compares two positions of the SAME population', () => {
  // `rank_notable_weighted` is computed over every account, so the baseline is `rank_official`
  // and never the `#` column, which may be excluding internal accounts.
  assert.equal(rankDelta({ rank_official: 4, rank_notable_weighted: 1 }), 3)
  assert.equal(rankDelta({ rank_official: 1, rank_notable_weighted: 3 }), -2)
  assert.equal(rankDelta({ rank_official: 2, rank_notable_weighted: 2 }), 0)
  assert.equal(rankDelta({ rank_official: null, rank_notable_weighted: 1 }), null)
  assert.equal(rankDelta({ rank_official: 1, rank_notable_weighted: null }), null)

  const component = source('components/dashboard/reports/RankingScoreboard.tsx')
  assert.equal(
    /rankDelta\(\s*\{[^}]*rank_excluding_internal/.test(component),
    false,
    'the delta never takes the `#` column as its baseline'
  )
})

// ── The copy ──────────────────────────────────────────────────────────────────────────────

test('DS-COPY-062: the three languages carry exactly the same ranking keys', () => {
  const paths = (value: unknown, prefix = ''): string[] =>
    value && typeof value === 'object' && !Array.isArray(value)
      ? Object.entries(value as Record<string, unknown>).flatMap(([key, child]) =>
          paths(child, prefix ? `${prefix}.${key}` : key)
        )
      : [prefix]

  const [pt, en, es] = LOCALES.map((locale) =>
    paths(messages(locale).Pages.Dashboard.ranking).sort()
  )

  assert.ok(pt.length > 50, 'the namespace is the screen, not a stub')
  assert.deepEqual(en, pt, 'a key missing in en renders its own NAME on the screen')
  assert.deepEqual(es, pt, 'a key missing in es renders its own NAME on the screen')
})

test('DS-COPY-062 items 3 and 4: the free-tier caveat is part of the label, from one key', () => {
  const expected = {
    pt: 'Escuta manual · só tier gratuito',
    en: 'Manual listens · free tier only',
    es: 'Escucha manual · solo nivel gratuito',
  }

  for (const locale of LOCALES) {
    const ranking = messages(locale).Pages.Dashboard.ranking
    assert.equal(ranking.kpi.manual_listens, expected[locale])
    // ONE key, two consumers. A second key holding the same sentence is the second redaction
    // the rule forbids — the expanded row reads `kpi.manual_listens` too.
    assert.equal(
      'manual_listens' in ranking.row,
      false,
      'the caveat has one owner; `row.manual_listens` would be a copy of it'
    )
  }

  const component = source('components/dashboard/reports/RankingScoreboard.tsx')
  const uses = component.match(/t\('kpi\.manual_listens'\)/g) ?? []
  assert.equal(uses.length, 2, 'the indicator and the expanded row read the same key')
})

test('DS-COPY-062 items 1 and 2: the fragile labels never borrow a neighbour’s word', () => {
  const FORBIDDEN = [
    // `trigger_point_id IS NULL` is boundary ∪ lost id — 6,2% of visits, #750. Naming it
    // boundary would promise a distinction the data does not make.
    'boundary',
    'geofence',
    'limite de área',
    'límite de área',
  ]

  for (const locale of LOCALES) {
    const ranking = JSON.stringify(messages(locale).Pages.Dashboard.ranking).toLowerCase()
    for (const word of FORBIDDEN) {
      assert.equal(ranking.includes(word), false, `${locale}: "${word}" is not ours to use`)
    }

    // No percentage of visits reaches this screen: `trigger_points_fired` is deduplicated by
    // (session, POI) and the visit counts are not, so the division would be an assertion nobody
    // made (`DS-COMPONENTE-084` item 2).
    assert.equal(ranking.includes('%'), false, `${locale}: no percentage belongs on this screen`)
  }
})

test('DS-COPY-062 item 1: `Intervalo de sinal` is named for what it measures', () => {
  // The LABEL is what the sweep covers — column head, indicator and `aria-label`. The
  // `<caption>` deliberately uses the word "tempo" to DENY it ("não é tempo de guia nem tempo
  // cobrado"), which is spec §6.2's own wording; see the #741 comment.
  const expected = { pt: 'Intervalo de sinal', en: 'Signal span', es: 'Intervalo de señal' }
  const BORROWED = ['tempo', 'uso', 'duração', 'duration', 'usage', 'tiempo', 'duración']

  for (const locale of LOCALES) {
    const label = messages(locale).Pages.Dashboard.ranking.table.trail_span
    assert.equal(label, expected[locale])
    for (const word of BORROWED) {
      assert.equal(label.toLowerCase().includes(word), false, `${locale}: ${word} in the label`)
    }
  }
})

test('#741: the report title and the menu label exist in the three languages', () => {
  for (const locale of LOCALES) {
    const file = messages(locale)
    assert.equal(typeof file.Navigation.ranking, 'string')
    assert.equal(typeof file.Pages.Dashboard.reports.ranking.title, 'string')
    assert.equal(typeof file.Pages.Dashboard.reports.ranking.subtitle, 'string')
  }
})
