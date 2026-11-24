/**
 * #993 — `places-report-close`: the cycle report is frozen, gets the site block from GA4, is
 * published, and the owner gets one e-mail (BR-B2B-059 items 3, 4, 5 and 7e). Contract:
 * `docs/contracts/places-cms.md` (workspace).
 *
 * The run (`_shared/places-report-close.ts`) takes the database, GA4 and Resend as arguments, so it
 * runs here against an in-memory table and a GA4 double. The GA4 client (`_shared/ga4-data.ts`) runs
 * with a key generated here and a fetch double. Deno source, loaded through a path built at run
 * time: a static `.ts` import fails the repo's `tsc`.
 *
 * Run with: npm run test:api
 */

import { test, before } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

const FUNCTIONS = resolve(import.meta.dirname, '../../supabase/functions')

// Untyped on purpose: a `typeof import` would pull the `.ts` sibling imports into `tsc` (TS5097).
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Mod = any
let close: Mod
let ga4: Mod

before(async () => {
  close = await import(pathToFileURL(resolve(FUNCTIONS, '_shared/places-report-close.ts')).href)
  ga4 = await import(pathToFileURL(resolve(FUNCTIONS, '_shared/ga4-data.ts')).href)
})

const ORIGIN = 'https://partner.tuggi.app'
const BAIRES = 'aaaaaaaa-0000-4000-8000-000000000001'
const ANCHO = 'aaaaaaaa-0000-4000-8000-000000000002'
const LONE = 'aaaaaaaa-0000-4000-8000-000000000003'
const POI_BAIRES = 'bbbbbbbb-0000-4000-8000-000000000001'
const POI_ANCHO = 'bbbbbbbb-0000-4000-8000-000000000002'
const POI_LONE = 'bbbbbbbb-0000-4000-8000-000000000003'
const FESTIVAL = 'cccccc11-0000-4000-8000-000000000001'
const FESTIVAL_PATH = '/pt/tours/brazil/rota-do-festival-sabores-de-cabo-frio-2026'
/** The day 21 at 06:00 in Brasília, when the cron runs. */
const RUN_AT = new Date('2026-10-21T09:00:00Z')

type Row = {
  submission_id: string
  cycle_end: string
  period_from: string
  plan: string
  payload: Record<string, unknown>
  published_at: string | null
  email_sent_at: string | null
}

const PAYLOADS: Record<string, Record<string, unknown>> = {
  [BAIRES]: { city: { name: 'Cabo Frio', narrations_played: 201, partners_live: 34 }, door: { m100: 18, m300: 25, m1000: 65 }, place: { reached: 40 }, compare: { reached_pct: 116 } },
  [ANCHO]: { city: { name: 'Cabo Frio', narrations_played: 201 }, door: { m300: 7 }, compare: { page_views_pct: 428 } },
  [LONE]: { city: { name: 'Búzios' }, door: { m1000: 3 } },
}
const PLANS: Record<string, string> = { [BAIRES]: 'paid', [ANCHO]: 'free', [LONE]: 'free' }

/** GA4 double: users per path regex, cities of the Festival page. */
type Ga4Call = { pathPattern: string; from: string; to: string; byCity?: boolean }
function ga4Double(opts: { festival?: number; baires?: number; cities?: { city: string; users: number }[]; throws?: boolean } = {}) {
  const calls: Ga4Call[] = []
  const fn = async (q: Ga4Call) => {
    calls.push(q)
    if (opts.throws) throw new Error('ga4_report_429')
    const re = new RegExp(q.pathPattern)
    if (q.byCity) return re.test(FESTIVAL_PATH) ? (opts.cities ?? []).filter((c) => c.users > 0) : []
    const users = re.test(FESTIVAL_PATH) ? (opts.festival ?? 0) : re.test('/d/baires') || re.test('/pt/d/baires-bistro') ? (opts.baires ?? 0) : 0
    return users > 0 ? [{ city: null, users }] : []
  }
  return { calls, fn }
}

