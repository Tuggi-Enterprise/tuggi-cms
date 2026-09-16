/**
 * #742 — THE TWO COMPOSED CYCLES, THE CALIBRATION OF THE KM AXIS, AND THE SECOND BOUNDARY.
 *
 * Spec: `docs/design/spec-placar-cms-2026-09.md`, §9 "Critério de pronto", criteria 25 to 39.
 * What has to be seen in a browser lives in `tests/ct/ranking-cycles.spec.tsx`; what can be
 * answered without a DOM is here — the period vocabulary, the two instrument boundaries, the
 * counterfactual of the panel, and the copy.
 *
 * THREE THINGS THIS FILE EXISTS TO CATCH, and each one is a way the screen could lie:
 *
 * 1. **A kilometre printed under the MINUTE boundary.** The two ledgers open five days apart, so
 *    a period between 13/08 and 18/08 has the km `full` and the minute `none` at the same time —
 *    and a test that does not look at the date passes either way (criterion 37).
 * 2. **A composed cycle wearing the weekly cycle's chrome.** `Pontos` in `month` is a sum over
 *    the podium weeks, not the formula of the period; a seal there would assert a prize band no
 *    rule defines, on a product that emits no prize at all (criteria 28, 29, 30).
 * 3. **A prize promised in a string.** **BR-RANKING-006** item 1: no surface may state, suggest or
 *    imply that the scoreboard pays anything, and the CMS is a surface.
 *
 * Run with: npm run test:api
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

import { UNKNOWN_VALUE } from '../../lib/format/unknown'
import {
  ENTITLEMENT_LEDGER_START,
  METERING_LEDGER_START,
  kmCoverage,
  meteringCoverage,
} from '../../lib/ranking/metering'
import {
  DEFAULT_PERIOD_KIND,
  PERIOD_KINDS,
  PODIUM_POINTS_FLOOR,
  formatMonthOfCycle,
  hasAnchoredStart,
  isComposedCycle,
  parsePeriodKey,
  parsePeriodParam,
  periodKey,
  periodNature,
  periodOfSelection,
  sealCycle,
  yearOfCycle,
  type PeriodKind,
  type PeriodSelection,
  type RankingRow,
} from '../../lib/ranking/scoreboard'

const REPO_ROOT = resolve(import.meta.dirname, '../..')
const source = (path: string) => readFileSync(resolve(REPO_ROOT, path), 'utf8')
const messages = (locale: string) =>
  JSON.parse(source(`messages/${locale}.json`)) as Record<string, any>

const LOCALES = ['pt', 'en', 'es'] as const

const SCOREBOARD = 'components/dashboard/reports/RankingScoreboard.tsx'
const PAGE = 'app/[locale]/dashboard/reports/ranking/page.tsx'
const ROUTE = 'app/api/dashboard/ranking/route.ts'

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
    visits_indeterminate: 0,
    visits_manual: 0,
    charged_minutes: 0,
    story_days: 4,
    has_full_week_streak: false,
    streak_multiplier: 1,
    points_from_triggers: 10,
    points_from_minutes: 0,
    points_official: 11.1,
    rank_official: 1,
    rank_excluding_internal: 1,
    points_notable_weighted: 13,
    rank_notable_weighted: 1,
    trail_span_minutes: 90,
    metering_gap_minutes: 90,
    sessions_with_trail: 2,
    sessions_charged: 0,
    top_country_code: 'BR',
    km_with_entitlement: 10,
    points_from_km: 1.1,
    podium_components: null,
    ...overrides,
  }
}

// ── The five windows, and the two natures ──────────────────────────────────────────────────

/**
 * #742 · BR-RANKING-005 · DS-COMPONENTE-089 item 1 — FIVE WINDOWS, TWO SPECIES.
 *
 * `week`, `month` and `year` are cycles of the product: roster, floor and podium. The two rolling
 * windows never were competition (**BR-RANKING-001** item 5) and exist to check a number. The
 * nature has ONE owner, which is what keeps the `<optgroup>` and the stamp beside the numbers
 * from ever disagreeing (criterion 25).
 */
