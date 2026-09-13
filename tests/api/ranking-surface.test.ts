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
import { createTranslator } from 'next-intl'
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
  parsePeriodKey,
  parsePeriodParam,
  periodBounds,
  periodKey,
  periodOptions,
  rankDelta,
  rowsForPeriod,
  summarize,
  visibleRows,
  weekOfSelection,
  type PeriodSelection,
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

/**
 * THE KEY OF THE `<select>`, AND THE COLONS INSIDE IT.
 *
 * The view returns the week's start as a full ISO instant, so its key is
 * `week:2026-08-17T00:00:00+00:00` — FOUR colons. The `<select>` cut it with `split(':')` and
 * destructured two pieces, keeping `2026-08-17T00`: not a readable instant, so the selection fell
 * back to `rolling_30d` and the table answered the same numbers for every week, while the label
 * printed `Semana de — a —` (#741).
 */
test('#741: the key of a period survives the round trip, colons and all', () => {
  const selections: PeriodSelection[] = [
    // The format the view actually returns — the offset is part of it.
    { kind: 'week', start: '2026-08-17T00:00:00+00:00' },
    { kind: 'rolling_30d', start: null },
    { kind: 'rolling_90d', start: null },
  ]

  for (const selection of selections) {
    assert.deepEqual(
      parsePeriodKey(periodKey(selection)),
      selection,
      `${periodKey(selection)} does not come back as it went`
    )
  }
})

test('#741: the week key of the `<select>` never lands on the default window', () => {
  const selection = parsePeriodKey('week:2026-08-17T00:00:00+00:00')

  // The regression itself: picking a week and being served the 30-day window.
  assert.notEqual(selection.kind, 'rolling_30d')
  assert.deepEqual(selection, { kind: 'week', start: '2026-08-17T00:00:00+00:00' })

  // A key that names no period, and a week with no start, DO fall back — the same ruler
  // `parsePeriodParam` already applies, because guessing which week was meant is the one answer
  // that looks right and is not.
  assert.deepEqual(parsePeriodKey('week:'), { kind: 'rolling_30d', start: null })
  assert.deepEqual(parsePeriodKey('week:terça'), { kind: 'rolling_30d', start: null })
  assert.deepEqual(parsePeriodKey('all'), { kind: 'rolling_30d', start: null })

  // And the screen reads the key through its owner. This assertion is on the SOURCE because the
  // defect lived in an `onChange` that no test without a DOM can fire, and the shape of the
  // mistake — cutting the key at the call site — is exactly what is worth forbidding.
  const page = source('app/[locale]/dashboard/reports/ranking/page.tsx')
  assert.ok(page.includes('parsePeriodKey(event.target.value)'), 'the `<select>` parses the key')
  assert.ok(!page.includes("split(':')"), 'an ISO instant carries colons; the naive split is back')
})

