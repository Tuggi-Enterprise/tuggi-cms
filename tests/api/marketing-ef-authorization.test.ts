/**
 * #346 — the marketing Edge Functions authorize who calls them, and the rules cannot be loaded
 * so they are ruled over the source.
 *
 * Why this file exists. `firebase-push-notification` (`/send`, `type: 'broadcast'`) and
 * `send-newsletter` (`/send`, `/send-test`, `/translate`, `/preview`) read no `Authorization`
 * header at all, and the gateway's `verify_jwt` is satisfied by the PUBLISHABLE key — which is
 * shipped inside the app binary and served in the site's JS. Anyone holding it could:
 *
 *  - POST `/send` with `type: 'broadcast'` and `filters: {}`, resolving
 *    `core.get_audience_push_tokens({})` — the whole base — with an arbitrary title, body and
 *    deeplink, plus a row in every user's inbox;
 *  - POST `/send-test` and send arbitrary HTML from `news@tuggi.app`, signed with our
 *    SPF/DKIM/DMARC, to any address, with no limit.
 *
 * Both files import `https://esm.sh/@supabase/supabase-js@2`, which Node cannot resolve and
 * `mock.module` does not intercept (measured 2026-08-23, `edge-push-deeplink.test.ts`). So the
 * gate is proved here by POSITION in the source — every route that sends must appear AFTER the
 * `requireAdmin` call — and the rules that CAN be executed live in
 * `_shared/newsletter-metrics.ts` with `marketing-ef-metrics.test.ts` on them.
 *
 * Run with: npm run test:api
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const FN = (name: string) =>
  readFileSync(resolve(import.meta.dirname, `../../supabase/functions/${name}`), 'utf8')

const newsletter = FN('send-newsletter/index.ts')
const push = FN('firebase-push-notification/index.ts')
const webhook = FN('resend-webhook/index.ts')
const middleware = FN('_shared/auth-middleware.ts')

/** Where a literal first appears, asserting it appears at all. */
function at(source: string, needle: string, label: string): number {
  const i = source.indexOf(needle)
  assert.notEqual(i, -1, `${label}: \`${needle}\` is gone from the source`)
  return i
}

// --- The gate exists, and it is the one that already existed -----------------