test('#742 · BR-RANKING-005 · DS-COMPONENTE-089 item 1: five windows, two natures, one owner', () => {
  assert.deepEqual(PERIOD_KINDS, ['week', 'month', 'year', 'rolling_30d', 'rolling_90d'])

  const natures = Object.fromEntries(PERIOD_KINDS.map((kind) => [kind, periodNature(kind)]))
  assert.deepEqual(natures, {
    week: 'competition',
    month: 'competition',
    year: 'competition',
    rolling_30d: 'calibration',
    rolling_90d: 'calibration',
  })

  // `month` and `year` COMPOSE the cycle below them; the other three do not compose anything.
  assert.deepEqual(
    PERIOD_KINDS.filter(isComposedCycle),
    ['month', 'year'],
    'only the two cycles whose `Pontos` is a sum over podium components'
  )

  // The default did NOT move: the screen exists to calibrate and the current week is always half
  // done, so changing it now would be churn with no gain (spec §2.3).
  assert.equal(DEFAULT_PERIOD_KIND, 'rolling_30d')

  // And there is still no aggregating window — `DS-COMPONENTE-082` item 1.
  assert.equal(
    PERIOD_KINDS.some((kind) => (kind as string) === 'all'),
    false
  )
})

/**
 * #742 · DS-COMPONENTE-089 item 1 — THE TWO NEW CYCLES SURVIVE A RELOAD, LIKE A WEEK DOES.
 *
 * `?period=month&start=2026-09-01` has to come back as the month it names (criterion 25). The
 * three anchored kinds go through ONE branch: the parameter used to be three literals, and adding
 * two more copies of the same three lines is how the fourth ends up without the date check.
 */
