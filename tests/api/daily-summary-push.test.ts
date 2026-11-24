/**
 * #1071: the daily summary push, `_shared/daily-push-i18n.ts` and its sender,
 * `daily-gamification-orchestrator`. BR-COMUNICACAO-019 item 3.i, BR-COMUNICACAO-007,
 * BR-COMUNICACAO-008, BR-IDIOMA-001 item 3. Criteria: `docs/design/copy/push-2026-11.md`, A.6.
 *
 * The module is imported through a path built at runtime: a static import ending in `.ts` fails
 * `npm run type-check` for the whole repo. The orchestrator imports a remote URL, so it is read as
 * source.
 *
 * Run with: npm run test:api
 */
import { test, before } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

const FUNCTIONS = resolve(import.meta.dirname, '../../supabase/functions')
const MODULE_PATH = resolve(FUNCTIONS, '_shared/daily-push-i18n.ts')
const ORCHESTRATOR_PATH = resolve(FUNCTIONS, 'daily-gamification-orchestrator/index.ts')

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let daily: any

before(async () => {
  daily = await import(pathToFileURL(MODULE_PATH).href)
})

const CASES: Array<[number, number]> = [[1, 1], [5, 123], [5, 0], [0, 1], [0, 123], [123, 123]]
const LANGS = () => Object.keys(daily.DAILY_SUMMARY_COPY) as string[]

/** Every string of one language, as written in the catalogue. */
function strings(lang: string): string[] {
  const c = daily.DAILY_SUMMARY_COPY[lang]
  return [c.heardTitle.one, c.heardTitle.other, c.nearbyTitle.one, c.nearbyTitle.other, c.nearbyBody.one, c.nearbyBody.other, c.mapBody]
}