test('#741: the week picked in the `<select>` is labelled with two dates, never with the em dash', () => {
  const week = weekOfSelection(parsePeriodKey('week:2026-08-17T00:00:00+00:00'))
  assert.ok(week, 'an unreadable start produces no week, and no week produces no dates')

  const bounds = periodBounds(week)
  const date = new Intl.DateTimeFormat('pt', {
    day: '2-digit',
    month: '2-digit',
    timeZone: 'UTC',
  })

  const t = createTranslator({
    locale: 'pt',
    messages: messages('pt'),
    namespace: 'Pages.Dashboard.ranking',
  })
  const label = t('period.week' as never, {
    start: date.format(bounds.start),
    end: date.format(bounds.endInclusive),
  } as never)

  // The end is INCLUSIVE: the week of 17/08 ends on 23/08 (contract, Parte 7).
  assert.equal(label, 'Semana de 17/08 a 23/08 · UTC')
  assert.ok(!label.includes(UNKNOWN_VALUE), 'the label printed `—` on both ends before the fix')
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

  // `Visitas sem trigger point` had the same two-redaction problem, one key each — the card and
  // the expanded row now read `kpi.indeterminate`, and `row.indeterminate` is gone.
  for (const locale of LOCALES) {
    const ranking = messages(locale).Pages.Dashboard.ranking
    assert.equal(
      'indeterminate' in ranking.row,
      false,
      `${locale}: the indeterminate label has one owner, and it is the indicator's key`
    )
  }
  assert.equal(
    (component.match(/t\('kpi\.indeterminate'\)/g) ?? []).length,
    2,
    'the indicator and the expanded row read the same key'
  )
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

// ── The band that must not lie, and the counts that must agree in number ──────────────────

/**
 * #754 — THE FAIXA AFFIRMS WHAT WAS COUNTED, AND NOTHING ELSE (spec §2.2, amended 2026-09-13).
 *
 * `N` is `countInternalAccounts` over the rows the VIEW returned, which is the right count for
 * "is the filter removing anybody from this scoreboard?" — and it is the count the operator's
 * decision kept, because the alternative costs an extra read of `drive.profiles` per load. What
 * was wrong was the sentence: "nenhuma conta está marcada" is a claim about `drive.profiles`,
 * and a marked account with no activity in the horizon leaves `N = 0` with #740 applied. The
 * band exists to stop the screen from showing an unfiltered scoreboard wearing the face of a
 * filtered one; it cannot be the place where the screen lies.
 */
test('#754: the band claims only what the read counted, never the state of drive.profiles', () => {
  const FORBIDDEN = [
    'nenhuma conta está marcada',
    'no account is marked',
    'ninguna cuenta está marcada',
  ]
  const SCOPED = { pt: 'nesta consulta', en: 'in this read', es: 'en esta consulta' }

  for (const locale of LOCALES) {
    const internal = messages(locale).Pages.Dashboard.ranking.internal
    const band = internal.none_marked.toLowerCase()

    for (const claim of FORBIDDEN) {
      assert.equal(band.includes(claim), false, `${locale}: the read cannot assert "${claim}"`)
    }
    assert.ok(band.includes(SCOPED[locale]), `${locale}: the band names the population it counted`)
    // Where the mark is put stays in the sentence: the operator has to know where to go.
    assert.ok(band.includes('excluded_from_metrics'), `${locale}: the mark keeps its address`)
    assert.ok(
      internal.marked.includes(SCOPED[locale]),
      `${locale}: "N marked" is scoped to the same read the band is`
    )
  }
})

test('#754: with a count of one, the three counted labels print the singular', () => {
  const expected = {
    pt: {
      'internal.marked': ['1 conta marcada nesta consulta', '2 contas marcadas nesta consulta'],
      'kpi.accounts': ['1 conta', '2 contas'],
      'table.totals': ['1 linha', '2 linhas'],
    },
    en: {
      'internal.marked': ['1 account marked in this read', '2 accounts marked in this read'],
      'kpi.accounts': ['1 account', '2 accounts'],
      'table.totals': ['1 row', '2 rows'],
    },
    es: {
      'internal.marked': ['1 cuenta marcada en esta consulta', '2 cuentas marcadas en esta consulta'],
      'kpi.accounts': ['1 cuenta', '2 cuentas'],
      'table.totals': ['1 fila', '2 filas'],
    },
  }

  for (const locale of LOCALES) {
    // The SAME formatter the screen uses: the plural is ICU, resolved by `next-intl`, and a
    // hand-rolled `count === 1 ? a : b` in the component would be a second ruler for grammar.
    const t = createTranslator({
      locale,
      messages: messages(locale),
      namespace: 'Pages.Dashboard.ranking',
    })

    for (const [key, [one, two]] of Object.entries(expected[locale])) {
      assert.equal(t(key as never, { count: 1 } as never), one, `${locale}: ${key} at one`)
      assert.equal(t(key as never, { count: 2 } as never), two, `${locale}: ${key} at two`)
    }
  }
})

// ── The refusal the screen is allowed to name ─────────────────────────────────────────────

/**
 * #755 — `42501` IS READ FROM `code`, NEVER FROM THE MESSAGE.
 *
 * `PostgrestError` carries the SQLSTATE in `code` and the prose in `message` — `permission
 * denied for view ranking_scoreboard`, with no number in it — so `message.includes('42501')`
 * was a branch that could not be taken and `error.forbidden` was an orphan key in the three
 * languages. `lib/credit/errors.ts` · `classifyLedgerError` is the repo's own precedent.
 */
test('#755: the two ranking screens pick the phrase by the SQLSTATE, not by the message text', () => {
  for (const file of [
    'components/dashboard/reports/RankingScoreboard.tsx',
    'components/dashboard/reports/RankingSessionMetering.tsx',
  ]) {
    const component = source(file)
    assert.match(
      component,
      /error\.code === '42501'/,
      `${file}: the code is what names the refusal`
    )
    assert.equal(
      /error\.includes\(/.test(component),
      false,
      `${file}: the message never carries the number, so matching its text is a dead branch`
    )
    assert.match(component, /t\('error\.forbidden'\)/, `${file}: the phrase has a caller again`)
  }

  // And the routes are what put it in the body — without this the screens would compare
  // `undefined` forever.
  for (const route of [
    'app/api/dashboard/ranking/route.ts',
    'app/api/dashboard/ranking/sessions/route.ts',
  ]) {
    assert.match(source(route), /code: error\.code/, `${route}: the SQLSTATE leaves the route`)
  }
})