test('#742 · DS-COMPONENTE-089: month and year survive the URL and the `<select>` round trip', () => {
  const selections: PeriodSelection[] = [
    { kind: 'week', start: '2026-08-31T00:00:00+00:00' },
    { kind: 'month', start: '2026-09-01T00:00:00+00:00' },
    { kind: 'year', start: '2026-01-01T00:00:00+00:00' },
    { kind: 'rolling_30d', start: null },
    { kind: 'rolling_90d', start: null },
  ]

  for (const selection of selections) {
    assert.deepEqual(
      parsePeriodKey(periodKey(selection)),
      selection,
      `${selection.kind} comes back out of its own key`
    )
    assert.deepEqual(
      parsePeriodParam(selection.kind, selection.start),
      selection,
      `${selection.kind} comes back out of the URL`
    )
  }

  // The colon of the ISO instant is inside the key of a month too, and the key is cut at the
  // FIRST one only — the defect of #741 generalised rather than repeated.
  assert.equal(periodKey({ kind: 'month', start: '2026-09-01T00:00:00+00:00' }), 'month:2026-09-01T00:00:00+00:00')

  // An anchored kind with no readable start falls back to the default rather than guessing which
  // month the operator meant: guessing is the one answer that looks right and is not.
  for (const kind of PERIOD_KINDS.filter(hasAnchoredStart)) {
    assert.deepEqual(parsePeriodParam(kind, null), { kind: DEFAULT_PERIOD_KIND, start: null })
    assert.deepEqual(parsePeriodParam(kind, 'terça'), { kind: DEFAULT_PERIOD_KIND, start: null })
  }

  // The end is a consequence of the start and of the calendar, never a second fact: `[start, end)`
  // in UTC for all three (**BR-RANKING-005** item 1).
  assert.equal(
    periodOfSelection({ kind: 'month', start: '2026-09-01T00:00:00+00:00' })?.end,
    '2026-10-01T00:00:00.000Z'
  )
  assert.equal(
    periodOfSelection({ kind: 'year', start: '2026-01-01T00:00:00+00:00' })?.end,
    '2027-01-01T00:00:00.000Z'
  )
  // December's month rolls the year over, and the year rolls with it.
  assert.equal(
    periodOfSelection({ kind: 'month', start: '2026-12-01T00:00:00+00:00' })?.end,
    '2027-01-01T00:00:00.000Z'
  )
  assert.equal(periodOfSelection({ kind: 'rolling_30d', start: null }), null)

  // And the page writes the start of a month into the URL by the same predicate (criterion 25).
  const page = source(PAGE)
  assert.match(page, /hasAnchoredStart\(next\.period\.kind\) && next\.period\.start/)

  /* THE GROUPING IS `<optgroup>`, NOT A COMPONENT — `DS-COMPONENTE-089` item 1, and the label of
     each group comes from `periodNature`, which is also what the stamp beside the numbers reads.
     This is asserted on the source and not in a browser on purpose: the `<select>` lives in the
     PAGE, and this bench cannot mount a page — `proxy.ts` calls `supabase.auth.getUser()` on the
     Next server, out of reach of a browser network hook (`playwright-ct.config.ts`), and the
     first render of the page has no periods yet because the reading has not landed. What a DOM
     could add here is that `<optgroup>` renders, which the HTML Living Standard already
     guarantees; what it could NOT add is that the two groups are the right ones, which
     `periodGroups` above pins. */
  assert.match(page, /<optgroup key=\{group\.nature\} label=\{tr\(`period\.group_\$\{group\.nature\}`\)\}>/)
  assert.equal(
    page.includes("kind === 'rolling_30d' || kind === 'rolling_90d'"),
    false,
    'the nature is never decided a second time inside a component'
  )
  for (const locale of LOCALES) {
    const period = messages(locale).Pages.Dashboard.ranking.period
    for (const key of ['group_competition', 'group_calibration', 'nature_competition', 'nature_calibration']) {
      assert.equal(typeof period[key], 'string', `${locale}: ${key}`)
    }
  }
})

/**
 * #742 · DS-COMPONENTE-085 item 4 — THE MONTH GOES UP IN CAPITALS, AND NOT BY HAND.
 *
 * `Intl` hands back `setembro de 2026` and `septiembre de 2026` in lower case, and one lower-case
 * option in the middle of a capitalised list reads as a defect. The capital is `toLocaleUpperCase`
 * and never `toUpperCase`, which does not respect the locale (criterion 27).
 */
test('#742 · DS-COMPONENTE-085 item 4: the month of a cycle is capitalised in the three locales', () => {
  const september = '2026-09-01T00:00:00+00:00'
  const expected = { pt: 'Setembro de 2026', en: 'September 2026', es: 'Septiembre de 2026' }

  for (const locale of LOCALES) {
    assert.equal(formatMonthOfCycle(september, locale), expected[locale])
  }

  // The zone is UTC because every cycle boundary is: formatting the same instant in a western
  // zone would print August over a month that starts in September.
  assert.equal(formatMonthOfCycle(september, 'pt'), 'Setembro de 2026')
  assert.equal(yearOfCycle('2026-01-01T00:00:00+00:00'), '2026')

  // An unreadable start is the em dash, never a month invented out of `Invalid Date`.
  assert.equal(formatMonthOfCycle('terça', 'pt'), UNKNOWN_VALUE)
  assert.equal(yearOfCycle('terça'), UNKNOWN_VALUE)

  // The capital has ONE owner, and it is locale-aware. `toUpperCase()` in a formatter is right by
  // accident in three locales and wrong in the fourth.
  const scoreboardLib = source('lib/ranking/scoreboard.ts')
  assert.match(scoreboardLib, /toLocaleUpperCase\(locale\)/)
  assert.equal(/\.toUpperCase\(\)/.test(scoreboardLib), false)

  // And the `(corrente)` of the two new cycles is a key of its own in the three languages.
  for (const locale of LOCALES) {
    const period = messages(locale).Pages.Dashboard.ranking.period
    for (const key of ['month', 'month_current', 'year', 'year_current']) {
      assert.equal(typeof period[key], 'string', `${locale}: ${key}`)
    }
    assert.match(period.month, /\{month\}/)
    assert.match(period.year, /\{year\}/)
  }
})

