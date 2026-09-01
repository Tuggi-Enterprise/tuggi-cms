/**
 * The guarantees of the credit surface that a running route cannot prove — card #310.
 *
 * Everything here is either pure arithmetic or a scan of the files the card created. The
 * scans exist because each one names a defect that type-checking and linting let through:
 * a product amount hard-coded in a component, a business number restated in the client, a
 * `window.confirm`, a locale key that only exists in Portuguese, a colour that fails AA.
 *
 * Run with: npm run test:api
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, readdirSync } from 'node:fs'
import { join, resolve } from 'node:path'
import {
  formatDuration,
  nearestBlockValues,
  MINUTE_OPTIONS,
  MINUTES_PER_BLOCK,
} from '@/lib/format/duration'
import { classifyLedgerError, creditErrorStatus } from '@/lib/credit/errors'
import { tierGrantsAccess } from '@/lib/credit/tiers'
import {
  isRetryable,
  periodWasStacked,
  retryTargets,
  type RunResult,
} from '@/components/admin/credit/outcome'
import type { GrantTarget } from '@/components/admin/credit/types'

const ROOT = resolve(import.meta.dirname, '../..')
const COMPONENT_DIR = join(ROOT, 'components/admin/credit')
const ROUTE_DIR = join(ROOT, 'app/api/admin/users/[userId]/credit')

/**
 * Strips comments before scanning. Without this the scans read the prose that explains
 * them — the header of `DialogShell` names `window.confirm` to say it is not used, and
 * `lib/credit/errors.ts` names the cap to say it is not restated. A static ruler that
 * reads its own explanation fails on the file that documents it best.
 */
function codeOnly(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/(^|[^:])\/\/[^\n]*/g, '$1')
}

function readAll(dir: string): Array<[string, string]> {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name)
    return entry.isDirectory()
      ? readAll(path)
      : [[path.slice(ROOT.length + 1), codeOnly(readFileSync(path, 'utf-8'))] as [string, string]]
  })
}

const CREDIT_SOURCES = [...readAll(COMPONENT_DIR), ...readAll(ROUTE_DIR)]

// ---------------------------------------------------------------------------
// Spec §11 item 5 — the format has one owner
// ---------------------------------------------------------------------------

test('formatDuration produces the four shapes of the spec, with the space', () => {
  assert.equal(formatDuration(320), '5 h 20 min')
  assert.equal(formatDuration(45), '45 min')
  assert.equal(formatDuration(720), '12 h')
  assert.equal(formatDuration(0), '0 min')
})

test('formatDuration never returns an empty string for an unusable input', () => {
  for (const value of [null, undefined, Number.NaN, -30]) {
    assert.equal(formatDuration(value as number), '0 min')
  }
})

// ---------------------------------------------------------------------------
// BR-MONETIZACAO-049 / DS-COMPONENTE-012 — the control prevents, it does not validate
// ---------------------------------------------------------------------------

test('BR-MONETIZACAO-049: the minutes control offers exactly 12 options, all whole blocks', () => {
  assert.equal(MINUTE_OPTIONS.length, 12)
  assert.deepEqual([...MINUTE_OPTIONS], [0, 5, 10, 15, 20, 25, 30, 35, 40, 45, 50, 55])
  for (const option of MINUTE_OPTIONS) {
    assert.equal(option % MINUTES_PER_BLOCK, 0)
  }
})

test('DS-COMPONENTE-012: no reachable combination of the controls forms a non-multiple', () => {
  for (let hours = 0; hours <= 100; hours += 1) {
    for (const minutes of MINUTE_OPTIONS) {
      const total = hours * 60 + minutes
      assert.equal(total % MINUTES_PER_BLOCK, 0, `${hours} h ${minutes} min = ${total}`)
    }
  }
})

test('nearestBlockValues brackets an amount the form could not have produced', () => {
  assert.deepEqual(nearestBlockValues(118), { lower: 115, upper: 120 })
  assert.deepEqual(nearestBlockValues(1), { lower: 0, upper: 5 })
})

// ---------------------------------------------------------------------------
// Spec §11 item 6 — the catalogue and the cap are not restated in the client
// ---------------------------------------------------------------------------

