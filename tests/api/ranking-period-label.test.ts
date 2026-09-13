/**
 * #741 — THE LABEL OF THE SELECTED PERIOD ON THE FIRST RENDER, BEFORE THE READING ARRIVES.
 *
 * The field defect: `?period=week&start=…` in the URL, reload, and the screen dies with
 * `FORMATTING_ERROR: The intl string context variable "start" was not provided` — the label of
 * the selection was taken from `payload.periods`, which on the first render is empty, and the
 * fallback called `period.week` (a key with two parameters) with none.
 *
 * So the repro here is exactly that and nothing else: ONE render, with no `payload`, with a week
 * in the URL. `useEffect` does not run in `renderToStaticMarkup`, which is what makes the first
 * render reproducible without a browser and without faking the service — the screen is rendered
 * as the operator got it, and the only thing mocked is the router, because there is none.
 *
 * THE ASSERTION IS ON THE RENDERED TEXT, and it has to be. Outside the dev overlay next-intl
 * 4.7 does not throw and does not even call `onError` for a missing ICU variable: it hands back
 * the message with `{start}` and `{end}` unreplaced. So the defect the operator saw as a red
 * `FORMATTING_ERROR` is, to this renderer, an `<option>` reading literally
 * `Semana de {start} a {end} · UTC` — checked, and it is what these tests failed on before the fix.
 *
 * Run with: npm run test:api  (or `npx tsx --experimental-test-module-mocks --test
 * tests/api/ranking-period-label.test.ts`)
 */

import { test, mock } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { NextIntlClientProvider } from 'next-intl'

const REPO_ROOT = resolve(import.meta.dirname, '../..')
const ptMessages = JSON.parse(
  readFileSync(resolve(REPO_ROOT, 'messages/pt.json'), 'utf8')
) as Record<string, unknown>

/** What the URL carries on this render — read by the mocked `useSearchParams`. */
let searchParams = new URLSearchParams()

mock.module('next/navigation', {
  namedExports: {
    useRouter: () => ({ replace: () => {}, push: () => {}, refresh: () => {} }),
    usePathname: () => '/pt/dashboard/reports/ranking',
    useSearchParams: () => searchParams,
  },
})

async function renderFirstPaint(query: string): Promise<string> {
  searchParams = new URLSearchParams(query)
  const { default: RankingReportPage } = await import(
    '@/app/[locale]/dashboard/reports/ranking/page'
  )

  // `children` goes in the props object, and the two gates disagree about it: the provider's own
  // props type declares `children` as REQUIRED, so `createElement`'s third argument leaves `tsc`
  // with a missing property, while `react/no-children-prop` wants the third argument. The type
  // error is the one that cannot be argued with, so the lint rule is the one that is silenced —
  // and only here, on this call. A `.tsx` would dissolve it, but `test:api` globs `*.test.ts`.
  return renderToStaticMarkup(
    // eslint-disable-next-line react/no-children-prop
    createElement(NextIntlClientProvider, {
      locale: 'pt',
      messages: ptMessages,
      timeZone: 'UTC',
      children: createElement(RankingReportPage),
    })
  )
}

/** The Monday 00:00 UTC of the week that contains `now` — the one `period.week_current` names. */
function currentWeekStart(now = new Date()): Date {
  const midnight = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate())
  const sinceMonday = (new Date(midnight).getUTCDay() + 6) % 7
  return new Date(midnight - sinceMonday * 86_400_000)
}

const dayMonth = (date: Date) =>
  new Intl.DateTimeFormat('pt', { day: '2-digit', month: '2-digit', timeZone: 'UTC' }).format(date)

test('#741: a week pasted in the URL is labelled on the first render, with no reading', async () => {
  // The repro: the URL gives back the week, the reading has not arrived, `payload` is `null`.
  const html = await renderFirstPaint('period=week&start=2026-08-31')

  // The boundary printed is INCLUSIVE: `period_end` is exclusive (contract, Parte 7), so the week
  // of 31/08 ends on 06/09 and a label reading `07/09` would claim a day it does not contain.
  assert.match(html, /Semana de 31\/08 a 06\/09 · UTC/)

  // And it is the `<select>`'s own option, so the control shows the week that is being queried
  // instead of falling back to whatever sits first in the list.
  assert.match(html, /<option value="week:2026-08-31"[^>]*>Semana de 31\/08 a 06\/09 · UTC<\/option>/)
})

test('#741: the current week keeps its own key on the first render', async () => {
  const start = currentWeekStart()
  const endInclusive = new Date(start.getTime() + 6 * 86_400_000)
  const iso = start.toISOString().slice(0, 10)

  const html = await renderFirstPaint(`period=week&start=${iso}`)

  // `period.week_current` is a DIFFERENT key from `period.week`, and it is chosen by comparing
  // the boundaries with `now` — a comparison that used to need the option the reading brings.
  assert.match(
    html,
    new RegExp(`Semana de ${dayMonth(start)} a ${dayMonth(endInclusive)} \\(corrente\\) · UTC`)
  )
})

test('#741: the two rolling windows still print their own label, and are the default', async () => {
  assert.match(await renderFirstPaint('period=rolling_90d'), /Últimos 90 dias/)

  // No period in the URL is the 30-day window (spec §2.1) — the screen exists to calibrate, and
  // the current week is always half done.
  assert.match(await renderFirstPaint(''), /Últimos 30 dias/)
})