// ── The chrome of a cycle nobody wrote a rule for ──────────────────────────────────────────

/**
 * #742 · BR-RANKING-003 · BR-RANKING-006 · DS-COMPONENTE-089 item 4 — NO SEAL IN `month` NOR IN
 * `year`, and it is a decision (criterion 30).
 *
 * `RankSeal` already draws the three cycles and the two composed ones have a real `rank_official`
 * since `20260916140000`. What they do not have is a RULE: the seal asserts a podium, a podium has
 * a floor, and the only floor written down is the weekly one — **BR-RANKING-003** names itself *o
 * prêmio do ciclo semanal*. Gold on a month would be the screen asserting a prize band nobody
 * defined, on a product that emits no prize at all (**BR-RANKING-006**). The `#` keeps printing
 * the ordinal in all five periods.
 */
test('#742 · BR-RANKING-003 · DS-COMPONENTE-089 item 4: `sealCycle` answers only `week`, over the five kinds', () => {
  const closed = Date.UTC(2026, 8, 21)

  const answers = Object.fromEntries(
    PERIOD_KINDS.map((kind: PeriodKind) => [
      kind,
      sealCycle({ kind, end: '2026-09-14T00:00:00+00:00' }, closed),
    ])
  )

  assert.deepEqual(answers, {
    week: 'week',
    month: null,
    year: null,
    rolling_30d: null,
    rolling_90d: null,
  })

  // Even a closed month, and even the year: the refusal is about the missing rule, not about the
  // cycle being open.
  assert.equal(sealCycle({ kind: 'month', end: '2026-09-01T00:00:00+00:00' }, closed), null)
  assert.equal(sealCycle({ kind: 'year', end: '2026-01-01T00:00:00+00:00' }, closed), null)

  // And the week still refuses while it is open: a podium exists at 8 a.m. on Monday with 0,3
  // point, and a gold seal there stops meaning anything by Tuesday.
  assert.equal(sealCycle({ kind: 'week', end: '2026-09-28T00:00:00+00:00' }, closed), null)
})

/**
 * #742 · BR-RANKING-005 · DS-COMPONENTE-089 item 3 — FOUR COLUMNS IN A COMPOSED CYCLE.
 *
 * `Disparos` summed over the whole month next to `Pontos` drawn only from the podium weeks are two
 * populations on one line: the fraction and the subtraction the operator would do in his head
 * would both be wrong, which is `DS-COMPONENTE-084` item 2 with columns instead of a card. The DOM
 * proof is in the CT suite; what is pinned here is that the branch exists and that the composition
 * header is TWO keys, because the unit changes between the cycles (criterion 28).
 */
test('#742 · BR-RANKING-005: the composed cycles get their own head, row and footer', () => {
  const component = source(SCOREBOARD)

  assert.match(component, /const isComposed = period !== null && isComposedCycle\(period\.kind\)/)
  // The column of the composition, and the two names it takes: `month` counts WEEKS of podium,
  // `year` counts MONTHS, and summing the monthly counters would give another quantity with the
  // same name (contract, Parte 7).
  assert.match(component, /period\?\.kind === 'year' \? t\('table\.podium_months'\) : t\('table\.podium_weeks'\)/)
  // The counter prints the em dash on `null` and never `0`: `0` would read as "no podium", which
  // is false — an account with no podium week has no `month` row at all.
  assert.match(component, /row\.podium_components \?\? UNKNOWN_VALUE/)

  for (const locale of LOCALES) {
    const table = messages(locale).Pages.Dashboard.ranking.table
    assert.equal(typeof table.podium_weeks, 'string', `${locale}: podium_weeks`)
    assert.equal(typeof table.podium_months, 'string', `${locale}: podium_months`)
    assert.notEqual(table.podium_weeks, table.podium_months, `${locale}: two units, two words`)
  }

  // The route reads column 31 rather than deriving it: deriving would cost a second read of a
  // ~2,8 s view and a second podium ruler in the browser (spec §10 item 2, CLAUDE.md §6).
  assert.match(source(ROUTE), /'podium_components'/)
})