test('BR-MONETIZACAO-048: no product amount is written into the credit surface', () => {
  for (const [path, source] of CREDIT_SOURCES) {
    for (const amount of ['600', '1500', '1_500', '2700', '2_700']) {
      assert.equal(
        new RegExp(`\\b${amount}\\b`).test(source),
        false,
        `${path} restates the catalogue amount ${amount}; its owner is drive.product_grant_map`
      )
    }
  }
})

test('BR-MONETIZACAO-063: the cap is never a constant on this side', () => {
  const errorModule = codeOnly(readFileSync(join(ROOT, 'lib/credit/errors.ts'), 'utf-8'))
  assert.equal(/\b2700\b/.test(errorModule), false)
  // …and it is read back from the exception text instead, which is the one owner.
  const classified = classifyLedgerError(
    {
      code: 'TGM63',
      message: 'concessão de 3000 minutos passa do teto de 2700 minutos por ato',
    },
    'grant'
  )
  assert.equal(classified.code, 'above_cap')
  assert.equal(classified.capMinutes, 2700)
})

// ---------------------------------------------------------------------------
// Refusals are classified by SQLSTATE, and a message never crosses
// ---------------------------------------------------------------------------

test('the two quantity refusals are told apart without reading the message', () => {
  assert.equal(classifyLedgerError({ code: 'TGM49', message: '' }, 'grant').code, 'not_multiple')
  assert.equal(classifyLedgerError({ code: 'TGM63', message: '' }, 'grant').code, 'above_cap')
  assert.equal(classifyLedgerError({ code: '42501', message: '' }, 'grant').code, 'forbidden')
  assert.equal(classifyLedgerError({ code: 'P0002', message: '' }, 'read').code, 'no_profile')
})

test('22023 stays unknown whatever step raised it', () => {
  // It means nine different things inside `drive.record_time_credit_grant`, and the one
  // reading that used to be given a message — "the period was not applied yet" — ordered
  // the operator to apply a period that, at that point in the flow, is already committed.
  // Applying it again stacks it (BR-MONETIZACAO-065), so the message is gone and no step
  // buys the classifier a guess between the nine.
  for (const step of ['read', 'grant', 'revoke', 'apply_period'] as const) {
    assert.equal(classifyLedgerError({ code: '22023', message: '' }, step).code, 'unknown', step)
  }
})

test('a classified refusal carries no prose from the database', () => {
  const classified = classifyLedgerError(
    { code: 'P0002', message: 'grant_time_credit: perfil 11111111-2222 inexistente.' },
    'grant'
  )
  assert.equal(JSON.stringify(classified).includes('perfil'), false)
  assert.equal(JSON.stringify(classified).includes('11111111'), false)
})

test('each refusal has the HTTP status the contract states', () => {
  assert.equal(creditErrorStatus({ code: 'forbidden' }), 403)
  assert.equal(creditErrorStatus({ code: 'no_profile' }), 404)
  assert.equal(creditErrorStatus({ code: 'not_multiple' }), 400)
  assert.equal(creditErrorStatus({ code: 'above_cap' }), 400)
  assert.equal(creditErrorStatus({ code: 'already_revoked' }), 409)
})

// ---------------------------------------------------------------------------
// Spec §11 items 19–20 / DS-COMPONENTE-014 — who the retry button sends again
//
// The rule is about behaviour, not about the sentence: the screen already told the
// operator to check the history first, and then offered a button that resent the very
// recipient it had just warned about.
// ---------------------------------------------------------------------------

function person(id: string): GrantTarget {
  // BR-USUARIO-042: a target carries a `nickname`, never a full name.
  return { userId: id, nickname: `person-${id}`, email: `${id}@example.com` }
}

function outcomeRow(target: GrantTarget, retryable: boolean, ok = false): RunResult {
  return { target, ok, retryable, message: '' }
}

test('BR-MONETIZACAO-047: an answer that never came is not retryable, a refusal is', () => {
  // A refusal arrived with a response, so nothing was written and sending it again is
  // correction. A `fetch` that threw proves nothing: the grant is not idempotent, and the
  // ledger may already hold the row.
  assert.equal(isRetryable({ kind: 'refused', code: 'not_multiple' }), true)
  assert.equal(isRetryable({ kind: 'no_answer' }), false)
  assert.equal(isRetryable({ kind: 'granted' }), false)
})