const CITIES = [
  { city: 'Rio de Janeiro', users: 188 },
  { city: '(not set)', users: 51 },
  { city: 'São Paulo', users: 85 },
  { city: 'Porto Alegre', users: 33 },
  { city: 'Cabo Frio', users: 20 },
]

function world(opts: { ga4?: ReturnType<typeof ga4Double> | null; failSendTo?: string; claimTaken?: string; computeError?: boolean; noRecipient?: string } = {}) {
  const table: Row[] = []
  const log = {
    computes: [] as string[],
    publishes: [] as { cycleEnd: string; site: Record<string, unknown> }[],
    sent: [] as { to: string; subject: string; html: string; text: string }[],
    alerts: [] as string[],
    releases: 0,
  }
  const deps = {
    compute: async (cycleEnd: string) => {
      log.computes.push(cycleEnd)
      if (opts.computeError) return { data: null, error: { code: '42501' } }
      let n = 0
      for (const id of [BAIRES, ANCHO, LONE]) {
        if (table.some((r) => r.submission_id === id && r.cycle_end === cycleEnd)) continue
        table.push({ submission_id: id, cycle_end: cycleEnd, period_from: close.cycleStart(cycleEnd), plan: PLANS[id], payload: PAYLOADS[id], published_at: null, email_sent_at: null })
        n++
      }
      return { data: n, error: null }
    },
    publish: async (cycleEnd: string, site: Record<string, unknown>) => {
      log.publishes.push({ cycleEnd, site })
      let n = 0
      for (const r of table) {
        if (r.cycle_end !== cycleEnd || r.published_at) continue
        if (site[r.submission_id]) r.payload = { ...r.payload, site: site[r.submission_id] }
        r.published_at = '2026-10-21T09:00:05Z'
        n++
      }
      return { data: n, error: null }
    },
    cycleRows: async (cycleEnd: string) =>
      table
        .filter((r) => r.cycle_end === cycleEnd)
        .map((r) => ({
          submissionId: r.submission_id,
          periodFrom: r.period_from,
          plan: r.plan,
          cityName: ((r.payload.city as { name?: string }) ?? {}).name ?? null,
          hasCompare: !!r.payload.compare,
          publishedAt: r.published_at,
          emailSentAt: r.email_sent_at,
        })),
    liveTargets: async () => [
      { submissionId: BAIRES, cityName: 'Cabo Frio' },
      { submissionId: LONE, cityName: 'Armação dos Búzios' },
    ],
    placeRefs: async (ids: string[]) =>
      new Map(
        ids.map((id) => [
          id,
          {
            [BAIRES]: { attractionId: POI_BAIRES, ownSlugs: ['baires', 'baires-bistro'], placeName: 'Baires Bistrô' },
            [ANCHO]: { attractionId: POI_ANCHO, ownSlugs: ['ancho-e-faca'], placeName: 'Ancho e Faca' },
            [LONE]: { attractionId: POI_LONE, ownSlugs: [], placeName: '' },
          }[id],
        ]),
      ),
    publishedRoutes: async () => [
      {
        id: FESTIVAL,
        name: 'Rota do Festival Sabores de Cabo Frio 2026',
        country: 'Brasil',
        metadata: null,
        waypoints: JSON.stringify([
          { metadata: { attraction_id: POI_BAIRES } },
          { attraction_id: POI_ANCHO.toUpperCase() },
          { metadata: { attraction_id: POI_LONE, is_generic: true } },
          { name: 'Praia do Forte' },
        ]),
      },
      { id: 'dddddd22-0000-4000-8000-000000000002', name: 'Sem país', country: null, metadata: {}, waypoints: [{ metadata: { attraction_id: POI_LONE } }] },
    ],
    ga4: opts.ga4 === undefined ? ga4Double({ festival: 357, baires: 14, cities: CITIES }).fn : opts.ga4 === null ? null : opts.ga4.fn,
    claimEmail: async (submissionId: string, cycleEnd: string) => {
      if (opts.claimTaken === submissionId) return null
      const r = table.find((x) => x.submission_id === submissionId && x.cycle_end === cycleEnd)
      if (!r || !r.published_at || r.email_sent_at) return null
      r.email_sent_at = `2026-10-21T09:00:0${table.indexOf(r)}.5Z`
      return r.email_sent_at
    },
    releaseEmail: async (submissionId: string, cycleEnd: string, claimedAt: string) => {
      const r = table.find((x) => x.submission_id === submissionId && x.cycle_end === cycleEnd)
      if (r && r.email_sent_at === claimedAt) {
        r.email_sent_at = null
        log.releases++
      }
    },
    recipient: async (submissionId: string) => (submissionId === opts.noRecipient ? null : `dono-${submissionId.slice(-1)}@example.com`),
    sendEmail: async (to: string, mail: { subject: string; html: string; text: string }) => {
      if (to === opts.failSendTo) return false
      log.sent.push({ to, ...mail })
      return true
    },
    alert: async (what: string) => {
      log.alerts.push(what)
    },
    pause: async () => {},
    origin: ORIGIN,
    now: () => RUN_AT,
  }
  return { table, log, deps }
}

