/**
 * How the Overview map draws a state — the three rules `design` wrote over #732.
 *
 * The two treatments this file pins were both **provisional** in the first pass, and both were
 * refused with a measurement behind the refusal. What comes back if nobody is watching is not
 * a bug in a function: it is a line of markup. So part of this suite reads the source of the
 * two files that carry the treatment. That is deliberate, and it is the same check the spec
 * itself states as the criterion of done (`docs/design/spec-mapa-do-painel-2026-09.md`, §5).
 *
 * - **DS-MAPA-026** — a window is a question with a name. Three of them, three questions, and
 *   only the one that decides the word "live" is allowed to be called that.
 * - **DS-MAPA-027** — emphasis on a dense map is static. No animation loop.
 * - **DS-MAPA-028** — temporal state is drawn by shape. Opacity is not a channel when the
 *   colour carries a fact.
 *
 * Run with: npm run test:api
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import { PIN_GEOMETRY, PIN_PATH_D, pinSvg } from '@/lib/dashboard/map-pin-icon'
import {
  LIVE_SIGNAL_MAX_AGE_SECONDS,
  POSITION_SOURCE_WINDOW_SEC,
  RADAR_FEED_WINDOW_SEC,
} from '@/lib/dashboard/time-windows'
import { CHART_NEUTRAL, CHROME_GRAY, ENTITLEMENT_COLOR } from '@/lib/constants/chart-colors'

const source = (relative: string) => readFileSync(join(process.cwd(), relative), 'utf8')

const MAP_COMPONENT = 'components/ui/GoogleMapComponent.tsx'
const LEGEND_ITEM = 'components/dashboard/MapLegendItem.tsx'
const OVERVIEW_PAGE = 'app/[locale]/dashboard/page.tsx'
const RADAR_PAGE = 'app/[locale]/dashboard/realtime/page.tsx'
const SERVICE = 'lib/services/dashboard-service.ts'

// ---------------------------------------------------------------- DS-MAPA-028

test('DS-MAPA-028: the archived pin is hollow — same path, same size, same anchor', () => {
  const filled = pinSvg(ENTITLEMENT_COLOR.metered)
  const hollow = pinSvg(ENTITLEMENT_COLOR.metered, { dimmed: true })

  // Shape is the channel, so everything that is not the fill has to be identical: a hollow pin
  // that also shrank would be competing with the size channel, which belongs to the guide.
  assert.ok(filled.includes(`d="${PIN_PATH_D}"`), 'the filled pin must use the shared path')
  assert.ok(hollow.includes(`d="${PIN_PATH_D}"`), 'the hollow pin must use the SAME path')
  assert.ok(hollow.includes(`width="${PIN_GEOMETRY.base.size}"`), 'same size as the filled pin')
  assert.ok(hollow.includes('viewBox="0 0 24 24"'), 'same viewBox, so the anchor keeps meaning')
})

test('DS-MAPA-028: the colour survives archiving — full strength in the stroke', () => {
  for (const [state, color] of Object.entries(ENTITLEMENT_COLOR)) {
    const hollow = pinSvg(color, { dimmed: true })

    assert.ok(hollow.includes(`stroke="${color}"`), `${state} must keep its hue at full strength`)
    assert.ok(hollow.includes('stroke-width="1.6"'), `${state}: the outline is what carries the colour`)
    assert.ok(hollow.includes('fill="#ffffff"'), `${state}: the body is white, not a faded hue`)
  }
})

test('DS-MAPA-028: archiving never fades the marker — no opacity on the pin itself', () => {
  // The measurement that refused 45 %: orange fell from 2,47:1 to 1,54:1 over the default land
  // tile and the three product states stopped being distinguishable from each other. What is
  // forbidden is the `opacity` attribute on the marker; `fill-opacity` on the halo is a
  // different thing and stays (DS-MAPA-027 keeps it as one of the three static channels).
  for (const svg of [
    pinSvg(ENTITLEMENT_COLOR.free),
    pinSvg(ENTITLEMENT_COLOR.free, { dimmed: true }),
    pinSvg(ENTITLEMENT_COLOR.free, { active: true }),
  ]) {
    assert.ok(!/[^-]opacity="/.test(svg), 'a faded pin loses the colour, which is the fact')
  }

  assert.ok(
    !/\bopacity\s*[:=]/.test(source(MAP_COMPONENT).split('const buildIcon')[1].split('const glideTo')[0]),
    'buildIcon must not reintroduce an opacity channel',
  )
})

test('DS-MAPA-028: the legend sample mirrors the pin, and borrows no colour that means something else', () => {
  const legend = source(LEGEND_ITEM)

  assert.ok(legend.includes('inset 0 0 0 2px'), 'the `dim` sample is hollow, not faded')
  assert.ok(!/opacity:\s*(dim|0\.45)/.test(legend), 'a 10 px square at 45 % is a key nobody can read')

  // On this very map grey is `unknown` — a column that did not arrive. A treatment sample
  // wearing it would teach the operator the opposite of what the pins say.
  const overviewLegend = source(OVERVIEW_PAGE).split('<MapLegendItem')
  assert.ok(overviewLegend.length > 1, 'the Overview legend must still exist')
  for (const entry of overviewLegend.slice(1)) {
    assert.ok(!entry.slice(0, 200).includes('CHART_NEUTRAL'), 'treatment samples must not wear the `unknown` grey')
  }
  assert.notEqual(CHROME_GRAY, CHART_NEUTRAL, 'chrome grey exists precisely because it is not the `unknown` grey')
})

test('DS-MAPA-028: the legend fills by column — who on one side, state on the other', () => {
  const legendBlock = source(OVERVIEW_PAGE).split('<MapLegendItem')[0].split('absolute bottom-3 left-3').pop() ?? ''

  assert.ok(legendBlock.includes('grid-flow-col'), 'filling by row interleaves the two axes')
  assert.ok(legendBlock.includes('grid-rows-5'), 'five rows: the five entries of the "who" column')

  const entries = source(OVERVIEW_PAGE).split('<MapLegendItem').slice(1).map((e) => e.split('/>')[0])
  assert.equal(entries.length, 7, 'five "who" entries and two "state" entries — `unknown` gets no row')
  assert.ok(entries[5].includes('guide_on') && entries[6].includes('signal_archived'), 'the state column comes last, in order')
})

// ---------------------------------------------------------------- DS-MAPA-027

test('DS-MAPA-027: no bouncing marker — BOUNCE runs until it is explicitly set to null', () => {
  const map = source(MAP_COMPONENT)

  assert.ok(!map.includes('Animation.BOUNCE'), 'a perpetual loop on a panel somebody watches for eight hours')
  assert.ok(!map.includes('setAnimation('), 'and no marker animation state at all')
})

test('DS-MAPA-027: emphasis is static — size, halo, outline, stack order', () => {
  const active = pinSvg(ENTITLEMENT_COLOR.unlimited, { active: true })
  const base = pinSvg(ENTITLEMENT_COLOR.unlimited)

  assert.equal(PIN_GEOMETRY.active.size, 32)
  assert.equal(PIN_GEOMETRY.base.size, 24)
  assert.ok(active.includes('fill-opacity="0.25"'), 'the halo of its own hue is the second static channel')
  assert.ok(active.includes('stroke="#ffffff"'), 'and the white outline is the third')
  assert.ok(!/<animate/.test(active) && !/<animate/.test(base), 'nothing in the marker moves by itself')
  assert.ok(source(MAP_COMPONENT).includes('zIndex: isActive ? 1000 : 1'), 'stack order stays the fourth channel')
})

test('DS-MAPA-027: the legend does not animate what the map does not animate', () => {
  const legend = source(LEGEND_ITEM)

  // The green pin (`livePinAppearance`) is `active: false` — a still pin. The sample pulsed.
  assert.ok(!legend.includes('animate-pulse'), 'a pulsing sample beside a still pin is a broken contract')
  assert.ok(!/\bpulse\b\s*[?:,}]/.test(legend.split('export function')[1] ?? ''), 'the prop goes, rather than staying unused')
  assert.ok(!source(OVERVIEW_PAGE).split('<MapLegendItem').slice(1).some((e) => e.split('/>')[0].includes('pulse')))
})

// ---------------------------------------------------------------- DS-MAPA-026

test('DS-MAPA-026: three windows, three questions, and only one of them is "live"', () => {
  const windows = {
    LIVE_SIGNAL_MAX_AGE_SECONDS,
    POSITION_SOURCE_WINDOW_SEC,
    RADAR_FEED_WINDOW_SEC,
  }

  for (const [name, value] of Object.entries(windows)) {
    assert.ok(Number.isInteger(value) && value > 0, `${name} must be a whole number of seconds`)
  }

  // Different values are the point, not the defect: presence, coordinate choice and feed are
  // three questions. What may not exist is a second ruler deciding the word "live".
  const named = Object.keys(windows).filter((name) => /LIVE|REALTIME/.test(name))
  assert.deepEqual(named, ['LIVE_SIGNAL_MAX_AGE_SECONDS'], 'only the liveness cut may be named after liveness')

  assert.ok(POSITION_SOURCE_WINDOW_SEC < LIVE_SIGNAL_MAX_AGE_SECONDS, 'the coordinate window is the short one, and it is not liveness')
  assert.ok(RADAR_FEED_WINDOW_SEC > LIVE_SIGNAL_MAX_AGE_SECONDS, 'the feed window is sized by its list, not by presence')
})

test('DS-MAPA-026: the 300 s cut is documented by what holds it, not by the clamp', () => {
  const windows = source('lib/dashboard/time-windows.ts')

  assert.equal(LIVE_SIGNAL_MAX_AGE_SECONDS, 300)
  assert.ok(!windows.includes('PROVISIONAL'), 'the value is decided; a provisional marker would invite a silent change')
  // The clamp is a skew limit, not a staleness limit. It may be cited as the noise inside the
  // input — it may not be cited as the origin of the number.
  assert.ok(!/ceiling of the .drive.insert_location_batch. clamp/.test(windows), 'the clamp is not where 300 comes from')
})

test('DS-MAPA-026: no window is a literal at the call site, and none is a parameter default', () => {
  const calls = [source(OVERVIEW_PAGE), source(RADAR_PAGE)]
    .flatMap((file) => file.split('getRealtimeActivity(').slice(1))
    .map((tail) => tail.split(')')[0])

  assert.equal(calls.length, 2, 'the two callers of the presence RPC')
  for (const arg of calls) {
    assert.ok(!/^\s*\d/.test(arg), `a window typed into a call has no name: getRealtimeActivity(${arg})`)
  }

  const signature = source(SERVICE).split('static async getRealtimeActivity(')[1].split(')')[0]
  assert.ok(!signature.includes('='), 'a default nobody passes is a fourth number waiting to be wrong')
})