test('BR-MONETIZACAO-065: "period applied, row missing" reads as itself, never as errors.unknown', async () => {
  const { creditFailureText } = await import('@/components/admin/credit/errorText')

  // `errors.unknown` prints the SQLSTATE and says the detail is in the server log: true,
  // and useless to the one operator who has to be told NOT to grant again.
  assert.equal(
    creditFailureText((key) => key, { code: 'period_applied_no_record', sqlstate: '22023' }),
    'errors.period_applied_no_record'
  )

  for (const locale of ['pt', 'en', 'es']) {
    const messages = JSON.parse(readFileSync(join(ROOT, 'messages', `${locale}.json`), 'utf-8'))
    const sentence: string = messages.Pages.AppUsers.credit.errors.period_applied_no_record

    // No placeholder: the refusal envelope carries no date, and the call passes no values —
    // an interpolation here would render as literal braces on the screen.
    assert.equal(/\{\w+\}/.test(sentence), false, `${locale}: interpolates a value nobody passes`)

    // Five sentences, and each one has a job the others do not do: the period WAS applied,
    // only the record failed, do not grant again because it stacks, this grant will not
    // show in the history, the audit log is where to look. The fourth is the one that gets
    // trimmed as redundant and is not — `errors.network` trains the operator to check the
    // history before repeating, and here the history is empty on purpose, so an operator
    // who checks concludes it failed and grants a second period.
    assert.ok(
      sentence.split('.').filter((part) => part.trim().length > 0).length >= 5,
      `${locale}: a sentence was dropped — each of the five says something the others do not`
    )
  }
})

test('BR-MONETIZACAO-065: "period applied, row missing" is refused a second attempt', () => {
  // It arrives WITH a response, so the shape alone would make it retryable — and repeating
  // it stacks the access period instead of recording the missing row.
  assert.equal(isRetryable({ kind: 'refused', code: 'period_applied_no_record' }), false)
})

test('a batch of two, one timed out and one refused, offers to retry exactly one', () => {
  const timedOut = person('timeout')
  const refused = person('refused')
  const results = [outcomeRow(timedOut, false), outcomeRow(refused, true)]

  const again = retryTargets(results, [])

  assert.deepEqual(
    again.map((target) => target.userId),
    ['refused'],
    'the uncertain recipient is the one path by which this screen grants twice'
  )
})

test('an individual grant that timed out ends with no retry path at all', () => {
  assert.deepEqual(retryTargets([outcomeRow(person('alone'), false)], []), [])
})

test('DS-COMPONENTE-014: whoever was already granted in this dialog is never sent again', () => {
  const granted = person('granted')
  const refused = person('refused')
  const results = [outcomeRow(granted, false, true), outcomeRow(refused, true)]

  assert.deepEqual(
    retryTargets(results, ['granted']).map((target) => target.userId),
    ['refused']
  )
})