// ─── the request and the cycle ───────────────────────────────────────────────────────────────

test('#993: empty body (the cron) is the last closed cycle, e-mail on, for real', () => {
  assert.deepEqual(close.parseCloseRequest(''), { cycleEnd: null, sendEmail: true, dryRun: false })
  assert.deepEqual(close.parseCloseRequest('{}'), { cycleEnd: null, sendEmail: true, dryRun: false })
  assert.deepEqual(close.parseCloseRequest('{"cycle_end":"2026-09-20","send_email":false,"dry_run":true}'), { cycleEnd: '2026-09-20', sendEmail: false, dryRun: true })
})

test('#993: a typo, a cycle that is not a day 20 or a body that is not JSON is refused, never run for real', () => {
  for (const raw of ['{"dryrun":true}', '{"cycle_end":"2026-10-21"}', '{"cycle_end":"2026-13-20"}', '{"send_email":"no"}', '{"dry_run":1}', '[1]', 'null', '{dry_run:true']) {
    assert.equal(close.parseCloseRequest(raw), null, raw)
  }
})

test('BR-B2B-059 item 3: the last closed cycle is the day 20 whose day is over in Brasília', () => {
  assert.equal(close.latestClosedCycleEnd(RUN_AT), '2026-10-20')
  assert.equal(close.latestClosedCycleEnd(new Date('2026-10-21T02:59:00Z')), '2026-09-20')
  assert.equal(close.latestClosedCycleEnd(new Date('2026-10-21T03:00:00Z')), '2026-10-20')
  assert.equal(close.latestClosedCycleEnd(new Date('2027-01-10T12:00:00Z')), '2026-12-20')
  assert.equal(close.cycleStart('2026-10-20'), '2026-09-21')
  assert.equal(close.cycleStart('2027-01-20'), '2026-12-21')
})

test('BR-B2B-059 items 3 and 5: an open cycle and one before 2026-09-20 are refused, with nothing written', async () => {
  for (const [body, error] of [
    ['{"cycle_end":"2026-11-20"}', 'cycle_not_closed'],
    ['{"cycle_end":"2026-08-20"}', 'before_first_cycle'],
  ]) {
    const w = world()
    const r = await close.runReportClose(w.deps, body)
    assert.equal(r.status, 400)
    assert.equal(r.body.error, error)
    assert.equal(w.log.computes.length, 0)
    assert.equal(w.log.publishes.length, 0)
  }
  assert.equal(close.cycleRefusal('2026-09-20', RUN_AT), null)
})

// ─── the site block ──────────────────────────────────────────────────────────────────────────