/**
 * #742 · BR-RANKING-005 · CLAUDE.md §6 — THE CAPTION DECLARES THE QUANTITY, AND THE FLOOR IS A
 * PLACEHOLDER (criterion 29).
 *
 * A `10` typed into a string is a second owner of a business number: `PODIUM_POINTS_FLOOR` moves
 * and the sentence goes on saying ten in three languages. **The yearly caption names no floor at
 * all, and that is deliberate** — **BR-RANKING-003** is the floor of the WEEK, and a number the
 * rule never wrote would be the screen deciding a prize band (spec §6.9).
 */
test('#742 · BR-RANKING-005: the cycle caption takes the floor by placeholder, and the year names none', () => {
  assert.equal(PODIUM_POINTS_FLOOR, 10)

  for (const locale of LOCALES) {
    const caption = messages(locale).Pages.Dashboard.ranking.caption
    assert.match(caption.cycle_month, /\{floor\}/, `${locale}: the month takes the floor as a parameter`)
    assert.equal(
      /\{floor\}/.test(caption.cycle_year),
      false,
      `${locale}: the yearly cycle has no floor written anywhere`
    )

    // The placeholder is the ONLY source of the number: substitute it and the ten appears;
    // leave it alone and no message of this screen says ten at all (the scan below).
    assert.match(
      (caption.cycle_month as string).replace('{floor}', String(PODIUM_POINTS_FLOOR)),
      /\b10\b/,
      `${locale}: and the sentence does carry the number once the constant fills it`
    )
  }

  // NO `10` IS TYPED INTO ANY STRING OF THIS SCREEN, in any of the three files.
  for (const locale of LOCALES) {
    const strings: string[] = []
    const walk = (node: unknown) => {
      if (typeof node === 'string') strings.push(node)
      else if (node && typeof node === 'object') Object.values(node).forEach(walk)
    }
    walk(messages(locale).Pages.Dashboard.ranking)

    const typed = strings.filter((text) => /\b10\b/.test(text))
    assert.deepEqual(typed, [], `${locale}: the floor is never a literal in a message`)
  }

  // And the component passes it from the constant, never from a number of its own.
  assert.match(source(SCOREBOARD), /floor: PODIUM_POINTS_FLOOR/)
})

// ── The two instruments ────────────────────────────────────────────────────────────────────

/**
 * #742 · DS-COMPONENTE-084 item 1 — TWO BOUNDARIES, AND A PERIOD THAT DISAGREES WITH ITSELF.
 *
 * This is the defect the entry predicted by name (criterion 37): the kilometre hangs on the
 * balance-grant ledger of 13/08 and the minute on the consumption ledger of 18/08, so a window
 * between them has one `full` and the other `none` AT THE SAME TIME. Reusing `meteringCoverage`
 * for a km column passes every test that does not look at the date — this one looks.
 */