test('BR-COMUNICACAO-019 3.i, A.6.1: no title over 40 and no body over 110, with 3 digits', () => {
  for (const lang of LANGS()) {
    for (const [heard, missed] of CASES) {
      const push = daily.composeDailySummaryPush(lang, heard, missed)
      assert.ok(push, `${lang} ${heard}/${missed}`)
      assert.ok(push.title.length <= 40, `${lang} ${heard}/${missed} title ${push.title.length}: ${push.title}`)
      assert.ok(push.body.length <= 110, `${lang} ${heard}/${missed} body ${push.body.length}: ${push.body}`)
      assert.doesNotMatch(`${push.title} ${push.body}`, /\{\{|[?!]/, `${lang}: unresolved variable or ? !`)
    }
  }
})

test('BR-COMUNICACAO-007, A.6.2: zero never renders, it changes the sentence; both zero sends nothing', () => {
  for (const lang of LANGS()) {
    const c = daily.DAILY_SUMMARY_COPY[lang]
    const noMissed = daily.composeDailySummaryPush(lang, 5, 0)
    assert.equal(noMissed.body, c.mapBody, `${lang}: missed = 0 body is the map body only`)
    assert.ok(!noMissed.body.includes('0'), lang)
    const noHeard = daily.composeDailySummaryPush(lang, 0, 123)
    assert.equal(noHeard.title, c.nearbyTitle.other.replace('{{missed}}', '123'), `${lang}: heard = 0 uses the nearby title`)
    assert.equal(noHeard.body, c.mapBody, lang)
    const both = daily.composeDailySummaryPush(lang, 5, 123)
    assert.equal(both.title, c.heardTitle.other.replace('{{heard}}', '5'), lang)
    assert.equal(both.body, `${c.nearbyBody.other.replace('{{missed}}', '123')} ${c.mapBody}`, lang)
    for (const [h, m] of [[0, 0], [null, null], [undefined, 0], ['x', -3]]) {
      assert.equal(daily.composeDailySummaryPush(lang, h, m), null, `${lang} ${h}/${m}`)
    }
  }
})

test('A.6.3: with n = 1 no plural noun is rendered', () => {
  const plurals = /histórias|stories|historias|storie|histoires|Geschichten|lugares|places|luoghi|lieux|Orte/
  for (const lang of LANGS()) {
    for (const [h, m] of [[1, 1], [1, 0], [0, 1]]) {
      const push = daily.composeDailySummaryPush(lang, h, m)
      assert.doesNotMatch(`${push.title} ${push.body}`, plurals, `${lang} ${h}/${m}`)
    }
  }
})

test('BR-COMUNICACAO-007 item 2, A.6.4: a string counting places never says story, guide or audio', () => {
  const forbidden = /história|story|historia|storia|histoire|Geschichte|guia|guide|áudio|audio|narração|roteiro/i
  for (const lang of LANGS()) {
    const c = daily.DAILY_SUMMARY_COPY[lang]
    for (const s of [c.nearbyTitle.one, c.nearbyTitle.other, c.nearbyBody.one, c.nearbyBody.other]) {
      assert.doesNotMatch(s, forbidden, `${lang}: ${s}`)
    }
  }
})

test('BR-COMUNICACAO-008, A.6.5: no string orders the guide on', () => {
  const activation = /ligar|ativar|activate|turn on|encender|activar|attivare|accendere|activer|allumer|einschalten|aktivieren|anschalten/i
  for (const lang of LANGS()) {
    for (const s of strings(lang)) assert.doesNotMatch(s, activation, `${lang}: ${s}`)
  }
})

test('BR-COMUNICACAO-008 item 4, A.6.6: the payload opens tuggi://map and names daily_summary to the gate and the app', () => {
  const user = '00000000-0000-4000-8000-000000000001'
  const body = daily.dailySummarySendBody(user, { title: 't', body: 'b' }, '2026-11-03')
  assert.equal(body.type, 'user')
  assert.deepEqual(body.userIds, [user])
  assert.equal(body.push_kind, 'daily_summary')
  assert.deepEqual(body.notification.data, { type: 'daily_summary', deeplink: 'tuggi://map', date: '2026-11-03' })
})

test('BR-COMUNICACAO-019 item 11, A.6.7: a language outside the catalogue reads English; regional tags fold', () => {
  const en = daily.composeDailySummaryPush('en', 5, 123)
  for (const raw of ['zh', 'ko', '', null, undefined, 'xx-YY']) {
    assert.deepEqual(daily.composeDailySummaryPush(raw, 5, 123), en, String(raw))
  }
  assert.deepEqual(daily.composeDailySummaryPush('pt-BR', 5, 123), daily.composeDailySummaryPush('pt', 5, 123))
  assert.deepEqual(daily.composeDailySummaryPush('it_IT', 1, 0), daily.composeDailySummaryPush('it', 1, 0))
})

test('BR-COMUNICACAO-019 3.i.2: the orchestrator sends the summary once a day, on the first pass, through the in-process sender', () => {
  const source = readFileSync(ORCHESTRATOR_PATH, 'utf8')
  assert.match(source, /from '\.\.\/_shared\/push-send\.ts'/)
  assert.match(source, /createPushSender\(/)
  // No call per person to another function (#1046).
  assert.doesNotMatch(source, /functions\/v1\/firebase-push-notification/)
  assert.match(source, /if \(attemptsSoFar === 0\) \{\s*const daily = composeDailySummaryPush\(user\.language, user\.heard_count, user\.missed_count\);/)
  assert.match(source, /dailySummarySendBody\(user\.user_id, daily, today\)/)
  // The local hour and "used yesterday" are the RPC's (SSOT): no hour test in the sender.
  assert.doesNotMatch(source, /getHours\(|getUTCHours\(|toLocaleString\(/)
})

test('push-2026-11 A.6.7 and C.6.1 (#1073): `de`, `de-AT` and `de_CH` get the German strings', () => {
  const de = daily.composeDailySummaryPush('de', 5, 123)
  assert.deepEqual(de, {
    title: 'Gestern hast du 5 Geschichten gehört',
    body: 'Außerdem lagen 123 Orte auf deinem Weg. Schau auf der Karte, was heute um dich herum ist.',
  })
  assert.deepEqual(daily.composeDailySummaryPush('de-AT', 5, 123), de)
  assert.deepEqual(daily.composeDailySummaryPush('de_CH', 5, 123), de)
  assert.deepEqual(daily.composeDailySummaryPush('de', 0, 1), {
    title: 'Gestern lag 1 Ort auf deinem Weg',
    body: 'Schau auf der Karte, was heute um dich herum ist.',
  })
})