test('BR-B2B-059 item 7e: the route page of the place, the cities without (not set), the share outside rounded down, the partner link', async () => {
  const w = world()
  const r = await close.runReportClose(w.deps, '')
  assert.equal(r.status, 200)
  assert.equal(w.log.publishes.length, 1)
  const site = w.log.publishes[0].site
  assert.deepEqual(site[BAIRES], {
    pages: [{ path: FESTIVAL_PATH, title: 'Rota do Festival Sabores de Cabo Frio 2026', users: 357 }],
    cities_count: 4,
    // (188 + 85 + 33) / (188 + 85 + 33 + 20) = 93,8%
    outside_city_pct: 93,
    top_cities: [
      { name: 'Rio de Janeiro', users: 188 },
      { name: 'São Paulo', users: 85 },
      { name: 'Porto Alegre', users: 33 },
    ],
    own_link_users: 14,
  })
  // The free place on the same route gets the same page and cities, and no partner link (zero).
  assert.equal((site[ANCHO] as { own_link_users?: number }).own_link_users, undefined)
  assert.equal((site[ANCHO] as { pages: unknown[] }).pages.length, 1)
  assert.doesNotMatch(JSON.stringify(site), /not set/)
})

test('BR-B2B-059 items 6 and 7e: a place with everything at zero has no site block at all', async () => {
  const w = world()
  await close.runReportClose(w.deps, '')
  assert.equal(LONE in w.log.publishes[0].site, false)
  assert.equal(close.siteBlock({ pages: [{ path: '/pt/x', title: 'x', users: 0 }], cities: [{ city: '(not set)', users: 9 }], ownLinkUsers: 0, cityName: 'Cabo Frio' }), null)
  assert.equal(close.siteBlock({ pages: [], cities: [], ownLinkUsers: 0, cityName: null }), null)
})

test('BR-B2B-059 item 6: no zero as a number inside the block (page at zero, share outside at zero)', () => {
  const b = close.siteBlock({
    pages: [
      { path: '/pt/a', title: 'A', users: 5 },
      { path: '/pt/b', title: 'B', users: 0 },
    ],
    cities: [{ city: 'Cabo Frio', users: 5 }],
    ownLinkUsers: 0,
    cityName: 'cabo frio',
  })
  assert.deepEqual(b, { pages: [{ path: '/pt/a', title: 'A', users: 5 }], cities_count: 1, top_cities: [{ name: 'Cabo Frio', users: 5 }] })
})

test('#993: GA4 is read once per page and period, not once per place; the period is the cycle', async () => {
  const g = ga4Double({ festival: 357, baires: 14, cities: CITIES })
  const w = world({ ga4: g })
  await close.runReportClose(w.deps, '')
  const routeCalls = g.calls.filter((c) => !c.byCity && c.pathPattern.includes('tours/'))
  const cityCalls = g.calls.filter((c) => c.byCity)
  assert.equal(routeCalls.length, 1)
  assert.equal(cityCalls.length, 1)
  for (const c of g.calls) assert.deepEqual([c.from, c.to], ['2026-09-21', '2026-10-20'])
  const own = g.calls.find((c) => c.pathPattern.includes('d/baires'))
  assert.ok(own)
  for (const p of ['/d/baires', '/pt/d/baires', '/d/baires-bistro/', '/en/d/baires-bistro']) assert.match(p, new RegExp(own.pathPattern))
  for (const p of ['/d/baires-x', '/pt/d/bairesbistro', '/foo/d/baires', '/d/baires?x=1']) assert.doesNotMatch(p, new RegExp(own.pathPattern))
})