test('the dialog builds its retry list only through retryTargets', () => {
  const dialog = codeOnly(readFileSync(join(COMPONENT_DIR, 'GrantCreditDialog.tsx'), 'utf-8'))
  assert.equal((dialog.match(/retryTargets\(/g) ?? []).length, 1)
  // The shape that produced the defect: everyone who is not `ok`, sent again.
  assert.equal(
    /filter\(\s*\(\s*result\s*\)\s*=>\s*!result\.ok\s*\)\s*\.\s*map/.test(dialog),
    false,
    'the retry list is being rebuilt from "not ok" instead of from the outcome'
  )
})

test('an unreadable body is treated as no answer, not as a refusal', async () => {
  // A Vercel gateway timeout answers 504 with an HTML page. It carries a status code, so
  // it does not go through the `catch`, and without this flag it looked like a refusal.
  const { readFailure } = await import('@/components/admin/credit/errorText')
  const html = new Response('<html>gateway timeout</html>', { status: 504 })

  assert.equal((await readFailure(html)).unreadable, true)
  assert.equal(
    (await readFailure(new Response(JSON.stringify({ error: { code: 'no_profile' } }), { status: 404 })))
      .unreadable,
    undefined
  )
})

// ---------------------------------------------------------------------------
// BR-MONETIZACAO-065 / DS-COMPONENTE-013 — the result names the stacking
// ---------------------------------------------------------------------------

test('BR-MONETIZACAO-065: stacking is decided by the dates as displayed, not by instants', () => {
  const asDate = (iso: string) => new Date(iso).toISOString().slice(0, 10)

  // The route asks for a duration in whole days counted from now, so the instants almost
  // never coincide — comparing them would light the warning on every single grant.
  assert.equal(
    periodWasStacked('2026-09-12T23:59:59.000Z', '2026-09-12T14:03:11.000Z', asDate),
    false
  )
  assert.equal(
    periodWasStacked('2026-09-12T23:59:59.000Z', '2026-10-30T14:03:11.000Z', asDate),
    true
  )
  assert.equal(periodWasStacked(null, '2026-10-30T14:03:11.000Z', asDate), false)
})

// ---------------------------------------------------------------------------
// The licence a period may be written on
// ---------------------------------------------------------------------------

test('BR-MONETIZACAO-046: a period is never written on a licence that grants no access', () => {
  // The published app resolves the right by name — `tierName !== "free" && notExpired`
  // (docs/contracts/entitlement.md) — so a period on `free` shows Ilimitado here and
  // delivers nothing there.
  assert.equal(tierGrantsAccess('free'), false)
  assert.equal(tierGrantsAccess(' Free '), false)
  assert.equal(tierGrantsAccess('premium'), true)
  assert.equal(tierGrantsAccess('pro'), true)
  // Unknown is refused, not assumed: the two answers have the same cost for the tourist.
  assert.equal(tierGrantsAccess(null), false)
  assert.equal(tierGrantsAccess(''), false)
})

test('the licence list on screen and the refusal on the server ask the same question', () => {
  const dialog = codeOnly(readFileSync(join(COMPONENT_DIR, 'GrantCreditDialog.tsx'), 'utf-8'))
  const route = codeOnly(readFileSync(join(ROUTE_DIR, 'route.ts'), 'utf-8'))
  for (const [path, source] of [
    ['GrantCreditDialog.tsx', dialog],
    ['route.ts', route],
  ] as const) {
    assert.match(source, /tierGrantsAccess\(/, `${path} does not use the shared predicate`)
    assert.equal(
      /['"]free['"]/.test(source),
      false,
      `${path} restates the licence name; its owner is lib/credit/tiers.ts`
    )
  }
})

// ---------------------------------------------------------------------------
// Spec §11 items 16, 24, 28, 31
// ---------------------------------------------------------------------------

test('window.confirm appears nowhere in the surface this card created', () => {
  for (const [path, source] of CREDIT_SOURCES) {
    assert.equal(source.includes('window.confirm'), false, path)
    assert.equal(/(^|[^.\w])confirm\(/.test(source), false, path)
  }
})

test('the usage tab renders no trail — no coordinate, POI, city, country or map', () => {
  // Two halves, because a trail could arrive either as a field of the envelope or as a
  // component on the screen. `.map(` is array iteration and is not evidence of either.
  const contract = codeOnly(readFileSync(join(COMPONENT_DIR, 'types.ts'), 'utf-8'))
  for (const field of ['latitude', 'longitude', 'lat', 'lng', 'poi', 'city', 'country']) {
    assert.equal(
      new RegExp(`\\b${field}\\b`, 'i').test(contract),
      false,
      `the ledger envelope declares "${field}" — usage history is a sequence of sessions`
    )
  }

  for (const [path, source] of readAll(COMPONENT_DIR)) {
    for (const token of [
      'latitude',
      'longitude',
      'GoogleMap',
      'MapComponent',
      'leaflet',
      'mapbox',
      'coordinate',
      'trip_session',
    ]) {
      assert.equal(new RegExp(token, 'i').test(source), false, `${path} renders "${token}"`)
    }
  }
})

test('no new component uses the brand blue as text on a light surface', () => {
  for (const [path, source] of readAll(COMPONENT_DIR)) {
    assert.equal(/text-tuggi-blue/.test(source), false, path)
    assert.equal(/className="[^"]*\btext-primary\b/.test(source), false, path)
  }
})

test('BR-MONETIZACAO-047: no component writes drive.profiles, and no route writes it directly', () => {
  for (const [path, source] of CREDIT_SOURCES) {
    assert.equal(/from\(['"]profiles['"]\)/.test(source), false, path)
    assert.equal(/\.update\(/.test(source), false, path)
  }
})

test('the old direct-write door is gone', () => {
  const routes = readdirSync(join(ROOT, 'app/api/admin/users/[userId]'))
  assert.equal(
    routes.includes('subscription'),
    false,
    'PATCH .../subscription wrote drive.profiles with service_role — a second writer of the balance and of subscription_end_date'
  )
})

// ---------------------------------------------------------------------------
// Spec §11 item 27 — the destructive token has to pass AA **on the screen**
//
// The first version of these tests read the triplet out of `app/globals.css` and measured
// it. That passed while the revoke button rendered navy with yellow tint (card #329): the
// browser does not paint the triplet, it paints what the wrapper in `tailwind.config.js`
// makes of it, and that wrapper was `hsl()` over an RGB declaration. So the resolution
// below models what the browser does with each wrapper, and every assertion is made on the
// resolved colour.
//
// The model was confirmed in Chromium on 2026-08-14, on the CSS compiled from this
// repository (`npx tailwindcss -i app/globals.css`), reading `getComputedStyle` off the
// markup of `ui/button.tsx` and `ui/input.tsx`: with `hsl()` the button measured
// rgb(60, 85, 134) on rgb(255, 255, 0) and the field measured rgb(255, 255, 0); with
// `rgb()` they measure rgb(220, 38, 38) on white and rgb(247, 249, 250).
// ---------------------------------------------------------------------------

type Rgb = [number, number, number]

function channel(value: number): number {
  const srgb = value / 255
  return srgb <= 0.03928 ? srgb / 12.92 : ((srgb + 0.055) / 1.055) ** 2.4
}

function luminance([r, g, b]: Rgb): number {
  return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b)
}

function contrast(a: Rgb, b: Rgb): number {
  const [high, low] = [luminance(a), luminance(b)].sort((x, y) => y - x)
  return (high + 0.05) / (low + 0.05)
}

const WHITE: Rgb = [255, 255, 255]

/**
 * `hsl(220 38 38)` as Chromium resolves it: hue in degrees, the other two as percentages,
 * **without clamping the inputs** — the out-of-range values are carried through the
 * conversion and only the resulting channels are clamped. That is why
 * `hsl(255 255 255)` comes out yellow instead of white, which is what turned
 * `--destructive-foreground` into rgb(255, 255, 0) on the revoke button.
 */
function hslToRgb([h, s, l]: Rgb): Rgb {
  const sat = s / 100
  const light = l / 100
  const c = (1 - Math.abs(2 * light - 1)) * sat
  const hp = (((h % 360) + 360) % 360) / 60
  const x = c * (1 - Math.abs((hp % 2) - 1))
  const m = light - c / 2
  const [r, g, b] =
    hp < 1 ? [c, x, 0]
    : hp < 2 ? [x, c, 0]
    : hp < 3 ? [0, c, x]
    : hp < 4 ? [0, x, c]
    : hp < 5 ? [x, 0, c]
    : [c, 0, x]
  return [r, g, b].map((value) =>
    Math.round(Math.min(1, Math.max(0, value + m)) * 255)
  ) as Rgb
}

function readToken(block: string, token: string): Rgb {
  const match = new RegExp(`--${token}:\\s*(\\d+)\\s+(\\d+)\\s+(\\d+)`).exec(block)
  assert.ok(match, `--${token} not found`)
  return [Number(match[1]), Number(match[2]), Number(match[3])]
}

/** The colour function `tailwind.config.js` wraps a token in — `rgb`, `hsl`, or none. */
function wrapperOf(config: string, token: string): string {
  const match = new RegExp(`(\\w+)\\(var\\(--${token}\\)`).exec(config)
  assert.ok(match, `--${token} is not consumed by tailwind.config.js`)
  return match[1]
}

/** What the browser paints for a token: the declaration read through its wrapper. */
function painted(config: string, block: string, token: string): Rgb {
  const triplet = readToken(block, token)
  const wrapper = wrapperOf(config, token)
  if (wrapper === 'rgb') return triplet
  if (wrapper === 'hsl') return hslToRgb(triplet)
  assert.fail(`--${token} is wrapped in ${wrapper}(), which this test cannot resolve`)
}

const TAILWIND_CONFIG = readFileSync(join(ROOT, 'tailwind.config.js'), 'utf-8')
const GLOBALS = readFileSync(join(ROOT, 'app/globals.css'), 'utf-8')
const LIGHT = GLOBALS.slice(0, GLOBALS.indexOf('.dark {'))
const DARK = GLOBALS.slice(GLOBALS.indexOf('.dark {'))

test('every token tailwind consumes reaches the screen as the colour globals.css declares', () => {
  // Not a style preference: `hsl()` over an RGB triplet does not fail, it succeeds with a
  // different colour, and nothing in the build says so.
  for (const token of [
    'background',
    'foreground',
    'muted',
    'muted-foreground',
    'accent',
    'accent-foreground',
    'destructive',
    'destructive-foreground',
    'destructive-hover',
  ]) {
    for (const [theme, block] of [
      ['light', LIGHT],
      ['dark', DARK],
    ] as const) {
      assert.deepEqual(
        painted(TAILWIND_CONFIG, block, token),
        readToken(block, token),
        `${theme}: --${token} is declared as ${readToken(block, token).join(' ')} and painted as ` +
          `${painted(TAILWIND_CONFIG, block, token).join(' ')} — the wrapper in tailwind.config.js changes the colour`
      )
    }
  }
})

test('WCAG 2.2 SC 1.4.3 AA: the destructive button measures at least 4.5:1 as painted', () => {
  for (const [theme, block] of [
    ['light', LIGHT],
    ['dark', DARK],
  ] as const) {
    const background = painted(TAILWIND_CONFIG, block, 'destructive')
    const tint = painted(TAILWIND_CONFIG, block, 'destructive-foreground')
    assert.deepEqual(tint, WHITE, `${theme}: the tint of the destructive button is not white`)
    const ratio = contrast(tint, background)
    assert.ok(
      ratio >= 4.5,
      `${theme}: the destructive button measures ${ratio.toFixed(2)}:1, AA needs 4.5:1`
    )
  }
})

test('SC 1.4.3 AA is not left behind on hover, and hover darkens instead of lightening', () => {
  // `/90` composes with whatever is behind the button: over the white of a dialog it
  // lightened to #E03C3C = 4.32:1, in the state the operator is in while reading it.
  for (const [theme, block] of [
    ['light', LIGHT],
    ['dark', DARK],
  ] as const) {
    const rest = painted(TAILWIND_CONFIG, block, 'destructive')
    const hover = painted(TAILWIND_CONFIG, block, 'destructive-hover')
    const ratio = contrast(WHITE, hover)
    assert.ok(ratio >= 4.5, `${theme}: hover measures ${ratio.toFixed(2)}:1, AA needs 4.5:1`)
    assert.ok(
      luminance(hover) < luminance(rest),
      `${theme}: hover is lighter than rest, so it is opacity over a light surface again`
    )
  }
})

test('the destructive button reaches the hover token, and never through opacity', () => {
  const button = codeOnly(readFileSync(join(ROOT, 'components/ui/button.tsx'), 'utf-8'))
  assert.match(button, /hover:bg-destructive-hover/)
  assert.equal(
    /hover:bg-destructive\/\d+/.test(button),
    false,
    'hover:bg-destructive/NN composes with the surface behind the button'
  )
})

test('the input field paints the surface it declares, and its placeholder passes AA on it', () => {
  const field = painted(TAILWIND_CONFIG, LIGHT, 'background')
  const placeholder = painted(TAILWIND_CONFIG, LIGHT, 'muted-foreground')
  const ratio = contrast(placeholder, field)
  assert.ok(
    ratio >= 4.5,
    `the placeholder of Input measures ${ratio.toFixed(2)}:1 on the field, AA needs 4.5:1`
  )
})

// ---------------------------------------------------------------------------
// Spec §11 item 30 — the same keys in the three locales
// ---------------------------------------------------------------------------

function creditKeys(locale: string): string[] {
  const messages = JSON.parse(readFileSync(join(ROOT, 'messages', `${locale}.json`), 'utf-8'))
  const credit = messages?.Pages?.AppUsers?.credit
  assert.ok(credit, `Pages.AppUsers.credit missing in ${locale}.json`)
  return Object.entries(credit)
    .flatMap(([group, entries]) => Object.keys(entries as object).map((key) => `${group}.${key}`))
    .sort()
}

test('Pages.AppUsers.credit carries the same keys in pt, en and es', () => {
  const pt = creditKeys('pt')
  assert.deepEqual(creditKeys('en'), pt)
  assert.deepEqual(creditKeys('es'), pt)
  assert.ok(pt.length > 100)
})

test('no credit string is empty, and none cites a rule ID at the operator', () => {
  for (const locale of ['pt', 'en', 'es']) {
    const messages = JSON.parse(readFileSync(join(ROOT, 'messages', `${locale}.json`), 'utf-8'))
    const credit = messages.Pages.AppUsers.credit
    for (const [group, entries] of Object.entries(credit)) {
      for (const [key, value] of Object.entries(entries as Record<string, string>)) {
        assert.ok(value.trim().length > 0, `${locale}: ${group}.${key} is empty`)
        assert.equal(
          /BR-[A-Z]+-\d+|DS-[A-Z]+-\d+/.test(value),
          false,
          `${locale}: ${group}.${key} shows a rule ID to the operator`
        )
      }
    }
  }
})

test('h and min are identical across the three locales — they do not translate', () => {
  for (const locale of ['pt', 'en', 'es']) {
    const messages = JSON.parse(readFileSync(join(ROOT, 'messages', `${locale}.json`), 'utf-8'))
    assert.equal(messages.Pages.AppUsers.credit.form.add_hours, '+{hours} h')
  }
})

test('BR-MONETIZACAO-063: the cap refusal states both units, like every other number here', () => {
  // The operator types hours and the cap comes back in minutes: the refusal is the one
  // moment they would have to convert in their head.
  for (const locale of ['pt', 'en', 'es']) {
    const messages = JSON.parse(readFileSync(join(ROOT, 'messages', `${locale}.json`), 'utf-8'))
    const aboveCap: string = messages.Pages.AppUsers.credit.errors.above_cap
    assert.match(aboveCap, /\{duration\}/, `${locale}: errors.above_cap does not say the hours`)
    assert.match(aboveCap, /\{cap\}/, `${locale}: errors.above_cap does not say the minutes`)
  }
})

test('the state field of the panel has a label of its own, not the section heading', () => {
  const panel = codeOnly(readFileSync(join(COMPONENT_DIR, 'CreditPanel.tsx'), 'utf-8'))
  assert.match(panel, /t\('panel\.state'\)/)
  assert.equal(
    (panel.match(/t\('panel\.title'\)/g) ?? []).length,
    1,
    'panel.title labels the section heading; a second use is a field wearing the heading'
  )
})

test('the three keys the stacking case needs exist, and each one is rendered', () => {
  // A key with no call site is a decision that was written and never shown — the state
  // `revoke.done` is already in, and it is not a shape to grow.
  const rendered = readAll(COMPONENT_DIR)
    .map(([, source]) => source)
    .join('\n')
  for (const key of [
    'confirm.until_stacks_warning',
    'result.granted_until_stacked',
    'batch.until_stacks_note',
  ]) {
    const [group, name] = key.split('.')
    for (const locale of ['pt', 'en', 'es']) {
      const messages = JSON.parse(readFileSync(join(ROOT, 'messages', `${locale}.json`), 'utf-8'))
      assert.ok(messages.Pages.AppUsers.credit[group]?.[name], `${locale}: ${key} is missing`)
    }
    assert.ok(rendered.includes(`'${key}'`), `${key} has no call site on the screen`)
  }
})

test('the network refusal tells the operator to check before retrying', () => {
  for (const locale of ['pt', 'en', 'es']) {
    const messages = JSON.parse(readFileSync(join(ROOT, 'messages', `${locale}.json`), 'utf-8'))
    const network: string = messages.Pages.AppUsers.credit.errors.network
    // It is the only path by which a non-idempotent grant is made twice by accident.
    assert.ok(network.length > 60, `${locale}: errors.network is too short to say what to do`)
  }
})
