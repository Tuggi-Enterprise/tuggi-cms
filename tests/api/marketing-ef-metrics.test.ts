/**
 * Marketing metrics — the three rules that decide what a recipient row means, executed.
 *
 * Why this file exists: all three defects it pins were MEASURED in production on 2026-09-10,
 * and none of them were visible from the code reading correct.
 *
 *  1. A status that could move DOWN. Resend emits `email.opened` on every reopen, so a reader
 *     who clicked and reopened was written back to `opened`: 11 rows say `clicked` while 4 more
 *     carry `click_count > 0` and say `opened` — clicks undercounted by 27%.
 *  2. A bounce that never suppressed. 83 bounces over 67 distinct addresses, `email_unsubscribes`
 *     with `source='bounce'` at ZERO, and 54 of those addresses mailed again in a later campaign.
 *  3. `utm_campaign` carrying the campaign's free-text name, so GA4 reported
 *     `Novidades%20de%20junho`.
 *
 * The module under test imports NOTHING, on purpose: the two Edge Functions that consume it pull
 * `https://esm.sh/@supabase/supabase-js@2` and cannot be loaded by Node, so a rule left inside
 * them could only ever be checked by a regexp over the source. The rule lives here so a test can
 * run it. `tests/api/marketing-ef-authorization.test.ts` holds the source rulers that prove the
 * functions still call it.
 *
 * The module is Deno source (`.ts` specifier), so it is loaded through a path built at run time —
 * a static import ending in `.ts` fails `npm run type-check` for the whole repo.
 *
 * Run with: npm run test:api
 */

import { test, before } from 'node:test'
import assert from 'node:assert/strict'
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

const MODULE_PATH = resolve(
  import.meta.dirname,
  '../../supabase/functions/_shared/newsletter-metrics.ts'
)

let highestStatus: (current: string | null | undefined, incoming: string) => string
let isPermanentBounce: (bounce: unknown) => boolean
let slugifyCampaign: (name: string, fallback: string) => string
let STATUS_RANK: Record<string, number>

before(async () => {
  const mod = await import(pathToFileURL(MODULE_PATH).href)
  ;({ highestStatus, isPermanentBounce, slugifyCampaign, STATUS_RANK } = mod)
  assert.equal(typeof highestStatus, 'function', 'highestStatus is not exported')
  assert.equal(typeof isPermanentBounce, 'function', 'isPermanentBounce is not exported')
  assert.equal(typeof slugifyCampaign, 'function', 'slugifyCampaign is not exported')
})

// --- 1. The status never goes down -------------------------------------------

test('the measured regression: a reopen after a click does not erase the click', () => {
  // Exactly the sequence that produced the 4 mislabelled rows: delivered, opened, clicked,
  // then Resend sends `email.opened` again because the reader came back to the message.
  let status = 'sent'
  status = highestStatus(status, 'delivered')
  status = highestStatus(status, 'opened')
  status = highestStatus(status, 'clicked')
  status = highestStatus(status, 'opened')
  assert.equal(status, 'clicked', 'a reopen demoted a click — this is the 27% undercount')
})

test('bounced is terminal: no later engagement event displaces it', () => {
  for (const later of ['delivered', 'opened', 'clicked', 'sent']) {
    assert.equal(highestStatus('bounced', later), 'bounced', `${later} overwrote a bounce`)
  }
})

test('complained is terminal too, and outranks bounced', () => {
  assert.equal(highestStatus('complained', 'clicked'), 'complained')
  assert.equal(highestStatus('bounced', 'complained'), 'complained')
})

test('the ladder still moves forward — a fix that froze every status would be worse', () => {
  assert.equal(highestStatus('queued', 'sent'), 'sent')
  assert.equal(highestStatus('sent', 'delivered'), 'delivered')
  assert.equal(highestStatus('delivered', 'opened'), 'opened')
  assert.equal(highestStatus('opened', 'clicked'), 'clicked')
})

test('an unset status accepts anything; an unknown one never displaces a known one', () => {
  assert.equal(highestStatus(null, 'delivered'), 'delivered')
  assert.equal(highestStatus(undefined, 'sent'), 'sent')
  assert.equal(highestStatus('clicked', 'teleported'), 'clicked')
})

test('every status the code writes has a rank', () => {
  // Written by send-newsletter (`sent`, `failed`), by the webhook (the rest), and by the table
  // default (`queued`). A status with no rank silently ranks -1 and loses every comparison.
  for (const s of ['queued', 'sent', 'failed', 'delivered', 'opened', 'clicked', 'bounced', 'complained']) {
    assert.equal(typeof STATUS_RANK[s], 'number', `${s} has no rank`)
  }
})

// --- 2. Only a hard bounce suppresses ----------------------------------------

test('Permanent bounce suppresses — the payload Resend documents', () => {
  // https://resend.com/docs/webhooks/emails/bounced, the worked example verbatim.
  assert.equal(
    isPermanentBounce({
      message: "The recipient's email address is on the suppression list because it has a recent history of producing hard bounces.",
      subType: 'Suppressed',
      type: 'Permanent',
    }),
    true
  )
})

test('Permanent/NoEmail — the address does not exist — suppresses', () => {
  assert.equal(isPermanentBounce({ type: 'Permanent', subType: 'NoEmail' }), true)
})

test('a full mailbox does NOT unsubscribe anyone', () => {
  // https://resend.com/docs/dashboard/emails/email-bounces: Transient "may be delivered in the
  // future". Suppressing here would opt a paying customer out over one afternoon's full inbox.
  for (const subType of ['General', 'MailboxFull', 'MessageTooLarge', 'ContentRejected', 'AttachmentRejected']) {
    assert.equal(isPermanentBounce({ type: 'Transient', subType }), false, `Transient/${subType} suppressed`)
  }
})

test('Undetermined does not suppress — "I do not know" is not consent', () => {
  assert.equal(isPermanentBounce({ type: 'Undetermined', subType: 'Undetermined' }), false)
})

test('a bounce with no type at all does not suppress', () => {
  assert.equal(isPermanentBounce(undefined), false)
  assert.equal(isPermanentBounce(null), false)
  assert.equal(isPermanentBounce({}), false)
  assert.equal(isPermanentBounce({ subType: 'Suppressed' }), false)
})

// --- 3. utm_campaign is a slug -----------------------------------------------

test('the measured case: a free-text campaign name becomes a slug', () => {
  assert.equal(slugifyCampaign('Novidades de junho', 'fallback'), 'novidades-de-junho')
})

test('accents are folded, so one campaign is one GA4 row', () => {
  assert.equal(slugifyCampaign('Promoção de Verão', 'fallback'), 'promocao-de-verao')
  assert.equal(slugifyCampaign('We are in Iceland', 'fallback'), 'we-are-in-iceland')
})

test('a name with nothing sluggable falls back to the id, never to empty', () => {
  // An empty utm_campaign merges the campaign into every other unattributed session, which is
  // worse than an ugly value.
  assert.equal(slugifyCampaign('!!! ???', 'a1b2c3'), 'a1b2c3')
  assert.equal(slugifyCampaign('', 'a1b2c3'), 'a1b2c3')
})

test('the slug carries no character that needs escaping in a query string', () => {
  const slug = slugifyCampaign('Newsletter #7 — Búzios & Cabo Frio!', 'fallback')
  assert.equal(slug, encodeURIComponent(slug), `${slug} still needs escaping`)
})