test('#993: the route page slug is the site twin (tuggi-enterprise update-routes.mjs), and a generic stop is not a place of the route', () => {
  assert.equal(close.slugify('Rota do Festival Sabores de Cabo Frio 2026'), 'rota-do-festival-sabores-de-cabo-frio-2026')
  assert.equal(close.slugify("Caminho d'Ouro — São João"), 'caminho-douro-sao-joao')
  assert.equal(close.countrySlugOf('Brasil'), 'brazil')
  assert.equal(close.countrySlugOf('Itália'), 'italy')
  const [r] = close.siteRoutes([
    { id: FESTIVAL, name: 'Rota do Festival Sabores de Cabo Frio 2026', country: null, metadata: { country: 'Brasil' }, waypoints: [{ metadata: { attraction_id: POI_BAIRES } }, { metadata: { attraction_id: POI_LONE, is_generic: true } }] },
  ])
  assert.equal(r.path, FESTIVAL_PATH)
  assert.deepEqual([...r.attractionIds], [POI_BAIRES])
  const re = new RegExp(close.routePattern([r]))
  for (const p of [FESTIVAL_PATH, '/en/tours/brazil/rota-do-festival-sabores-de-cabo-frio-2026/', `/pt/tours/brazil/rota-do-festival-sabores-de-cabo-frio-2026-${FESTIVAL.slice(0, 6)}`]) assert.match(p, re)
  for (const p of ['/pt/tours/brazil/rota-do-festival-sabores-de-cabo-frio-2026-x', '/pt/tours/italy/rota-do-festival-sabores-de-cabo-frio-2026']) assert.doesNotMatch(p, re)
})

// ─── publication and e-mail ──────────────────────────────────────────────────────────────────

test('BR-B2B-059 item 4: one e-mail per place, and a second run sends no second e-mail nor recalculates', async () => {
  const w = world()
  const first = await close.runReportClose(w.deps, '')
  assert.equal(first.status, 200)
  assert.equal(w.log.sent.length, 3)
  assert.deepEqual(new Set(w.log.sent.map((m) => m.to)).size, 3)
  assert.ok(w.table.every((r) => r.published_at && r.email_sent_at))

  const again = await close.runReportClose(w.deps, '')
  assert.equal(again.status, 200)
  assert.equal(w.log.sent.length, 3)
  assert.equal(w.log.publishes.length, 1)
  assert.equal(again.body.counts['email:already_sent'], 3)
})

test('BR-B2B-059 item 4: two runs at the same time, the row claimed by the other run is not sent here', async () => {
  const w = world({ claimTaken: BAIRES })
  const r = await close.runReportClose(w.deps, '')
  assert.equal(w.log.sent.length, 2)
  assert.equal(r.body.results.find((o: { submission_id: string }) => o.submission_id === BAIRES).email, 'already_sent')
})

test('BR-B2B-059 item 4: a send that fails gives the claim back and alerts, and the next run sends it once', async () => {
  const w = world({ failSendTo: `dono-2@example.com` })
  const r = await close.runReportClose(w.deps, '')
  assert.equal(r.body.results.find((o: { submission_id: string }) => o.submission_id === ANCHO).email, 'failed')
  assert.equal(w.table.find((x) => x.submission_id === ANCHO)?.email_sent_at, null)
  assert.equal(w.log.releases, 1)
  assert.ok(w.log.alerts.includes('report_email_failed'))

  w.deps.sendEmail = async (to: string, mail: { subject: string; html: string; text: string }) => {
    w.log.sent.push({ to, ...mail })
    return true
  }
  await close.runReportClose(w.deps, '')
  assert.equal(w.log.sent.filter((m) => m.to === 'dono-2@example.com').length, 1)
  assert.equal(w.log.sent.length, 3)
})

test('BR-B2B-059 item 4: no owner e-mail is no send, the row stays unmarked and the run alerts', async () => {
  const w = world({ noRecipient: LONE })
  const r = await close.runReportClose(w.deps, '')
  assert.equal(r.body.results.find((o: { submission_id: string }) => o.submission_id === LONE).email, 'no_recipient')
  assert.equal(w.table.find((x) => x.submission_id === LONE)?.email_sent_at, null)
  assert.ok(w.log.alerts.includes('report_email_no_recipient'))
})

test('BR-B2B-059 items 1 and 4: the e-mail carries no number of the report; the only digits are the two dates', async () => {
  const w = world()
  await close.runReportClose(w.deps, '')
  for (const m of w.log.sent) {
    for (const part of [m.subject, m.text, m.html.replace(/<[^>]+>/g, ' ')]) {
      assert.doesNotMatch(part.replace(/\b(21\/09|20\/10)\b/g, ''), /\d/, part)
    }
  }
})