test('#742 · DS-COMPONENTE-084 item 1: the km boundary is five days older than the minute one', () => {
  assert.equal(new Date(ENTITLEMENT_LEDGER_START).toISOString(), '2026-08-13T16:11:00.000Z')
  assert.equal(new Date(METERING_LEDGER_START).toISOString(), '2026-08-18T20:41:00.000Z')
  assert.ok(ENTITLEMENT_LEDGER_START < METERING_LEDGER_START)

  // THE PERIOD THAT DISAGREES WITH ITSELF — 14/08 to 17/08.
  const start = '2026-08-14T00:00:00Z'
  const end = '2026-08-17T00:00:00Z'
  assert.equal(kmCoverage(start, end), 'full', 'the grant ledger already exists here')
  assert.equal(meteringCoverage(start, end), 'none', 'and the consumption ledger does not')

  // A week straddling only the older boundary.
  assert.equal(kmCoverage('2026-08-10T00:00:00Z', '2026-08-17T00:00:00Z'), 'partial')
  // And one entirely before both.
  assert.equal(kmCoverage('2026-07-06T00:00:00Z', '2026-07-13T00:00:00Z'), 'none')
  // `period_end` is EXCLUSIVE: a period ending exactly at the first row contains none of it.
  assert.equal(kmCoverage('2026-08-01T00:00:00Z', new Date(ENTITLEMENT_LEDGER_START).toISOString()), 'none')

  // NO PRINTING OF KILOMETRES IS GOVERNED BY THE MINUTE COVERAGE. The two variables are named
  // apart in the component, and `hasMeter` — which answers *is there any measured minute?* —
  // touches no km cell.
  const component = source(SCOREBOARD)
  assert.match(component, /const kmCov = meteredPeriod \? kmCoverage\(/)
  assert.equal(
    /hasMeter \? [^\n]*points_from_km/.test(component),
    false,
    'the km points column is not gated by the minute meter'
  )
  assert.equal(
    /hasMeter[^\n]*km_with_entitlement/.test(component),
    false,
    'nor is the kilometre of the expanded row'
  )
  // And the two functions are two callers of one body, not two copies of the comparison.
  const metering = source('lib/ranking/metering.ts')
  assert.equal((metering.match(/if \(end <= boundary\) return 'none'/g) ?? []).length, 1)
})

/**
 * #742 · DS-COMPONENTE-084 item 1 — THE TWO BANDS TAKE THE DATE FROM THE CONSTANT (criterion 39).
 *
 * A date typed inside a sentence is a second owner of a fact the code already has, and it ages in
 * silence. The km band also says something the minute band never says: the POINTS of the period
 * are a floor, because the kilometre is a parcel of `points_official` (**BR-RANKING-004**).
 */
test('#742 · DS-COMPONENTE-084 item 1: the km bands carry `{date}`, never a date of their own', () => {
  const FLOOR_SAYS_POINTS = { pt: /pontos deste período são mínimos/i, en: /points of this period are minimums/i, es: /puntos de este período son mínimos/i }

  for (const locale of LOCALES) {
    const meter = messages(locale).Pages.Dashboard.ranking.meter
    for (const key of ['km_floor', 'km_partial']) {
      assert.match(meter[key], /\{date\}/, `${locale}: ${key} takes the boundary as a parameter`)
      assert.equal(
        /\d{2}\/\d{2}\/\d{4}|\d{4}-\d{2}-\d{2}/.test(meter[key]),
        false,
        `${locale}: ${key} writes no date of its own`
      )
    }
    assert.match(meter.km_floor, FLOOR_SAYS_POINTS[locale], `${locale}: the floor reaches the points`)
  }

  const component = source(SCOREBOARD)
  assert.match(component, /kmCov === 'none' \? 'meter\.km_floor' : 'meter\.km_partial'/)
  assert.match(component, /format\(new Date\(ENTITLEMENT_LEDGER_START\)\)/)
})

// ── The copy ───────────────────────────────────────────────────────────────────────────────

/**
 * #742 · DS-COPY-062 item 5 — THE CONDITION IS `acesso`, AND THE COLUMN IS NOT A DISTANCE
 * (criterion 38).
 *
 * `km_with_entitlement` is not the kilometre driven: it is the kilometre with the guide ON and
 * with ACCESS, and 17,2 % of the kilometre driven with the guide on carried no access and is not
 * in it. Between two correct synonyms the label takes the one the surface already uses — `acesso`,
 * 24 strings of the CMS — and not the one of the data model, `direito`, whose only two strings in
 * the repository were this column's. And never `acesso pago`: `unlimited` granted by the CMS is
 * access and is not a purchase.
 */
test('#742 · DS-COPY-062 item 5: the km label names access, never distance and never a purchase', () => {
  const FORBIDDEN = [
    'Km rodados',
    'Km percorridos',
    'Distância',
    'Distance',
    'Kilometres driven',
    'Km recorridos',
    'Distancia',
    'acesso pago',
    'paid access',
    'acceso pagado',
  ]
  const CONDITION = { pt: 'com acesso', en: 'with access', es: 'con acceso' }
  const MODEL_WORD = { pt: /direito/i, en: /entitlement/i, es: /derecho/i }

  for (const locale of LOCALES) {
    const ranking = messages(locale).Pages.Dashboard.ranking
    const strings: string[] = []
    const walk = (node: unknown) => {
      if (typeof node === 'string') strings.push(node)
      else if (node && typeof node === 'object') Object.values(node).forEach(walk)
    }
    walk(ranking)

    for (const term of FORBIDDEN) {
      const hits = strings.filter((text) => text.includes(term))
      assert.deepEqual(hits, [], `${locale}: "${term}" promises a quantity the column does not measure`)
    }

    // The definitive label of column 29, and the condition inside it.
    assert.ok(
      (ranking.row.km_with_entitlement as string).includes(CONDITION[locale]),
      `${locale}: the label carries the condition, in the word the surface already uses`
    )

    // The vocabulary of the data model appears in NO label of this screen, in any of the three.
    const labels = [
      ...Object.values(ranking.table),
      ...Object.values(ranking.row),
      ...Object.values(ranking.kpi),
      ...Object.values(ranking.calibration),
    ] as string[]
    const modelWords = labels.filter((text) => MODEL_WORD[locale].test(text))
    assert.deepEqual(modelWords, [], `${locale}: no label speaks the data model's word`)
  }
})

/**
 * #742 · BR-RANKING-006 — THE CMS DOES NOT PROMISE A PRIZE, TO THE TOURIST OR TO THE OPERATOR.
 *
 * Determined by the operator on 2026-09-16 and it is one assertion: *"ainda não daremos prêmio,
 * vamos ver como performa"*. **BR-RANKING-006** item 1 — no surface may state, suggest or imply
 * that the scoreboard pays anything, and the ledger has no prize origin at all (item 5: the six
 * values of `time_credit_grants.source` do not include one, and no prize hour was ever emitted).
 * The seal of position is expressly NOT covered by this (item 3): it is internal display of a
 * position on a surface the Tuggi operates, and the symbol suspended by item 1 is the Passport's.
 */
test('#742 · BR-RANKING-006: no message of the CMS asserts that the scoreboard pays anything', () => {
  /* `premium` and `premissa` are not prizes, and the CMS has plenty of both — the word this rule
     is about is the noun and the verb of awarding, in the three languages. */
  const PRIZE = /pr[êe]mi[oa]|premiaç|premiad|prize|reward|recompensa|hora[s]? gr[áa]tis|free hour|hora[s]? gratis/i

  for (const locale of LOCALES) {
    const offending: string[] = []
    const walk = (node: unknown, path: string) => {
      if (typeof node === 'string') {
        if (PRIZE.test(node)) offending.push(`${path} = ${node}`)
      } else if (node && typeof node === 'object') {
        for (const [key, value] of Object.entries(node)) walk(value, path ? `${path}.${key}` : key)
      }
    }
    walk(messages(locale), '')

    assert.deepEqual(offending, [], `${locale}: a prize promised in a string is a promise the product cannot honour`)
  }
})