test('#346: neither function invents a second authorization scheme', () => {
  // §6, procure antes de criar. `_shared/auth-middleware.ts` is what ~15 content functions
  // already use; a third spelling of "is this caller allowed" is the defect, not the fix.
  for (const [name, src] of [['send-newsletter', newsletter], ['firebase-push-notification', push]] as const) {
    assert.match(
      src,
      /import \{ requireAdmin \} from '\.\.\/_shared\/auth-middleware\.ts'/,
      `${name} does not import the shared gate`
    )
    assert.match(src, /await requireAdmin\(req/, `${name} never calls the gate`)
    assert.match(
      src,
      /if \(auth instanceof Response\)/,
      `${name} calls the gate but does not return its refusal`
    )
  }
})

test('#346: send-newsletter gates every route that sends, schedules or reads the audience', () => {
  const gate = at(newsletter, 'await requireAdmin(req', 'send-newsletter')
  for (const route of [
    "path === '/preview'",
    "path === '/send-test'",
    "path === '/translate'",
    "path === '/audience-breakdown'",
    "path === '/send'",
    "path === '/schedule'",
    "path === '/process-scheduled'",
  ]) {
    assert.ok(
      at(newsletter, route, 'send-newsletter') > gate,
      `${route} is handled BEFORE the gate — it is still open to the publishable key`
    )
  }
})

test('#346: only /health and /unsubscribe are answered before the gate', () => {
  const gate = at(newsletter, 'await requireAdmin(req', 'send-newsletter')
  const before = newsletter.slice(0, gate)
  const routesBefore = [...before.matchAll(/path === '([^']+)'/g)].map((m) => m[1])
  assert.deepEqual(
    routesBefore.sort(),
    ['/health', '/unsubscribe'],
    'a route slipped in front of the gate'
  )
})

test('#346: the push function gates everything but /health', () => {
  const gate = at(push, 'await requireAdmin(req', 'firebase-push-notification')
  assert.match(
    push.slice(0, gate),
    /if \(path !== '\/health'\)/,
    'the push gate is not the "everything but /health" shape'
  )
  for (const route of ["path === '/send'", "path === '/schedule'", "path === '/process-scheduled'"]) {
    assert.ok(at(push, route, 'firebase-push-notification') > gate, `${route} is not gated`)
  }
})

// --- The machine callers keep working ----------------------------------------

test('#346: the machine bypass accepts ef_secret_key, and ONLY that', () => {
  // This assertion used to demand the opposite — that `SUPABASE_SERVICE_ROLE_KEY` be accepted
  // too, "or the database stops being able to call". That came from reading the migration FILES,
  // which say the cron drains and the partner push post with the Vault's SERVICE_ROLE_KEY.
  //
  // Measured against production on 2026-09-10, they don't: the Vault holds only `ef_secret_key`
  // and `SUPABASE_URL`, and `pg_get_functiondef` of all three callers reads `ef_secret_key`. The
  // database is AHEAD of `supabase/migrations/`, so the file is not the fact — and the test that
  // pinned the file pinned an open gate onto the key `_shared/secret-key.ts` calls leaked (#155).
  assert.match(middleware, /export function isOwnMachineKey\(/, 'isOwnMachineKey is gone')
  assert.match(middleware, /getSecretKey\(\)/, 'the ef_secret_key is not accepted')
  // The pattern is the ENV READ, not the name: the docblock above `isOwnMachineKey` explains at
  // length why the legacy key is not accepted, and a bare-name assertion would fail on the
  // explanation itself — which is how this assertion first failed.
  assert.doesNotMatch(
    middleware,
    /Deno\.env\.get\(\s*["']SUPABASE_SERVICE_ROLE_KEY["']/,
    'the leaked legacy key is read again, and no caller in production needs it'
  )
  assert.match(middleware, /if \(isOwnMachineKey\(token\)\)/, 'the bypass does not use the helper')
})

test('#346: service_role passes requireAdmin, and a signed-in non-admin does not', () => {
  const start = at(middleware, 'export async function requireAdmin(', 'auth-middleware')
  const body = middleware.slice(start, start + 2000)
  assert.match(
    body,
    /result\.role !== "service_role" && !isAdmin\(result\.role\)/,
    'requireAdmin no longer lets the machine identity through, or no longer checks the role'
  )
  assert.match(body, /status: 403/, 'a non-admin is not refused with 403')
})

// --- One-click unsubscribe ---------------------------------------------------

test('Gmail bulk-sender: BOTH unsubscribe headers go out, not just one', () => {
  // https://support.google.com/a/answer/81126 — a sender doing 5,000 messages a day must
  // "support one-click unsubscribe", which is `List-Unsubscribe` AND
  // `List-Unsubscribe-Post: List-Unsubscribe=One-Click` (RFC 2369 + RFC 8058).
  assert.match(newsletter, /'List-Unsubscribe': `<\$\{oneClickUrl\}>`/)
  assert.match(newsletter, /'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click'/)
  // And they travel together: one function composes the pair, so a caller cannot send half.
  const pairs = [...newsletter.matchAll(/'List-Unsubscribe':/g)].length
  assert.equal(pairs, 1, 'the header pair is spelled out more than once and will drift')
  assert.equal(
    [...newsletter.matchAll(/headers: unsubscribeHeaders\(/g)].length,
    2,
    'the campaign send and the test send do not both use the pair'
  )
})

test('the one-click endpoint refuses GET — a link scanner must not unsubscribe anyone', () => {
  // This is the whole reason the header points at the function and not at the site page:
  // `tuggi-enterprise/src/app/[locale]/unsubscribe/page.tsx` writes the opt-out DURING RENDER,
  // so any GET on it — an antivirus link scanner, a corporate URL-defense prefetch, a Slack
  // unfurl — records an unsubscribe nobody asked for. That page is another repo's card.
  const start = at(newsletter, "path === '/unsubscribe'", 'send-newsletter')
  const body = newsletter.slice(start, start + 1500)
  assert.match(body, /req\.method !== 'POST'/, 'the one-click route does not insist on POST')
  assert.match(body, /405/, 'a non-POST is not refused')
  assert.match(body, /verifySignedEmail\(/, 'the route writes without checking the signature')
  assert.match(body, /source: 'list_unsubscribe'/, 'the opt-out is not attributed to the header')
})

// --- Hard bounce becomes suppression -----------------------------------------

test('a permanent bounce is written to email_unsubscribes, and a soft one is not', () => {
  // Measured 2026-09-10: 83 bounces over 67 distinct addresses, `email_unsubscribes` with
  // `source='bounce'` at ZERO, and 54 of those addresses mailed again in a later campaign —
  // `marketing.get_newsletter_audience` filters on `email_unsubscribes` alone.
  const start = at(webhook, "type === 'email.bounced'", 'resend-webhook')
  const body = webhook.slice(start, webhook.indexOf("type === 'email.complained'", start))
  assert.match(body, /isPermanentBounce\(bounce\)/, 'the bounce is not classified')
  assert.match(body, /if \(permanent\)/, 'the suppression is not conditional on the classification')
  assert.match(body, /source: 'bounce'/, 'the suppression is not attributed to the bounce')
  assert.match(body, /from\('email_unsubscribes'\)/, 'the bounce never reaches the suppression list')
  assert.match(body, /error_details:/, 'the bounce reason is not recorded on the recipient row')
})

test('the webhook never demotes a status, and the ladder is the shared one', () => {
  assert.match(
    webhook,
    /import \{ highestStatus, isPermanentBounce \} from '\.\.\/_shared\/newsletter-metrics\.ts'/,
    'the webhook re-declared the rules instead of importing them (SSOT)'
  )
  // Every status write goes through the ladder. A bare `status: '...'` in an update is the
  // regression: that is exactly how a reopen used to erase a click.
  const rawWrites = [...webhook.matchAll(/update\(\{\s*status: '/g)].length
  assert.equal(rawWrites, 0, 'a status is written without passing through highestStatus')
  assert.match(webhook, /const status = highestStatus\(rec\.status, incoming\)/)
  // And the derived value is the only thing that reaches an update.
  const statusWrites = [...webhook.matchAll(/update\(\{ status[,}]/g)].length
  assert.ok(statusWrites > 0, 'nothing writes a status any more')
})

// --- The rate limit and the honest campaign status ---------------------------

test('the send loop paces itself and retries the rate limit', () => {
  // https://resend.com/docs/api-reference/introduction — "The default maximum rate limit is 10
  // requests per second per team", 429 over it. The Iceland campaign fired five batches inside
  // 550 ms and lost 200 of 500 recipients.
  assert.match(newsletter, /const RESEND_MAX_RPS = \d+/)
  assert.match(newsletter, /MIN_INTERVAL_MS/, 'nothing spaces the calls out')
  assert.match(newsletter, /res\.status === 429 \|\| res\.status >= 500/, '429 is not retried')
  assert.match(newsletter, /retry-after/, 'the provider\'s own backoff hint is ignored')
  assert.match(newsletter, /Math\.random\(\)/, 'the backoff has no jitter, so batches re-collide')
  // One cursor for the whole campaign, or the gap only holds inside a batch.
  assert.match(newsletter, /const pace = \{ nextAt: 0 \}/)
})

test('a campaign that reached some of its audience is not filed as `sent`', () => {
  assert.match(
    newsletter,
    /failed === 0 \? 'sent' : sent === 0 \? 'failed' : 'partial'/,
    'a partial send is again indistinguishable from a complete one'
  )
  assert.match(newsletter, /sent_count: sent/, 'the counts are not persisted')
  assert.match(newsletter, /failed_count: failed/)
})

test('a campaign that throws mid-flight does not stay `sending` forever', () => {
  const start = at(newsletter, "path === '/send'", 'send-newsletter')
  const body = newsletter.slice(start, start + 1600)
  assert.match(body, /campaign_already_sending/, 'a double press sends the campaign twice')
  assert.match(body, /update\(\{ status: 'failed' \}\)/, 'an exception leaves the row `sending`')
})

// --- The Italian fallback ----------------------------------------------------

test('an Italian reader with no name is not greeted in English', () => {
  const start = at(newsletter, 'const FALLBACK_NAME', 'send-newsletter')
  const table = newsletter.slice(start, start + 300)
  for (const lang of ['pt', 'en', 'es', 'it']) {
    assert.match(table, new RegExp(`\\b${lang}:`), `FALLBACK_NAME has no ${lang}`)
  }
})

// --- The push log stops throwing its own numbers away ------------------------

test('the push log persists the counts and the segment it actually used', () => {
  // `stats.success`/`stats.failure` were counted token by token and went to console.log; the
  // audience `filters` were dropped, so the history showed "All Users" for every broadcast.
  assert.match(push, /success_count: stats\?\.success/)
  assert.match(push, /failure_count: stats\?\.failure/)
  assert.match(push, /recipient_count:/)
  assert.match(push, /audience_filters:/)
  // The columns are the `data` agent's migration (§2): until it runs, the insert must not lose
  // the log row that exists today.
  assert.match(push, /PGRST204/, 'a missing column would drop the log entirely')
})

test('the push data map is coerced to strings before it reaches FCM', () => {
  // FCM `data` is map<string,string>. A number in there is INVALID_ARGUMENT for EVERY token —
  // the failure `shouldAbortForBadPayload` exists to stop — and the CMS composer now writes
  // `data.type` alongside whatever the operator typed.
  assert.match(push, /data: stringifyData\(notification\.data\)/)
})