test('#993 copy §7: subject, period, button to the reports tab, and the comparison paragraph only for the free plan with compare', async () => {
  const w = world()
  await close.runReportClose(w.deps, '')
  const byTo = Object.fromEntries(w.log.sent.map((m) => [m.to, m]))
  const paid = byTo['dono-1@example.com']
  const freeCompare = byTo['dono-2@example.com']
  const freeAlone = byTo['dono-3@example.com']
  assert.equal(paid.subject, 'Seu relatório de outubro no Tuggi está pronto')
  assert.match(paid.html, /Quanta gente usou o Tuggi em Cabo Frio de 21\/09 a 20\/10, e quantas passaram pela sua porta\./)
  assert.match(paid.text, /Baires Bistrô já tem o relatório de outubro no painel: quanta gente usou o Tuggi em Cabo Frio, quantas pessoas passaram pela sua porta e o que o local aproveitou no período\./)
  assert.match(paid.text, /Dá para baixar em PDF e mandar para o sócio\./)
  assert.match(paid.text, /Ver o relatório: https:\/\/partner\.tuggi\.app\/status\/relatorios/)
  assert.match(paid.text, /Se o botão não abrir, entre em partner\.tuggi\.app com este e-mail\./)
  assert.match(paid.text, /Não reconhece este local\? Escreva para suporte@tuggi\.app\./)
  assert.doesNotMatch(paid.text, /Experiência alcançam/)
  assert.match(freeCompare.text, /O relatório também mostra o que os locais do plano Experiência alcançam a mais em Cabo Frio, e a troca de plano é feita no mesmo painel\./)
  assert.doesNotMatch(freeAlone.text, /Experiência alcançam/)
  // No name: the sentence opens with the fallback of the legacy e-mail.
  assert.match(freeAlone.text, /\n\nSeu local já tem o relatório de outubro no painel: quanta gente usou o Tuggi em Búzios,/)
})

test('#993: the place name in the e-mail is escaped in the HTML', () => {
  const m = close.reportCycleEmail({ placeName: '<b>Bar</b> & Cia', cityName: 'Cabo Frio', cycleEnd: '2026-10-20', periodFrom: '2026-10-03', plan: 'paid', hasCompare: false }, ORIGIN)
  assert.doesNotMatch(m.html, /<b>Bar<\/b>/)
  assert.match(m.html, /&lt;b&gt;Bar&lt;\/b&gt; &amp; Cia/)
  assert.match(m.html, /de 03\/10 a 20\/10/)
})

// ─── GA4 down, database down, dry run ────────────────────────────────────────────────────────

test('BR-B2B-059 item 3: without the GA4 secret nothing is published and no e-mail goes out (503, alert)', async () => {
  const w = world({ ga4: null })
  const r = await close.runReportClose(w.deps, '')
  assert.equal(r.status, 503)
  assert.equal(r.body.error, 'ga4_unavailable')
  assert.equal(w.log.publishes.length, 0)
  assert.equal(w.log.sent.length, 0)
  assert.ok(w.log.alerts.includes('report_close_ga4_not_configured'))
})

test('BR-B2B-059 item 3: GA4 refusing stops the run before publishing', async () => {
  const w = world({ ga4: ga4Double({ throws: true }) })
  const r = await close.runReportClose(w.deps, '')
  assert.equal(r.status, 503)
  assert.equal(w.log.publishes.length, 0)
  assert.equal(w.log.sent.length, 0)
  assert.ok(w.log.alerts.includes('report_close_ga4_failed'))
})

test('#993: the compute failing is 502 and nothing else runs', async () => {
  const w = world({ computeError: true })
  const r = await close.runReportClose(w.deps, '')
  assert.equal(r.status, 502)
  assert.equal(r.body.error, 'compute_failed')
  assert.equal(w.log.publishes.length, 0)
  assert.equal(w.log.sent.length, 0)
})

test('#993: send_email false publishes without e-mail and leaves email_sent_at empty (the history of 2026-09-20)', async () => {
  const w = world()
  const r = await close.runReportClose(w.deps, '{"cycle_end":"2026-09-20","send_email":false}')
  assert.equal(r.status, 200)
  assert.equal(w.log.sent.length, 0)
  assert.ok(w.table.every((x) => x.cycle_end === '2026-09-20' && x.published_at && x.email_sent_at === null))
  assert.equal(w.log.publishes[0].cycleEnd, '2026-09-20')
})

test('#993: dry run before the compute writes nothing, sends nothing, and lists each live place with its site block', async () => {
  const w = world()
  const r = await close.runReportClose(w.deps, '{"dry_run":true}')
  assert.equal(r.status, 200)
  assert.equal(w.log.computes.length, 0)
  assert.equal(w.log.publishes.length, 0)
  assert.equal(w.log.sent.length, 0)
  assert.equal(w.table.length, 0)
  const baires = r.body.results.find((o: { submission_id: string }) => o.submission_id === BAIRES)
  assert.equal(baires.site.pages[0].users, 357)
  assert.equal(baires.email, 'would_send')
  assert.equal(r.body.results.find((o: { submission_id: string }) => o.submission_id === LONE).site, null)
})

test('#993: the answer and the log carry ids and codes only, no name and no e-mail address', async () => {
  const w = world()
  const r = await close.runReportClose(w.deps, '')
  const body = JSON.stringify(r.body)
  assert.doesNotMatch(body, /@|Baires|Ancho/)
})

// ─── the GA4 client ──────────────────────────────────────────────────────────────────────────

async function serviceAccountJson(): Promise<string> {
  const pair = await crypto.subtle.generateKey({ name: 'RSASSA-PKCS1-v1_5', modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: 'SHA-256' }, true, ['sign', 'verify'])
  const der = Buffer.from(await crypto.subtle.exportKey('pkcs8', pair.privateKey)).toString('base64')
  const pem = `-----BEGIN PRIVATE KEY-----\n${der.match(/.{1,64}/g)?.join('\n')}\n-----END PRIVATE KEY-----\n`
  return JSON.stringify({ type: 'service_account', client_email: 'ga4-reader@tuggi.iam.gserviceaccount.com', private_key: pem, token_uri: 'https://evil.example/token' })
}

test('#993: the service account key is read from the secret; anything else is no GA4', async () => {
  assert.equal(ga4.parseServiceAccount(undefined), null)
  assert.equal(ga4.parseServiceAccount(''), null)
  assert.equal(ga4.parseServiceAccount('{"client_email":"x@y"}'), null)
  assert.equal(ga4.parseServiceAccount('not json'), null)
  assert.equal(ga4.parseServiceAccount(await serviceAccountJson()).clientEmail, 'ga4-reader@tuggi.iam.gserviceaccount.com')
})

test('#993: the GA4 client trades a signed JWT at Google (never at the token_uri of the secret), once per run, and reads the property', async () => {
  const sa = ga4.parseServiceAccount(await serviceAccountJson())
  const calls: { url: string; init: RequestInit }[] = []
  const fetchFn = async (url: string, init: RequestInit) => {
    calls.push({ url, init })
    if (url === ga4.GOOGLE_TOKEN_URL) return new Response(JSON.stringify({ access_token: 'tok', expires_in: 3599 }), { status: 200 })
    return new Response(JSON.stringify({ rows: [{ dimensionValues: [{ value: 'Rio de Janeiro' }], metricValues: [{ value: '188' }] }, { dimensionValues: [{ value: 'X' }], metricValues: [{ value: '0' }] }] }), { status: 200 })
  }
  const client = ga4.ga4Client(sa, '494999879', fetchFn)
  const q = { pathPattern: '^(/[a-z]{2})?/(d/baires)/?$', from: '2026-09-21', to: '2026-10-20', byCity: true }
  assert.deepEqual(await client(q), [{ city: 'Rio de Janeiro', users: 188 }])
  await client({ ...q, byCity: false })
  assert.equal(calls.filter((c) => c.url === ga4.GOOGLE_TOKEN_URL).length, 1)
  assert.equal(calls.some((c) => c.url.includes('evil')), false)
  const assertion = new URLSearchParams(String(calls[0].init.body)).get('assertion') ?? ''
  const claims = JSON.parse(Buffer.from(assertion.split('.')[1], 'base64url').toString())
  assert.equal(claims.scope, 'https://www.googleapis.com/auth/analytics.readonly')
  assert.equal(claims.aud, 'https://oauth2.googleapis.com/token')
  assert.equal(calls[1].url, 'https://analyticsdata.googleapis.com/v1beta/properties/494999879:runReport')
  assert.equal((calls[1].init.headers as Record<string, string>).Authorization, 'Bearer tok')
  assert.deepEqual(JSON.parse(String(calls[1].init.body)), {
    dateRanges: [{ startDate: '2026-09-21', endDate: '2026-10-20' }],
    dimensions: [{ name: 'city' }],
    metrics: [{ name: 'totalUsers' }],
    dimensionFilter: { filter: { fieldName: 'pagePath', stringFilter: { matchType: 'FULL_REGEXP', value: q.pathPattern, caseSensitive: false } } },
    orderBys: [{ metric: { metricName: 'totalUsers' }, desc: true }],
    limit: '10000',
  })
})

test('#993: a GA4 refusal throws with the status only, and a failed token is drawn again next time', async () => {
  const sa = ga4.parseServiceAccount(await serviceAccountJson())
  let tokenCalls = 0
  const client = ga4.ga4Client(sa, '494999879', async (url: string) => {
    if (url === ga4.GOOGLE_TOKEN_URL) {
      tokenCalls++
      return tokenCalls === 1 ? new Response('{"error":"invalid_grant"}', { status: 400 }) : new Response('{"access_token":"t"}', { status: 200 })
    }
    return new Response('{"error":{"message":"quota for properties/494999879"}}', { status: 429 })
  })
  const q = { pathPattern: '^/x$', from: '2026-09-21', to: '2026-10-20' }
  await assert.rejects(client(q), /^Error: ga4_token_400$/)
  await assert.rejects(client(q), /^Error: ga4_report_429$/)
  assert.equal(tokenCalls, 2)
})

// ─── the wiring ──────────────────────────────────────────────────────────────────────────────

test('places-report-close/index.ts: machine key only, as places-payment-sweep, and the raw body goes to the run', () => {
  const src = readFileSync(resolve(FUNCTIONS, 'places-report-close', 'index.ts'), 'utf8')
  assert.match(src, /const auth = await requireAdmin\(req\);/)
  assert.match(src, /if \(auth\.role !== 'service_role'\) return json\(403, \{ error: 'forbidden' \}\);/)
  assert.match(src, /runReportClose\(reportCloseDeps\(\), raw\)/)
})

test('places-report-close-runtime.ts: the three RPCs of #992, the GA4 secret, and the reply to the support', () => {
  const src = readFileSync(resolve(FUNCTIONS, '_shared', 'places-report-close-runtime.ts'), 'utf8')
  assert.match(src, /rpc\('report_cycle_compute', \{ p_cycle_end: cycleEnd, p_force: false \}\)/)
  assert.match(src, /rpc\('report_cycle_publish', \{ p_cycle_end: cycleEnd, p_site: site \}\)/)
  assert.match(src, /from\('place_report_cycles'\)/)
  assert.match(src, /\.is\('email_sent_at', null\)\s*\.not\('published_at', 'is', null\)/)
  assert.match(src, /parseServiceAccount\(Deno\.env\.get\(GA4_CREDENTIALS_ENV\)\)/)
  assert.match(src, /sendEmailWithId\(to, mail\.subject, mail\.html, mail\.text, ACCESS_FROM_NAME, SUPPORT_EMAIL\)/)
  assert.equal(close.SUPPORT_EMAIL, 'suporte@tuggi.app')
  assert.equal(close.GA4_PROPERTY_ID, '494999879')
})
